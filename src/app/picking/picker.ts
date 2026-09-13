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

import type { DefinitionId } from '../../kernel/ids';
import { classifyPointInPolygon } from '../../kernel/math/geom2d';
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

export const DEFAULT_EDGE_PICK_TOLERANCE_PX = 5;
/** Faces seen this close to edge-on (|cos| of the angle to the ray) are not hit. */
const GRAZING_COSINE = 1e-9;

export interface PickRequest {
  readonly camera: CameraState;
  readonly size: ViewportSize;
  readonly screen: ScreenPoint;
  readonly edgeTolerancePx?: number;
  /** Also pick soft edges, which are normally skipped (the eraser needs them to unsoften). */
  readonly includeSoftEdges?: boolean;
  /** Also pick the section planes of the context by their outlines (only the Select tool wants them). */
  readonly includeSectionPlanes?: boolean;
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
    request.camera,
    request.size,
    worldRay,
    tolerancePx,
    (visit) => {
      pickFaces(doc, visit, candidates);
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

function pickFaces(doc: ModelDocument, visit: RayVisit, candidates: Candidate[]): void {
  const { store, origin, direction, toWorld, topLevel } = visit;
  for (const faceId of store.queryFaces(visit.box)) {
    const face = store.getFace(faceId);
    if (face.attributes.hidden || !face.plane || !isTagVisible(doc, face.attributes.tagId)) continue;
    const denominator = dot(face.plane.normal, direction);
    if (Math.abs(denominator) < GRAZING_COSINE * length(direction)) continue;
    const t = (face.plane.offset - dot(face.plane.normal, origin)) / denominator;
    if (t <= 0) continue;
    const local = add(origin, scale(direction, t));
    const basis = planeBasis(face.plane.normal);
    const project = (loop: Loop) => store.loopPoints(loop).map((p) => projectTo2D(basis, p));
    const position = classifyPointInPolygon(
      projectTo2D(basis, local),
      project(face.outer),
      face.inners.map(project),
    );
    if (position === 'outside') continue;
    candidates.push({
      ref: topLevel ?? { kind: 'face', id: faceId },
      distance: t,
      point: transformPoint(toWorld, local),
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
  for (const edgeId of store.queryEdges(visit.box)) {
    const edge = store.getEdge(edgeId);
    if (edge.attributes.hidden || (edge.attributes.soft && request.includeSoftEdges !== true)) continue;
    if (!isTagVisible(doc, edge.attributes.tagId)) continue;
    const closest = closestPointsOnSegments(
      visit.start,
      visit.end,
      store.position(edge.v0),
      store.position(edge.v1),
    );
    const onRay = transformPoint(toWorld, closest.pointOnFirst);
    const onEdge = transformPoint(toWorld, closest.pointOnSecond);
    const toleranceWorld = tolerancePx * worldUnitsPerPixel(request.camera, onEdge, request.size);
    if (distance(onRay, onEdge) > toleranceWorld) continue;
    candidates.push({
      ref: topLevel ?? { kind: 'edge', id: edgeId },
      distance: dot(sub(onEdge, worldRay.origin), worldRay.direction),
      point: onEdge,
      bias: toleranceWorld,
    });
  }
}
