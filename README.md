# Planar

Planar is an offline, local-first 3D modeling application that runs in the browser.

- No account, no login, no backend.
- No telemetry and no network requests at runtime.
- Everything you create stays on your device.

> **Status: Phases 0–9 largely complete; performance (10) and hardening (11) in progress.** Planar opens as an
> installable offline web app with drawing and modeling tools (lines, shapes, arcs, push/pull, move, rotate, scale,
> offset, follow me, solid tools), groups and components, tags, materials and textures, scenes, section planes, sun
> shadows, dimensions and text, import and export (glTF/GLB, OBJ, STL, COLLADA, 3DS import; PNG export), files that
> repair on open, autosave with crash recovery, customizable shortcuts, preferences, context menus and an Instructor
> panel. It is not yet called production-ready: styles, fog and environments, 3D Text and the remaining hardening are
> still open. Feature status, including known gaps, is tracked in [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md).
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
