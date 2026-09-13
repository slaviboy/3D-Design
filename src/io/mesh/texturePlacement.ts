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

import { dot, type Vec3 } from '../../kernel/math/vec3';
import type { TexturePlacement } from '../../kernel/model/types';
import { textureAxes } from '../../kernel/ops/materials';

/*
 * Fits Planar's per-face texture placement to imported texture coordinates. The kernel maps a face side with one
 * planar projection: the point is projected onto the face's texture axes (textureAxes), moved by an offset, rotated
 * and divided by a per-axis scale, then divided by the material's tile size. So the UV of a point p is
 *
 *   uv = K · Rᵀ · (P(p) − o),   K = diag(1 / (sx·W), 1 / (sy·H)),  R = rotation(θ)
 *
 * which is an affine map without shear. An imported face carries an arbitrary affine UV map per triangle, so the
 * fit is done in two steps: a least-squares affine fit of the vertex UVs against the projected positions, then the
 * nearest shear-free map (rotation and signed per-axis scale, chosen to best match the rows of the affine part),
 * with the offset refitted by least squares. The error is the largest UV residual relative to the UV extent.
 */

/** A placement fitted with a tile size of 1 m × 1 m; divide the scales by the real tile size. */
export interface PlacementFit {
  readonly placement: TexturePlacement;
  /** Largest distance between a fitted and a given UV, relative to the UVs' extent. 0 = exact. */
  readonly error: number;
}

/** Fits above this relative error are reported as approximations. */
export const PLACEMENT_FIT_TOLERANCE = 0.02;

/**
 * Fits a placement to points on a plane with normal `normal` and their UVs (image UVs, origin at the bottom-left).
 * Returns null when the UVs collapse to a point or a line, which no placement can reproduce.
 */
export function fitTexturePlacement(
  points: readonly Vec3[],
  uvs: readonly { readonly u: number; readonly v: number }[],
  normal: Vec3,
): PlacementFit | null {
  const count = Math.min(points.length, uvs.length);
  if (count < 3) return null;
  const axes = textureAxes(normal);
  const px: number[] = [];
  const py: number[] = [];
  let cx = 0;
  let cy = 0;
  let cu = 0;
  let cv = 0;
  for (let i = 0; i < count; i++) {
    const p = points[i];
    const t = uvs[i];
    if (!p || !t) return null;
    px.push(dot(p, axes.u));
    py.push(dot(p, axes.v));
    cx += px[i] ?? 0;
    cy += py[i] ?? 0;
    cu += t.u;
    cv += t.v;
  }
  cx /= count;
  cy /= count;
  cu /= count;
  cv /= count;

  // Normal equations of the affine fit t − tc = A (p − pc).
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sux = 0;
  let suy = 0;
  let svx = 0;
  let svy = 0;
  let extent = 0;
  for (let i = 0; i < count; i++) {
    const dx = (px[i] ?? 0) - cx;
    const dy = (py[i] ?? 0) - cy;
    const t = uvs[i] as { u: number; v: number };
    const du = t.u - cu;
    const dv = t.v - cv;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
    sux += du * dx;
    suy += du * dy;
    svx += dv * dx;
    svy += dv * dy;
    extent = Math.max(extent, Math.hypot(du, dv));
  }
  const det = sxx * syy - sxy * sxy;
  if (!(det > 1e-300) || !(extent > 0)) return null;
  // A = S_tp · S_pp⁻¹, rows a0 (u) and a1 (v).
  const a00 = (sux * syy - suy * sxy) / det;
  const a01 = (suy * sxx - sux * sxy) / det;
  const a10 = (svx * syy - svy * sxy) / det;
  const a11 = (svy * sxx - svx * sxy) / det;
  const norm = Math.max(Math.abs(a00), Math.abs(a01), Math.abs(a10), Math.abs(a11));
  if (!(norm > 0) || Math.abs(a00 * a11 - a01 * a10) <= 1e-9 * norm * norm) return null;

  // Nearest shear-free map: rows k0·(cos θ, sin θ) and k1·(−sin θ, cos θ). θ maximizes eᵀCe with
  // C = a0a0ᵀ + wwᵀ, w = (a11, −a10), e = (cos θ, sin θ).
  const c00 = a00 * a00 + a11 * a11;
  const c01 = a00 * a01 - a11 * a10;
  const c11 = a01 * a01 + a10 * a10;
  let theta = 0.5 * Math.atan2(2 * c01, c00 - c11);
  let cos = Math.cos(theta);
  let sin = Math.sin(theta);
  let k0 = a00 * cos + a01 * sin;
  let k1 = -a10 * sin + a11 * cos;
  if (k0 < 0) {
    theta += Math.PI;
    cos = -cos;
    sin = -sin;
    k0 = -k0;
    k1 = -k1;
  }
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (!(Math.abs(k0) > 1e-12 * norm) || !(Math.abs(k1) > 1e-12 * norm)) return null;

  // Rows of the restricted map, and the least-squares translation b = tc − A'·pc.
  const r00 = k0 * cos;
  const r01 = k0 * sin;
  const r10 = -k1 * sin;
  const r11 = k1 * cos;
  const b0 = cu - (r00 * cx + r01 * cy);
  const b1 = cv - (r10 * cx + r11 * cy);
  let residual = 0;
  for (let i = 0; i < count; i++) {
    const t = uvs[i] as { u: number; v: number };
    const x = px[i] ?? 0;
    const y = py[i] ?? 0;
    residual = Math.max(residual, Math.hypot(r00 * x + r01 * y + b0 - t.u, r10 * x + r11 * y + b1 - t.v));
  }

  // uv = K·Rᵀ·(P − o) = A'·P − A'·o, so o = −A'⁻¹·b with A'⁻¹ = R·S (S = diag(sx, sy)).
  const scaleX = 1 / k0;
  const scaleY = 1 / k1;
  const offsetX = -(cos * scaleX * b0 - sin * scaleY * b1);
  const offsetY = -(sin * scaleX * b0 + cos * scaleY * b1);
  const placement: TexturePlacement = { offsetX, offsetY, rotation: theta, scaleX, scaleY };
  if (![offsetX, offsetY, theta, scaleX, scaleY].every(Number.isFinite)) return null;
  return { placement, error: residual / extent };
}

/** The placement for a material whose tile is `width` × `height` meters, from a fit made with a 1 m tile. */
export function placementForTile(fit: TexturePlacement, width: number, height: number): TexturePlacement {
  return { ...fit, scaleX: fit.scaleX / width, scaleY: fit.scaleY / height };
}
