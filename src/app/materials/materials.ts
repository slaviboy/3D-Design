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

import type { MaterialId } from '../../kernel/ids';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import type { MaterialTexture, Rgb } from '../../kernel/model/types';
import { materialAreas, materialUsage } from '../../kernel/ops/materials';
import { hexToRgb } from '../tags/tags';

/** One row of the Materials panel. */
export interface MaterialRow {
  readonly id: MaterialId;
  readonly name: string;
  readonly color: Rgb;
  readonly opacity: number;
  readonly metalness: number;
  readonly roughness: number;
  readonly texture: MaterialTexture | null;
  /** Pixel size and file name of the texture image, when there is one. */
  readonly image: { readonly name: string; readonly width: number; readonly height: number } | null;
  /** Face sides, edges, groups and components that use the material. */
  readonly usage: number;
  /** Painted world-space area in square meters. */
  readonly area: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Materials in the model, sorted by name, with usage and painted area. */
export function listMaterials(doc: ModelDocument): MaterialRow[] {
  const usage = materialUsage(doc);
  const areas = materialAreas(doc);
  return [...doc.materials()]
    .map((material) => {
      const asset = material.texture ? doc.asset(material.texture.assetId) : undefined;
      return {
        id: material.id,
        name: material.name,
        color: material.color,
        opacity: material.opacity,
        metalness: material.metalness,
        roughness: material.roughness,
        texture: material.texture,
        image: asset ? { name: asset.name, width: asset.width, height: asset.height } : null,
        usage: usage.get(material.id) ?? 0,
        area: areas.get(material.id) ?? 0,
      };
    })
    .sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);
}

/** `Material 1`, `Material 2`, … — or `base` itself, then `base 2`, … when a base name is given. */
export function uniqueMaterialName(doc: ModelDocument, base?: string): string {
  const names = new Set([...doc.materials()].map((material) => material.name));
  if (base !== undefined && !names.has(base)) return base;
  for (let n = base === undefined ? 1 : 2; ; n++) {
    const candidate = `${base ?? 'Material'} ${String(n)}`;
    if (!names.has(candidate)) return candidate;
  }
}

/** A color material shipped with Planar. */
export interface LibraryMaterial {
  readonly name: string;
  /** sRGB hex. */
  readonly hex: string;
  readonly opacity?: number;
  readonly metalness?: number;
  readonly roughness?: number;
}

/** Planar's bundled library: plain colors defined here, with no images. */
export const MATERIAL_LIBRARY: readonly LibraryMaterial[] = [
  { name: 'Chalk White', hex: '#f4f1ea' },
  { name: 'Warm Gray', hex: '#a39e93' },
  { name: 'Charcoal', hex: '#3b3d40' },
  { name: 'Clay Brick', hex: '#a4553a' },
  { name: 'Terracotta', hex: '#c8734f' },
  { name: 'Sandstone', hex: '#d8c29a' },
  { name: 'Pine', hex: '#c9a26b' },
  { name: 'Walnut', hex: '#6b4a32' },
  { name: 'Moss', hex: '#6f8a4e' },
  { name: 'Slate Blue', hex: '#50698a' },
  { name: 'Clear Glass', hex: '#bcd8e6', opacity: 0.35, roughness: 0.1 },
  { name: 'Brushed Steel', hex: '#b8bcc2', metalness: 1, roughness: 0.4 },
];

export function libraryColor(entry: LibraryMaterial): Rgb {
  return hexToRgb(entry.hex) ?? { r: 0.5, g: 0.5, b: 0.5 };
}
