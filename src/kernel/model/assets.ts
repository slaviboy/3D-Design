import type { TextureMimeType } from './types';

/** Texture files larger than this are refused, when imported and when a project is opened. */
export const MAX_TEXTURE_BYTES = 32 * 1024 * 1024;
/** Textures wider or taller than this many pixels are refused (WebGL implementations commonly cap at 8192). */
export const MAX_TEXTURE_DIMENSION = 8192;

export const TEXTURE_MIME_TYPES: readonly TextureMimeType[] = ['image/png', 'image/jpeg'];

export function isTextureMimeType(value: unknown): value is TextureMimeType {
  return value === 'image/png' || value === 'image/jpeg';
}

/** File extension used for a texture inside a project archive. */
export function textureExtension(mimeType: TextureMimeType): 'png' | 'jpg' {
  return mimeType === 'image/png' ? 'png' : 'jpg';
}

export interface ImageHeader {
  readonly mimeType: TextureMimeType;
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      ((bytes[offset + 1] ?? 0) << 16) +
      ((bytes[offset + 2] ?? 0) << 8) +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readU16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readPngHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 24) return null;
  // The first chunk must be IHDR: length 13, type "IHDR", then width and height.
  if (readU32(bytes, 8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null;
  return { mimeType: 'image/png', width: readU32(bytes, 16), height: readU32(bytes, 20) };
}

/** Start-of-frame markers that carry the image size (baseline, progressive, lossless and arithmetic variants). */
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function readJpegHeader(bytes: Uint8Array): ImageHeader | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const segmentLength = readU16(bytes, offset + 2);
    if (segmentLength < 2) return null;
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (offset + 9 > bytes.length) return null;
      return {
        mimeType: 'image/jpeg',
        height: readU16(bytes, offset + 5),
        width: readU16(bytes, offset + 7),
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

/**
 * Identifies a PNG or JPEG file and reads its pixel size from the header, without decoding the image.
 * Returns null for anything else, including truncated headers.
 */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return readPngHeader(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpegHeader(bytes);
  return null;
}

/** Why texture bytes can't be used, or null when they are a supported image within the limits. */
export function textureBytesProblem(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0) return 'the image is empty';
  if (bytes.byteLength > MAX_TEXTURE_BYTES) {
    return `the image is larger than ${String(MAX_TEXTURE_BYTES / (1024 * 1024))} MB`;
  }
  const header = readImageHeader(bytes);
  if (!header) return 'the image is not a PNG or JPEG file';
  if (header.width < 1 || header.height < 1) return 'the image has no pixels';
  if (header.width > MAX_TEXTURE_DIMENSION || header.height > MAX_TEXTURE_DIMENSION) {
    return `the image is larger than ${String(MAX_TEXTURE_DIMENSION)} pixels on a side`;
  }
  return null;
}

// -------------------------------------------------------------------------------------------------- SHA-256

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const digestCache = new WeakMap<Uint8Array, string>();

/** SHA-256 of `bytes` as lowercase hex. Results are cached per array, since asset bytes are immutable. */
export function sha256Hex(bytes: Uint8Array): string {
  const cached = digestCache.get(bytes);
  if (cached !== undefined) return cached;
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const w = new Uint32Array(64);
  for (let chunk = 0; chunk < paddedLength; chunk += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(chunk + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      w[i] = (w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1;
    }
    let a = h[0] ?? 0;
    let b = h[1] ?? 0;
    let c = h[2] ?? 0;
    let d = h[3] ?? 0;
    let e = h[4] ?? 0;
    let f = h[5] ?? 0;
    let g = h[6] ?? 0;
    let hh = h[7] ?? 0;
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const choose = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + choose + (K[i] ?? 0) + (w[i] ?? 0)) | 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] ?? 0) + a;
    h[1] = (h[1] ?? 0) + b;
    h[2] = (h[2] ?? 0) + c;
    h[3] = (h[3] ?? 0) + d;
    h[4] = (h[4] ?? 0) + e;
    h[5] = (h[5] ?? 0) + f;
    h[6] = (h[6] ?? 0) + g;
    h[7] = (h[7] ?? 0) + hh;
  }
  const hex = [...h].map((word) => word.toString(16).padStart(8, '0')).join('');
  digestCache.set(bytes, hex);
  return hex;
}
