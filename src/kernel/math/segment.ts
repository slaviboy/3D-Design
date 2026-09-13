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

import { EPS_PARALLEL } from '../tolerance';
import { add, distance, dot, lerp, lengthSquared, scale, sub, type Vec3 } from './vec3';

export interface SegmentClosestPoints {
  /** Parameter on the first segment, in [0, 1]. */
  readonly s: number;
  /** Parameter on the second segment, in [0, 1]. */
  readonly t: number;
  readonly pointOnFirst: Vec3;
  readonly pointOnSecond: Vec3;
  readonly distance: number;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Closest points between segments `p1 → q1` and `p2 → q2` (Ericson, *Real-Time Collision Detection*, §5.1.9).
 * For parallel segments the distance is exact, but the points are one arbitrary pair among many.
 */
export function closestPointsOnSegments(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): SegmentClosestPoints {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s: number;
  let t: number;
  if (a === 0 && e === 0) {
    s = 0;
    t = 0;
  } else if (a === 0) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e === 0) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denominator = a * e - b * b;
      // denominator = a·e·sin²θ; treat directions within EPS_PARALLEL as parallel.
      s = denominator > EPS_PARALLEL * EPS_PARALLEL * a * e ? clamp01((b * f - c * e) / denominator) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const pointOnFirst = add(p1, scale(d1, s));
  const pointOnSecond = add(p2, scale(d2, t));
  return { s, t, pointOnFirst, pointOnSecond, distance: distance(pointOnFirst, pointOnSecond) };
}

/** Parameter of the projection of `p` onto the infinite line through `a` and `b` (0 at `a`, 1 at `b`). */
export function parameterOnLine(a: Vec3, b: Vec3, p: Vec3): number {
  const ab = sub(b, a);
  const lengthSq = lengthSquared(ab);
  return lengthSq === 0 ? 0 : dot(sub(p, a), ab) / lengthSq;
}

export function closestPointOnSegment(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  return lerp(a, b, clamp01(parameterOnLine(a, b, p)));
}

export function distancePointToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  return distance(p, closestPointOnSegment(a, b, p));
}

/** Distance from `p` to the infinite line through `a` and `b`, or to `a` when the two points coincide. */
export function distancePointToLine(p: Vec3, a: Vec3, b: Vec3): number {
  return distance(p, lerp(a, b, parameterOnLine(a, b, p)));
}
