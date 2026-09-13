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

import { rgbFromSrgb } from '../mesh/color';
import type { ImportedMaterial } from '../mesh/importedScene';

/*
 * A small MTL reader: diffuse color (Kd), dissolve (d) or transparency (Tr), and the diffuse texture (map_Kd) with
 * its -o (offset) and -s (scale) options. three's MTLLoader creates textures through the DOM when materials are
 * used, which a worker can't do; the OBJ importer resolves the texture file among the picked files itself.
 */

export interface MtlMaterial extends ImportedMaterial {
  /** The map_Kd options as a UV transform [a, b, c, d, e, f] (see ImportedMaterialTexture.uvTransform). */
  readonly textureUvTransform: readonly number[];
}

/** map_* options and how many values each takes (-o, -s and -t take one to three numbers). */
const FIXED_OPTION_ARGUMENTS: Readonly<Record<string, number>> = {
  '-blendu': 1,
  '-blendv': 1,
  '-bm': 1,
  '-boost': 1,
  '-cc': 1,
  '-clamp': 1,
  '-imfchan': 1,
  '-texres': 1,
  '-type': 1,
  '-mm': 2,
};
const VECTOR_OPTIONS = new Set(['-o', '-s', '-t']);

/** Splits a map statement into its file name and its -o / -s options. */
export function parseTextureMap(tokens: readonly string[]): {
  name: string | null;
  uvTransform: readonly number[];
} {
  let offset = [0, 0];
  let scale = [1, 1];
  let i = 0;
  while (i < tokens.length) {
    const option = (tokens[i] ?? '').toLowerCase();
    const fixed = FIXED_OPTION_ARGUMENTS[option];
    if (fixed !== undefined) {
      i += 1 + fixed;
    } else if (VECTOR_OPTIONS.has(option)) {
      const values: number[] = [];
      i++;
      while (values.length < 3 && i < tokens.length && Number.isFinite(Number(tokens[i]))) {
        values.push(Number(tokens[i]));
        i++;
      }
      // A trailing number is the file name, not an option value (a file called "1" is unlikely but possible).
      if (i >= tokens.length && values.length > 0) {
        i--;
        values.pop();
      }
      const [x = option === '-s' ? 1 : 0, y = option === '-s' ? 1 : 0] = values;
      if (option === '-o') offset = [x, y];
      else if (option === '-s') scale = [x, y];
    } else {
      break;
    }
  }
  const name = tokens.slice(i).join(' ');
  return {
    name: name === '' ? null : name,
    uvTransform: [scale[0] ?? 1, 0, 0, scale[1] ?? 1, offset[0] ?? 0, offset[1] ?? 0],
  };
}

export function parseMtl(text: string): Map<string, MtlMaterial> {
  const materials = new Map<string, MtlMaterial>();
  let name: string | null = null;
  let color = { r: 0.8, g: 0.8, b: 0.8 };
  let opacity = 1;
  let textureName: string | null = null;
  let textureUvTransform: readonly number[] = [1, 0, 0, 1, 0, 0];
  const flush = (): void => {
    if (name !== null) materials.set(name, { name, color, opacity, textureName, textureUvTransform });
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [keyword = '', ...rest] = line.split(/\s+/);
    const key = keyword.toLowerCase();
    const numbers = rest.map(Number);
    if (key === 'newmtl') {
      flush();
      name = rest.join(' ');
      color = { r: 0.8, g: 0.8, b: 0.8 };
      opacity = 1;
      textureName = null;
      textureUvTransform = [1, 0, 0, 1, 0, 0];
    } else if (key === 'kd' && numbers.length >= 3 && numbers.slice(0, 3).every(Number.isFinite)) {
      color = rgbFromSrgb(numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0);
    } else if (key === 'd' && Number.isFinite(numbers[0])) {
      opacity = Math.min(1, Math.max(0, numbers[0] ?? 1));
    } else if (key === 'tr' && Number.isFinite(numbers[0])) {
      opacity = Math.min(1, Math.max(0, 1 - (numbers[0] ?? 0)));
    } else if (key === 'map_kd' && rest.length > 0) {
      const map = parseTextureMap(rest);
      textureName = map.name;
      textureUvTransform = map.uvTransform;
    }
  }
  flush();
  return materials;
}

/** File names listed by `mtllib` statements in an OBJ file. */
export function materialLibraries(objText: string): string[] {
  const names: string[] = [];
  for (const match of objText.matchAll(/^[ \t]*mtllib[ \t]+(.+?)[ \t]*$/gm)) {
    const value = match[1] ?? '';
    // Several libraries may be listed on one line; names with spaces are rare and not supported.
    names.push(...value.split(/\s+/).filter((item) => item !== ''));
  }
  return names;
}
