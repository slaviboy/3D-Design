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

import { mkdirSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, test } from 'vitest';
import { IDENTITY } from '../../src/kernel/math/mat4';
import { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { addTextureAsset } from '../../src/kernel/model/mutations';
import type { ExportSource } from '../../src/io/export/exportScene';
import { exportModel, type ExportFormatId } from '../../src/io/export/formats';
import { decodePlanarFile, encodePlanarFile } from '../../src/io/format/planarFile';
import { parseImportFiles } from '../../src/io/import/parseImport';
import { encodeGlb } from '../../src/io/mesh/glb';
import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from '../../src/io/mesh/limits';
import { insertImportedScene } from '../../src/io/mesh/sceneToKernel';
import { boxGrid, paintAllFaces } from './models';
import { largePngPlaceholder } from './pngImage';

/*
 * Save/load, import, export and large-texture benchmarks. Each test times its workload with performance.now()
 * (one warm-up run, then several samples, or a single run for workloads that take seconds) and writes a summary,
 * including sizes and retained heap, to bench/results/<name>.json.
 */

const RESULTS_DIRECTORY = 'bench/results';
const ENCODE_OPTIONS = { appVersion: 'bench', now: new Date(0) } as const;
const MB = 1024 * 1024;

// A forced garbage collection makes heap deltas show retained memory rather than collector timing.
setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;

const round = (value: number, digits = 1): number => Number(value.toFixed(digits));

interface MemoryInUse {
  readonly heap: number;
  readonly arrayBuffers: number;
}

function memoryInUse(): MemoryInUse {
  collectGarbage();
  const usage = process.memoryUsage();
  return { heap: usage.heapUsed, arrayBuffers: usage.arrayBuffers };
}

/**
 * Memory retained since `before`, after a garbage collection: V8 heap (objects) and array buffers (typed arrays such
 * as mesh positions and texture bytes, which live outside the heap).
 */
function retainedSince(before: MemoryInUse): { readonly heapMb: number; readonly arrayBuffersMb: number } {
  const after = memoryInUse();
  return {
    heapMb: round((after.heap - before.heap) / MB),
    arrayBuffersMb: round((after.arrayBuffers - before.arrayBuffers) / MB),
  };
}

interface Timing {
  readonly medianMs: number;
  readonly minMs: number;
  readonly samples: number;
}

/** Runs `run` once to warm up (unless `samples` is 1), then `samples` times, and returns the median and minimum. */
function time(samples: number, run: () => void): Timing {
  if (samples > 1) run();
  const durations: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    run();
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  return {
    medianMs: round(durations[Math.floor(durations.length / 2)] ?? Number.NaN),
    minMs: round(durations[0] ?? Number.NaN),
    samples,
  };
}

async function timeAsync<T>(run: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await run();
  return { ms: round(performance.now() - start), value };
}

function writeResult(name: string, summary: Record<string, unknown>): void {
  const result = { benchmark: name, ...summary };
  mkdirSync(RESULTS_DIRECTORY, { recursive: true });
  writeFileSync(`${RESULTS_DIRECTORY}/${name}.json`, `${JSON.stringify(result, null, 2)}\n`);
}

function decodeOrThrow(bytes: Uint8Array, repair = false): ModelDocument {
  const result = decodePlanarFile(bytes, {}, { repair });
  if (!result.ok) throw new Error(result.error);
  return result.value.doc;
}

// ------------------------------------------------------------------------------------------ meshes

/** Grid size of a height field with about `triangles` triangles (two per grid cell). */
const gridSize = (triangles: number): number => Math.ceil(Math.sqrt(triangles / 2));

/** Height of the field at grid point (i, j): smooth waves, so neighboring triangles are never coplanar. */
const heightAt = (i: number, j: number): number =>
  0.3 * Math.sin(i * 0.37) * Math.cos(j * 0.23) + 0.0007 * i * j;

/** A binary STL of an n × n height field with 10 cm cells: 2n² triangles. */
function heightFieldStl(n: number): Uint8Array {
  const triangles = 2 * n * n;
  const out = new Uint8Array(84 + triangles * 50);
  const view = new DataView(out.buffer);
  view.setUint32(80, triangles, true);
  let offset = 84;
  const corner = (i: number, j: number): void => {
    view.setFloat32(offset, i * 0.1, true);
    view.setFloat32(offset + 4, j * 0.1, true);
    view.setFloat32(offset + 8, heightAt(i, j), true);
    offset += 12;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      offset += 12; // normal left as zero; importers recompute it
      corner(i, j);
      corner(i + 1, j);
      corner(i + 1, j + 1);
      offset += 2;
      offset += 12;
      corner(i, j);
      corner(i + 1, j + 1);
      corner(i, j + 1);
      offset += 2;
    }
  }
  return out;
}

/** A GLB with one indexed mesh: the same n × n height field, with shared vertices and 32-bit indices. */
function heightFieldGlb(n: number): Uint8Array {
  const side = n + 1;
  const vertices = side * side;
  const triangles = 2 * n * n;
  const positions = new Float32Array(vertices * 3);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const v = (j * side + i) * 3;
      positions[v] = i * 0.1;
      positions[v + 1] = heightAt(i, j); // glTF is Y-up
      positions[v + 2] = -j * 0.1;
    }
  }
  const indices = new Uint32Array(triangles * 3);
  let k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side + 1;
      const d = a + side;
      indices.set([a, c, b, a, d, c], k);
      k += 6;
    }
  }
  const binary = new Uint8Array(positions.byteLength + indices.byteLength);
  binary.set(new Uint8Array(positions.buffer), 0);
  binary.set(new Uint8Array(indices.buffer), positions.byteLength);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Terrain', mesh: 0 }],
    meshes: [{ name: 'Terrain', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: vertices,
        type: 'VEC3',
        min: [0, -1, -n * 0.1],
        max: [n * 0.1, 1 + 0.0007 * n * n, 0],
      },
      { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength },
    ],
    buffers: [{ byteLength: binary.byteLength }],
  };
  return encodeGlb(json, binary);
}

interface ImportRun {
  readonly parseMs: number;
  readonly kernelMs: number;
  readonly trianglesIn: number;
  readonly facesOut: number;
  readonly degenerateTriangles: number;
  /** Memory still in use after the import, with the parsed scene and the model both alive. */
  readonly retained: ReturnType<typeof retainedSince>;
}

/** Parses the file, then inserts it into a new model the way the app's Import command does (merge coplanar on). */
async function importFile(name: string, bytes: Uint8Array, limits: ImportLimits): Promise<ImportRun> {
  const before = memoryInUse();
  const parsed = await timeAsync(() => parseImportFiles([{ name, bytes }], limits));
  const doc = new ModelDocument();
  const inserted = await timeAsync(() =>
    Promise.resolve(
      insertImportedScene(doc, doc.rootDefinitionId, parsed.value, {
        name: 'Import',
        unitMeters: 1,
        swapYUpToZUp: name.endsWith('.glb'),
        mergeCoplanar: true,
        as: 'group',
        limits,
      }),
    ),
  );
  const retained = retainedSince(before);
  return {
    parseMs: parsed.ms,
    kernelMs: inserted.ms,
    trianglesIn: inserted.value.triangles,
    facesOut: inserted.value.faces,
    degenerateTriangles: inserted.value.degenerateTriangles,
    retained,
  };
}

// ------------------------------------------------------------------------------------------ tests

describe('save and load', () => {
  for (const entities of [10_000, 100_000]) {
    test(`encode and decode a ${String(entities)}-entity model`, () => {
      const grid = boxGrid(entities);
      const bytes = encodePlanarFile(grid.doc, ENCODE_OPTIONS);
      const samples = entities >= 100_000 ? 5 : 10;
      const encode = time(samples, () => {
        encodePlanarFile(grid.doc, ENCODE_OPTIONS);
      });
      const decode = time(samples, () => {
        decodeOrThrow(bytes);
      });
      const decodeWithRepair = time(samples, () => {
        decodeOrThrow(bytes, true);
      });
      const before = memoryInUse();
      const decoded = decodeOrThrow(bytes);
      const retained = retainedSince(before);
      expect(decoded.rootStore.faceCount).toBe(grid.doc.rootStore.faceCount);
      writeResult(`save-load-${String(entities)}`, {
        entities: grid.entities,
        boxes: grid.boxes,
        fileBytes: bytes.byteLength,
        encode,
        decode,
        decodeWithRepair,
        decodedModel: retained,
      });
    });
  }
});

describe('large textures', () => {
  const TEXTURE_SIZE = 8192;
  const PAYLOAD_BYTES = 24 * MB;

  test(`add an ${String(TEXTURE_SIZE)} × ${String(TEXTURE_SIZE)} texture and save and load a model with it`, () => {
    const image = largePngPlaceholder(TEXTURE_SIZE, PAYLOAD_BYTES);
    const addAsset = time(10, () => {
      const doc = new ModelDocument();
      doc.transact('Add texture', () => addTextureAsset(doc, 'texture.png', image));
    });
    // 10k entities with every face painted. Each sample builds a fresh model: texture digests are cached per byte
    // array, and a real save or load never has the digest of freshly read bytes.
    const texturedModel = (): ModelDocument => {
      const { doc } = boxGrid(10_000);
      paintAllFaces(doc, image);
      return doc;
    };
    const paint = time(3, () => {
      texturedModel();
    });
    const models = Array.from({ length: 4 }, texturedModel);
    let next = 0;
    const encode = time(3, () => {
      encodePlanarFile(models[next++] ?? texturedModel(), ENCODE_OPTIONS);
    });
    const bytes = encodePlanarFile(texturedModel(), ENCODE_OPTIONS);
    const decode = time(3, () => {
      decodeOrThrow(bytes);
    });
    const decodeWithRepair = time(3, () => {
      decodeOrThrow(bytes, true);
    });
    const before = memoryInUse();
    const decoded = decodeOrThrow(bytes);
    const retained = retainedSince(before);
    expect([...decoded.assets()]).toHaveLength(1);
    writeResult(`texture-8192`, {
      textureSize: `${String(TEXTURE_SIZE)}x${String(TEXTURE_SIZE)}`,
      textureBytes: image.byteLength,
      note: 'PNG signature and IHDR followed by incompressible placeholder data; the kernel only reads the header',
      entities: 10_010,
      addTextureAsset: addAsset,
      buildAndPaint10kModel: paint,
      fileBytes: bytes.byteLength,
      encode,
      decode,
      decodeWithRepair,
      decodedModel: retained,
    });
  });
});

describe('import large meshes', () => {
  for (const triangles of [100_000, DEFAULT_IMPORT_LIMITS.maxTriangles]) {
    test(`import a binary STL with about ${String(triangles)} triangles`, async () => {
      const n = gridSize(triangles) - (triangles === DEFAULT_IMPORT_LIMITS.maxTriangles ? 1 : 0);
      const bytes = heightFieldStl(n);
      await importFile('warmup.stl', heightFieldStl(40), DEFAULT_IMPORT_LIMITS);
      const run = await importFile('terrain.stl', bytes, DEFAULT_IMPORT_LIMITS);
      writeResult(`import-stl-${String(triangles)}`, { format: 'stl', fileBytes: bytes.byteLength, ...run });
    });
  }

  test('import a binary STL with 1 million triangles', async () => {
    const bytes = heightFieldStl(gridSize(1_000_000));
    const trianglesIn = new DataView(bytes.buffer).getUint32(80, true);
    const refused = await timeAsync(() =>
      parseImportFiles([{ name: 'terrain.stl', bytes }], DEFAULT_IMPORT_LIMITS).then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
    );
    expect(refused.value).toContain('more than the import limit');
    // Parsing only, with the limit raised. Inserting a million triangles into the kernel exhausts the worker's
    // default V8 heap (the 250k import alone retains about 700 MB), which is what the limit protects against.
    const raised: ImportLimits = { ...DEFAULT_IMPORT_LIMITS, maxTriangles: 2_000_000 };
    const before = memoryInUse();
    const parsed = await timeAsync(() => parseImportFiles([{ name: 'terrain.stl', bytes }], raised));
    const retained = retainedSince(before);
    expect(parsed.value.meshes).toHaveLength(1);
    writeResult('import-stl-1000000', {
      format: 'stl',
      fileBytes: bytes.byteLength,
      trianglesInFile: trianglesIn,
      defaultLimit: DEFAULT_IMPORT_LIMITS.maxTriangles,
      refusedWithDefaultLimitMs: refused.ms,
      refusalMessage: refused.value,
      parseWithRaisedLimit: {
        maxTriangles: raised.maxTriangles,
        parseMs: parsed.ms,
        parsedScene: retained,
        kernel: 'not run: the insertion exhausts the default V8 heap',
      },
    });
  });

  test('import a GLB with one mesh at the triangle limit', async () => {
    const bytes = heightFieldGlb(gridSize(DEFAULT_IMPORT_LIMITS.maxTriangles) - 1);
    await importFile('warmup.glb', heightFieldGlb(40), DEFAULT_IMPORT_LIMITS);
    const run = await importFile('terrain.glb', bytes, DEFAULT_IMPORT_LIMITS);
    writeResult('import-glb-250000', { format: 'glb', fileBytes: bytes.byteLength, ...run });
  });
});

describe('export', () => {
  test('export a 100k-entity model as STL, OBJ, GLB and glTF', () => {
    const grid = boxGrid(100_000);
    const source: ExportSource = {
      doc: grid.doc,
      context: grid.doc.rootDefinitionId,
      contextTransform: IDENTITY,
      name: 'Boxes',
    };
    const formats: Record<string, unknown> = {};
    for (const format of ['stl', 'obj', 'glb', 'gltf'] satisfies ExportFormatId[]) {
      let bytes = 0;
      const timing = time(5, () => {
        const files = exportModel(source, { format, fileName: 'boxes', unit: 'm', swapZUpToYUp: true });
        bytes = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
      });
      expect(bytes).toBeGreaterThan(0);
      formats[format] = { ...timing, bytes };
    }
    writeResult('export-100000', {
      entities: grid.entities,
      boxes: grid.boxes,
      faces: grid.doc.rootStore.faceCount,
      triangles: grid.doc.rootStore.faceCount * 2,
      formats,
    });
  });
});
