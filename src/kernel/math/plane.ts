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

import { EPS_AREA, EPS_LEN, isParallelBySine } from '../tolerance';
import type { Point2 } from './geom2d';
import { add, anyPerpendicular, cross, dot, length, normalize, scale, sub, vec3, type Vec3 } from './vec3';

/** The set of points `p` with `dot(normal, p) === offset`. `normal` has unit length. */
export interface Plane {
  readonly normal: Vec3;
  readonly offset: number;
}

/** Right-handed orthonormal basis of a plane: `cross(u, v) === normal`. */
export interface PlaneBasis {
  readonly u: Vec3;
  readonly v: Vec3;
  readonly normal: Vec3;
}

/**
 * Newell's method: the normal of a polygon whose vertices are in order.
 * The result is not normalized; its length is twice the polygon's area, and it points so that
 * the vertex order is counter-clockwise when viewed from the side it points toward.
 */
export function newellNormal(points: readonly Vec3[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const current = points[i];
    const next = points[(i + 1) % count];
    if (!current || !next) continue;
    nx += (current.y - next.y) * (current.z + next.z);
    ny += (current.z - next.z) * (current.x + next.x);
    nz += (current.x - next.x) * (current.y + next.y);
  }
  return vec3(nx, ny, nz);
}

/** Plane of a polygon (Newell normal, centroid offset), or `null` when the polygon has no area. */
export function planeFromPolygon(points: readonly Vec3[]): Plane | null {
  const raw = newellNormal(points);
  if (length(raw) / 2 <= EPS_AREA) return null;
  const normal = normalize(raw);
  if (!normal || points.length === 0) return null;
  let offsetSum = 0;
  for (const p of points) offsetSum += dot(normal, p);
  return { normal, offset: offsetSum / points.length };
}

/** Plane through three points, or `null` when they are collinear. */
export function planeThroughPoints(a: Vec3, b: Vec3, c: Vec3): Plane | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n = cross(ab, ac);
  const scaleOfInputs = length(ab) * length(ac);
  if (scaleOfInputs === 0 || isParallelBySine(length(n) / scaleOfInputs)) return null;
  const normal = normalize(n);
  if (!normal) return null;
  return { normal, offset: dot(normal, a) };
}

export function planeFromPointNormal(point: Vec3, unitNormal: Vec3): Plane {
  return { normal: unitNormal, offset: dot(unitNormal, point) };
}

export function signedDistanceToPlane(plane: Plane, p: Vec3): number {
  return dot(plane.normal, p) - plane.offset;
}

export function isPointOnPlane(plane: Plane, p: Vec3): boolean {
  return Math.abs(signedDistanceToPlane(plane, p)) <= EPS_LEN;
}

export function projectPointOntoPlane(plane: Plane, p: Vec3): Vec3 {
  return sub(p, scale(plane.normal, signedDistanceToPlane(plane, p)));
}

export function flipPlane(plane: Plane): Plane {
  return { normal: scale(plane.normal, -1), offset: -plane.offset };
}

/** True when both planes contain the same points. Opposite-facing planes count as coincident. */
export function planesCoincide(a: Plane, b: Plane): boolean {
  if (!isParallelBySine(length(cross(a.normal, b.normal)))) return false;
  const sameDirection = dot(a.normal, b.normal) > 0;
  return Math.abs(a.offset - (sameDirection ? b.offset : -b.offset)) <= EPS_LEN;
}

/**
 * The same plane with its normal flipped, if needed, so that the normal's largest-magnitude component
 * is positive. Two coincident planes then compare equal regardless of which way they faced.
 */
export function canonicalPlane(plane: Plane): Plane {
  const { x, y, z } = plane.normal;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  const dominant = ax >= ay && ax >= az ? x : ay >= az ? y : z;
  return dominant < 0 ? flipPlane(plane) : plane;
}

export function planeBasis(unitNormal: Vec3): PlaneBasis {
  const u = anyPerpendicular(unitNormal);
  const v = cross(unitNormal, u);
  return { u, v, normal: unitNormal };
}

/** 2D coordinates of `p` in the basis. Absolute coordinates are used, so a plane and its points map consistently. */
export function projectTo2D(basis: PlaneBasis, p: Vec3): Point2 {
  return { x: dot(basis.u, p), y: dot(basis.v, p) };
}

/** The 3D point on `plane` whose 2D coordinates in `basis` are `q`. */
export function unprojectFrom2D(basis: PlaneBasis, plane: Plane, q: Point2): Vec3 {
  return add(add(scale(basis.u, q.x), scale(basis.v, q.y)), scale(basis.normal, plane.offset));
}
