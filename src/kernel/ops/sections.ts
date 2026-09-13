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
import type { DefinitionId, SectionPlaneId } from '../ids';
import { aabbFromPoints, aabbIsEmpty, aabbUnion, EMPTY_AABB, type Aabb } from '../math/aabb';
import {
  classifyPointInRing,
  interiorPoint,
  signedArea,
  triangulatePolygon,
  type Point2,
} from '../math/geom2d';
import { transformPoint } from '../math/mat4';
import { planeBasis, projectTo2D } from '../math/plane';
import {
  add,
  AXIS_X,
  AXIS_Z,
  cross,
  distance,
  dot,
  length,
  normalize,
  scale,
  sub,
  vec3,
  type Vec3,
} from '../math/vec3';
import type { EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import { addDefinition, addInstance } from '../model/mutations';
import { isTagVisible } from '../model/visibility';
import { EPS_AREA, EPS_LEN, isParallelBySine, WELD_GRID_CELL_SIZE } from '../tolerance';
import type { CreatedInstance } from './hierarchy';
import { insertSegments } from './insertSegments';

/** A plane given by a point on it and its unit normal. */
export interface PointNormalPlane {
  readonly point: Vec3;
  readonly normal: Vec3;
}

export interface CutSegment {
  readonly a: Vec3;
  readonly b: Vec3;
}

/** The closed outlines where a plane cuts a context's faces, and their triangulation for drawing a fill. */
export interface SectionCut {
  readonly loops: readonly (readonly Vec3[])[];
  /** Nine coordinates per triangle, in the context's coordinates. */
  readonly triangles: readonly number[];
}

/** The section plane rectangle extends this far beyond the model's bounding sphere. */
const RECTANGLE_MARGIN = 1.15;
/** Smallest half-size of a section plane rectangle, in meters, so planes in empty contexts stay visible. */
const MIN_RECTANGLE_HALF_SIZE = 0.5;

/**
 * Where the plane crosses the visible faces of a context, as segments in the context's coordinates. Each face
 * contributes the parts of the intersection line that lie inside it (holes excluded). Faces parallel to the plane
 * contribute nothing.
 *
 * Vertices within the length tolerance of the plane always count as lying in front of it (the half-open rule), so
 * crossings pair up consistently: a boundary edge lying in the plane is reported by the faces behind the plane, and a
 * vertex that merely touches the plane produces no segment.
 */
export function sectionSegments(
  doc: ModelDocument,
  context: DefinitionId,
  plane: PointNormalPlane,
): CutSegment[] {
  const store = doc.store(context);
  const segments: CutSegment[] = [];
  const offset = dot(plane.normal, plane.point);
  for (const face of store.faces()) {
    if (face.attributes.hidden || !face.plane || !isTagVisible(doc, face.attributes.tagId)) continue;
    const rawDirection = cross(face.plane.normal, plane.normal);
    if (isParallelBySine(length(rawDirection))) continue;
    const direction = normalize(rawDirection);
    if (!direction) continue;
    const crossings: { readonly u: number; readonly point: Vec3 }[] = [];
    for (const loop of store.faceLoops(face.id)) {
      const points = store.loopPoints(loop);
      const distances = points.map((p) => dot(plane.normal, p) - offset);
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        const pi = points[i];
        const pj = points[j];
        const si = distances[i];
        const sj = distances[j];
        if (!pi || !pj || si === undefined || sj === undefined) continue;
        // Distances within tolerance count as "on or in front of" the plane.
        const aheadI = si >= -EPS_LEN;
        const aheadJ = sj >= -EPS_LEN;
        if (aheadI === aheadJ) continue;
        let point: Vec3;
        if (Math.abs(si) <= EPS_LEN) point = pi;
        else if (Math.abs(sj) <= EPS_LEN) point = pj;
        else point = add(pi, scale(sub(pj, pi), si / (si - sj)));
        crossings.push({ u: dot(direction, point), point });
      }
    }
    crossings.sort((a, b) => a.u - b.u);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const a = crossings[k];
      const b = crossings[k + 1];
      if (a && b && distance(a.point, b.point) > EPS_LEN) segments.push({ a: a.point, b: b.point });
    }
  }
  return segments;
}

/** Joins segments that share endpoints (within the length tolerance) into closed loops. Open chains are dropped. */
export function chainSegmentsIntoLoops(segments: readonly CutSegment[]): Vec3[][] {
  const nodes: Vec3[] = [];
  const grid = new Map<string, number[]>();
  const cellOf = (value: number): number => Math.round(value / WELD_GRID_CELL_SIZE);
  const nodeFor = (point: Vec3): number => {
    const cx = cellOf(point.x);
    const cy = cellOf(point.y);
    const cz = cellOf(point.z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const index of grid.get(`${String(cx + dx)},${String(cy + dy)},${String(cz + dz)}`) ?? []) {
            const node = nodes[index];
            if (node && distance(node, point) <= EPS_LEN) return index;
          }
        }
      }
    }
    const index = nodes.length;
    nodes.push(point);
    const key = `${String(cx)},${String(cy)},${String(cz)}`;
    const cell = grid.get(key);
    if (cell) cell.push(index);
    else grid.set(key, [index]);
    return index;
  };

  const edges: [number, number][] = [];
  const seen = new Set<string>();
  const adjacency = new Map<number, number[]>();
  for (const segment of segments) {
    const a = nodeFor(segment.a);
    const b = nodeFor(segment.b);
    if (a === b) continue;
    const key = a < b ? `${String(a)}:${String(b)}` : `${String(b)}:${String(a)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const edgeIndex = edges.length;
    edges.push([a, b]);
    for (const node of [a, b]) {
      const list = adjacency.get(node);
      if (list) list.push(edgeIndex);
      else adjacency.set(node, [edgeIndex]);
    }
  }

  const used = new Set<number>();
  const loops: Vec3[][] = [];
  for (let start = 0; start < edges.length; start++) {
    const first = edges[start];
    if (!first || used.has(start)) continue;
    used.add(start);
    const [origin, second] = first;
    const chain = [origin];
    let current = second;
    let closed = false;
    for (;;) {
      if (current === origin) {
        closed = true;
        break;
      }
      chain.push(current);
      const next = (adjacency.get(current) ?? []).find((edgeIndex) => !used.has(edgeIndex));
      if (next === undefined) break;
      used.add(next);
      const edge = edges[next];
      if (!edge) break;
      current = edge[0] === current ? edge[1] : edge[0];
    }
    if (closed && chain.length >= 3) loops.push(chain.map((index) => nodes[index] ?? vec3(0, 0, 0)));
  }
  return loops;
}

/**
 * The section cut of a context: closed outlines of the plane's intersection with its faces, triangulated with
 * nested outlines treated as holes (even-odd nesting). Works on open and non-manifold models; outlines that do not
 * close are left unfilled.
 */
export function sectionCut(doc: ModelDocument, context: DefinitionId, plane: PointNormalPlane): SectionCut {
  const loops = chainSegmentsIntoLoops(sectionSegments(doc, context, plane));
  const basis = planeBasis(plane.normal);
  const rings = loops
    .map((loop) => {
      const ring = loop.map((p) => projectTo2D(basis, p));
      return { loop, ring, area: Math.abs(signedArea(ring)) };
    })
    .filter((entry) => entry.area > EPS_AREA)
    .sort((a, b) => b.area - a.area);

  const samples = rings.map((entry) => interiorPoint(entry.ring, []));
  const containers = rings.map((_, index) =>
    rings
      .map((other, otherIndex) => ({ other, otherIndex }))
      .filter(({ other, otherIndex }) => {
        const sample = samples[index];
        return otherIndex !== index &&
          other.area > (rings[index]?.area ?? 0) &&
          sample !== null &&
          sample !== undefined
          ? classifyPointInRing(sample, other.ring) === 'inside'
          : false;
      })
      .map(({ otherIndex }) => otherIndex),
  );
  const depth = containers.map((list) => list.length);

  const triangles: number[] = [];
  const kept: Vec3[][] = [];
  rings.forEach((entry, index) => {
    if ((depth[index] ?? 0) % 2 !== 0) return;
    const holes = rings.filter((_, holeIndex) => {
      if ((depth[holeIndex] ?? 0) !== (depth[index] ?? 0) + 1) return false;
      // The hole's innermost container must be this outline.
      const parents = containers[holeIndex] ?? [];
      const innermost = parents.reduce<number | null>(
        (best, candidate) =>
          best === null || (rings[candidate]?.area ?? 0) < (rings[best]?.area ?? 0) ? candidate : best,
        null,
      );
      return innermost === index;
    });
    const points: Vec3[] = [...entry.loop, ...holes.flatMap((hole) => hole.loop)];
    const indices = triangulatePolygon(
      entry.ring,
      holes.map((hole) => hole.ring as readonly Point2[]),
    );
    for (const i of indices) {
      const p = points[i];
      if (p) triangles.push(p.x, p.y, p.z);
    }
    kept.push([...entry.loop], ...holes.map((hole) => [...hole.loop]));
  });
  return { loops: kept, triangles };
}

/** Bounds of a context's geometry and visible nested instances, in its own coordinates. */
export function contextContentBounds(
  doc: ModelDocument,
  definitionId: DefinitionId,
  cache = new Map<DefinitionId, Aabb>(),
): Aabb {
  const cached = cache.get(definitionId);
  if (cached) return cached;
  cache.set(definitionId, EMPTY_AABB);
  const store: EntityStore = doc.store(definitionId);
  let box = aabbFromPoints([...store.vertices()].map((vertex) => vertex.position));
  for (const instance of store.instances()) {
    if (instance.attributes.hidden) continue;
    const child = contextContentBounds(doc, instance.definitionId, cache);
    if (aabbIsEmpty(child)) continue;
    const corners: Vec3[] = [];
    for (const x of [child.minX, child.maxX]) {
      for (const y of [child.minY, child.maxY]) {
        for (const z of [child.minZ, child.maxZ])
          corners.push(transformPoint(instance.transform, vec3(x, y, z)));
      }
    }
    box = aabbUnion(box, aabbFromPoints(corners));
  }
  cache.set(definitionId, box);
  return box;
}

/**
 * The four corners, in order, of the rectangle that shows a section plane: centered on the projection of the
 * content's center and large enough to span the content.
 */
export function sectionRectangle(plane: PointNormalPlane, bounds: Aabb): [Vec3, Vec3, Vec3, Vec3] {
  const empty = aabbIsEmpty(bounds);
  const center = empty
    ? plane.point
    : vec3((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2);
  const onPlane = sub(center, scale(plane.normal, dot(plane.normal, sub(center, plane.point))));
  const halfDiagonal = empty
    ? 0
    : length(vec3(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ)) / 2;
  const half = Math.max(halfDiagonal * RECTANGLE_MARGIN, MIN_RECTANGLE_HALF_SIZE);
  const u =
    (isParallelBySine(length(cross(plane.normal, AXIS_Z))) ? null : normalize(cross(AXIS_Z, plane.normal))) ??
    normalize(cross(plane.normal, AXIS_X)) ??
    AXIS_X;
  const v = cross(plane.normal, u);
  const corner = (su: number, sv: number): Vec3 =>
    add(onPlane, add(scale(u, su * half), scale(v, sv * half)));
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

/**
 * Puts the edges where a section plane cuts the context's faces into a new group in the same context, with faces
 * wherever the edges enclose an area.
 */
export function createGroupFromSlice(
  doc: ModelDocument,
  context: DefinitionId,
  sectionPlaneId: SectionPlaneId,
): CreatedInstance {
  return doc.transact('Create Group from Slice', () => {
    const plane = doc.store(context).getSectionPlane(sectionPlaneId);
    const segments = sectionSegments(doc, context, plane);
    if (segments.length === 0) {
      throw new KernelError('invalid-operation', 'The section plane does not cut any faces here');
    }
    const definition = addDefinition(doc, { name: 'Group', isGroup: true });
    insertSegments(doc, definition, segments, { autoFace: true, orientationHint: plane.normal });
    const instance = addInstance(doc, context, definition);
    return { definition, instance };
  });
}
