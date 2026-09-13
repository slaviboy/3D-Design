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

import type { Vec3 } from './vec3';

/** Axis-aligned bounding box. An empty box has min greater than max on every axis. */
export interface Aabb {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export const EMPTY_AABB: Aabb = {
  minX: Infinity,
  minY: Infinity,
  minZ: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
  maxZ: -Infinity,
};

export function aabbFromPoints(points: Iterable<Vec3>): Aabb {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function aabbUnion(a: Aabb, b: Aabb): Aabb {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

export function aabbExpand(box: Aabb, margin: number): Aabb {
  return {
    minX: box.minX - margin,
    minY: box.minY - margin,
    minZ: box.minZ - margin,
    maxX: box.maxX + margin,
    maxY: box.maxY + margin,
    maxZ: box.maxZ + margin,
  };
}

export function aabbIntersects(a: Aabb, b: Aabb): boolean {
  return (
    a.minX <= b.maxX &&
    a.maxX >= b.minX &&
    a.minY <= b.maxY &&
    a.maxY >= b.minY &&
    a.minZ <= b.maxZ &&
    a.maxZ >= b.minZ
  );
}

export function aabbContains(outer: Aabb, inner: Aabb): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.minZ <= inner.minZ &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY &&
    outer.maxZ >= inner.maxZ
  );
}

export function aabbIsEmpty(box: Aabb): boolean {
  return box.minX > box.maxX || box.minY > box.maxY || box.minZ > box.maxZ;
}

/** Half of the surface area, used as the insertion cost heuristic in bounding volume hierarchies. */
export function aabbHalfSurfaceArea(box: Aabb): number {
  const dx = box.maxX - box.minX;
  const dy = box.maxY - box.minY;
  const dz = box.maxZ - box.minZ;
  return dx * dy + dy * dz + dz * dx;
}
