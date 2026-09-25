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

import type { InstanceId } from '../../kernel/ids';
import { IDENTITY, multiply, transformNormal, transformPoint, type Mat4 } from '../../kernel/math/mat4';
import { planeFromPointNormal, signedDistanceToPlane, type Plane } from '../../kernel/math/plane';
import { lerp, normalize, type Vec3 } from '../../kernel/math/vec3';
import type { SectionPlaneView } from '../../kernel/model/EntityStore';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import { EPS_LEN } from '../../kernel/tolerance';

/**
 * Section cuts as picking and inference see them. As in the renderer (src/render/sections/SectionOverlay.ts), while
 * cuts are shown a context with an active section plane loses what lies on the side the plane's normal points to,
 * in its own geometry and in everything nested inside it.
 */
export interface SectionClipping {
  readonly enabled: boolean;
  /** World planes of the active section planes of the contexts around the active one (open groups' parents). */
  readonly inherited: readonly Plane[];
}

export const NO_SECTION_CLIPPING: SectionClipping = Object.freeze({ enabled: false, inherited: [] });

/** A section plane in world coordinates. Its normal points to the side that is cut away. */
export function worldSectionPlane(plane: SectionPlaneView, toWorld: Mat4): Plane | null {
  const normal = transformNormal(toWorld, plane.normal);
  const unit = normal ? normalize(normal) : null;
  return unit ? planeFromPointNormal(transformPoint(toWorld, plane.point), unit) : null;
}

/**
 * Clipping for picking in the active context: the active section planes of the model and of each open group above
 * the active context. The active context's own plane, and those nested below it, are added while traversing.
 */
export function sectionClipping(
  doc: ModelDocument,
  editPath: readonly InstanceId[],
  enabled: boolean,
): SectionClipping {
  if (!enabled) return NO_SECTION_CLIPPING;
  const inherited: Plane[] = [];
  let context = doc.rootDefinitionId;
  let transform: Mat4 = IDENTITY;
  for (const instanceId of editPath) {
    const store = doc.store(context);
    const active = store.activeSectionPlane();
    const plane = active ? worldSectionPlane(active, transform) : null;
    if (plane) inherited.push(plane);
    const instance = store.instance(instanceId);
    if (!instance) break;
    transform = multiply(transform, instance.transform);
    context = instance.definitionId;
  }
  return { enabled, inherited };
}

/** True when a world point lies in the part a section cuts away. Points on a section plane stay. */
export function isClipped(point: Vec3, planes: readonly Plane[]): boolean {
  return planes.some((plane) => signedDistanceToPlane(plane, point) > EPS_LEN);
}

/** The part of a world segment that no section cuts away, or null when all of it is cut away. */
export function clipSegment(a: Vec3, b: Vec3, planes: readonly Plane[]): readonly [Vec3, Vec3] | null {
  let from = 0;
  let to = 1;
  for (const plane of planes) {
    const atA = signedDistanceToPlane(plane, a) - EPS_LEN;
    const atB = signedDistanceToPlane(plane, b) - EPS_LEN;
    if (atA > 0 && atB > 0) return null;
    if (atA > 0) from = Math.max(from, atA / (atA - atB));
    else if (atB > 0) to = Math.min(to, atA / (atA - atB));
  }
  if (from > to) return null;
  return from === 0 && to === 1 ? [a, b] : [lerp(a, b, from), lerp(a, b, to)];
}
