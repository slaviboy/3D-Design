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

import type { Rgb } from '../../kernel/model/types';
import { ImportError, type ImportLimits } from './limits';

/*
 * The plain data an importer produces: triangle meshes, materials and a node tree. It holds only numbers, strings and
 * typed arrays, so it can be posted from the io worker to the main thread, and it is validated again on arrival.
 */

export interface ImportedMaterial {
  readonly name: string;
  /** Linear RGB. */
  readonly color: Rgb;
  /** 0 = fully transparent, 1 = opaque. */
  readonly opacity: number;
  /** File name of the material's color texture, if it has one. */
  readonly textureName: string | null;
  /** The color texture, when its image was found among the picked files (or embedded) and is a usable PNG or JPEG. */
  readonly texture?: ImportedMaterialTexture;
}

/** A material's reference to one of {@link ImportedScene.textures}. */
export interface ImportedMaterialTexture {
  /** Index into {@link ImportedScene.textures}. */
  readonly image: number;
  /**
   * Maps mesh UVs to image UVs with the origin at the bottom-left of the image, as the 2×3 affine
   * [a, b, c, d, e, f]: u' = a·u + c·v + e, v' = b·u + d·v + f. Covers flipped V axes (glTF) and texture
   * transforms declared by the file (MTL -o/-s, 3DS map offset and scale, KHR_texture_transform).
   */
  readonly uvTransform: readonly number[];
}

/** An encoded PNG or JPEG image, deduplicated by content. */
export interface ImportedTexture {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export const IDENTITY_UV_TRANSFORM: readonly number[] = Object.freeze([1, 0, 0, 1, 0, 0]);

export interface ImportedMesh {
  readonly name: string;
  /** x, y, z per vertex, in file units and file axes. */
  readonly positions: Float64Array;
  /** Three vertex indices per triangle. */
  readonly indices: Uint32Array;
  /** Per triangle, an index into {@link ImportedScene.materials}, or -1 for no material. */
  readonly materials: Int32Array;
  /** u, v per vertex, as stored in the file; NaN where a vertex has no texture coordinates. */
  readonly uvs?: Float64Array;
}

export interface ImportedNode {
  readonly name: string;
  /** Local transform relative to the parent node, column-major 4×4. */
  readonly transform: readonly number[];
  /** Meshes drawn by this node. A mesh used by more than one node becomes a component. */
  readonly meshes: readonly number[];
  readonly children: readonly number[];
}

export interface ImportedScene {
  readonly materials: readonly ImportedMaterial[];
  readonly meshes: readonly ImportedMesh[];
  readonly nodes: readonly ImportedNode[];
  readonly roots: readonly number[];
  /** Images referenced by materials. */
  readonly textures?: readonly ImportedTexture[];
  /** Things the user should know about: skipped external references, ignored entities, … */
  readonly warnings: readonly string[];
  /** Meters per file unit, when the file declares its unit (COLLADA). */
  readonly unitMeters: number | null;
  /** The up axis the file declares (COLLADA), or null when the format doesn't say. */
  readonly upAxis: 'y' | 'z' | null;
}

export const IDENTITY_TRANSFORM: readonly number[] = Object.freeze([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

/** The buffers of a scene's meshes, to transfer rather than copy them between threads. */
export function sceneTransferables(scene: ImportedScene): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const mesh of scene.meshes) {
    for (const array of [mesh.positions, mesh.indices, mesh.materials, mesh.uvs]) {
      if (array?.buffer instanceof ArrayBuffer) buffers.add(array.buffer);
    }
  }
  for (const texture of scene.textures ?? []) {
    if (texture.bytes.buffer instanceof ArrayBuffer) buffers.add(texture.bytes.buffer);
  }
  return [...buffers];
}

export function triangleCount(scene: ImportedScene): number {
  let total = 0;
  for (const mesh of scene.meshes) total += Math.floor(mesh.indices.length / 3);
  return total;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function fail(message: string): never {
  throw new ImportError(message);
}

/**
 * Checks everything the converter relies on: typed arrays of the right kind and length, finite numbers, indices in
 * range, a node tree without cycles or shared children, and the triangle limit. Throws an {@link ImportError}.
 */
export function validateImportedScene(
  scene: ImportedScene,
  limits: Pick<ImportLimits, 'maxTriangles'>,
): void {
  const lists: unknown[] = [scene.materials, scene.meshes, scene.nodes, scene.roots, scene.textures ?? []];
  if (!lists.every((list) => Array.isArray(list))) {
    fail('the file could not be read');
  }
  const textures = scene.textures ?? [];
  for (const texture of textures) {
    if (typeof texture.name !== 'string' || !(texture.bytes instanceof Uint8Array)) {
      fail('a texture has invalid data');
    }
  }
  scene.materials.forEach((material) => {
    const { texture } = material;
    if (
      texture !== undefined &&
      (!Number.isInteger(texture.image) ||
        texture.image < 0 ||
        texture.image >= textures.length ||
        !Array.isArray(texture.uvTransform) ||
        texture.uvTransform.length !== 6 ||
        !texture.uvTransform.every(isFiniteNumber))
    ) {
      fail('a material refers to a texture that does not exist');
    }
    const { color } = material;
    if (
      typeof material.name !== 'string' ||
      !isFiniteNumber(color.r) ||
      !isFiniteNumber(color.g) ||
      !isFiniteNumber(color.b) ||
      !isFiniteNumber(material.opacity)
    ) {
      fail('a material has an invalid color or opacity');
    }
  });
  const total = triangleCount(scene);
  if (total > limits.maxTriangles) {
    fail(
      `the model has ${total.toLocaleString('en-US')} triangles, more than the import limit of ${limits.maxTriangles.toLocaleString('en-US')}`,
    );
  }
  scene.meshes.forEach((mesh) => {
    if (
      !(mesh.positions instanceof Float64Array) ||
      !(mesh.indices instanceof Uint32Array) ||
      !(mesh.materials instanceof Int32Array)
    ) {
      fail('a mesh has invalid data');
    }
    if (mesh.positions.length % 3 !== 0 || mesh.indices.length % 3 !== 0) fail('a mesh has invalid data');
    if (mesh.materials.length !== mesh.indices.length / 3) fail('a mesh has invalid material data');
    if (
      mesh.uvs !== undefined &&
      (!(mesh.uvs instanceof Float64Array) || mesh.uvs.length !== (mesh.positions.length / 3) * 2)
    ) {
      fail('a mesh has invalid texture coordinates');
    }
    for (const value of mesh.positions) {
      if (!Number.isFinite(value))
        fail('a mesh has coordinates that are not finite numbers (NaN or Infinity)');
    }
    const vertexCount = mesh.positions.length / 3;
    for (const index of mesh.indices) {
      if (index >= vertexCount) fail('a mesh refers to a vertex that does not exist');
    }
    for (const material of mesh.materials) {
      if (material < -1 || material >= scene.materials.length)
        fail('a mesh refers to a material that does not exist');
    }
  });
  const parents = new Int32Array(scene.nodes.length).fill(-1);
  scene.nodes.forEach((node, index) => {
    if (node.transform.length !== 16 || !node.transform.every(isFiniteNumber)) {
      fail('a node has a transform that is not finite');
    }
    for (const mesh of node.meshes) {
      if (!Number.isInteger(mesh) || mesh < 0 || mesh >= scene.meshes.length)
        fail('a node refers to a missing mesh');
    }
    for (const child of node.children) {
      if (!Number.isInteger(child) || child < 0 || child >= scene.nodes.length)
        fail('a node refers to a missing child');
      if (child === index || parents[child] !== -1) fail('the node hierarchy is not a tree');
      parents[child] = index;
    }
  });
  for (const root of scene.roots) {
    if (!Number.isInteger(root) || root < 0 || root >= scene.nodes.length)
      fail('the scene refers to a missing node');
    if (parents[root] !== -1) fail('the node hierarchy is not a tree');
  }
  // With at most one parent each, a cycle is a chain that never reaches a node without a parent.
  scene.nodes.forEach((_, start) => {
    let current = start;
    for (let steps = 0; parents[current] !== -1; steps++) {
      if (steps > scene.nodes.length) fail('the node hierarchy contains a cycle');
      current = parents[current] ?? -1;
    }
  });
}
