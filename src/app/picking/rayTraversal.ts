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

import type { DefinitionId, InstanceId } from '../../kernel/ids';
import { aabbExpand, aabbFromPoints, aabbIsEmpty, type Aabb } from '../../kernel/math/aabb';
import {
  invertAffine,
  multiply,
  transformDirection,
  transformPoint,
  type Mat4,
} from '../../kernel/math/mat4';
import type { Plane } from '../../kernel/math/plane';
import { add, AXIS_X, AXIS_Y, AXIS_Z, length, scale, type Vec3 } from '../../kernel/math/vec3';
import type { EntityStore } from '../../kernel/model/EntityStore';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import { isTagVisible } from '../../kernel/model/visibility';
import { EPS_LEN } from '../../kernel/tolerance';
import { worldUnitsPerPixel, type CameraState, type Ray, type ViewportSize } from '../camera/camera';
import { aabbCorners, definitionBounds } from '../geometry/bounds';
import type { EntityRef } from '../selection/Selection';
import { NO_SECTION_CLIPPING, worldSectionPlane, type SectionClipping } from './sectionClip';

/** What to search along a ray, and how far. */
export interface RayQuery {
  readonly camera: CameraState;
  readonly size: ViewportSize;
  /** World ray; points on it are `origin + direction·t`. */
  readonly ray: Ray;
  /** Geometry within this many pixels of the ray is visited. */
  readonly tolerancePx: number;
  /** Only the part of the ray with t up to this is searched. */
  readonly maxT?: number;
  /**
   * Definition bounds by id, to share between the queries of one pointer move (computing them visits every vertex).
   * Only valid while the document is unchanged.
   */
  readonly boundsCache?: Map<DefinitionId, Aabb>;
  /** Instances of the context to pass over, together with everything inside them. */
  readonly skipInstances?: ReadonlySet<InstanceId>;
  /** Section cuts: geometry they cut away is still visited, and each visit says which cuts apply to it. */
  readonly clip?: SectionClipping;
  /** Checked before each definition; the traversal ends once it returns true (a visibility test found a face). */
  readonly stop?: () => boolean;
}

/** One definition that the ray passes near, in that definition's local coordinates. */
export interface RayVisit {
  readonly store: EntityStore;
  readonly toWorld: Mat4;
  /** `origin + direction·t` is the same point as the world ray at `t`. */
  readonly origin: Vec3;
  readonly direction: Vec3;
  /** Where the ray enters and leaves the definition's (tolerance-grown) bounds. */
  readonly start: Vec3;
  readonly end: Vec3;
  /** Local box around the ray segment, grown by the pixel tolerance. Use it to query the store's spatial index. */
  readonly box: Aabb;
  /** The top-level instance being traversed, or null for the context itself. */
  readonly topLevel: EntityRef | null;
  /** World planes of the section cuts that apply here (see `isClipped`); empty when nothing is cut. */
  readonly clipPlanes: readonly Plane[];
}

/** Parameter interval where a ray is inside a box (slab method), clipped to t ≥ 0, or null when it misses. */
export function rayBoxInterval(origin: Vec3, direction: Vec3, box: Aabb): [number, number] | null {
  let near = 0;
  let far = Infinity;
  const slabs: [number, number, number, number][] = [
    [origin.x, direction.x, box.minX, box.maxX],
    [origin.y, direction.y, box.minY, box.maxY],
    [origin.z, direction.z, box.minZ, box.maxZ],
  ];
  for (const [o, d, min, max] of slabs) {
    if (d === 0) {
      if (o < min || o > max) return null;
      continue;
    }
    const t1 = (min - o) / d;
    const t2 = (max - o) / d;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
  }
  return far >= near ? [near, far] : null;
}

function localUnitsPerWorldUnit(fromWorld: Mat4): number {
  return Math.max(
    length(transformDirection(fromWorld, AXIS_X)),
    length(transformDirection(fromWorld, AXIS_Y)),
    length(transformDirection(fromWorld, AXIS_Z)),
  );
}

/**
 * Visits the context and every visible nested definition whose bounds the ray passes within `tolerancePx` of.
 * Shared by picking, inference and visibility tests so all of them see exactly the same geometry.
 */
export function traverseAlongRay(
  doc: ModelDocument,
  context: DefinitionId,
  contextTransform: Mat4,
  query: RayQuery,
  visit: (visit: RayVisit) => void,
): void {
  const { camera, size, ray: worldRay, tolerancePx } = query;
  const maxT = query.maxT ?? Infinity;
  const boundsCache = query.boundsCache ?? new Map<DefinitionId, Aabb>();
  const clip = query.clip ?? NO_SECTION_CLIPPING;
  const walk = (
    definitionId: DefinitionId,
    toWorld: Mat4,
    topLevel: EntityRef | null,
    inheritedClips: readonly Plane[],
  ): void => {
    if (query.stop?.() === true) return;
    const bounds = definitionBounds(doc, definitionId, boundsCache);
    const fromWorld = invertAffine(toWorld);
    if (aabbIsEmpty(bounds) || !fromWorld) return;
    const origin = transformPoint(fromWorld, worldRay.origin);
    const direction = transformDirection(fromWorld, worldRay.direction);
    const worldPerPixel = Math.max(
      ...aabbCorners(bounds).map((corner) =>
        worldUnitsPerPixel(camera, transformPoint(toWorld, corner), size),
      ),
    );
    // A hair of slack keeps faces that lie exactly on the bounds (flat models) inside the slab test.
    const margin = tolerancePx * worldPerPixel * localUnitsPerWorldUnit(fromWorld) + EPS_LEN;
    const interval = rayBoxInterval(origin, direction, aabbExpand(bounds, margin));
    if (!interval || interval[0] > maxT) return;
    const store = doc.store(definitionId);
    const active = clip.enabled ? store.activeSectionPlane() : undefined;
    const ownClip = active ? worldSectionPlane(active, toWorld) : null;
    const clipPlanes = ownClip ? [...inheritedClips, ownClip] : inheritedClips;
    const start = add(origin, scale(direction, interval[0]));
    const end = add(origin, scale(direction, Math.min(interval[1], maxT)));
    visit({
      store,
      toWorld,
      origin,
      direction,
      start,
      end,
      box: aabbExpand(aabbFromPoints([start, end]), margin),
      topLevel,
      clipPlanes,
    });
    for (const instance of store.instances()) {
      // An instance hidden directly or by its tag hides everything inside it.
      if (instance.attributes.hidden || !isTagVisible(doc, instance.attributes.tagId)) continue;
      if (topLevel === null && query.skipInstances?.has(instance.id) === true) continue;
      walk(
        instance.definitionId,
        multiply(toWorld, instance.transform),
        topLevel ?? { kind: 'instance', id: instance.id },
        clipPlanes,
      );
    }
  };
  walk(context, contextTransform, null, clip.enabled ? clip.inherited : []);
}
