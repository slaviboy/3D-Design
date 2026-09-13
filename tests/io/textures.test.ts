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

import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodePlanarFile, encodePlanarFile } from '../../src/io/format/planarFile';
import { MAX_TEXTURE_BYTES, sha256Hex } from '../../src/kernel/model/assets';
import { addMaterial, addTextureAsset, setFaceAttributes } from '../../src/kernel/model/mutations';
import { hashDocument } from '../../src/kernel/model/snapshot';
import { draw, faceIds, newDocument, rectangle } from '../kernel/helpers';
import { jpegBytes, pngBytes } from '../kernel/imageBytes';

const OPTIONS = { appVersion: '0.0.0-test', now: new Date('2026-09-13T10:00:00.000Z') };

function texturedFile() {
  const doc = newDocument();
  draw(doc, rectangle(0, 0, 1, 1));
  const [face] = faceIds(doc.rootStore);
  if (face === undefined) throw new Error('expected a face');
  const png = pngBytes(16, 8);
  const jpeg = jpegBytes(20, 10);
  doc.transact('Materials', () => {
    const tiles = addTextureAsset(doc, 'tiles.png', png);
    const photo = addTextureAsset(doc, 'photo.jpg', jpeg);
    const first = addMaterial(doc, {
      name: 'Tiles',
      color: { r: 1, g: 1, b: 1 },
      texture: { assetId: tiles, width: 1, height: 0.5 },
    });
    addMaterial(doc, {
      name: 'Photo',
      color: { r: 1, g: 1, b: 1 },
      texture: { assetId: photo, width: 2, height: 1 },
    });
    setFaceAttributes(doc, doc.rootDefinitionId, face, { frontMaterialId: first });
  });
  return { doc, png, jpeg, bytes: encodePlanarFile(doc, OPTIONS) };
}

function rezip(bytes: Uint8Array, edit: (entries: Record<string, Uint8Array>) => void): Uint8Array {
  const entries = unzipSync(bytes);
  edit(entries);
  return zipSync(entries);
}

describe('.planar texture assets', () => {
  it('stores texture bytes under assets/textures by digest and restores them', () => {
    const { doc, png, jpeg, bytes } = texturedFile();
    const names = Object.keys(unzipSync(bytes)).sort();
    expect(names).toEqual(
      [
        `assets/textures/${sha256Hex(jpeg)}.jpg`,
        `assets/textures/${sha256Hex(png)}.png`,
        'manifest.json',
        'model.json',
      ].sort(),
    );
    const result = decodePlanarFile(bytes);
    if (!result.ok) throw new Error(result.error);
    expect(hashDocument(result.value.doc)).toBe(hashDocument(doc));
    const restored = [...result.value.doc.assets()].map((asset) => asset.bytes);
    expect(restored).toEqual([png, jpeg]);
  });

  it('refuses a project whose texture is missing or corrupt', () => {
    const { png, bytes } = texturedFile();
    const name = `assets/textures/${sha256Hex(png)}.png`;
    const missing = zipSync(
      Object.fromEntries(Object.entries(unzipSync(bytes)).filter(([key]) => key !== name)),
    );
    expect(decodePlanarFile(missing)).toMatchObject({ ok: false, error: expect.stringContaining('missing') });
    const corrupt = rezip(bytes, (entries) => {
      entries[name] = pngBytes(16, 8, 7);
    });
    expect(decodePlanarFile(corrupt)).toMatchObject({ ok: false, error: expect.stringContaining('corrupt') });
  });

  it('refuses oversize texture entries before decompressing them', () => {
    const { bytes } = texturedFile();
    const oversize = rezip(bytes, (entries) => {
      entries[`assets/textures/${'0'.repeat(64)}.png`] = new Uint8Array(MAX_TEXTURE_BYTES + 1);
    });
    expect(decodePlanarFile(oversize)).toMatchObject({
      ok: false,
      error: expect.stringContaining('too large'),
    });
  });
});
