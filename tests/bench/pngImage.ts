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

import { zlibSync } from 'fflate';

/*
 * PNG files for benchmarks, generated at run time so no image files are bundled with the tests.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)));
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function ihdr(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, deflate, no interlace
  return chunk('IHDR', data);
}

/**
 * A real, decodable RGB PNG of `size` × `size` pixels: a checkerboard of 64-pixel squares with a color gradient.
 * The pattern compresses well, so the file is small even though the decoded image (and its GPU texture) is large.
 */
export function checkerPng(size: number): Uint8Array {
  const rowBytes = 1 + size * 3;
  const raw = new Uint8Array(rowBytes * size);
  for (let y = 0; y < size; y++) {
    const row = y * rowBytes;
    raw[row] = 0; // filter: none
    const band = Math.floor((255 * y) / size);
    for (let x = 0; x < size; x++) {
      const dark = ((x >> 6) + (y >> 6)) % 2 === 0;
      const offset = row + 1 + x * 3;
      raw[offset] = dark ? 40 : 230;
      raw[offset + 1] = dark ? band : 255 - band;
      raw[offset + 2] = dark ? 90 : 180;
    }
  }
  return concat([
    new Uint8Array(PNG_SIGNATURE),
    ihdr(size, size),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * A PNG-sized file with a valid signature and IHDR for `size` × `size` pixels followed by `payloadBytes` of
 * incompressible data. The kernel and the .planar format only read the header, so this stands in for a large photo
 * texture without the cost of encoding one; it is not decodable.
 */
export function largePngPlaceholder(size: number, payloadBytes: number): Uint8Array {
  const payload = new Uint8Array(payloadBytes);
  // A fixed xorshift sequence: incompressible like real image data, and the same on every run.
  let state = 0x9e3779b9;
  for (let i = 0; i < payloadBytes; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    payload[i] = state & 0xff;
  }
  return concat([
    new Uint8Array(PNG_SIGNATURE),
    ihdr(size, size),
    chunk('IDAT', payload),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
