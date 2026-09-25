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

import type { DefinitionId, EdgeId, FaceId } from '../../ids';
import { aabbExpand, aabbFromPoints } from '../../math/aabb';
import { classifyPointInPolygon, interiorPoint, type Point2 } from '../../math/geom2d';
import {
  canonicalPlane,
  planeBasis,
  planesCoincide,
  projectTo2D,
  unprojectFrom2D,
  type Plane,
} from '../../math/plane';
import { dot, type Vec3 } from '../../math/vec3';
import type { ModelDocument } from '../../model/ModelDocument';
import { removeFace } from '../../model/mutations';
import type { FaceAttributes } from '../../model/types';
import { EPS_LEN } from '../../tolerance';
import { faceRings } from './regions';
import { NEVER_CREATE_FACES, resolvePlane } from './resolvePlane';

/**
 * What happens when new geometry lands on a face that already covers the same region:
 * - `merge`: the existing face stays (sticky geometry, used when inserting copies)
 * - `cancel-opposite`: an existing face facing the opposite way is removed, because the two volumes meet and
 *   open into each other (a push that cuts all the way through); a face facing the same way stays
 */
export type CoincidentFaceRule = 'merge' | 'cancel-opposite';

export interface SettleRegionRequest {
  /** Plane of the region. */
  readonly plane: Plane;
  /** Edges bounding the region, already inserted into the definition. */
  readonly seeds: readonly EdgeId[];
  /** Region outline and holes in world coordinates of the definition. */
  readonly outer: readonly Vec3[];
  readonly inners: readonly (readonly Vec3[])[];
  /** Direction the region's face should face. */
  readonly normal: Vec3;
  readonly attributes: FaceAttributes;
  readonly rule: CoincidentFaceRule;
}

/**
 * Makes sure a polygon region is represented by faces after its boundary edges were inserted. Faces are created
 * for parts no face covers yet; existing coplanar faces covering the region are handled by `rule`.
 * Returns the faces that cover the region afterwards.
 */
export function settleRegion(
  doc: ModelDocument,
  context: DefinitionId,
  request: SettleRegionRequest,
): FaceId[] {
  const store = doc.store(context);
  const plane = canonicalPlane(request.plane);
  const basis = planeBasis(plane.normal);
  const outer2D = request.outer.map((p) => projectTo2D(basis, p));
  const inners2D = request.inners.map((loop) => loop.map((p) => projectTo2D(basis, p)));
  const inside = (point: Point2): boolean => classifyPointInPolygon(point, outer2D, inners2D) === 'inside';

  const { createdFaces } = resolvePlane(doc, context, plane, request.seeds, {
    policy: {
      decide: (_region, sample) =>
        inside(projectTo2D(basis, sample))
          ? { attributes: request.attributes, normal: request.normal }
          : null,
    },
  });
  const created = new Set(createdFaces);

  const candidates = new Set<FaceId>();
  for (const edgeId of request.seeds) {
    const edge = store.edge(edgeId);
    if (edge) for (const faceId of edge.faces) candidates.add(faceId);
  }
  for (const faceId of store.queryFaces(aabbExpand(aabbFromPoints(request.outer), EPS_LEN)))
    candidates.add(faceId);

  const covering: FaceId[] = [];
  for (const faceId of [...candidates].sort((a, b) => a - b)) {
    const face = store.face(faceId);
    if (!face?.plane || !planesCoincide(face.plane, plane)) continue;
    const rings = faceRings(store, faceId, basis);
    const sample = interiorPoint(rings.outer, rings.inners);
    if (!sample || !inside(projectTo2D(basis, unprojectFrom2D(basis, plane, sample)))) continue;
    if (created.has(faceId)) {
      covering.push(faceId);
    } else if (request.rule === 'cancel-opposite' && dot(face.plane.normal, request.normal) < 0) {
      removeFace(doc, context, faceId);
    } else {
      covering.push(faceId);
    }
  }
  return covering;
}

/**
 * Settles a face that was moved onto other faces in its plane, the way a push that reaches them should end
 * (GEOMETRY.md, Push/Pull step 4): its outline is imprinted into them, and its region is settled with
 * `cancel-opposite`. A face there facing the other way goes along with it, which leaves a hole (or joins two volumes);
 * one facing the same way covers the region instead. Returns the faces covering the region afterwards, none where it
 * cancelled.
 */
export function settleLandedFace(doc: ModelDocument, context: DefinitionId, faceId: FaceId): FaceId[] {
  const store = doc.store(context);
  const { attributes } = store.getFace(faceId);
  const plane = store.getFacePlane(faceId);
  const loops = store.faceLoops(faceId);
  const [outer, ...inners] = loops.map((loop) => store.loopPoints(loop));
  if (!outer) return [faceId];
  const edges = loops.flatMap((loop) => loop.map((use) => use.edge));
  removeFace(doc, context, faceId);
  // Split the faces underneath along the outline first. Settling would split them itself, but it would then take the
  // piece it split off for a face it made, and keep it.
  resolvePlane(doc, context, plane, edges, { policy: NEVER_CREATE_FACES });
  return settleRegion(doc, context, {
    plane,
    seeds: edges,
    outer,
    inners,
    normal: plane.normal,
    attributes,
    rule: 'cancel-opposite',
  });
}
