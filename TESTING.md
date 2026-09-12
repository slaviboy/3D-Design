# Planar Testing

Tests are mandatory. A feature counts as done only when its tests exist and pass (see the Definition of Done in
[docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md)).

## Commands

| Command | What it runs |
|---|---|
| `npm test` | Vitest: unit, integration, architecture, and property tests |
| `npm run coverage` | Vitest with V8 coverage (HTML report in `coverage/`) |
| `npm run e2e` | Builds for production, then runs Playwright against `vite preview` |
| `npm run verify` | typecheck → lint → format check → unit tests → E2E; the gate for every phase |

## Layers of testing

### Unit tests (`tests/kernel`, `tests/app`, `tests/io`, `tests/render`)

- Run in Node, with no DOM.
- Kernel tests use only the kernel's public API.
- Every mutation primitive is tested forward and inverse.
- Every operation is tested against its rows in [docs/BEHAVIOR_MATRIX.md](docs/BEHAVIOR_MATRIX.md).

### Geometry regression suite (`tests/kernel/regressions`)

Covers these cases:

- coplanar overlaps
- coincident vertices
- zero-length edges
- collinear overlapping edges
- invalid and self-intersecting loops
- non-manifold fins
- precision far from the origin (10 km)
- tiny features (1e-5 m)

Every geometry bug that gets fixed adds a regression case here.

### Property and fuzz tests (fast-check, from the kernel phase)

Random sequences of operations (draw line, rectangle, circle, erase, push/pull, move, undo, redo) must satisfy:

- the invariant validator passes after every step;
- undoing everything returns the empty-store hash;
- redoing everything returns the final hash;
- serializing and then deserializing gives an identical store hash.

CI runs a fast profile. `FUZZ_RUNS=10000 npm test` runs the deep profile before each phase is signed off.

### Architecture tests (`tests/architecture`)

- `boundaries.test.ts` proves the ESLint layer rules reject forbidden imports.
- `tsconfig.kernel.json` compiles the kernel with no DOM or Node types, and runs as part of `npm run typecheck`.

### Integration tests (`tests/integration`)

- **Tools.** `ToolManager` drives tools with synthetic pointer and keyboard events, using a fake camera and picker.
- **Workflows.** For example: draw rectangle → push/pull → group → component → make unique → undo/redo.
- **Autosave and recovery.** Tested with `fake-indexeddb`.
- **Scenes.** Capture and apply.

### End-to-end tests (`tests/e2e`, Playwright)

- **Build under test.** Tests run against the production build.
- **Automatic guards.** `tests/e2e/fixtures.ts` applies two guards to every test:
  - **Offline guard:** any request to an origin other than the preview server fails the test.
  - **Error guard:** any uncaught exception or console error fails the test.
- **Offline suite** (from the foundation phase): load the app so the service worker installs, call
  `context.setOffline(true)`, reload, then run a full modeling workflow.
- **Workflow coverage.** The 16 acceptance workflows are:
  1. create project
  2. draw rectangle
  3. push/pull
  4. move
  5. rotate
  6. scale
  7. apply material
  8. group
  9. component
  10. scene
  11. save
  12. reload
  13. undo
  14. redo
  15. export
  16. import

  They are driven mainly through the keyboard and the measurements box, because exact values are deterministic. Model
  state is checked through a test hook that exists only in development and test builds, and screenshots are used as a
  sanity check.
- **Browsers.** Chromium is the primary target. WebKit and Firefox run a smoke suite in the hardening phase.

### Accessibility tests

axe-core runs inside Playwright from the UX phase, and fails on serious or critical violations.

### Benchmarks (`tests/bench`)

`npm run bench` (`vitest bench --run`) runs the kernel benchmarks. In Vitest 5 a benchmark is a test in a
`*.bench.ts` file that uses the `bench` fixture. Vitest runs those files only in bench mode
(`test.benchmark.include` in `vitest.config.ts`), so the slow 100k-entity cases stay out of `npm test`. Each benchmark
writes its result to `bench/results/<name>.json`.

From the performance phase, a Playwright performance page measures:

- FPS and p95 frame time during a scripted orbit
- heap usage
- import, export, save and load times

It runs these on 1k-, 10k- and 100k-entity synthetic models, large textures, and a 1M-triangle STL. Results go to
`bench/results/*.json` and are summarized in PERFORMANCE.md.

## Conventions

- Test files mirror source paths: `src/kernel/ops/pushPull.ts` → `tests/kernel/ops/pushPull.test.ts`.
- Test names describe behavior ("pushing an inner face through a slab creates a hole").
- Tests never depend on the network, wall-clock time, or random seeds that aren't fixed.
- Fixtures live in `tests/fixtures/`. Every file format fixture has a README line saying where it came from. All
  fixtures are original or public domain.
