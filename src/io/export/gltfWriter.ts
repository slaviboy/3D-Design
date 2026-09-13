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

import { isIdentity } from '../mesh/axes';
import { bytesToBase64, encodeGlb } from '../mesh/glb';
import type { ExportScene } from './exportScene';

/*
 * glTF 2.0 writer. Each ExportMesh becomes one glTF mesh (one primitive per material), nodes reference meshes, so a
 * component drawn several times is stored once. The scene must already be in meters and Y-up (glTF's convention).
 * `.glb` puts the buffer in the binary chunk; `.gltf` embeds it as a base64 data URI, so the export is one file.
 */

const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const TRIANGLES = 4;

type Json = Record<string, unknown>;

export interface GltfWriteOptions {
  readonly binary: boolean;
  readonly generator: string;
}

class BufferBuilder {
  readonly #parts: Uint8Array[] = [];
  #length = 0;
  readonly views: Json[] = [];

  add(bytes: Uint8Array, target: number): number {
    const padding = (4 - (this.#length % 4)) % 4;
    if (padding > 0) {
      this.#parts.push(new Uint8Array(padding));
      this.#length += padding;
    }
    this.views.push({ buffer: 0, byteOffset: this.#length, byteLength: bytes.byteLength, target });
    this.#parts.push(bytes);
    this.#length += bytes.byteLength;
    return this.views.length - 1;
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.#length / 4) * 4);
    let offset = 0;
    for (const part of this.#parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }
}

export function writeGltf(scene: ExportScene, options: GltfWriteOptions): Uint8Array {
  const buffer = new BufferBuilder();
  const accessors: Json[] = [];
  const materials: Json[] = scene.materials.map((material) => ({
    name: material.name,
    pbrMetallicRoughness: {
      baseColorFactor: [material.color.r, material.color.g, material.color.b, material.opacity],
      metallicFactor: 0,
      roughnessFactor: 1,
    },
    ...(material.opacity < 1 ? { alphaMode: 'BLEND' } : {}),
    doubleSided: true,
  }));
  let defaultMaterial: number | null = null;
  const materialFor = (index: number): number => {
    if (index >= 0) return index;
    defaultMaterial ??=
      materials.push({
        name: 'Default',
        pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: 1 },
        doubleSided: true,
      }) - 1;
    return defaultMaterial;
  };

  const meshes = scene.meshes.map((mesh) => {
    const count = mesh.positions.length / 3;
    const positions = Float32Array.from(mesh.positions);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) {
        const value = positions[i * 3 + k] ?? 0;
        min[k] = Math.min(min[k] ?? value, value);
        max[k] = Math.max(max[k] ?? value, value);
      }
    }
    const positionAccessor =
      accessors.push({
        bufferView: buffer.add(new Uint8Array(positions.buffer), ARRAY_BUFFER),
        componentType: FLOAT,
        count,
        type: 'VEC3',
        min,
        max,
      }) - 1;
    const normalAccessor =
      accessors.push({
        bufferView: buffer.add(new Uint8Array(Float32Array.from(mesh.normals).buffer), ARRAY_BUFFER),
        componentType: FLOAT,
        count,
        type: 'VEC3',
      }) - 1;
    return {
      name: mesh.name,
      primitives: mesh.primitives.map((primitive) => ({
        attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
        indices:
          accessors.push({
            bufferView: buffer.add(new Uint8Array(primitive.indices.slice().buffer), ELEMENT_ARRAY_BUFFER),
            componentType: UNSIGNED_INT,
            count: primitive.indices.length,
            type: 'SCALAR',
          }) - 1,
        material: materialFor(primitive.material),
        mode: TRIANGLES,
      })),
    };
  });

  const nodes = scene.nodes.map((node) => ({
    name: node.name,
    ...(node.mesh === null ? {} : { mesh: node.mesh }),
    ...(node.children.length > 0 ? { children: node.children } : {}),
    ...(isIdentity(node.transform) ? {} : { matrix: [...node.transform] }),
  }));

  const binary = buffer.bytes();
  const json: Json = {
    asset: { version: '2.0', generator: options.generator },
    scene: 0,
    scenes: [{ nodes: scene.roots }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews: buffer.views,
    buffers: [
      options.binary
        ? { byteLength: binary.byteLength }
        : {
            byteLength: binary.byteLength,
            uri: `data:application/octet-stream;base64,${bytesToBase64(binary)}`,
          },
    ],
  };
  return options.binary ? encodeGlb(json, binary) : new TextEncoder().encode(JSON.stringify(json));
}
