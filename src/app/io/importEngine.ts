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

import type { InputFile } from '../../io/import/fileSet';
import type { ImportedScene } from '../../io/mesh/importedScene';
import { ImportError, type ImportLimits } from '../../io/mesh/limits';
import {
  fileTransferables,
  type ImportParseRequest,
  type ImportParseResponse,
} from '../../workers/ioProtocol';

/** Parses picked files into an ImportedScene, wherever the work actually happens. */
export interface ImportEngine {
  parse(files: readonly InputFile[], limits: ImportLimits): Promise<ImportedScene>;
  /** Abandons every pending parse; their promises reject with {@link ImportCancelledError}. */
  cancel(): void;
  dispose?(): void;
}

export type ImportParser = (files: readonly InputFile[], limits: ImportLimits) => Promise<ImportedScene>;

export class ImportCancelledError extends Error {
  override readonly name = 'ImportCancelledError';

  constructor() {
    super('The import was cancelled');
  }
}

/** An engine that parses on the calling thread. Used by tests, which run the parsers in Node. */
export function createDirectImportEngine(parse: ImportParser): ImportEngine {
  let generation = 0;
  return {
    async parse(files, limits) {
      const started = generation;
      const scene = await parse(files, limits);
      if (started !== generation) throw new ImportCancelledError();
      return scene;
    },
    cancel() {
      generation++;
    },
  };
}

interface Pending {
  readonly resolve: (scene: ImportedScene) => void;
  readonly reject: (error: Error) => void;
}

/** Parses in `io.worker`, started on first use. Cancelling stops the worker, which is started again when needed. */
export class WorkerImportEngine implements ImportEngine {
  #worker: Worker | null = null;
  #nextId = 1;
  readonly #pending = new Map<number, Pending>();

  parse(files: readonly InputFile[], limits: ImportLimits): Promise<ImportedScene> {
    const worker = this.#ensureWorker();
    const id = this.#nextId++;
    const copies = files.map((file) => ({ name: file.name, bytes: file.bytes.slice() }));
    const request: ImportParseRequest = { id, files: copies, limits };
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      worker.postMessage(request, fileTransferables(copies));
    });
  }

  cancel(): void {
    this.#stop(new ImportCancelledError());
  }

  dispose(): void {
    this.#stop(new Error('The import engine was stopped'));
  }

  #stop(error: Error): void {
    this.#worker?.terminate();
    this.#worker = null;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;
    const worker = new Worker(new URL('../../workers/io.worker.ts', import.meta.url), {
      type: 'module',
      name: 'planar-io',
    });
    worker.onmessage = (event: MessageEvent<ImportParseResponse>) => {
      const response = event.data;
      const pending = this.#pending.get(response.id);
      if (!pending) return;
      this.#pending.delete(response.id);
      if (response.ok) pending.resolve(response.scene);
      else pending.reject(new ImportError(response.error));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (this.#worker === worker) this.#stop(new ImportError(`the import worker failed: ${event.message}`));
    };
    this.#worker = worker;
    return worker;
  }
}
