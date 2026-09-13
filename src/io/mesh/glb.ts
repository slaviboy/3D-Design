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

/*
 * The GLB container (glTF 2.0 binary): a 12-byte header, a JSON chunk and an optional binary chunk, each padded to a
 * four-byte boundary. Used by the glTF exporter, and by the importer to hand three's loader a self-contained file.
 */

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

export function isGlb(bytes: Uint8Array): boolean {
  return bytes.byteLength >= HEADER_BYTES && readUint32(bytes, 0) === MAGIC;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

const padded = (length: number): number => Math.ceil(length / 4) * 4;

export function encodeGlb(json: unknown, binary: Uint8Array | null): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = padded(jsonBytes.byteLength);
  const binLength = binary ? padded(binary.byteLength) : 0;
  const total =
    HEADER_BYTES + CHUNK_HEADER_BYTES + jsonLength + (binary ? CHUNK_HEADER_BYTES + binLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(jsonBytes, 20);
  if (binary) {
    const start = 20 + jsonLength;
    view.setUint32(start, binLength, true);
    view.setUint32(start + 4, CHUNK_BIN, true);
    out.set(binary, start + CHUNK_HEADER_BYTES);
  }
  return out;
}

/** Splits a GLB into its JSON text and binary chunk. Throws on a malformed container. */
export function decodeGlb(bytes: Uint8Array): { json: string; binary: Uint8Array | null } {
  if (!isGlb(bytes)) throw new Error('not a GLB file');
  const version = readUint32(bytes, 4);
  if (version !== 2) throw new Error(`GLB version ${String(version)} is not supported`);
  const declared = readUint32(bytes, 8);
  if (declared > bytes.byteLength || declared < HEADER_BYTES + CHUNK_HEADER_BYTES)
    throw new Error('the GLB file is truncated');
  let offset = HEADER_BYTES;
  let json: string | null = null;
  let binary: Uint8Array | null = null;
  while (offset + CHUNK_HEADER_BYTES <= declared) {
    const length = readUint32(bytes, offset);
    const type = readUint32(bytes, offset + 4);
    const start = offset + CHUNK_HEADER_BYTES;
    if (start + length > declared) throw new Error('a GLB chunk runs past the end of the file');
    if (type === CHUNK_JSON && json === null)
      json = new TextDecoder().decode(bytes.subarray(start, start + length));
    else if (type === CHUNK_BIN && binary === null) binary = bytes.subarray(start, start + length);
    offset = start + padded(length);
  }
  if (json === null) throw new Error('the GLB file has no JSON chunk');
  return { json, binary };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Decodes a base64 `data:` URI. Returns null for anything else (including non-base64 data URIs). */
export function decodeDataUri(uri: string): Uint8Array | null {
  const match = /^data:[^,]*;base64,(.*)$/s.exec(uri.trim());
  if (!match) return null;
  try {
    return base64ToBytes(match[1] ?? '');
  } catch {
    return null;
  }
}
