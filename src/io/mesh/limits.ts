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

/** Resource limits for imports. Every file is untrusted (SECURITY.md, "Untrusted input"). */
export interface ImportLimits {
  /** Largest single file accepted, in bytes. Applies to picked files and to files inside a zip. */
  readonly maxFileBytes: number;
  /** Largest total size of all files, after unzipping. */
  readonly maxTotalBytes: number;
  /** Most triangles one import may contain. */
  readonly maxTriangles: number;
  /** Most entries a zip may contain. */
  readonly maxArchiveEntries: number;
  /** Most nodes (groups) one import may contain. */
  readonly maxNodes: number;
  /** Largest texture edge, in pixels. Textures larger than this are scaled down. */
  readonly maxTextureSize: number;
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = Object.freeze({
  maxFileBytes: 256 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxTriangles: 250_000,
  maxArchiveEntries: 2_000,
  maxNodes: 50_000,
  maxTextureSize: 4096,
});

/** A problem with an imported file, with a message meant for the user. */
export class ImportError extends Error {
  override readonly name = 'ImportError';
}

/** Scales width × height down, keeping the aspect ratio, so neither edge exceeds `max`. Results are whole pixels. */
export function clampImageSize(
  width: number,
  height: number,
  max: number,
): { readonly width: number; readonly height: number } {
  const w = Math.max(1, Math.round(Number.isFinite(width) ? width : 1));
  const h = Math.max(1, Math.round(Number.isFinite(height) ? height : 1));
  const factor = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.floor(w * factor)), height: Math.max(1, Math.floor(h * factor)) };
}
