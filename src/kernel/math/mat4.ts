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

import { vec3, type Vec3 } from './vec3';

/**
 * 4×4 affine transform stored column-major, the same convention as three.js and glTF:
 * element (row r, column c) is `m[c * 4 + r]`.
 */
export type Mat4 = readonly number[];

export const MAT4_LENGTH = 16;

export const IDENTITY: Mat4 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function isMat4(value: unknown): value is Mat4 {
  return (
    Array.isArray(value) &&
    value.length === MAT4_LENGTH &&
    value.every((element) => typeof element === 'number' && Number.isFinite(element))
  );
}

function at(m: Mat4, index: number): number {
  const value = m[index];
  if (value === undefined) throw new Error(`Mat4 index ${String(index)} out of range`);
  return value;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(MAT4_LENGTH);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += at(a, k * 4 + row) * at(b, col * 4 + k);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function translation(offset: Vec3): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offset.x, offset.y, offset.z, 1];
}

export function scaling(factors: Vec3): Mat4 {
  return [factors.x, 0, 0, 0, 0, factors.y, 0, 0, 0, 0, factors.z, 0, 0, 0, 0, 1];
}

/** Rotation by `angle` radians about the unit vector `axis` through the origin (right-hand rule). */
export function rotationAxisAngle(axis: Vec3, angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const { x, y, z } = axis;
  return [
    t * x * x + c,
    t * x * y + s * z,
    t * x * z - s * y,
    0,
    t * x * y - s * z,
    t * y * y + c,
    t * y * z + s * x,
    0,
    t * x * z + s * y,
    t * y * z - s * x,
    t * z * z + c,
    0,
    0,
    0,
    0,
    1,
  ];
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return vec3(
    at(m, 0) * p.x + at(m, 4) * p.y + at(m, 8) * p.z + at(m, 12),
    at(m, 1) * p.x + at(m, 5) * p.y + at(m, 9) * p.z + at(m, 13),
    at(m, 2) * p.x + at(m, 6) * p.y + at(m, 10) * p.z + at(m, 14),
  );
}

/** Applies the linear part only (no translation). */
export function transformDirection(m: Mat4, d: Vec3): Vec3 {
  return vec3(
    at(m, 0) * d.x + at(m, 4) * d.y + at(m, 8) * d.z,
    at(m, 1) * d.x + at(m, 5) * d.y + at(m, 9) * d.z,
    at(m, 2) * d.x + at(m, 6) * d.y + at(m, 10) * d.z,
  );
}

/** Determinant of the 3×3 linear part. Negative means the transform mirrors geometry. */
export function linearDeterminant(m: Mat4): number {
  const a = at(m, 0);
  const b = at(m, 4);
  const c = at(m, 8);
  const d = at(m, 1);
  const e = at(m, 5);
  const f = at(m, 9);
  const g = at(m, 2);
  const h = at(m, 6);
  const i = at(m, 10);
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** Inverse of an affine transform, or `null` when the linear part is singular. */
export function invertAffine(m: Mat4): Mat4 | null {
  const det = linearDeterminant(m);
  if (det === 0 || !Number.isFinite(det)) return null;
  const a = at(m, 0);
  const b = at(m, 4);
  const c = at(m, 8);
  const d = at(m, 1);
  const e = at(m, 5);
  const f = at(m, 9);
  const g = at(m, 2);
  const h = at(m, 6);
  const i = at(m, 10);
  const inv = 1 / det;
  // Inverse of the 3×3 linear part (adjugate / determinant), written row by row.
  const r00 = (e * i - f * h) * inv;
  const r01 = (c * h - b * i) * inv;
  const r02 = (b * f - c * e) * inv;
  const r10 = (f * g - d * i) * inv;
  const r11 = (a * i - c * g) * inv;
  const r12 = (c * d - a * f) * inv;
  const r20 = (d * h - e * g) * inv;
  const r21 = (b * g - a * h) * inv;
  const r22 = (a * e - b * d) * inv;
  const tx = at(m, 12);
  const ty = at(m, 13);
  const tz = at(m, 14);
  return [
    r00,
    r10,
    r20,
    0,
    r01,
    r11,
    r21,
    0,
    r02,
    r12,
    r22,
    0,
    -(r00 * tx + r01 * ty + r02 * tz),
    -(r10 * tx + r11 * ty + r12 * tz),
    -(r20 * tx + r21 * ty + r22 * tz),
    1,
  ];
}

/**
 * Transforms a surface normal: multiplies by the inverse transpose of the linear part.
 * The result is not normalized. Returns `null` for singular transforms.
 */
export function transformNormal(m: Mat4, n: Vec3): Vec3 | null {
  const inverse = invertAffine(m);
  if (!inverse) return null;
  // Multiplying by the transpose of the inverse means dotting n with each column of the inverse.
  return vec3(
    at(inverse, 0) * n.x + at(inverse, 1) * n.y + at(inverse, 2) * n.z,
    at(inverse, 4) * n.x + at(inverse, 5) * n.y + at(inverse, 6) * n.z,
    at(inverse, 8) * n.x + at(inverse, 9) * n.y + at(inverse, 10) * n.z,
  );
}
