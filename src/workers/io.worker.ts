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
