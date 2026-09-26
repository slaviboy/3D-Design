/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { KernelError } from '../errors';
import type { CurveId, DefinitionId, EdgeId, FaceId, VertexId } from '../ids';
import { aabbExpand, aabbFromPoints, aabbUnion, type Aabb } from '../math/aabb';
import { polygonsOverlap } from '../math/geom2d';
import { translation } from '../math/mat4';
import {
  planeBasis,
  planeFromPointNormal,
  planeFromPolygon,
  planesCoincide,
  signedDistanceToPlane,
} from '../math/plane';
import { closestPointsOnSegments } from '../math/segment';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../math/vec3';
import type { CurveView, EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import { addCurve, moveVertex, removeFace, reverseFace } from '../model/mutations';
import { DEFAULT_EDGE_ATTRIBUTES, DEFAULT_FACE_ATTRIBUTES, type EdgeAttributes } from '../model/types';
import { EPS_LEN, EPS_PARALLEL, isParallelBySine } from '../tolerance';
import { isSmoothJoint, transformCurveParams } from './curves';
import { eraseEdges, removeEdgeAndOrphans } from './erase';
import { insertSegments, type SegmentInput } from './insertSegments';
import { faceRings, type FaceRings } from './planar/regions';
import { settleLandedFace, settleRegion } from './planar/settle';

/**
 * - `stretch`: the face moves and its perpendicular neighbors grow or shrink with it; no new entities.
 * - `extrude`: a new cap face and side faces are built; the original face is removed, kept as the base of a
 *   free-standing face, or kept on request.
 */
export type PushPullMode = 'stretch' | 'extrude';

export interface PushPullOptions {
  /** Keep the original face and extrude a new one from it (Ctrl in the reference workflow). */
  readonly createNewStartFace?: boolean;
}

export interface PushPullResult {
  readonly mode: PushPullMode;
  /** The face at the end of the push or pull, or null when it cancelled against an opposite face. */
  readonly face: FaceId | null;
}

const SOFT_SMOOTH_EDGE: EdgeAttributes = Object.freeze({
  ...DEFAULT_EDGE_ATTRIBUTES,
  soft: true,
  smooth: true,
});

function faceVertices(store: EntityStore, faceId: FaceId): VertexId[] {
  return [...new Set(store.faceLoops(faceId).flatMap((loop) => store.loopVertices(loop)))];
}

/** Faces other than `faceId` that share an edge or a vertex with it. */
function neighborFaces(store: EntityStore, faceId: FaceId): Set<FaceId> {
  const neighbors = new Set<FaceId>();
  for (const vertex of faceVertices(store, faceId)) {
    for (const edgeId of store.getVertex(vertex).edges) {
      for (const other of store.getEdge(edgeId).faces) if (other !== faceId) neighbors.add(other);
    }
  }
  return neighbors;
}

/**
 * Whether the face spans an opening in a shape that is closed without it: every edge of it is already shared by two
 * other faces, as for a rectangle drawn over the top of a hole. Empty space lies on both of its sides.
 */
function spansOpening(store: EntityStore, faceId: FaceId): boolean {
  return store
    .faceEdges(faceId)
    .every((edgeId) => store.getEdge(edgeId).faces.filter((other) => other !== faceId).length >= 2);
}

/** How a push or pull of this face would be carried out. */
export function pushPullMode(
  store: EntityStore,
  faceId: FaceId,
  options: PushPullOptions = {},
): PushPullMode {
  if (options.createNewStartFace === true) return 'extrude';
  const normal = store.getFacePlane(faceId).normal;
  const neighbors = neighborFaces(store, faceId);
  if (neighbors.size === 0) return 'extrude';
  for (const neighborId of neighbors) {
    const plane = store.getFace(neighborId).plane;
    // Only faces containing the push direction can follow the moved face and stay planar.
    if (!plane || Math.abs(dot(plane.normal, normal)) > EPS_PARALLEL) return 'extrude';
  }
  return 'stretch';
}

/**
 * The lowest distance (along the face normal) a stretch can reach before a neighboring face collapses.
 * Returns -Infinity when nothing limits it.
 */
function stretchLimit(store: EntityStore, faceId: FaceId, normal: Vec3): number {
  const vertices = new Set(faceVertices(store, faceId));
  let limit = -Infinity;
  for (const vertex of vertices) {
    const origin = store.position(vertex);
    for (const edgeId of store.getVertex(vertex).edges) {
      const other = store.otherVertex(edgeId, vertex);
      if (vertices.has(other)) continue;
      const along = dot(sub(store.position(other), origin), normal);
      if (along < 0) limit = Math.max(limit, along);
    }
  }
  return limit;
}

/** `box` moved by `offset`. */
function shifted(box: Aabb, offset: Vec3): Aabb {
  return {
    minX: box.minX + offset.x,
    minY: box.minY + offset.y,
    minZ: box.minZ + offset.z,
    maxX: box.maxX + offset.x,
    maxY: box.maxY + offset.y,
    maxZ: box.maxZ + offset.z,
  };
}

/**
 * How far behind `faceId` the far side is: the nearest face behind it (against its normal) that is parallel to it,
 * faces the other way and overlaps it. Null when there is none, or none within `reach` when it is given.
 */
function farSideDistance(store: EntityStore, faceId: FaceId, reach?: number): number | null {
  const plane = store.getFacePlane(faceId);
  let candidates: Iterable<FaceId>;
  if (reach === undefined) {
    candidates = [...store.faces()].map((face) => face.id);
  } else {
    const bounds = store.faceBounds(faceId);
    const swept = aabbUnion(bounds, shifted(bounds, scale(plane.normal, -reach)));
    candidates = store.queryFaces(aabbExpand(swept, EPS_LEN));
  }
  const basis = planeBasis(plane.normal);
  let own: FaceRings | null = null;
  let nearest: number | null = null;
  for (const otherId of candidates) {
    const other = store.face(otherId);
    const otherPlane = other?.plane;
    if (otherId === faceId || !other || !otherPlane || dot(otherPlane.normal, plane.normal) >= 0) continue;
    if (!isParallelBySine(length(cross(otherPlane.normal, plane.normal)))) continue;
    const corner = store.loopPoints(other.outer)[0];
    if (!corner) continue;
    const depth = -signedDistanceToPlane(plane, corner);
    if (depth <= EPS_LEN || (nearest !== null && depth >= nearest)) continue;
    if (reach !== undefined && depth > reach + EPS_LEN) continue;
    own ??= faceRings(store, faceId, basis);
    const rings = faceRings(store, otherId, basis);
    if (polygonsOverlap(own.outer, own.inners, rings.outer, rings.inners)) nearest = depth;
  }
  return nearest;
}

/** Where a push into a face's back side stops (see {@link pushPullLimit}). */
export interface PushPullLimit {
  /** How far the face can be pushed in. */
  readonly distance: number;
  /**
   * - `far-side`: the face reaches the far side of the shape and cuts through there. A box's top pushed onto its own
   *   bottom takes the whole box with it.
   * - `flush`: the walls it stretches end there, and it lands flush with the surface they rise from, as a bump or a
   *   step pushed back down does.
   */
  readonly kind: 'far-side' | 'flush';
}

/**
 * How far a face can be pushed into its back side, and why it stops there: at the far side of the shape (the nearest
 * face behind it that is parallel to it, faces the other way and overlaps it), or, when it stretches, where the walls
 * it stretches end. Pushing exactly that far lands there; pushing further is refused (the reference's "offset is
 * limited"). Null when nothing stops it, and for a free-standing face, which has nothing behind it.
 */
export function pushPullLimit(
  store: EntityStore,
  faceId: FaceId,
  options: PushPullOptions = {},
): PushPullLimit | null {
  if (neighborFaces(store, faceId).size === 0) return null;
  const farSide = farSideDistance(store, faceId);
  const flush = pushPullMode(store, faceId, options) === 'stretch' ? flushDistance(store, faceId) : null;
  // At the same depth the far side says more: landing there cuts through, walls and all.
  if (flush !== null && (farSide === null || flush < farSide - EPS_LEN))
    return { distance: flush, kind: 'flush' };
  return farSide === null ? null : { distance: farSide, kind: 'far-side' };
}

/**
 * How far a stretch can push the face into its back side before the walls it stretches end, where it comes down on
 * what they rise from. Null when no wall ends behind the face, or the face would not come down on anything there.
 */
function flushDistance(store: EntityStore, faceId: FaceId): number | null {
  const flat = stretchLimit(store, faceId, store.getFacePlane(faceId).normal);
  return Number.isFinite(flat) && wouldTouch(store, faceId, flat) ? -flat : null;
}

/**
 * Whether moving the face by `travel` along its normal would bring its outline onto other geometry: a corner onto
 * another vertex or edge, or an edge onto or across another edge. Edges that move or stretch with the face don't count.
 */
function wouldTouch(store: EntityStore, faceId: FaceId, travel: number): boolean {
  const offset = scale(store.getFacePlane(faceId).normal, travel);
  const moving = new Set<EdgeId>();
  for (const vertex of faceVertices(store, faceId))
    for (const edge of store.getVertex(vertex).edges) moving.add(edge);
  for (const loop of store.faceLoops(faceId)) {
    for (const { edge: edgeId } of loop) {
      const edge = store.getEdge(edgeId);
      const a = add(store.position(edge.v0), offset);
      const b = add(store.position(edge.v1), offset);
      for (const otherId of store.queryEdges(aabbExpand(aabbFromPoints([a, b]), EPS_LEN))) {
        if (moving.has(otherId)) continue;
        const other = store.getEdge(otherId);
        const gap = closestPointsOnSegments(
          a,
          b,
          store.position(other.v0),
          store.position(other.v1),
        ).distance;
        if (gap <= EPS_LEN) return true;
      }
    }
  }
  return false;
}

/**
 * Carries out a stretch whose face would land on other geometry as an extrusion from where the face is, since
 * inserting the new walls and cap welds and splits whatever they meet. The walls' old and new parts are then healed
 * into one face each, as the stretch would have left them.
 */
function stretchByExtruding(
  doc: ModelDocument,
  context: DefinitionId,
  faceId: FaceId,
  travel: number,
): FaceId | null {
  const store = doc.store(context);
  const outline = store.faceEdges(faceId);
  const face = extrude(doc, context, faceId, travel, false);
  const seams = outline.filter((edgeId) => {
    const faces = store.edge(edgeId)?.faces ?? [];
    const [a, b] = faces.map((id) => store.getFace(id).plane);
    return faces.length === 2 && !!a && !!b && planesCoincide(a, b) && dot(a.normal, b.normal) > 0;
  });
  eraseEdges(doc, context, seams);
  return face;
}

/** Whether another face of the store lies in the face's plane and shares some of its area. */
function liesOnAnotherFace(store: EntityStore, faceId: FaceId): boolean {
  const plane = store.getFacePlane(faceId);
  const basis = planeBasis(plane.normal);
  const own = faceRings(store, faceId, basis);
  return store.queryFaces(aabbExpand(store.faceBounds(faceId), EPS_LEN)).some((otherId) => {
    const otherPlane = otherId === faceId ? null : store.face(otherId)?.plane;
    if (!otherPlane || !planesCoincide(otherPlane, plane)) return false;
    const rings = faceRings(store, otherId, basis);
    return polygonsOverlap(own.outer, own.inners, rings.outer, rings.inners);
  });
}

/**
 * Pushes or pulls a planar face by `distance` along its normal (negative pushes into the face's back side).
 * GEOMETRY.md ("Algorithm: Push/Pull").
 */
export function pushPull(
  doc: ModelDocument,
  context: DefinitionId,
  faceId: FaceId,
  distance: number,
  options: PushPullOptions = {},
): PushPullResult {
  const store = doc.store(context);
  const plane = store.getFacePlane(faceId);
  if (!Number.isFinite(distance))
    throw new KernelError('invalid-geometry', 'The distance must be a finite number');
  const mode = pushPullMode(store, faceId, options);
  if (Math.abs(distance) <= EPS_LEN) return { mode, face: faceId };

  // A push into the shape stops at its far side. Right there it cuts through, so a distance a rounding error short or
  // long lands exactly on it.
  let travel = distance;
  if (travel < 0 && neighborFaces(store, faceId).size > 0) {
    const farSide = farSideDistance(store, faceId, -travel + EPS_LEN);
    if (farSide !== null) {
      if (-travel > farSide + EPS_LEN) {
        throw new KernelError('invalid-operation', "Push/Pull can't go past the face on the other side");
      }
      if (-travel >= farSide - EPS_LEN) travel = -farSide;
    }
  }

  return doc.transact('Push/Pull', () => {
    if (mode === 'stretch') {
      // Exactly flat, the walls end and the face comes down on what they rise from. It lands there as a stretch onto
      // other geometry does: a box's top pushed onto its bottom takes the box with it, and a bump pushed back flush
      // merges into its surface. Any further would turn the walls inside out.
      const flat = stretchLimit(store, faceId, plane.normal);
      if (Math.abs(travel - flat) <= EPS_LEN && wouldTouch(store, faceId, flat)) {
        return { mode: 'extrude', face: stretchByExtruding(doc, context, faceId, flat) };
      }
      if (travel <= flat + EPS_LEN) {
        throw new KernelError('invalid-operation', 'Push/Pull cannot flatten the neighboring faces');
      }
      if (wouldTouch(store, faceId, travel)) {
        return { mode: 'extrude', face: stretchByExtruding(doc, context, faceId, travel) };
      }
      const offset = scale(plane.normal, travel);
      for (const vertex of faceVertices(store, faceId)) {
        moveVertex(doc, context, vertex, add(store.position(vertex), offset));
      }
      // Moved onto the inside of another face (the far side, or a face it was pulled up against): settle it as an
      // extrusion's cap would be, instead of leaving two faces in one place.
      if (liesOnAnotherFace(store, faceId)) {
        return { mode, face: settleLandedFace(doc, context, faceId)[0] ?? null };
      }
      return { mode, face: faceId };
    }
    return { mode, face: extrude(doc, context, faceId, travel, options.createNewStartFace === true) };
  });
}

interface CapturedLoop {
  readonly points: readonly Vec3[];
  readonly edges: readonly EdgeId[];
  readonly curves: readonly (CurveId | null)[];
}

function extrude(
  doc: ModelDocument,
  context: DefinitionId,
  faceId: FaceId,
  distance: number,
  keepOriginal: boolean,
): FaceId | null {
  const store = doc.store(context);
  const face = store.getFace(faceId);
  const normal = store.getFacePlane(faceId).normal;
  const offset = scale(normal, distance);
  const travel = scale(normal, Math.sign(distance));
  // A free-standing face, or one spanning an opening, becomes the base of a new closed shape: nothing solid lies on
  // either side of it, so the extrusion stands on it instead of opening into what is behind it.
  const base = neighborFaces(store, faceId).size === 0 || spansOpening(store, faceId);
  const attributes = face.attributes;
  const loops: CapturedLoop[] = store.faceLoops(faceId).map((loop) => ({
    points: store.loopPoints(loop),
    edges: loop.map((use) => use.edge),
    curves: loop.map((use) => store.getEdge(use.edge).curve),
  }));
  const sourceCurves = new Map<CurveId, CurveView>();
  for (const loop of loops) {
    for (const curveId of loop.curves)
      if (curveId !== null) sourceCurves.set(curveId, store.getCurve(curveId));
  }

  if (base) {
    // The base faces away from the extrusion.
    if (dot(normal, travel) > 0) reverseFace(doc, context, faceId);
  } else if (!keepOriginal) {
    removeFace(doc, context, faceId);
  }

  const segments: SegmentInput[] = [];
  const capSegments: number[][] = [];
  const sideSegments: number[][] = [];
  for (const loop of loops) {
    const count = loop.points.length;
    const caps: number[] = [];
    const sides: number[] = [];
    for (let i = 0; i < count; i++) {
      const p = loop.points[i];
      const q = loop.points[(i + 1) % count];
      if (!p || !q) continue;
      caps.push(segments.push({ a: add(p, offset), b: add(q, offset) }) - 1);
      // The side edge at a vertex inside a round curve is soft and smooth, so extruded arcs look round; a polygon
      // keeps its corners.
      const previousCurve = loop.curves[(i - 1 + count) % count] ?? null;
      const smooth = isSmoothJoint(store, previousCurve, loop.curves[i] ?? null);
      sides.push(
        segments.push({ a: p, b: add(p, offset), ...(smooth ? { attributes: SOFT_SMOOTH_EDGE } : {}) }) - 1,
      );
    }
    capSegments.push(caps);
    sideSegments.push(sides);
  }
  const inserted = insertSegments(doc, context, segments, { autoFace: false });
  const edgesOf = (index: number | undefined): readonly EdgeId[] =>
    index === undefined ? [] : (inserted.segmentEdges[index] ?? []);
  const touched = new Set<EdgeId>([
    ...loops.flatMap((loop) => loop.edges),
    ...inserted.segmentEdges.flatMap((edges) => edges),
  ]);

  // Cap: faces the push direction on a base, otherwise keeps the original face's orientation.
  const capOuter = (loops[0]?.points ?? []).map((p) => add(p, offset));
  const capFaces = settleRegion(doc, context, {
    plane: planeFromPointNormal(capOuter[0] ?? offset, normal),
    seeds: capSegments.flat().flatMap((index) => edgesOf(index)),
    outer: capOuter,
    inners: loops.slice(1).map((loop) => loop.points.map((p) => add(p, offset))),
    normal: base ? travel : normal,
    attributes,
    rule: 'cancel-opposite',
  });

  // Sides face away from the material: outward on a base or for a pull, into the pocket for a push.
  const sideSign = base || distance > 0 ? 1 : -1;
  loops.forEach((loop, loopIndex) => {
    const count = loop.points.length;
    const caps = capSegments[loopIndex] ?? [];
    const sides = sideSegments[loopIndex] ?? [];
    for (let i = 0; i < count; i++) {
      const p = loop.points[i];
      const q = loop.points[(i + 1) % count];
      const originalEdge = loop.edges[i];
      if (!p || !q) continue;
      const quad = [p, q, add(q, offset), add(p, offset)];
      const quadPlane = planeFromPolygon(quad);
      const sideNormal = normalize(scale(cross(sub(q, p), normal), sideSign));
      if (!quadPlane || !sideNormal) continue;
      settleRegion(doc, context, {
        plane: quadPlane,
        seeds: [
          ...edgesOf(caps[i]),
          ...edgesOf(sides[i]),
          ...edgesOf(sides[(i + 1) % count]),
          ...(originalEdge !== undefined && store.edge(originalEdge) ? [originalEdge] : []),
        ],
        outer: quad,
        inners: [],
        normal: sideNormal,
        attributes: DEFAULT_FACE_ATTRIBUTES,
        rule: 'cancel-opposite',
      });
    }
  });

  // Curves on the cap follow the original curves.
  const move = translation(offset);
  for (const [curveId, curve] of sourceCurves) {
    const capEdges = loops.flatMap((loop, loopIndex) =>
      loop.curves.flatMap((id, i) => (id === curveId ? edgesOf(capSegments[loopIndex]?.[i]) : [])),
    );
    const unique = new Set(capEdges).size === capEdges.length;
    if (capEdges.length === 0 || !unique || !capEdges.every((id) => store.edge(id)?.curve === null)) continue;
    addCurve(
      doc,
      context,
      curve.edges.length === capEdges.length
        ? transformCurveParams(curve.params, move)
        : { kind: 'polyline' },
      capEdges,
    );
  }

  // Where the push cut through, the outline's edges and the new ones there may bound nothing now (GEOMETRY.md,
  // step 5): lines across the opening would be left behind.
  for (const edgeId of touched) {
    if (store.edge(edgeId)?.faces.length === 0) removeEdgeAndOrphans(doc, context, edgeId);
  }
  return capFaces[0] ?? null;
}
