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
import { translation } from '../math/mat4';
import { planeFromPointNormal, planeFromPolygon } from '../math/plane';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../math/vec3';
import type { CurveView, EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import { addCurve, moveVertex, removeFace, reverseFace } from '../model/mutations';
import { DEFAULT_EDGE_ATTRIBUTES, DEFAULT_FACE_ATTRIBUTES, type EdgeAttributes } from '../model/types';
import { EPS_LEN, EPS_PARALLEL } from '../tolerance';
import { transformCurveParams } from './curves';
import { insertSegments, type SegmentInput } from './insertSegments';
import { settleRegion } from './planar/settle';

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

  return doc.transact('Push/Pull', () => {
    if (mode === 'stretch') {
      if (distance <= stretchLimit(store, faceId, plane.normal) + EPS_LEN) {
        throw new KernelError('invalid-operation', 'Push/Pull cannot flatten the neighboring faces');
      }
      const offset = scale(plane.normal, distance);
      for (const vertex of faceVertices(store, faceId)) {
        moveVertex(doc, context, vertex, add(store.position(vertex), offset));
      }
      return { mode, face: faceId };
    }
    return { mode, face: extrude(doc, context, faceId, distance, options.createNewStartFace === true) };
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
  const isFree = neighborFaces(store, faceId).size === 0;
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

  if (isFree) {
    // A free-standing face becomes the base of a closed shape, facing away from the extrusion.
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
      // The side edge at a vertex inside a curve is soft and smooth, so extruded arcs look round.
      const previousCurve = loop.curves[(i - 1 + count) % count] ?? null;
      const smooth = previousCurve !== null && previousCurve === loop.curves[i];
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

  // Cap: faces the push direction for a free face, otherwise keeps the original face's orientation.
  const capOuter = (loops[0]?.points ?? []).map((p) => add(p, offset));
  const capFaces = settleRegion(doc, context, {
    plane: planeFromPointNormal(capOuter[0] ?? offset, normal),
    seeds: capSegments.flat().flatMap((index) => edgesOf(index)),
    outer: capOuter,
    inners: loops.slice(1).map((loop) => loop.points.map((p) => add(p, offset))),
    normal: isFree ? travel : normal,
    attributes,
    rule: 'cancel-opposite',
  });

  // Sides face away from the material: outward for a free face or a pull, into the pocket for a push.
  const sideSign = isFree || distance > 0 ? 1 : -1;
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
  return capFaces[0] ?? null;
}
