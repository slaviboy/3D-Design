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

import type { Aabb } from '../../kernel/math/aabb';
import { transformPoint, type Mat4 } from '../../kernel/math/mat4';
import { add, type Vec3 } from '../../kernel/math/vec3';
import { aabbCorners } from '../geometry/bounds';
import type { PreviewLine } from './Tool';

/** Corner index pairs of a box from `aabbCorners` (index bits: x·4 + y·2 + z). */
const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * The twelve edges of `box`, moved by `offset` in context coordinates and drawn in world space. Tools that carry
 * something on the cursor (placing a component, pasting) show this outline.
 */
export function boxPreviewLines(box: Aabb, offset: Vec3, toWorld: Mat4): PreviewLine[] {
  const corners = aabbCorners(box).map((corner) => transformPoint(toWorld, add(corner, offset)));
  const lines: PreviewLine[] = [];
  for (const [a, b] of BOX_EDGES) {
    const start = corners[a];
    const end = corners[b];
    if (start && end) lines.push({ a: start, b: end, style: 'preview' });
  }
  return lines;
}
