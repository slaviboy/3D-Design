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
