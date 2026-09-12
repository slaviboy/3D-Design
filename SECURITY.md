# Planar Security and Privacy

Planar runs entirely in the browser. It has no backend and no accounts, and it collects no data. Its security work is
about treating user-supplied files as untrusted and making sure the app can never reach the network.

## Privacy guarantees

- **No telemetry, analytics, tracking, remote logging, crash reporting, cookies or identifiers.**
- **Local storage only.** All data stays in the browser's local storage (IndexedDB) or in files the user explicitly
  chooses.
- **Offline-verifiable.** Every end-to-end test fails if the app requests any origin other than its own (see
  `tests/e2e/fixtures.ts`).

## Network isolation

Production builds carry a Content-Security-Policy (`vite.config.ts`):

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | Nothing loads from other origins |
| `script-src` | `'self' 'wasm-unsafe-eval'` | No inline scripts and no `eval`. WebAssembly compilation is allowed for the bundled boolean kernel |
| `style-src` | `'self'` | No inline `<style>` elements or style attributes |
| `connect-src` | `'self' data: blob:` | `fetch`, XHR and WebSocket requests to other origins are blocked |
| `img-src` | `'self' data: blob:` | Images from user files are decoded into blob or data URLs |
| `worker-src` | `'self' blob:` | Only bundled workers and the offline service worker |
| `manifest-src` | `'self'` | The web app manifest used for installation |
| `object-src` | `'none'` | No plugins |
| `base-uri` | `'self'` | Prevents base-tag hijacking |
| `form-action` | `'none'` | The app never submits forms |

**Test hook.** Builds made with `vite build --mode e2e` expose `window.__planar` so end-to-end tests can inspect
the model. The normal `npm run build` output never includes it.

**Limits of a meta-tag policy:**
- A policy set through a `<meta>` tag can't set `frame-ancestors`.
- Deployments behind a web server should send the same policy as an HTTP header, and add
  `frame-ancestors 'none'`.

## Untrusted input

Project files, imported 3D models and images are all treated as hostile.

- **No code execution.** No `eval`, `new Function`, or string `setTimeout` (ESLint enforces this). No HTML strings are
  inserted as markup, and user-provided text (names, labels, dimensions) is always rendered as text.
- **Validation before use.** Every parsed file is validated structurally before it touches the model:
  - finite numbers, and no NaN or Infinity;
  - index ranges and id references;
  - enum values;
  - array lengths.
- **Resource limits.** File size, vertex and face counts, texture dimensions (clamped to the maximum texture size),
  and ZIP entry count and uncompressed size (to stop zip bombs).
- **Path safety.** ZIP entries with `..`, absolute paths, or drive letters are rejected. Importers resolve external
  references (MTL files, textures, glTF buffers) only against files the user supplied. Remote URLs inside files are
  never fetched, and the user sees a warning.
- **Parsing in workers.** Imports are parsed in a worker, so a malformed file can't freeze the interface, and parsing
  can be cancelled.
- **No silent corruption.** A corrupt or unsupported file produces an explicit error and leaves the open model
  untouched.

## Dependencies

- **Vetting.** Runtime dependencies are kept to a minimum. Each one is checked for its license, maintenance and offline
  behavior (see ARCHITECTURE.md).
- **Lockfile.** `package-lock.json` is committed, and installs use `npm ci` in automation.
- **Updates.** `npm audit` is reviewed at every phase gate.

## Reporting

Security issues should be reported privately to the project maintainers, not in public issue trackers.
