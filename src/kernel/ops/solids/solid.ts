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

import { cross, dot, sub } from '../../math/vec3';
import type { EntityStore } from '../../model/EntityStore';
import { triangulateFace } from '../triangulate';

/**
 * True when a definition's geometry encloses a volume: it has faces, no nested groups or components, every edge
 * bounds exactly two faces, and those two faces use the edge in opposite directions (consistent orientation).
 */
export function isSolid(store: EntityStore): boolean {
  if (store.faceCount === 0 || store.instanceCount > 0) return false;
  for (const edge of store.edges()) {
    if (edge.faces.length !== 2) return false;
    const [first, second] = edge.faces.map((faceId) => {
      const face = store.getFace(faceId);
      return [face.outer, ...face.inners].flat().find((use) => use.edge === edge.id);
    });
    if (!first || !second || first.reversed === second.reversed) return false;
  }
  for (const face of store.faces()) if (!face.plane) return false;
  return true;
}

/**
 * Signed volume enclosed by the faces of a definition, from the divergence theorem over the triangulated faces.
 * Positive when the faces point outward. Meaningful only for solids.
 */
export function solidVolume(store: EntityStore): number {
  let volume = 0;
  for (const face of store.faces()) {
    if (!face.plane) continue;
    const { vertices, indices } = triangulateFace(store, face.id);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const a = vertices[indices[i] ?? -1];
      const b = vertices[indices[i + 1] ?? -1];
      const c = vertices[indices[i + 2] ?? -1];
      if (a === undefined || b === undefined || c === undefined) continue;
      const pa = store.position(a);
      volume += dot(pa, cross(sub(store.position(b), pa), sub(store.position(c), pa))) / 6;
    }
  }
  return volume;
}
