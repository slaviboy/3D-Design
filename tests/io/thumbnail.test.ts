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

import { describe, expect, it } from 'vitest';
import {
  decodePlanarFile,
  encodePlanarFile,
  MAX_THUMBNAIL_BYTES,
  readPlanarThumbnail,
} from '../../src/io/format/planarFile';
import { draw, newDocument, rectangle } from '../kernel/helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function model() {
  const doc = newDocument();
  draw(doc, rectangle(0, 0, 2, 1));
  return doc;
}

describe('.planar thumbnails', () => {
  it('stores a PNG preview that can be read back without decoding the model', () => {
    const bytes = encodePlanarFile(model(), { appVersion: 'test', now: new Date(0), thumbnail: PNG });
    expect(readPlanarThumbnail(bytes)).toEqual(PNG);
    expect(decodePlanarFile(bytes).ok).toBe(true);
  });

  it('leaves out previews that are not PNG or too large, and files without one read as null', () => {
    const notPng = encodePlanarFile(model(), {
      appVersion: 'test',
      now: new Date(0),
      thumbnail: new Uint8Array([1, 2, 3]),
    });
    expect(readPlanarThumbnail(notPng)).toBeNull();
    const huge = new Uint8Array(MAX_THUMBNAIL_BYTES + 1);
    huge.set(PNG);
    expect(
      readPlanarThumbnail(
        encodePlanarFile(model(), { appVersion: 'test', now: new Date(0), thumbnail: huge }),
      ),
    ).toBeNull();
    expect(
      readPlanarThumbnail(encodePlanarFile(model(), { appVersion: 'test', now: new Date(0) })),
    ).toBeNull();
    expect(readPlanarThumbnail(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
