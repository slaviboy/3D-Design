# Planar Acceptance Validation

This file records how every acceptance criterion in the product specification was validated, with the evidence for
each. A criterion counts as met only when automated evidence exists and passes; manual impressions are not used.

> **Status: validated on 2026-09-13** (Apple M1 Max; Chromium, WebKit and Firefox through Playwright 1.63).

## How to reproduce

```sh
npm run verify          # typecheck → lint → format check → unit tests → E2E (Chromium, WebKit, Firefox)
FUZZ_RUNS=2000 npx vitest run tests/kernel/fuzz.test.ts
npm run bench           # kernel and file benchmarks (Node)
npm run bench:render    # rendering benchmarks (Chromium with a hardware GPU)
npx vite build && (grep -l __planar dist/assets/*.js || true)   # must print nothing
```

## Final expectation: the user journey

All 22 steps run in one end-to-end test, `tests/e2e/acceptance.spec.ts`, in Chromium, Firefox and WebKit. The
network is disabled after the first visit in Chromium and Firefox. In WebKit, Playwright's offline emulation
breaks service-worker navigations, so the same journey runs online there. In every browser the fixtures fail the
test on any request to another origin (`tests/e2e/fixtures.ts`).

| # | A user can… | Evidence in the journey (and focused tests) |
|---|---|---|
| 1 | Open the application offline | Reload with the network disabled after the service worker installs; `navigator.onLine === false` (also `workflows.spec.ts`) |
| 2 | Start a new model | File › New |
| 3 | Draw geometry | Rectangle tool (also `modeling.spec.ts`, unit tests for every drawing tool) |
| 4 | Snap accurately to geometry | The first corner snaps to the Origin inference; resulting extents start exactly at 0,0,0 |
| 5 | Enter exact dimensions | Typed `2m,1m` gives a 2 × 1 m rectangle |
| 6 | Push/Pull faces | Typed `1m` extrusion gives a closed box (6 faces, height 1) |
| 7 | Move/rotate/scale objects | Typed 90° rotation, typed ×2 scale, typed 3 m move (also `transform.spec.ts`) |
| 8 | Group geometry | Ctrl+G creates one group |
| 9 | Create components | G turns the group into a component |
| 10 | Apply materials | New material with a color, painted onto the component with the Paint Bucket (also `materials.spec.ts`) |
| 11 | Organize the model | Tag created and assigned in Entity Info; component renamed in the Outliner (also `panels.spec.ts`) |
| 12 | Create scenes | Scenes panel › Add creates "Scene 1" (also `scenes.spec.ts`) |
| 13 | Use sections | Section plane placed on the top face |
| 14 | Measure geometry | Tape Measure shows `2000mm` across the box (also `annotations.spec.ts` for dimensions) |
| 15 | Undo/redo operations | Undo and redo of grouping restore exact states (also `workflows.spec.ts`, kernel undo hash identity tests) |
| 16 | Save the project locally | Ctrl+S writes a `.planar` file |
| 17 | Close the browser | The page is closed and a new one opened, still offline |
| 18 | Reopen the project | File › Open restores faces, component, name, material, tag, scene and section plane |
| 19 | Continue editing | A new rectangle is drawn; the model becomes unsaved |
| 20 | Import supported 3D files | OBJ + MTL import (also `importExport.spec.ts`: textured OBJ; unit tests for glTF/GLB, STL, COLLADA, 3DS) |
| 21 | Export supported formats | STL export (unit tests for glTF/GLB, OBJ, COLLADA, STL; `importExport.spec.ts` for PNG) |
| 22 | Do all of the above offline | Every step above ran with the network disabled (Chromium, Firefox) |

## Production hardening

| Requirement | Evidence |
|---|---|
| Full tests | `npm test`: unit, integration, architecture and property tests, plus the kernel fuzz suite |
| E2E tests | `npm run e2e`: every spec in Chromium, WebKit and Firefox |
| Build, lint, typecheck | `npm run build`, `npm run lint` (zero warnings), `npm run typecheck` (whole project and the kernel alone) |
| Performance benchmarks | `PERFORMANCE.md`; `npm run bench`, `npm run bench:render` |
| Offline | `workflows.spec.ts` (offline reload and editing), `acceptance.spec.ts` |
| Reload | `preferences.spec.ts`, `shortcuts.spec.ts`, `keyboard.spec.ts` (settings survive reload), offline reload tests |
| Crash recovery | `workflows.spec.ts`: autosave after a session ends unexpectedly is offered and restored in a new page |
| Corrupted files | `damagedFiles.spec.ts` (repaired with a notice; unreadable refused with the model unchanged); unit tests in `tests/kernel/model/repair.test.ts`, `validateCorruption.test.ts`, `tests/io/storage.test.ts` |
| Large models | 100k-entity models orbit at 60 FPS with a hardware GPU and save in 0.33 s / load in 1.1 s; imports up to the 250,000-triangle limit complete (7.1 s bundled, 20.6 s under Vitest); larger files are refused with a clear message (`PERFORMANCE.md`) |
| Browser compatibility | The whole E2E suite passes in Chromium, WebKit and Firefox (one documented WebKit skip) |

## Other requirements

| Area | Requirement | Evidence |
|---|---|---|
| Privacy | Zero user data, no telemetry, tracking, cookies, remote logging, accounts or identifiers | No backend or account code; E2E fails on any external request; production bundle audit in `SECURITY.md` |
| Security | Sanitize and validate imported files and project files; treat assets as untrusted | Import limits and validators (`src/io/import`, `IMPORT_EXPORT.md`); `.planar` structure, id and invariant validation with repair; zip path and size guards; strict XML parser without entities |
| Security | No unsafe HTML injection, no eval, no arbitrary code execution | No `innerHTML`, `dangerouslySetInnerHTML`, `eval` or `new Function` in `src`; ESLint `no-eval`, `no-implied-eval`, `no-new-func`; Content-Security-Policy without `unsafe-eval` or inline scripts (`shell.spec.ts`) |
| PWA | Service worker, offline cache, local assets, installable manifest, offline startup, versioned cache invalidation | `pwa.spec.ts` (manifest, icons and an active service worker in every browser; no installability errors in Chromium); precache with revisioned URLs and `cleanupOutdatedCaches`; offline startup in `workflows.spec.ts` |
| Error handling | Error boundaries, recoverable errors, import validation, corrupted project detection, unsupported-format messages, geometry validation, safe fallbacks, developer diagnostics | Per-area `ErrorBoundary`; tool failures become notifications (`ToolManager`); import warnings for unsupported and external content; repair on open; kernel validation after every transaction in tests; diagnostics logger |
| Logging | Development logging behind a flag, no noisy production logs, no telemetry | `src/app/diagnostics/log.ts` (silent in production unless `localStorage planar.debug` or `?debug`); ESLint forbids `console` elsewhere; `tests/app/log.test.ts` |
| Accessibility | Keyboard reachable commands, focus, labels, contrast | `accessibility.spec.ts` (axe WCAG A/AA, light and dark themes), `keyboard.spec.ts` (keyboard-only workflows) |
| Responsive | Desktop first; large tablet secondary | Desktop layout in every spec; `shell.spec.ts` checks a 1024 × 768 tablet layout |
| Performance testing | 1k/10k/100k entities; large textures; large imported meshes; FPS, memory, geometry update, import, export, save/load times | `PERFORMANCE.md` records all of them: drawing and orbit FPS at 1k/10k/100k; 8192 px textures in the file and 4096/8192 px textures rendering at 60 FPS; STL/GLB imports up to 250k triangles; STL/OBJ/glTF/GLB export at 100k; save/load at 10k/100k; JS heap while rendering; edit-to-frame times at 1k/10k/100k |
| Definition of done | UI, domain, rendering, interaction, undo/redo, persistence, error handling, tests, documentation | Per-feature status and known gaps in `docs/FEATURE_MATRIX.md` |

## Known limitations

These are documented where they apply, and none blocks the criteria above.

- WebKit can't run the offline part of the journey under Playwright; the same steps run online there, still with
  the external-request guard.
- Only rotation 0 of glTF `KHR_texture_transform` is tested.
- Textures are imported but not exported.
- User HDR environments are not saved in `.planar` files.
- The 3D Text font is intentionally geometric: no curves and no kerning.
- Rendering benchmarks are capped at 60 FPS by `requestAnimationFrame`, so they show that targets are met, not how
  much headroom there is.
- Importing a mesh at the 250,000-triangle limit blocks the interface for several seconds and holds about 670 MB;
  larger meshes are refused (see `PERFORMANCE.md`, "Not measured yet").
- `docs/FEATURE_MATRIX.md` lists the remaining partial features, such as texture pins, a user material library and
  the drawing and graphics preference panes.
