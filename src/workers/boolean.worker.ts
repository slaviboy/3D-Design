import Module, { type ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { meshTransferables, type BooleanRequest, type BooleanResponse } from './booleanProtocol';
import { runBoolean } from './manifoldBoolean';

/*
 * Boolean worker: loads the bundled manifold-3d WebAssembly module on the first request and answers boolean
 * requests. The .wasm file is a local build asset (precached by the service worker), so nothing is fetched from
 * another origin.
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<BooleanRequest>) => void) | null;
  postMessage(message: BooleanResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
let loading: Promise<ManifoldToplevel> | null = null;

function manifold(): Promise<ManifoldToplevel> {
  loading ??= Module({ locateFile: () => wasmUrl }).then((wasm) => {
    wasm.setup();
    return wasm;
  });
  return loading;
}

async function handle(request: BooleanRequest): Promise<void> {
  try {
    const wasm = await manifold();
    const results = runBoolean(wasm, request.operation, request.meshes);
    scope.postMessage({ id: request.id, ok: true, results }, meshTransferables(results));
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
