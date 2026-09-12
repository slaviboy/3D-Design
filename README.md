# Planar

Planar is an offline, local-first 3D modeling application that runs in the browser.

- No account, no login, no backend.
- No telemetry and no network requests at runtime.
- Everything you create stays on your device.

> **Status: Phase 3 (foundation app) complete.** Planar opens as an installable offline web app with menus,
> toolbars, a 3D viewport, orbit/pan/zoom, standard views, selection (click, double/triple click, window and
> crossing), Entity Info, undo/redo, saving and opening `.planar` files, and autosave with crash recovery. Drawing
> and modeling tools arrive in Phases 4–6. Nothing in this repository is production-ready yet. Progress is tracked
> in [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md).
>
> Try it: `npm install && npm run dev`, then **File › Open Sample Model**.

## Documents

| Document | Purpose |
|---|---|
| [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md) | Feature inventory: behavior, priority, complexity, dependencies, status, tests |
| [docs/BEHAVIOR_MATRIX.md](docs/BEHAVIOR_MATRIX.md) | Exact topology outcomes for modeling scenarios; these become test fixtures |

ARCHITECTURE, DEVELOPMENT, GEOMETRY, RENDERING, IMPORT_EXPORT, PROJECT_FORMAT, TESTING, PERFORMANCE and SECURITY
documents are added as their phases begin.

## Behavioral reference

Planar's workflows are modeled on public documentation for SketchUp. That documentation is used only as a
**behavioral reference**. Planar is an independent, original implementation and is not affiliated with Trimble
or SketchUp. It does not reuse their code, assets, icons or text.
