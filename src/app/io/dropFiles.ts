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

import { PLANAR_FILE_EXTENSION } from '../../io/format/planarFile';
import type { InputFile } from '../../io/import/fileSet';
import { IMPORT_FORMATS } from '../../io/import/formats';

/** Main model extensions that can be dropped, lower case with the dot. */
export const IMPORT_EXTENSIONS: readonly string[] = IMPORT_FORMATS.flatMap((format) => [
  ...format.extensions,
]);

/** Files an importer reads alongside a model: materials, buffers and textures. */
export const COMPANION_EXTENSIONS: readonly string[] = [
  ...new Set(IMPORT_FORMATS.flatMap((format) => [...format.companions])),
  '.zip',
];

/** Everything the window accepts by drag and drop. */
export const DROPPABLE_EXTENSIONS: readonly string[] = [PLANAR_FILE_EXTENSION, ...IMPORT_EXTENSIONS];

/** What a set of dropped files means. */
export type DroppedFiles =
  /** A Planar project, which replaces the open model. */
  | { readonly kind: 'project'; readonly file: InputFile }
  /** Models to add to the open model, with the companion files they refer to. */
  | { readonly kind: 'import'; readonly files: readonly InputFile[] }
  | { readonly kind: 'unsupported'; readonly names: readonly string[] };

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * Decides what dropping these files does. A project wins over models, since opening one replaces everything;
 * otherwise every model file is imported, together with the companions dropped with it.
 */
export function classifyDroppedFiles(files: readonly InputFile[]): DroppedFiles {
  const project = files.find((file) => extensionOf(file.name) === PLANAR_FILE_EXTENSION);
  if (project) return { kind: 'project', file: project };
  const usable = files.filter((file) => {
    const extension = extensionOf(file.name);
    return IMPORT_EXTENSIONS.includes(extension) || COMPANION_EXTENSIONS.includes(extension);
  });
  const hasModel = usable.some((file) => IMPORT_EXTENSIONS.includes(extensionOf(file.name)));
  if (hasModel) return { kind: 'import', files: usable };
  return { kind: 'unsupported', names: files.map((file) => file.name) };
}

/** "a .planar project, or a glTF, OBJ, STL, COLLADA or 3DS model", for the drop overlay and error messages. */
export function describeDroppableFiles(): string {
  const formats = IMPORT_FORMATS.map((format) => format.label.split(' (')[0] ?? format.label);
  const last = formats.pop();
  return `a ${PLANAR_FILE_EXTENSION} project, or a ${formats.join(', ')} or ${last ?? ''} model`;
}
