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

import { METERS_PER_UNIT, type LengthUnit } from '../../kernel/units/units';
import { exportConversion } from '../mesh/axes';
import { writeDae } from './daeWriter';
import { collectExportScene, type ExportSource } from './exportScene';
import { writeGltf } from './gltfWriter';
import { writeObj, writeStlAscii, writeStlBinary } from './meshWriters';

/*
 * The registry of implemented 3D exporters. The export dialog lists exactly these formats. Every exporter
 * triangulates faces.
 */

export type ExportFormatId = 'glb' | 'gltf' | 'obj' | 'stl' | 'stl-ascii' | 'dae';

export interface ExportFormat {
  readonly id: ExportFormatId;
  readonly label: string;
  readonly extension: string;
  readonly mimeType: string;
  /** Whether the user picks the file unit. glTF is always meters. */
  readonly allowsUnits: boolean;
  /** Whether the user picks the up axis. glTF is always Y-up. */
  readonly allowsSwap: boolean;
  readonly defaultUnit: LengthUnit;
  readonly defaultSwapZUpToYUp: boolean;
}

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  {
    id: 'glb',
    label: 'glTF binary (.glb)',
    extension: '.glb',
    mimeType: 'model/gltf-binary',
    allowsUnits: false,
    allowsSwap: false,
    defaultUnit: 'm',
    defaultSwapZUpToYUp: true,
  },
  {
    id: 'gltf',
    label: 'glTF (.gltf, embedded buffer)',
    extension: '.gltf',
    mimeType: 'model/gltf+json',
    allowsUnits: false,
    allowsSwap: false,
    defaultUnit: 'm',
    defaultSwapZUpToYUp: true,
  },
  {
    id: 'obj',
    label: 'OBJ with MTL (.obj)',
    extension: '.obj',
    mimeType: 'model/obj',
    allowsUnits: true,
    allowsSwap: true,
    defaultUnit: 'm',
    defaultSwapZUpToYUp: true,
  },
  {
    id: 'stl',
    label: 'STL binary (.stl)',
    extension: '.stl',
    mimeType: 'model/stl',
    allowsUnits: true,
    allowsSwap: true,
    defaultUnit: 'mm',
    defaultSwapZUpToYUp: false,
  },
  {
    id: 'stl-ascii',
    label: 'STL ASCII (.stl)',
    extension: '.stl',
    mimeType: 'model/stl',
    allowsUnits: true,
    allowsSwap: true,
    defaultUnit: 'mm',
    defaultSwapZUpToYUp: false,
  },
  {
    id: 'dae',
    label: 'COLLADA (.dae)',
    extension: '.dae',
    mimeType: 'model/vnd.collada+xml',
    allowsUnits: true,
    allowsSwap: true,
    defaultUnit: 'm',
    defaultSwapZUpToYUp: false,
  },
];

export function exportFormatById(id: ExportFormatId): ExportFormat {
  const format = EXPORT_FORMATS.find((candidate) => candidate.id === id);
  if (!format) throw new Error(`Unknown export format ${id}`);
  return format;
}

export interface ExportOptions {
  readonly format: ExportFormatId;
  /** File name without extension. */
  readonly fileName: string;
  readonly unit: LengthUnit;
  readonly swapZUpToYUp: boolean;
}

export interface ExportedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

const UNIT_NAMES: Readonly<Record<LengthUnit, string>> = {
  mm: 'millimeter',
  cm: 'centimeter',
  m: 'meter',
  km: 'kilometer',
  in: 'inch',
  ft: 'foot',
  yd: 'yard',
  mi: 'mile',
};

/** A file name without characters that file systems refuse, and without the format's extension. */
export function safeFileName(name: string, extension: string): string {
  let cleaned = name.trim().replace(/[\\/:*?"<>|]/g, '_');
  if (extension !== '' && cleaned.toLowerCase().endsWith(extension))
    cleaned = cleaned.slice(0, -extension.length);
  return cleaned === '' ? 'model' : cleaned;
}

/** Exports part of a model. Throws an ExportError when there is nothing to export. */
export function exportModel(
  source: ExportSource,
  options: ExportOptions,
  generator = 'Planar',
): ExportedFile[] {
  const format = exportFormatById(options.format);
  const unit = format.allowsUnits ? options.unit : 'm';
  const swap = format.allowsSwap ? options.swapZUpToYUp : format.defaultSwapZUpToYUp;
  const scene = collectExportScene(source, exportConversion(METERS_PER_UNIT[unit], swap));
  const base = safeFileName(options.fileName, format.extension);
  const encoder = new TextEncoder();
  switch (format.id) {
    case 'glb':
    case 'gltf':
      return [
        {
          name: `${base}${format.extension}`,
          bytes: writeGltf(scene, { binary: format.id === 'glb', generator }),
          mimeType: format.mimeType,
        },
      ];
    case 'obj': {
      const objBase = base.replace(/\s+/g, '_');
      const { obj, mtl } = writeObj(scene, `${objBase}.mtl`);
      return [
        { name: `${objBase}.obj`, bytes: encoder.encode(obj), mimeType: format.mimeType },
        { name: `${objBase}.mtl`, bytes: encoder.encode(mtl), mimeType: 'model/mtl' },
      ];
    }
    case 'stl':
      return [{ name: `${base}.stl`, bytes: writeStlBinary(scene), mimeType: format.mimeType }];
    case 'stl-ascii':
      return [
        { name: `${base}.stl`, bytes: encoder.encode(writeStlAscii(scene, base)), mimeType: format.mimeType },
      ];
    case 'dae':
      return [
        {
          name: `${base}.dae`,
          bytes: encoder.encode(
            writeDae(scene, {
              unitMeters: METERS_PER_UNIT[unit],
              unitName: UNIT_NAMES[unit],
              upAxis: swap ? 'Y_UP' : 'Z_UP',
              generator,
              created: new Date().toISOString(),
            }),
          ),
          mimeType: format.mimeType,
        },
      ];
  }
}
