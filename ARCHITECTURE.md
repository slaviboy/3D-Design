# Planar Architecture

This document describes how Planar is structured and why. The detailed designs are in:

- [GEOMETRY.md](GEOMETRY.md): the modeling kernel
- [RENDERING.md](RENDERING.md): drawing the model
- [PROJECT_FORMAT.md](PROJECT_FORMAT.md): files and storage
- [TESTING.md](TESTING.md): how it is tested

## Goals that shape the design

1. **Offline and private.** Planar makes no network requests at runtime. Every asset is bundled, and the
   production Content-Security-Policy blocks connections to other origins.
2. **The domain model is the source of truth.** Planar keeps its own model: vertices, edges, faces, loops, curves,
   groups, components, materials, tags, scenes, and so on. Three.js objects are derived from that model and are
   never read back as data.
3. **Deterministic, undoable editing.** Every change to the model goes through a small set of primitive operations.
   Each primitive records the information needed to undo it, and those records make up undo history.
4. **Large models.** Updates are incremental. Changes are tracked as dirty sets, spatial indexes are updated in
   place, render buffers are rebuilt only where something changed, and expensive work runs in workers.

## Layers

```
┌────────────────────────────────────────────────────────────────────────┐
│ ui        React components: shell, menus, toolbars, panels, dialogs    │
└───────────────┬────────────────────────────────────────────────────────┘
                │ dispatches command ids, reads view-models
┌───────────────▼────────────────────────────────────────────────────────┐
│ app       commands, tools, inference, input, selection, camera,        │
│           edit context, shortcuts, preferences, autosave, UI stores    │
└──────┬──────────────────────┬─────────────────────┬────────────────────┘
       │ drives               │ opens transactions  │ save / load / import / export
┌──────▼───────┐       ┌──────▼───────────────┐    ┌▼──────────────────────┐
│ render       │ reads │ kernel               │◄───│ io                    │
│ three.js     ├──────►│ pure TypeScript:     │    │ format, migrations,   │
│ adapters     │       │ geometry, topology,  │    │ importers, exporters, │
└──────────────┘       │ ops, history, units  │    │ IndexedDB, files      │
                       └──────────▲───────────┘    └───────────┬───────────┘
                                  │                            │
                       ┌──────────┴────────────────────────────▼───────────┐
                       │ workers  booleans (manifold-3d), import/export,   │
                       │          serialization, heavy kernel operations   │
                       └───────────────────────────────────────────────────┘
```

| Layer | May import | Must not import |
|---|---|---|
| `kernel` | own modules, pure math libraries (`robust-predicates`, `earcut`) | three, react, react-dom, zustand, any other layer |
| `render` | kernel, three | react, zustand, app, io, workers, ui |
| `io` | kernel, three loaders/exporters, fflate | react, zustand, app, render, ui |
| `workers` | kernel, io, manifold-3d | react, zustand, app, render, ui |
| `app` | kernel, render, io, zustand | react, react-dom, ui |
| `ui` | app, kernel types, react | three, workers |

Two finer rules keep three.js loaders inside the io worker:

- `src/io/mesh`, `src/io/export`, `src/io/import/formats.ts` and `src/io/import/fileSet.ts` run on the main thread and
  must not import `three`. Only the parsers in `src/io/import` use three's loaders.
- `app` must not import `three/examples/*` or the import parsers (`io/import/parseImport`, `gltf`, `objStl3ds`,
  `dae`, `threeScene`, `mtl`, `xml`). It parses imports through `app/io/importEngine`, which posts to `io.worker`.

See [IMPORT_EXPORT.md](IMPORT_EXPORT.md) for the formats.

Two mechanisms enforce these rules:

- **ESLint.** `no-restricted-imports` rules in `eslint.config.js` encode the table. `tests/architecture/boundaries.test.ts`
  checks that they reject forbidden imports.
- **Compiler.** `tsconfig.kernel.json` compiles the kernel without DOM or Node type definitions, so any platform
  dependency in the kernel is a type error.

Modeling logic never lives in React components. A button click dispatches a command, the command runs a tool or an
operation, the operation mutates the kernel inside a transaction, and the renderer and the UI stores react to what
changed.

## Directory layout

```
src/
  kernel/    math, tolerance, ids, store (EntityStore, primitives, transactions, history, validation),
             entities, ops (insertSegments, erase/heal, pushPull, transforms, offset, followMe, intersect,
             solids, curves, triangulate), spatial (AABB tree, vertex hash grid), units, vcb (measurement
             input grammar), sun (solar position)
  app/       commands, tools (one folder per tool + ToolManager), inference, input, selection, context
             (edit path), camera, stores, shortcuts, prefs, scenes, autosave
  render/    Viewport, face chunk renderer, edge renderer, instance renderer, selection texture,
             overlays, styles, shadows, environment, sections, thumbnails
  io/        format (schema, migrations, validation, zip container), import, export, meshToKernel, fs, idb
  workers/   boolean worker, io worker, typed RPC
  ui/        shell, menubar, toolbar, tool palette, panels, dialogs, status bar, measurements box,
             command palette, preferences, accessibility helpers
  assets/    original icons, default materials and textures, environments, default styles
tests/       kernel/, app/, io/, render/, architecture/, integration/, e2e/, fixtures/, bench/
docs/        FEATURE_MATRIX.md, BEHAVIOR_MATRIX.md
```

Folders are created when they get their first real module. Placeholder files are never committed.

## Domain model overview

- **Document**: units and model info, materials, texture assets, tags and tag folders, styles, scenes, camera,
  shadow and geolocation settings, environment, and the component definitions (the root definition included).
- **ComponentDefinition**: one *context*. It owns an `EntityStore` holding vertices, edges, faces, curves, guides,
  dimensions, text, section planes, images and child instances. The model root is itself a definition. A group is a
  definition flagged `isGroup` that has exactly one instance.
- **Instance**: `{definitionId, transform, name, tag, material override, hidden, locked, cast/receive shadows}`.
- **Edit path**: the stack of instances the user has opened. Tools always work in the local coordinates of the
  innermost open definition.

[GEOMETRY.md](GEOMETRY.md) specifies the topology and the invariants the kernel must maintain.

## Commands and tools

- **Command registry.** Each command is `{id, label, category, aliases, defaultShortcut, isEnabled, isChecked, run,
  preservesTool}`. Menus, toolbars, context menus, the command palette and keyboard shortcuts all dispatch command
  ids through this one registry. No UI surface calls model code directly.
- **Tools.** A tool is a class with the lifecycle `activate`, `deactivate`, `pointerDown`, `pointerMove`,
  `pointerUp`, `doubleClick`, `keyDown`, `keyUp`, `onMeasurement(intent)`, `cancel`, `statusHint` and
  `measurementLabel`. `ToolManager` routes input to the active tool. Tool logic depends only on interfaces (picker,
  camera, inference) so it can be tested with synthetic events.
- **What a tool is doing.** `busy` says an operation is underway (what Escape would cancel) and `aims` that a press
  acts at once (paint, place, open a dialog). Touch input uses them: a finger dragged while a tool is busy or aiming
  moves the pointer, like a mouse between clicks, and acts where it lifts.
- **Stand-in tools.** `ToolManager.suspendFor` sets the active tool aside, operation and all, while a navigation tool
  is used (`Editor.toggleTool` does this for Orbit, Pan and Zoom), and `resumeSuspended` returns to it: a line can be
  continued after looking around, its preview stays on screen, and typed values still reach it. `beginTemporary`
  lends the pointer to another tool for one gesture (a box selection after a long press) without deactivating the
  active one, so a pending paste keeps its clipboard. Escape, undo and choosing another tool end both.
- **Touch** (`src/app/gestures/`). The viewport sends fingers to `editor.touch` and mouse and pen input to the tools.
  `TouchRecognizer` is a pure state machine (timers from the editor's clock) that turns fingers into gestures. It
  holds the first finger back until it is clearly a tap, a drag or a long press, or a second finger joins, so a
  multi-finger gesture never leaks a click into a tool (a speculative edit would also clear redo). `TouchController`
  maps the gestures onto the editor: one finger becomes mouse input for the active tool, using `busy` and `aims` to
  decide between pressing and moving the pointer; pinches zoom about the point picked where they start, computed from
  the camera at the start so nothing drifts; taps and holds run the actions in `Preferences.touch`. The interface
  side is a small port for opening and closing the context menu.
- **Previews.** Drawing tools show overlay geometry. Tools that modify existing geometry (push/pull, move, rotate,
  scale) run the real operation in a *speculative transaction* that is rolled back on the next pointer move and never
  enters history, so the preview always matches the committed result.
- **Measurements box.** The kernel's VCB module parses typed input into typed intents (length, pair, copies,
  absolute or relative point, segments, radius, angle, slope, scale factors). Each tool declares which intents it
  accepts. Typing right after an operation rolls back the last transaction and replaces it with a re-run that uses
  the new value, so the change stays a single history entry.

## History

- **Reverse deltas.** Every primitive records forward and inverse payloads, and removed entities are serialized in
  full. A transaction is a list of these records plus metadata: label, selection before and after, edit path, and the
  operation descriptor.
- **Undo and redo.** Undo applies the inverse records in reverse order. Redo replays the forward records, so entity
  ids stay identical. Nested transactions merge into their parent.
- **Size limit.** History is bounded by memory, not by the number of steps.
- **Not undoable.** Camera changes and selection changes are not undoable, which matches the reference workflows.
- **Derived state.** Triangulation, spatial indexes and render buffers are never stored in history. They are
  recomputed from the dirty sets the primitives emit.

## Tool previews, speculative edits and the measurements box

- **Previews.** Tools publish a `ToolPreview`: world-space rubber-band lines (colored by the axis they follow), entities
  to highlight in the active context, and the current inference marker. The `ToolManager` copies it into the session
  after every input event. The renderer draws the lines and highlights, and the UI draws the marker and its tooltip.
- **Speculative edits.** Push/Pull and Move show the real result while the pointer moves. A `Speculation` runs the
  kernel operation in a transaction, and each new attempt first rolls back the previous one with
  `ModelDocument.rollbackLastTransaction` (no redo entry). Committing keeps the last attempt as a single undo step.
  If an attempt throws, the model is left without it and the error is shown in the status bar.
- **Inferring during a speculative edit.** The attempt stays in the model while the pointer moves, so inference sees
  what is on screen: the preview hides what lies behind it. What the attempt added or moved (read from its transaction
  record, `exclusionForChanges`) is never a snap target, together with the operation's own source (Push/Pull's face
  outline, the selection Move and Rotate carry), so the preview can't catch the pointer. Move and Rotate also skip it
  as the face under the pointer, which would feed their result back into them.
- **Measurements box.** While the active tool reports a `MeasurementField`, `Editor.handleKey` sends typing to the
  box: digits and `. , - [ < /` start it, and after that any character continues it. Enter parses the text against
  the kinds the tool accepts (`parseMeasurement`) and calls `onMeasurement`. After an operation, typing replaces it as
  long as the tool's transaction is still the last one in the history (`canReplace`). That is how retyping a
  rectangle's size, a push/pull distance, or `3x` after a copy work.
- **Edit context.** `EditorSession.enterInstance` and `exitContext` maintain the edit path. Picking, inference and
  every tool work in the active context's coordinates; tools convert world points with the inverse of the context
  transform.

## Tags, locks and panels

- **Tag visibility.** `kernel/model/visibility.ts` (`isTagVisible`) is the single rule for hidden tags. The renderer,
  the picker and ray traversal, box selection, Select All and inference all call it, so an entity on a hidden tag is
  never drawn, picked, selected or snapped to. An instance on a hidden tag hides its whole subtree (the open group on
  the edit path stays drawn). Hiding a tag deselects what is on it.
- **Active tag.** A session setting (`EditorSession.activeTagId`), not model data and not undoable. New groups,
  components and placed components go on it.
- **Locks.** `app/selection/locking.ts` (`refuseLocked`, `LOCKED_MESSAGE`) is the shared guard. Editor methods
  (delete, explode, open) and tools (Move, Eraser) call it before editing, and it reports the refusal as an error
  notification. Attribute edits (for example unlocking in Entity Info) stay allowed.
- **Panels.** Panel view-models are pure app-layer functions (`buildOutlinerTree`, `listComponentDefinitions`,
  `listTags`, `describeSelection`). Panels read them from the model revision and change the model only through
  `Editor` methods, each one undoable transaction. Which panels are shown is editor state exposed in the store.
- **Dock layout.** `app/dock/dockLayout.ts` holds the pure layout model (`DockLayout`: width before UI scale, panel
  order, collapsed panels) and its defensive parser. `Editor.dockLayout` owns the state and saves it through a
  `DockLayoutStorage` (localStorage `planar.dock` in the browser). The UI sets `--dock-width` from it, clamped between
  200px and half the window, and lays panels out with CSS `order`, so panels added later keep working without
  changes to the dock markup.
- **Context menus.** `app/contextMenu/contextMenu.ts` decides which commands apply to a selection
  (`contextMenuGroups`) and turns them into entries with only registered, enabled commands (`buildContextMenu`).
  `ui/contextmenu` renders one WAI-ARIA menu at a time for the viewport, Outliner rows and Shift+F10, and runs
  entries through `editor.runCommand`.
- **Instructor.** `app/instructor/instructor.ts` is a typed table of original help keyed by tool id, with modifier
  key names for the platform; a unit test requires an entry for every registered tool.

## State management

- **Kernel.** The kernel is a mutable, transaction-guarded store. It is not kept in React state.
- **UI stores.** Zustand stores hold UI state (active tool, open panels, preferences, and view-models derived from
  the kernel) plus a model *revision* counter. React components subscribe to narrow selectors, so a geometry edit
  re-renders only the panels that show affected data.

## Workers

| Worker | Responsibility |
|---|---|
| `boolean.worker` | manifold-3d WebAssembly, loaded lazily: union, subtract, intersect, trim, split, outer shell |
| `io.worker` | parsing imports, serializing exports, packing and unpacking `.planar` zips |

- **Messaging.** Workers communicate through a small typed request/response protocol with transferable typed arrays
  and cancellation.
- **Kernel operations.** These run synchronously on the main thread, because interactive operations must finish in a
  few milliseconds. Any operation that benchmarks show exceeds its budget moves to a worker that works on a
  serialized snapshot of a context and returns a transaction payload.

## Error handling and logging

- **Error boundaries.** One boundary wraps the whole app and one wraps each panel, so a broken panel never takes
  down the viewport.
- **Failed operations.** A kernel operation that fails validation aborts its transaction, leaving the model
  unchanged, and reports a readable message.
- **Imports and project files.** Both are validated before they touch the model, and corrupt input produces an
  explicit error.
- **Logging.** A leveled logger is active only in development builds or when a diagnostics flag is set. There is no
  telemetry, analytics or remote error reporting.

## Key decisions

| Decision | Rationale |
|---|---|
| Canonical unit: meters, float64 | Matches glTF and three.js conventions; display formatting handles imperial and architectural units exactly |
| Radial-edge-lite topology (edge → face list) instead of half-edge | Loose edges and non-manifold fins are normal in this style of modeling |
| Reverse-delta history instead of immutable snapshots | Copying or diffing maps of 100k+ entities per edit is too slow and too memory-hungry |
| CPU picking against the kernel's spatial index | Inference needs vertices, midpoints and edges with pixel tolerance; GPU id buffers and triangle-only BVHs can't provide that |
| Section fills computed in the kernel | Stencil caps fail on open or non-manifold models |
| manifold-3d for booleans | Robust manifold booleans; JavaScript CSG libraries aren't watertight |
| TypeScript pinned to ~6.0 | typescript-eslint supports TypeScript below 6.1 only |
| Hand-written menus, dialogs, palette and IndexedDB wrapper | Each is small; fewer dependencies means a smaller bundle and less supply-chain risk |
| Platform (Mod key) from `navigator.platform`, not the user agent | User agents are routinely overridden; the OS platform matches the physical keyboard |

## Dependencies

Every runtime dependency is bundled; nothing is fetched at runtime.

| Package | License | Layer | Why |
|---|---|---|---|
| `three` | MIT | render | WebGL rendering only; never the model's source of truth |
| `react`, `react-dom` | MIT | ui | Interface chrome |
| `zustand` | MIT | app (vanilla store), ui (React binding) | Small UI view-state store fed by editor events |
| `robust-predicates` | Unlicense | kernel | Exact 2D orientation tests for planar topology |
| `earcut` | ISC | kernel | Triangulating faces with holes |
| `fflate` | MIT | io | ZIP container for `.planar` files |
| `manifold-3d` | Apache-2.0 | workers | Watertight mesh booleans for the solid tools. The WebAssembly module is bundled as a local asset, loaded lazily by `boolean.worker`, and precached for offline use. Its optional CAD and glTF helpers are never imported; npm installs their peer packages (`@gltf-transform/*`, `esbuild-wasm`) for development only, and they are not bundled |
| `workbox-window` | MIT | main | Registering the offline service worker |

| Development package | License | Why |
|---|---|---|
| `vite`, `@vitejs/plugin-react`, `typescript` | MIT / Apache-2.0 | Build and type checking |
| `vite-plugin-pwa` (Workbox) | MIT | Generates the service worker precache and manifest at build time |
| `vitest`, `@vitest/coverage-v8`, `fast-check`, `fake-indexeddb` | MIT / Apache-2.0 | Unit, property-based and storage tests |
| `@playwright/test` | Apache-2.0 | End-to-end and offline tests |
| `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier` | MIT | Lint rules, including layer boundaries, and formatting |
