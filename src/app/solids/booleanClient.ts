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

import type { TriangleMesh } from '../../kernel/ops/solids/mesh';
import {
  meshTransferables,
  type BooleanOperation,
  type BooleanRequest,
  type BooleanResponse,
} from '../../workers/booleanProtocol';

/** Runs boolean operations on triangle meshes, wherever the work actually happens. */
export interface BooleanEngine {
  run(operation: BooleanOperation, meshes: readonly TriangleMesh[]): Promise<TriangleMesh[]>;
  dispose?(): void;
}

export type BooleanFunction = (
  operation: BooleanOperation,
  meshes: readonly TriangleMesh[],
) => TriangleMesh[];

/** An engine that runs a boolean function on the calling thread. Used by tests, which call manifold-3d in Node. */
export function createDirectBooleanEngine(run: BooleanFunction): BooleanEngine {
  return {
    run: (operation, meshes) =>
      new Promise((resolve) => {
        resolve(run(operation, meshes));
      }),
  };
}

function copyMesh(mesh: TriangleMesh): TriangleMesh {
  return { positions: mesh.positions.slice(), indices: mesh.indices.slice(), faceIds: mesh.faceIds.slice() };
}

interface Pending {
  readonly resolve: (meshes: TriangleMesh[]) => void;
  readonly reject: (error: Error) => void;
}

/** Runs booleans in `boolean.worker`, started on first use. Meshes travel as transferred typed arrays. */
export class WorkerBooleanEngine implements BooleanEngine {
  #worker: Worker | null = null;
  #nextId = 1;
  readonly #pending = new Map<number, Pending>();

  run(operation: BooleanOperation, meshes: readonly TriangleMesh[]): Promise<TriangleMesh[]> {
    const worker = this.#ensureWorker();
    const id = this.#nextId++;
    const request: BooleanRequest = { id, operation, meshes: meshes.map(copyMesh) };
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      worker.postMessage(request, meshTransferables(request.meshes));
    });
  }

  dispose(): void {
    this.#worker?.terminate();
    this.#worker = null;
    this.#failAll(new Error('The boolean engine was stopped'));
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;
    const worker = new Worker(new URL('../../workers/boolean.worker.ts', import.meta.url), {
      type: 'module',
      name: 'planar-booleans',
    });
    worker.onmessage = (event: MessageEvent<BooleanResponse>) => {
      const response = event.data;
      const pending = this.#pending.get(response.id);
      if (!pending) return;
      this.#pending.delete(response.id);
      if (response.ok) pending.resolve([...response.results]);
      else pending.reject(new Error(response.error));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      if (this.#worker === worker) this.#worker = null;
      this.#failAll(new Error(`The boolean engine failed to start: ${event.message}`));
    };
    this.#worker = worker;
    return worker;
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}
