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

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodePlanarFile, encodePlanarFile } from '../../src/io/format/planarFile';
import { draw, newDocument, rectangle } from '../kernel/helpers';

/** A .planar file whose first face is painted with a material that doesn't exist. */
function corruptedFile(): Uint8Array {
  const doc = newDocument();
  draw(doc, rectangle(0, 0, 2, 1));
  const entries = unzipSync(encodePlanarFile(doc, { appVersion: 'test', now: new Date(0) }));
  const modelName = Object.keys(entries).find((name) => name.endsWith('.json') && name !== 'manifest.json');
  if (!modelName) throw new Error('no model entry');
  const model = JSON.parse(strFromU8(entries[modelName] ?? new Uint8Array())) as {
    nextId: number;
    definitions: { faces: { attributes: Record<string, unknown> }[] }[];
  };
  const face = model.definitions[0]?.faces[0];
  if (!face) throw new Error('no face');
  face.attributes.frontMaterialId = model.nextId + 10;
  entries[modelName] = strToU8(JSON.stringify(model));
  return zipSync(entries);
}

describe('opening .planar files with problems', () => {
  it('refuses them by default and repairs them on request', () => {
    const bytes = corruptedFile();
    expect(decodePlanarFile(bytes).ok).toBe(false);
    const repaired = decodePlanarFile(bytes, {}, { repair: true });
    expect(repaired.ok).toBe(true);
    if (repaired.ok) {
      expect(repaired.value.repairs).toHaveLength(1);
      expect([...repaired.value.doc.rootStore.faces()]).toHaveLength(1);
    }
  });
});
