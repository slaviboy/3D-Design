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

import type { LengthUnit } from '../../kernel/units/units';

/*
 * The registry of implemented importers. The import dialog, the file picker filter and the worker's dispatch all
 * come from this list, so a format appears in the interface only once it is implemented and tested.
 * This module must not import any parser: the application bundle reads it, and parsers live in the io worker.
 */

export type ImportFormatId = 'gltf' | 'obj' | 'stl' | 'dae' | '3ds';

export interface ImportFormat {
  readonly id: ImportFormatId;
  readonly label: string;
  /** Extensions of the main model file, lower case with the dot. */
  readonly extensions: readonly string[];
  /** Extensions of files the model may refer to, picked along with it. */
  readonly companions: readonly string[];
  /** The unit assumed for file coordinates. */
  readonly defaultUnit: LengthUnit;
  /** Whether the file is usually Y-up. */
  readonly defaultSwapYUpToZUp: boolean;
  /** The file declares its own unit and up axis, so the dialog doesn't ask. */
  readonly unitsFromFile: boolean;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'] as const;

export const IMPORT_FORMATS: readonly ImportFormat[] = [
  {
    id: 'gltf',
    label: 'glTF (.gltf, .glb)',
    extensions: ['.glb', '.gltf'],
    companions: ['.bin', ...IMAGE_EXTENSIONS],
    defaultUnit: 'm',
    defaultSwapYUpToZUp: true,
    unitsFromFile: false,
  },
  {
    id: 'obj',
    label: 'OBJ (.obj with .mtl)',
    extensions: ['.obj'],
    companions: ['.mtl', ...IMAGE_EXTENSIONS],
    defaultUnit: 'm',
    defaultSwapYUpToZUp: true,
    unitsFromFile: false,
  },
  {
    id: 'stl',
    label: 'STL (.stl)',
    extensions: ['.stl'],
    companions: [],
    defaultUnit: 'mm',
    defaultSwapYUpToZUp: false,
    unitsFromFile: false,
  },
  {
    id: 'dae',
    label: 'COLLADA (.dae)',
    extensions: ['.dae'],
    companions: [...IMAGE_EXTENSIONS],
    defaultUnit: 'm',
    defaultSwapYUpToZUp: false,
    unitsFromFile: true,
  },
  {
    id: '3ds',
    label: '3DS (.3ds)',
    extensions: ['.3ds'],
    companions: [...IMAGE_EXTENSIONS],
    defaultUnit: 'in',
    defaultSwapYUpToZUp: false,
    unitsFromFile: false,
  },
];

export const ZIP_EXTENSION = '.zip';

export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

export function importFormatFor(name: string): ImportFormat | undefined {
  const extension = extensionOf(name);
  return IMPORT_FORMATS.find((format) => format.extensions.includes(extension));
}

export function importFormatById(id: ImportFormatId): ImportFormat {
  const format = IMPORT_FORMATS.find((candidate) => candidate.id === id);
  if (!format) throw new Error(`Unknown import format ${id}`);
  return format;
}

/** Every extension the import file picker accepts: model files, their companions and zips. */
export function importAcceptedExtensions(): string[] {
  return [
    ...new Set([
      ...IMPORT_FORMATS.flatMap((format) => [...format.extensions, ...format.companions]),
      ZIP_EXTENSION,
    ]),
  ];
}
