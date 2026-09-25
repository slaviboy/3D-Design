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

import type { DefinitionId, FaceId } from '../../kernel/ids';
import type { Aabb } from '../../kernel/math/aabb';
import { transformNormal, transformPoint, type Mat4 } from '../../kernel/math/mat4';
import { distancePointToSegment } from '../../kernel/math/segment';
import { dot, normalize, sub, type Vec3 } from '../../kernel/math/vec3';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import type { StyleSettings } from '../../kernel/model/types';
import { rayToPoint, worldUnitsPerPixel, type CameraState, type ViewportSize } from '../camera/camera';
import { rayFaceHit } from './picker';
import { traverseAlongRay, type RayVisit } from './rayTraversal';
import { isClipped, type SectionClipping } from './sectionClip';

/** Which points a style lets the user see, and so snap to. */
export interface VisibilityRules {
  /** Faces hide what lies behind them. Not in X-ray, where they are see-through, or wireframe, where they aren't drawn. */
  readonly occlusion: boolean;
  /** Points on edges show through faces, because Back Edges draws hidden edges dashed. */
  readonly edgePointsAlwaysVisible: boolean;
}

export function visibilityRules(style: StyleSettings): VisibilityRules {
  const occlusion = !style.xRay && style.faceStyle !== 'wireframe';
  return { occlusion, edgePointsAlwaysVisible: occlusion && style.showEdges && style.backEdges };
}

/** The part of the model a visibility test looks into: the active context as the camera sees it. */
export interface OcclusionScene {
  readonly doc: ModelDocument;
  readonly context: DefinitionId;
  readonly contextTransform: Mat4;
  readonly camera: CameraState;
  readonly size: ViewportSize;
  readonly clip?: SectionClipping;
  readonly boundsCache?: Map<DefinitionId, Aabb>;
}

/**
 * A point this close to a face's plane lies on the face, which then doesn't hide it; this also absorbs faces of
 * imported meshes that are slightly out of plane. In pixels at the point's depth.
 */
const PLANE_TOLERANCE_PX = 0.75;
/**
 * Rays passing this close to a face's edges only graze it, so an outline doesn't hide the points right behind it,
 * such as the far corner of a box seen exactly edge-on. In pixels at the point's depth.
 */
const BOUNDARY_BAND_PX = 0.5;

/** True when a face of the scene hides `point` from the camera. */
export function isOccluded(point: Vec3, scene: OcclusionScene): boolean {
  const toPoint = rayToPoint(scene.camera, point);
  if (!toPoint) return false;
  const perPixel = worldUnitsPerPixel(scene.camera, point, scene.size);
  const planeTolerance = PLANE_TOLERANCE_PX * perPixel;
  const band = BOUNDARY_BAND_PX * perPixel;
  let hidden = false;
  traverseAlongRay(
    scene.doc,
    scene.context,
    scene.contextTransform,
    {
      camera: scene.camera,
      size: scene.size,
      ray: toPoint.ray,
      tolerancePx: 0,
      maxT: toPoint.t,
      stop: () => hidden,
      ...(scene.boundsCache ? { boundsCache: scene.boundsCache } : {}),
      ...(scene.clip ? { clip: scene.clip } : {}),
    },
    (visit) => {
      for (const faceId of visit.store.queryFaces(visit.box)) {
        if (faceHides(scene.doc, visit, faceId, point, toPoint.t, planeTolerance, band)) {
          hidden = true;
          return;
        }
      }
    },
  );
  return hidden;
}

function faceHides(
  doc: ModelDocument,
  visit: RayVisit,
  faceId: FaceId,
  point: Vec3,
  pointT: number,
  planeTolerance: number,
  band: number,
): boolean {
  const hit = rayFaceHit(doc, visit, faceId, pointT);
  if (hit?.position !== 'inside') return false;
  const { store, toWorld } = visit;
  const face = store.getFace(faceId);
  const worldHit = transformPoint(toWorld, hit.local);
  if (isClipped(worldHit, visit.clipPlanes)) return false;
  // Instances may scale unevenly or mirror, so distances are measured in world space.
  const normal = face.plane ? transformNormal(toWorld, face.plane.normal) : null;
  const unit = normal ? normalize(normal) : null;
  if (!unit || Math.abs(dot(sub(point, worldHit), unit)) <= planeTolerance) return false;
  for (const loop of [face.outer, ...face.inners]) {
    const corners = store.loopPoints(loop).map((corner) => transformPoint(toWorld, corner));
    for (const [index, a] of corners.entries()) {
      const b = corners[(index + 1) % corners.length] ?? a;
      if (distancePointToSegment(worldHit, a, b) <= band) return false;
    }
  }
  return true;
}
