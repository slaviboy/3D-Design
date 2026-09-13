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

import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { TriangleMesh } from '../kernel/ops/solids/mesh';
import type { BooleanOperation } from './booleanProtocol';

/**
 * Runs a boolean operation with manifold-3d. Works anywhere the WebAssembly module is loaded (the boolean worker, or
 * Node in tests).
 *
 * manifold-3d stores positions in single precision, so the meshes are moved next to the origin first, which keeps
 * the rounding far below the kernel's length tolerance for models of ordinary size. Each input triangle's face key
 * is passed as its face id; manifold-3d carries it through to the result triangles, so the caller can restore planes
 * and materials.
 */
export function runBoolean(
  wasm: ManifoldToplevel,
  operation: BooleanOperation,
  meshes: readonly TriangleMesh[],
): TriangleMesh[] {
  if (meshes.length === 0) return [];
  const center = centerOf(meshes);
  const owned: Manifold[] = [];
  try {
    const solids = meshes.map((mesh, index) => {
      const solid = toManifold(wasm, mesh, center, index);
      owned.push(solid);
      return solid;
    });
    const [first, second] = solids;
    if (!first) return [];
    let results: Manifold[];
    switch (operation) {
      case 'union':
        results = [solids.length === 1 ? first : wasm.Manifold.union(solids)];
        break;
      case 'intersection':
        results = [solids.length === 1 ? first : wasm.Manifold.intersection(solids)];
        break;
      case 'difference':
        results = [solids.length === 1 ? first : wasm.Manifold.difference(solids)];
        break;
      case 'split':
        if (!second) throw new Error('Split needs exactly two solids');
        results = [first.intersect(second), first.subtract(second), second.subtract(first)];
        break;
    }
    owned.push(...results);
    return results.map((result) => fromManifold(result, center));
  } finally {
    for (const solid of new Set(owned)) solid.delete();
  }
}

function centerOf(meshes: readonly TriangleMesh[]): [number, number, number] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    for (let i = 0; i + 2 < mesh.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = mesh.positions[i + axis] ?? 0;
        min[axis] = Math.min(min[axis] ?? value, value);
        max[axis] = Math.max(max[axis] ?? value, value);
      }
    }
  }
  const mid = (axis: number): number => {
    const low = min[axis] ?? 0;
    const high = max[axis] ?? 0;
    return Number.isFinite(low) && Number.isFinite(high) ? (low + high) / 2 : 0;
  };
  return [mid(0), mid(1), mid(2)];
}

function toManifold(
  wasm: ManifoldToplevel,
  mesh: TriangleMesh,
  center: readonly [number, number, number],
  index: number,
): Manifold {
  const vertProperties = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i++) {
    vertProperties[i] = (mesh.positions[i] ?? 0) - (center[i % 3] ?? 0);
  }
  const input = new wasm.Mesh({
    numProp: 3,
    vertProperties,
    triVerts: Uint32Array.from(mesh.indices),
    faceID: Uint32Array.from(mesh.faceIds),
  });
  input.merge();
  let solid: Manifold;
  try {
    solid = new wasm.Manifold(input);
  } catch (error) {
    throw new Error(`Solid ${String(index + 1)} is not a closed, consistently oriented mesh`, {
      cause: error,
    });
  }
  const status = solid.status();
  if (status !== 'NoError') {
    solid.delete();
    throw new Error(`Solid ${String(index + 1)} could not be used for a boolean operation (${status})`);
  }
  return solid;
}

function fromManifold(solid: Manifold, center: readonly [number, number, number]): TriangleMesh {
  const mesh = solid.getMesh();
  const numProp = mesh.numProp;
  const vertexCount = Math.floor(mesh.vertProperties.length / numProp);
  const positions = new Float64Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    for (let axis = 0; axis < 3; axis++) {
      positions[v * 3 + axis] = (mesh.vertProperties[v * numProp + axis] ?? 0) + (center[axis] ?? 0);
    }
  }
  const triangleCount = Math.floor(mesh.triVerts.length / 3);
  const faceIds =
    mesh.faceID.length === triangleCount ? Uint32Array.from(mesh.faceID) : new Uint32Array(triangleCount);
  return { positions, indices: Uint32Array.from(mesh.triVerts), faceIds };
}
