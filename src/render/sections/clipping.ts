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

import type * as THREE from 'three';

interface ClippedMaterialData {
  /** The material the model renderer assigned; clones are made from it. */
  baseMaterial?: THREE.Material;
  /** The clone this helper last assigned, to notice when the renderer replaced the material. */
  clippedMaterial?: THREE.Material;
}

/**
 * Clipped copies of shared materials. Materials are shared by every instance of a definition, but clipping planes
 * are world-space and differ per instance, so a mesh that needs clipping gets a clone with its own planes. Clones are
 * cached by base material and plane set, and released when a pass no longer uses them.
 */
export class ClippingMaterials {
  readonly #cache = new Map<THREE.Material, Map<string, THREE.Material>>();
  #used = new Set<THREE.Material>();

  /** Starts a pass; clones not used before `end` are disposed. */
  begin(): void {
    this.#used = new Set();
  }

  end(): void {
    for (const [base, byKey] of this.#cache) {
      for (const [key, clone] of byKey) {
        if (this.#used.has(clone)) continue;
        clone.dispose();
        byKey.delete(key);
      }
      if (byKey.size === 0) this.#cache.delete(base);
    }
  }

  /**
   * Gives a mesh or line object the clipping planes (world space). An empty list restores the base material.
   */
  apply(object: THREE.Mesh | THREE.LineSegments | THREE.Points, planes: readonly THREE.Plane[]): void {
    const data = object.userData as ClippedMaterialData;
    const current = object.material;
    if (Array.isArray(current)) return;
    // The renderer may have assigned a new material since the last pass; that one becomes the base.
    if (data.baseMaterial === undefined || current !== data.clippedMaterial) data.baseMaterial = current;
    const base = data.baseMaterial;
    const material = this.#materialFor(base, planes);
    object.material = material;
    data.clippedMaterial = material;
  }

  dispose(): void {
    for (const byKey of this.#cache.values()) for (const clone of byKey.values()) clone.dispose();
    this.#cache.clear();
  }

  #materialFor(base: THREE.Material, planes: readonly THREE.Plane[]): THREE.Material {
    if (planes.length === 0) return base;
    const key = planes
      .map((p) => `${String(p.normal.x)},${String(p.normal.y)},${String(p.normal.z)},${String(p.constant)}`)
      .join('|');
    let byKey = this.#cache.get(base);
    if (!byKey) {
      byKey = new Map();
      this.#cache.set(base, byKey);
    }
    let clone = byKey.get(key);
    if (!clone) {
      clone = base.clone();
      clone.clippingPlanes = planes.map((plane) => plane.clone());
      byKey.set(key, clone);
    }
    this.#used.add(clone);
    return clone;
  }
}
