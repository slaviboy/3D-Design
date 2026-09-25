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

import type { DefinitionId, FaceId, InstanceId } from '../../kernel/ids';
import type { Aabb } from '../../kernel/math/aabb';
import { classifyPointInPolygon, type RingClassification } from '../../kernel/math/geom2d';
import { transformPoint, type Mat4 } from '../../kernel/math/mat4';
import { planeBasis, projectTo2D } from '../../kernel/math/plane';
import { closestPointsOnSegments } from '../../kernel/math/segment';
import { add, distance, dot, length, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import type { Loop } from '../../kernel/model/types';
import { isTagVisible } from '../../kernel/model/visibility';
import { contextContentBounds, sectionRectangle } from '../../kernel/ops/sections';
import {
  rayThroughScreen,
  worldUnitsPerPixel,
  type CameraState,
  type Ray,
  type ScreenPoint,
  type ViewportSize,
} from '../camera/camera';
import type { EntityRef } from '../selection/Selection';
import { traverseAlongRay, type RayVisit } from './rayTraversal';
import { clipSegment, isClipped, type SectionClipping } from './sectionClip';

export const DEFAULT_EDGE_PICK_TOLERANCE_PX = 5;
/** Faces seen this close to edge-on (|cos| of the angle to the ray) are not hit. */
const GRAZING_COSINE = 1e-9;

/** Entities of the context that picking treats as absent, such as geometry that is being moved out of its place. */
export interface PickSkip {
  readonly faces?: ReadonlySet<FaceId>;
  readonly instances?: ReadonlySet<InstanceId>;
}

export interface PickRequest {
  readonly camera: CameraState;
  readonly size: ViewportSize;
  readonly screen: ScreenPoint;
  readonly edgeTolerancePx?: number;
  /** Also pick soft edges, which are normally skipped (the eraser needs them to unsoften). */
  readonly includeSoftEdges?: boolean;
  /** Also pick the section planes of the context by their outlines (only the Select tool wants them). */
  readonly includeSectionPlanes?: boolean;
  /** Section cuts: geometry they cut away can't be picked, so the pick finds what is visible behind it. */
  readonly clip?: SectionClipping;
  readonly skip?: PickSkip;
  /** Definition bounds shared with other queries against the same unchanged document. */
  readonly boundsCache?: Map<DefinitionId, Aabb>;
}

/** Length of the pick ray used against section plane outlines; longer than any parallel-projection back-off. */
const SECTION_PICK_RAY_LENGTH = 1e7;

export interface PickHit {
  /** A face or edge of the picked context, or the top-level instance that contains the hit. */
  readonly ref: EntityRef;
  /** World-space distance along the pick ray. */
  readonly distance: number;
  /** World-space point that was hit. */
  readonly point: Vec3;
}

interface Candidate extends PickHit {
  /** Edge hits get a head start equal to their pick tolerance, so an edge wins over the face it bounds. */
  readonly bias: number;
}

/**
 * The entity under a screen point. Geometry in `context` is picked directly; anything inside an instance is
 * reported as that instance, which is how selection works outside an open group or component.
 * `contextTransform` maps the context's coordinates to world coordinates.
 */
export function pick(
  doc: ModelDocument,
  context: DefinitionId,
  contextTransform: Mat4,
  request: PickRequest,
): PickHit | null {
  const tolerancePx = request.edgeTolerancePx ?? DEFAULT_EDGE_PICK_TOLERANCE_PX;
  const worldRay = rayThroughScreen(request.camera, request.screen, request.size);
  const candidates: Candidate[] = [];
  traverseAlongRay(
    doc,
    context,
    contextTransform,
    {
      camera: request.camera,
      size: request.size,
      ray: worldRay,
      tolerancePx,
      ...(request.boundsCache ? { boundsCache: request.boundsCache } : {}),
      ...(request.skip?.instances ? { skipInstances: request.skip.instances } : {}),
      ...(request.clip ? { clip: request.clip } : {}),
    },
    (visit) => {
      pickFaces(doc, visit, candidates, request.skip?.faces);
      pickEdges(doc, visit, request, tolerancePx, worldRay, candidates);
    },
  );
  if (request.includeSectionPlanes === true) {
    pickSectionPlanes(doc, context, contextTransform, request, tolerancePx, worldRay, candidates);
  }
  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (!best || candidate.distance - candidate.bias < best.distance - best.bias) best = candidate;
  }
  return best ? { ref: best.ref, distance: best.distance, point: best.point } : null;
}

/** Section planes of the context are picked by the outline of their rectangle, like edges. */
function pickSectionPlanes(
  doc: ModelDocument,
  context: DefinitionId,
  contextTransform: Mat4,
  request: PickRequest,
  tolerancePx: number,
  worldRay: Ray,
  candidates: Candidate[],
): void {
  const store = doc.store(context);
  if (store.sectionPlaneCount === 0) return;
  const bounds = contextContentBounds(doc, context);
  const rayEnd = add(worldRay.origin, scale(worldRay.direction, SECTION_PICK_RAY_LENGTH));
  for (const plane of store.sectionPlanes()) {
    const corners = sectionRectangle(plane, bounds).map((corner) => transformPoint(contextTransform, corner));
    let best: Candidate | null = null;
    for (const [index, a] of corners.entries()) {
      const b = corners[(index + 1) % corners.length] ?? a;
      const closest = closestPointsOnSegments(worldRay.origin, rayEnd, a, b);
      const toleranceWorld =
        tolerancePx * worldUnitsPerPixel(request.camera, closest.pointOnSecond, request.size);
      if (closest.distance > toleranceWorld) continue;
      const along = dot(sub(closest.pointOnSecond, worldRay.origin), worldRay.direction);
      if (!best || along < best.distance) {
        best = {
          ref: { kind: 'section', id: plane.id },
          distance: along,
          point: closest.pointOnSecond,
          bias: toleranceWorld,
        };
      }
    }
    if (best) candidates.push(best);
  }
}

/** Where the ray of a visit meets a visible face, in the visit's local coordinates, or null when it misses. */
export interface FaceHit {
  readonly t: number;
  readonly local: Vec3;
  readonly position: Exclude<RingClassification, 'outside'>;
}

export function rayFaceHit(
  doc: ModelDocument,
  visit: RayVisit,
  faceId: FaceId,
  maxT = Infinity,
): FaceHit | null {
  const { store, origin, direction } = visit;
  const face = store.getFace(faceId);
  if (face.attributes.hidden || !face.plane || !isTagVisible(doc, face.attributes.tagId)) return null;
  const denominator = dot(face.plane.normal, direction);
  if (Math.abs(denominator) < GRAZING_COSINE * length(direction)) return null;
  const t = (face.plane.offset - dot(face.plane.normal, origin)) / denominator;
  if (t <= 0 || t >= maxT) return null;
  const local = add(origin, scale(direction, t));
  const basis = planeBasis(face.plane.normal);
  const project = (loop: Loop) => store.loopPoints(loop).map((p) => projectTo2D(basis, p));
  const position = classifyPointInPolygon(
    projectTo2D(basis, local),
    project(face.outer),
    face.inners.map(project),
  );
  return position === 'outside' ? null : { t, local, position };
}

function pickFaces(
  doc: ModelDocument,
  visit: RayVisit,
  candidates: Candidate[],
  skipFaces: ReadonlySet<FaceId> | undefined,
): void {
  const { store, toWorld, topLevel } = visit;
  for (const faceId of store.queryFaces(visit.box)) {
    if (topLevel === null && skipFaces?.has(faceId) === true) continue;
    const hit = rayFaceHit(doc, visit, faceId);
    if (!hit) continue;
    const point = transformPoint(toWorld, hit.local);
    if (isClipped(point, visit.clipPlanes)) continue;
    candidates.push({
      ref: topLevel ?? { kind: 'face', id: faceId },
      distance: hit.t,
      point,
      bias: 0,
    });
  }
}

function pickEdges(
  doc: ModelDocument,
  visit: RayVisit,
  request: PickRequest,
  tolerancePx: number,
  worldRay: Ray,
  candidates: Candidate[],
): void {
  const { store, toWorld, topLevel } = visit;
  const rayStart = transformPoint(toWorld, visit.start);
  const rayEnd = transformPoint(toWorld, visit.end);
  for (const edgeId of store.queryEdges(visit.box)) {
    const edge = store.getEdge(edgeId);
    if (edge.attributes.hidden || (edge.attributes.soft && request.includeSoftEdges !== true)) continue;
    if (!isTagVisible(doc, edge.attributes.tagId)) continue;
    // Only the part of the edge that no section cuts away can be picked.
    const visible = clipSegment(
      transformPoint(toWorld, store.position(edge.v0)),
      transformPoint(toWorld, store.position(edge.v1)),
      visit.clipPlanes,
    );
    if (!visible) continue;
    const closest = closestPointsOnSegments(rayStart, rayEnd, visible[0], visible[1]);
    const onEdge = closest.pointOnSecond;
    const toleranceWorld = tolerancePx * worldUnitsPerPixel(request.camera, onEdge, request.size);
    if (distance(closest.pointOnFirst, onEdge) > toleranceWorld) continue;
    candidates.push({
      ref: topLevel ?? { kind: 'edge', id: edgeId },
      distance: dot(sub(onEdge, worldRay.origin), worldRay.direction),
      point: onEdge,
      bias: toleranceWorld,
    });
  }
}
