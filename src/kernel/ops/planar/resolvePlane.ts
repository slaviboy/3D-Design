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

import type { DefinitionId, EdgeId, FaceId, VertexId } from '../../ids';
import { aabbExpand, aabbFromPoints, aabbIsEmpty, aabbUnion, EMPTY_AABB, type Aabb } from '../../math/aabb';
import { classifyPointInPolygon } from '../../math/geom2d';
import { isPointOnPlane, planeBasis, planesCoincide, unprojectFrom2D, type Plane } from '../../math/plane';
import { AXIS_Z, cross, dot, length, type Vec3 } from '../../math/vec3';
import type { EntityStore } from '../../model/EntityStore';
import type { ModelDocument } from '../../model/ModelDocument';
import { addFace, setFaceLoops } from '../../model/mutations';
import type { FaceAttributes } from '../../model/types';
import { EPS_LEN, isParallelBySine } from '../../tolerance';
import {
  buildRegions,
  faceMatchesRegion,
  faceRings,
  loopsForRegion,
  type FaceRings,
  type PlanarRegion,
} from './regions';

export interface RegionDecision {
  readonly attributes: FaceAttributes;
  /** Desired direction of the new face's normal. When omitted, the standard orientation rules apply. */
  readonly normal?: Vec3;
}

/** Decides whether a region that no existing face covers should become a face. */
export interface RegionPolicy {
  decide(region: PlanarRegion, sample: Vec3): RegionDecision | null;
}

export const NEVER_CREATE_FACES: RegionPolicy = { decide: () => null };

export interface ResolvePlaneOptions {
  readonly policy: RegionPolicy;
  /** Preferred direction for new faces that have no neighbouring face to agree with (for example, toward the viewer). */
  readonly orientationHint?: Vec3 | undefined;
}

export interface ResolvePlaneResult {
  readonly createdFaces: readonly FaceId[];
  readonly splitFaces: readonly FaceId[];
}

/**
 * Brings the faces in one plane back in line with the edges in that plane: existing faces are split where edges
 * now divide them, and regions no face covers are offered to `policy`.
 * Steps 6–11 of GEOMETRY.md ("Algorithm: insertSegments").
 */
export function resolvePlane(
  doc: ModelDocument,
  context: DefinitionId,
  plane: Plane,
  seeds: Iterable<EdgeId>,
  options: ResolvePlaneOptions,
): ResolvePlaneResult {
  const store = doc.store(context);
  const edgeIds = gatherPlanarEdges(store, plane, seeds);
  if (edgeIds.length < 3) return { createdFaces: [], splitFaces: [] };

  const basis = planeBasis(plane.normal);
  const regions = buildRegions(store, basis, edgeIds);

  const candidateFaces = new Set<FaceId>();
  for (const edgeId of edgeIds) {
    for (const faceId of store.getEdge(edgeId).faces) {
      const facePlane = store.getFace(faceId).plane;
      if (facePlane && planesCoincide(facePlane, plane)) candidateFaces.add(faceId);
    }
  }
  const sortedCandidates = [...candidateFaces].sort((a, b) => a - b);
  const ringsByFace = new Map<FaceId, FaceRings>();
  const ringsOf = (faceId: FaceId): FaceRings => {
    let rings = ringsByFace.get(faceId);
    if (!rings) {
      rings = faceRings(store, faceId, basis);
      ringsByFace.set(faceId, rings);
    }
    return rings;
  };

  const regionsByFace = new Map<FaceId, PlanarRegion[]>();
  const uncovered: PlanarRegion[] = [];
  for (const region of regions) {
    /*
     * A face whose polygon contains the region's sample also has the sample inside its bounds, so the face index
     * narrows the search to a few faces instead of testing every candidate (which was quadratic on large connected
     * planes). Faces aren't changed until every region is assigned, so the index is current. Lowest id still wins.
     */
    const sample = unprojectFrom2D(basis, plane, region.sample);
    const cover = store
      .queryFaces(aabbExpand(aabbFromPoints([sample]), EPS_LEN))
      .filter((faceId) => candidateFaces.has(faceId))
      .sort((a, b) => a - b)
      .find((faceId) => {
        const rings = ringsOf(faceId);
        return classifyPointInPolygon(region.sample, rings.outer, rings.inners) === 'inside';
      });
    if (cover === undefined) {
      uncovered.push(region);
    } else {
      const list = regionsByFace.get(cover);
      if (list) list.push(region);
      else regionsByFace.set(cover, [region]);
    }
  }

  const createdFaces: FaceId[] = [];
  const splitFaces: FaceId[] = [];

  for (const faceId of sortedCandidates) {
    const covered = regionsByFace.get(faceId);
    if (!covered) continue;
    const [only] = covered;
    if (covered.length === 1 && only && faceMatchesRegion(store, faceId, only)) continue;
    const face = store.getFace(faceId);
    const facePlane = face.plane;
    if (!facePlane) continue;
    const sameDirection = dot(facePlane.normal, plane.normal) > 0;
    const attributes = face.attributes;
    const [largest, ...rest] = [...covered].sort((a, b) => b.area - a.area);
    if (!largest) continue;
    setFaceLoops(doc, context, faceId, loopsForRegion(largest, sameDirection));
    splitFaces.push(faceId);
    for (const region of rest) {
      createdFaces.push(addFace(doc, context, loopsForRegion(region, sameDirection), attributes));
    }
  }

  for (const region of uncovered) {
    const decision = options.policy.decide(region, unprojectFrom2D(basis, plane, region.sample));
    if (!decision) continue;
    const sameDirection = decision.normal
      ? dot(decision.normal, plane.normal) >= 0
      : chooseOrientation(store, plane, region, options.orientationHint);
    createdFaces.push(addFace(doc, context, loopsForRegion(region, sameDirection), decision.attributes));
  }

  return { createdFaces, splitFaces };
}

/**
 * All edges in `plane` that can bound regions touching the seeds. That means the seeds, every in-plane edge
 * connected to them, and every in-plane edge or coplanar face boundary inside the growing bounding box. The box
 * part catches enclosing faces and disconnected holes.
 */
export function gatherPlanarEdges(store: EntityStore, plane: Plane, seeds: Iterable<EdgeId>): EdgeId[] {
  const onPlaneCache = new Map<VertexId, boolean>();
  const vertexOnPlane = (vertex: VertexId): boolean => {
    let value = onPlaneCache.get(vertex);
    if (value === undefined) {
      value = isPointOnPlane(plane, store.position(vertex));
      onPlaneCache.set(vertex, value);
    }
    return value;
  };
  const edgeOnPlane = (id: EdgeId): boolean => {
    const edge = store.edge(id);
    return edge !== undefined && vertexOnPlane(edge.v0) && vertexOnPlane(edge.v1);
  };

  const result = new Set<EdgeId>();
  const visitedFaces = new Set<FaceId>();
  let bounds: Aabb = EMPTY_AABB;
  const queue: EdgeId[] = [];
  for (const seed of seeds) if (edgeOnPlane(seed)) queue.push(seed);

  const drain = (): void => {
    while (queue.length > 0) {
      const id = queue.pop();
      if (id === undefined || result.has(id)) continue;
      result.add(id);
      const edge = store.getEdge(id);
      bounds = aabbUnion(bounds, store.edgeBounds(id));
      for (const vertex of [edge.v0, edge.v1]) {
        for (const neighbour of store.getVertex(vertex).edges) {
          if (!result.has(neighbour) && edgeOnPlane(neighbour)) queue.push(neighbour);
        }
      }
    }
  };

  drain();
  for (;;) {
    if (aabbIsEmpty(bounds)) break;
    const box = aabbExpand(bounds, EPS_LEN);
    for (const id of store.queryEdges(box)) {
      if (!result.has(id) && edgeOnPlane(id)) queue.push(id);
    }
    for (const faceId of store.queryFaces(box)) {
      if (visitedFaces.has(faceId)) continue;
      const facePlane = store.getFace(faceId).plane;
      if (!facePlane || !planesCoincide(facePlane, plane)) continue;
      visitedFaces.add(faceId);
      for (const edgeId of store.faceEdges(faceId)) if (!result.has(edgeId)) queue.push(edgeId);
    }
    if (queue.length === 0) break;
    drain();
  }
  return [...result].sort((a, b) => a - b);
}

/** Face orientation rules for a new face (GEOMETRY.md, insertSegments step 11). Returns true to face along `plane.normal`. */
function chooseOrientation(
  store: EntityStore,
  plane: Plane,
  region: PlanarRegion,
  hint: Vec3 | undefined,
): boolean {
  let coplanarVote: boolean | undefined;
  for (const cycle of [region.outer, ...region.holes]) {
    for (const use of cycle.uses) {
      const neighbours = store.getEdge(use.edge).faces;
      for (const neighbourId of neighbours) {
        const neighbour = store.getFace(neighbourId);
        const neighbourUse = [neighbour.outer, ...neighbour.inners]
          .flat()
          .find((candidate) => candidate.edge === use.edge);
        if (!neighbourUse) continue;
        // Consistently oriented faces traverse a shared edge in opposite directions.
        const agrees = neighbourUse.reversed !== use.reversed;
        const coplanar = neighbour.plane !== null && planesCoincide(neighbour.plane, plane);
        if (coplanar) {
          coplanarVote ??= agrees;
        } else if (neighbours.length === 1) {
          // The new face closes the surface along this edge, as the last face of a box does. Where two faces meet
          // already (the top and a wall at the rim of a hole), the shape is closed without it, and the surface around
          // it decides instead.
          return agrees;
        }
      }
    }
  }
  if (coplanarVote !== undefined) return coplanarVote;
  if (isGroundPlane(plane)) return plane.normal.z < 0;
  if (hint) return dot(plane.normal, hint) >= 0;
  return true;
}

/** Horizontal plane at z = 0. New faces there start with their back side up, matching the reference workflows. */
function isGroundPlane(plane: Plane): boolean {
  return isParallelBySine(length(cross(plane.normal, AXIS_Z))) && Math.abs(plane.offset) <= EPS_LEN;
}
