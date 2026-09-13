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

import { readFileSync } from 'node:fs';
import type { DefinitionId } from '../../src/kernel/ids';
import { IDENTITY, multiply, transformPoint, type Mat4 } from '../../src/kernel/math/mat4';
import { vec3, type Vec3 } from '../../src/kernel/math/vec3';
import { ModelDocument } from '../../src/kernel/model/ModelDocument';
import type { InputFile } from '../../src/io/import/fileSet';
import { encodeGlb } from '../../src/io/mesh/glb';
import type { ImportedScene } from '../../src/io/mesh/importedScene';
import {
  insertImportedScene,
  type SceneImportOptions,
  type SceneImportSummary,
} from '../../src/io/mesh/sceneToKernel';

export function fixture(name: string): InputFile {
  return {
    name,
    bytes: new Uint8Array(readFileSync(new URL(`../fixtures/import/${name}`, import.meta.url))),
  };
}

export const IMPORT_OPTIONS: SceneImportOptions = {
  name: 'Import',
  unitMeters: 1,
  swapYUpToZUp: false,
  mergeCoplanar: true,
  as: 'group',
};

export function importInto(
  scene: ImportedScene,
  overrides: Partial<SceneImportOptions> = {},
  doc: ModelDocument = new ModelDocument({ validateOnCommit: true }),
): { doc: ModelDocument; summary: SceneImportSummary } {
  const summary = insertImportedScene(doc, doc.rootDefinitionId, scene, { ...IMPORT_OPTIONS, ...overrides });
  return { doc, summary };
}

/** Faces drawn under a definition, counting each instance's contents again. */
export function facesUnder(doc: ModelDocument, definition: DefinitionId): number {
  const store = doc.store(definition);
  let count = store.faceCount;
  for (const instance of store.instances()) count += facesUnder(doc, instance.definitionId);
  return count;
}

/** World-space bounds of every vertex in the model. */
export function worldBounds(doc: ModelDocument): { min: Vec3; max: Vec3 } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visit = (definition: DefinitionId, transform: Mat4): void => {
    const store = doc.store(definition);
    for (const vertex of store.vertices()) {
      const p = transformPoint(transform, vertex.position);
      [p.x, p.y, p.z].forEach((value, axis) => {
        min[axis] = Math.min(min[axis] ?? value, value);
        max[axis] = Math.max(max[axis] ?? value, value);
      });
    }
    for (const instance of store.instances())
      visit(instance.definitionId, multiply(transform, instance.transform));
  };
  visit(doc.rootDefinitionId, IDENTITY);
  return {
    min: vec3(min[0] ?? 0, min[1] ?? 0, min[2] ?? 0),
    max: vec3(max[0] ?? 0, max[1] ?? 0, max[2] ?? 0),
  };
}

/** Definitions other than the root that contain faces. */
export function definitionsWithFaces(doc: ModelDocument) {
  return [...doc.definitions()].filter(
    (definition) => definition.id !== doc.rootDefinitionId && definition.store.faceCount > 0,
  );
}

const CUBE_VERTICES = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
] as const;

/** Outward quads of the unit cube (1-based, as in tests/fixtures/import/cube.obj). */
const CUBE_QUADS = [
  [1, 4, 3, 2],
  [5, 6, 7, 8],
  [1, 2, 6, 5],
  [1, 5, 8, 4],
  [2, 3, 7, 6],
  [4, 8, 7, 3],
] as const;

/** The twelve outward triangles of a cube with edge `size`, nine coordinates each. */
export function cubeTriangles(size = 1): number[][] {
  const corner = (index: number): number[] =>
    (CUBE_VERTICES[index - 1] ?? [0, 0, 0]).map((value) => value * size);
  return CUBE_QUADS.flatMap(([a, b, c, d]) => [
    [...corner(a), ...corner(b), ...corner(c)],
    [...corner(a), ...corner(c), ...corner(d)],
  ]);
}

export function binaryStl(triangles: readonly (readonly number[])[]): Uint8Array {
  const out = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(out.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, index) => {
    for (let k = 0; k < 9; k++) view.setFloat32(84 + index * 50 + 12 + k * 4, triangle[k] ?? 0, true);
  });
  return out;
}

/** A GLB whose one mesh (a unit square facing +Z) is drawn by two nodes under a parent node. */
export function sharedMeshGlb(): Uint8Array {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const binary = new Uint8Array(60);
  binary.set(new Uint8Array(positions.buffer), 0);
  binary.set(new Uint8Array(indices.buffer), 48);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Pair', children: [1, 2] },
      { name: 'Left', mesh: 0 },
      { name: 'Right', mesh: 0, translation: [2, 0, 0] },
    ],
    meshes: [{ name: 'Tile', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: 'Clay', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.4, 0.2, 1] } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48 },
      { buffer: 0, byteOffset: 48, byteLength: 12 },
    ],
    buffers: [{ byteLength: 60 }],
  };
  return encodeGlb(json, binary);
}

// ------------------------------------------------------------------------------------------------ 3DS

function chunk(id: number, ...parts: Uint8Array[]): Uint8Array {
  const length = 6 + parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  view.setUint16(0, id, true);
  view.setUint32(2, length, true);
  let offset = 6;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

const words = (...values: number[]): Uint8Array => new Uint8Array(new Uint16Array(values).buffer);
const floats = (...values: number[]): Uint8Array => new Uint8Array(new Float32Array(values).buffer);
const text = (value: string): Uint8Array => new TextEncoder().encode(`${value}\0`);

/** A 3DS file with one green, textured 10 × 10 square made of two triangles. */
export function squareTds(): Uint8Array {
  const material = chunk(
    0xafff,
    chunk(0xa000, text('Green')),
    chunk(0xa020, chunk(0x0011, new Uint8Array([0, 255, 0]))),
    chunk(0xa200, chunk(0xa300, text('wood.jpg'))),
  );
  const mesh = chunk(
    0x4000,
    text('Plate'),
    chunk(
      0x4100,
      chunk(0x4110, words(4), floats(0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0)),
      chunk(
        0x4120,
        words(2),
        words(0, 1, 2, 0, 0, 2, 3, 0),
        chunk(0x4130, text('Green'), words(2), words(0, 1)),
      ),
    ),
  );
  const version = new Uint8Array(new Uint32Array([3]).buffer);
  return chunk(0x4d4d, chunk(0x0002, version), chunk(0x3d3d, material, mesh));
}
