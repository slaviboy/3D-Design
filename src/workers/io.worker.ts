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

import { parseImportFiles } from '../io/import/parseImport';
import { sceneTransferables } from '../io/mesh/importedScene';
import type { ImportParseRequest, ImportParseResponse } from './ioProtocol';

/*
 * io worker: parses imported model files with three's loaders (and Planar's COLLADA reader) off the main thread,
 * and posts back plain triangle arrays. It never makes a request: referenced files come only from the request.
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<ImportParseRequest>) => void) | null;
  postMessage(message: ImportParseResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

async function handle(request: ImportParseRequest): Promise<void> {
  try {
    const scene = await parseImportFiles(request.files, request.limits);
    scope.postMessage({ id: request.id, ok: true, scene }, sceneTransferables(scene));
  } catch (error) {
    scope.postMessage(
      { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) },
      [],
    );
  }
}

scope.onmessage = (event) => {
  void handle(event.data);
};
