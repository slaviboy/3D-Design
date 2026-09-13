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

import { readImageHeader, sha256Hex, textureBytesProblem } from '../../kernel/model/assets';
import { decodeDataUri } from '../mesh/glb';
import {
  IDENTITY_UV_TRANSFORM,
  type ImportedMaterialTexture,
  type ImportedTexture,
} from '../mesh/importedScene';
import { baseName, isExternalReference, type FileResolver } from './fileSet';

/*
 * Collects the images an import refers to. Images come only from the picked files, embedded bytes (a glTF buffer
 * view) or data: URIs; nothing is ever fetched. Only PNG and JPEG within the kernel's texture limits are kept,
 * one entry per distinct content. Everything skipped is reported in one counted warning, so the material keeps
 * its color and the user learns why.
 */

/** Recognizes common image formats Planar doesn't import, by signature, then by extension. */
function otherImageFormat(name: string, bytes: Uint8Array | null): string | null {
  const ascii = (start: number, end: number): string =>
    bytes ? String.fromCharCode(...bytes.subarray(start, end)) : '';
  if (bytes) {
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'WebP';
    if (bytes[0] === 0xab && ascii(1, 7) === 'KTX 2') return 'KTX2';
    if (ascii(1, 4) === 'KTX') return 'KTX';
    if (ascii(0, 4) === 'DDS ') return 'DDS';
    if (ascii(0, 3) === 'GIF') return 'GIF';
    if (ascii(0, 2) === 'BM') return 'BMP';
    if (ascii(4, 12) === 'ftypavif') return 'AVIF';
  }
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  const byExtension: Record<string, string> = {
    webp: 'WebP',
    ktx2: 'KTX2',
    ktx: 'KTX',
    dds: 'DDS',
    gif: 'GIF',
    bmp: 'BMP',
    tga: 'TGA',
    tif: 'TIFF',
    tiff: 'TIFF',
    avif: 'AVIF',
    hdr: 'HDR',
    exr: 'EXR',
    psd: 'PSD',
  };
  return extension === undefined ? null : (byExtension[extension] ?? null);
}

export class TextureCollector {
  readonly #resolver: FileResolver;
  readonly #warnings: string[];
  readonly #textures: ImportedTexture[] = [];
  readonly #byDigest = new Map<string, number>();
  /** Results per reference, so a file used by several materials is read and reported once. */
  readonly #byReference = new Map<string, number | null>();
  readonly #skipped: string[] = [];

  constructor(resolver: FileResolver, warnings: string[]) {
    this.#resolver = resolver;
    this.#warnings = warnings;
  }

  get textures(): readonly ImportedTexture[] {
    return this.#textures;
  }

  /** Skips an image with a reason, counted in the summary warning. */
  skip(name: string, reason: string): void {
    this.#skipped.push(`${name} (${reason})`);
  }

  /**
   * The texture index for a file reference (a path relative to the model, a `file:` URI resolved by file name, or a
   * data: URI), or null when it can't be used. External URLs are warned about by the resolver and never fetched.
   */
  fromReference(reference: string): number | null {
    const trimmed = reference.trim();
    if (trimmed === '') return null;
    const known = this.#byReference.get(trimmed);
    if (known !== undefined) return known;
    let result: number | null = null;
    if (trimmed.startsWith('data:')) {
      const bytes = decodeDataUri(trimmed);
      if (bytes) result = this.fromBytes('Embedded image', bytes);
      else this.skip('an embedded image', 'unreadable data URI');
    } else {
      // A file: URI names a file on the author's machine; look for a picked file with the same name.
      const local = /^file:/i.test(trimmed) ? baseName(trimmed.replace(/^file:\/*/i, '')) : trimmed;
      const name = baseName(local);
      if (!isExternalReference(local) && otherImageFormat(name, null)) {
        // Don't even look for formats that can't be used; say why instead of "not among the selected files".
        this.skip(name, `${otherImageFormat(name, null) ?? ''} images are not supported`);
      } else {
        const bytes = this.#resolver.resolve(local, 'texture');
        if (bytes) result = this.fromBytes(name, bytes);
      }
    }
    this.#byReference.set(trimmed, result);
    return result;
  }

  /** The texture index for encoded image bytes, or null (with the reason recorded) when they can't be used. */
  fromBytes(name: string, bytes: Uint8Array): number | null {
    const header = readImageHeader(bytes);
    if (!header) {
      const format = otherImageFormat(name, bytes);
      this.skip(name, format ? `${format} images are not supported` : 'not a PNG or JPEG image');
      return null;
    }
    const problem = textureBytesProblem(bytes);
    if (problem !== null) {
      this.skip(name, problem.replace(/^the image /, ''));
      return null;
    }
    const digest = sha256Hex(bytes);
    const known = this.#byDigest.get(digest);
    if (known !== undefined) return known;
    // Copy, so the texture doesn't keep (or transfer) a whole model file's buffer.
    const index = this.#textures.push({ name, bytes: bytes.slice() }) - 1;
    this.#byDigest.set(digest, index);
    return index;
  }

  /** A material texture reference, or undefined when there is no usable image. */
  reference(
    image: number | null,
    uvTransform: readonly number[] = IDENTITY_UV_TRANSFORM,
  ): ImportedMaterialTexture | undefined {
    return image === null ? undefined : { image, uvTransform };
  }

  /** Adds the counted warning for skipped images. Call once, after every material was read. */
  finish(): readonly ImportedTexture[] {
    const unique = [...new Set(this.#skipped)];
    if (unique.length > 0) {
      const shown = unique.slice(0, 4).join(', ');
      const more = unique.length > 4 ? ` and ${String(unique.length - 4)} more` : '';
      this.#warnings.push(
        `Skipped ${String(unique.length)} ${unique.length === 1 ? 'texture image' : 'texture images'} that Planar can't use (only PNG and JPEG are imported): ${shown}${more}. Those materials keep their color`,
      );
    }
    return this.#textures;
  }
}

/** Composes two UV transforms: first `inner`, then `outer`. */
export function composeUvTransforms(outer: readonly number[], inner: readonly number[]): number[] {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = outer;
  const [p = 1, q = 0, r = 0, s = 1, t = 0, u = 0] = inner;
  return [a * p + c * q, b * p + d * q, a * r + c * s, b * r + d * s, a * t + c * u + e, b * t + d * u + f];
}
