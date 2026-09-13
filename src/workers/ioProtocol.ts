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

import type { InputFile } from '../io/import/fileSet';
import type { ImportedScene } from '../io/mesh/importedScene';
import type { ImportLimits } from '../io/mesh/limits';

/** Parse the picked files of one import into an ImportedScene. */
export interface ImportParseRequest {
  readonly id: number;
  readonly files: readonly InputFile[];
  readonly limits: ImportLimits;
}

export type ImportParseResponse =
  | { readonly id: number; readonly ok: true; readonly scene: ImportedScene }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** The buffers of the files, to transfer rather than copy them to the worker. */
export function fileTransferables(files: readonly InputFile[]): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const file of files) if (file.bytes.buffer instanceof ArrayBuffer) buffers.add(file.bytes.buffer);
  return [...buffers];
}
