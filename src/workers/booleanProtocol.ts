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

import type { TriangleMesh } from '../kernel/ops/solids/mesh';

/**
 * - `union`: everything inside any mesh
 * - `difference`: inside the first mesh and outside every other
 * - `intersection`: inside every mesh
 * - `split`: of two meshes, three results: their intersection, first minus second, second minus first
 */
export type BooleanOperation = 'union' | 'difference' | 'intersection' | 'split';

export interface BooleanRequest {
  readonly id: number;
  readonly operation: BooleanOperation;
  readonly meshes: readonly TriangleMesh[];
}

export type BooleanResponse =
  | { readonly id: number; readonly ok: true; readonly results: readonly TriangleMesh[] }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** The buffers of the meshes, to transfer rather than copy them between threads. */
export function meshTransferables(meshes: readonly TriangleMesh[]): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const mesh of meshes) {
    for (const array of [mesh.positions, mesh.indices, mesh.faceIds]) {
      if (array.buffer instanceof ArrayBuffer) buffers.add(array.buffer);
    }
  }
  return [...buffers];
}
