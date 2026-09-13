# Planar Performance

This file records measured performance, never estimates. Every number here comes from `npm run bench`, and the
raw results are in `bench/results/*.json`. Optimization work happens in the performance phase and is driven by
these measurements.

## Environment for the current baseline

| | |
|---|---|
| Date | 2026-09-13 (end of Phase 2) |
| Machine | Apple M1 Max, 32 GB |
| Runtime | Node.js 25.5, Vitest 5 benchmarks (tinybench) |
| Build | Unbundled TypeScript through Vite's transform, kernel validation off |

Workloads that take seconds are timed once; repeating them adds run time without adding much insight. Treat
single-sample numbers as ±10%.

## Kernel baseline (Phase 2)

| Benchmark | Workload | Result |
|---|---|---|
| `draw-rectangles-1000` | 112 separate rectangles, drawn one at a time (≈1k entities) | 6.7 ms |
| `draw-rectangles-10000` | 1,112 rectangles (≈10k entities) | 89 ms |
| `draw-rectangles-100000` | 11,112 rectangles (≈100k entities) | 1.05 s |
| `draw-line-grid` | 31 + 31 crossing lines drawn one at a time: 961 vertices, 900 faces | 477 ms |
| `validate-10000` | Full invariant validation of a 10k-entity model | 21.9 ms (64 samples, ±0.7%) |
| `snapshot-restore-10000` | Snapshot to JSON and restore a 10k-entity model, including validation | 59 ms |

Each rectangle is 9 entities: 4 vertices, 4 edges and 1 face.

## Findings

- **Separate geometry scales linearly.** Drawing costs about 90 µs per rectangle from 1k to 100k entities, because
  spatial indexes keep each insertion local.
- **Large connected coplanar geometry does not.** In the line grid, every line joins one connected graph in a single
  plane. Resolving faces after each insertion re-traces that whole planar graph, so drawing a grid line by line
  grows quadratically: the last lines cost about 15 ms each.
  - This matches technical risk 3 in the plan (face detection on large coplanar contexts).
  - Performance-phase target: limit resolution to faces touched by the new edges plus their enclosing face, instead
    of the whole connected component.
- **Validation is affordable in development.** At about 2 µs per entity, validating after every transaction is fine
  for tests and development builds, but it stays off in production.

## Phase 10: plane resolution on large connected faces

**Measured hotspot.** A CPU profile of the 31 × 31 line grid (esbuild bundle, `node --cpu-prof`) put about 60% of
the time in point-in-polygon tests called from `resolvePlane`. After every insertion, each traced region was tested
against every coplanar candidate face, in id order, to find the face that covers it. That is regions × faces tests
per insertion, and it grows with the size of the connected plane.

**Change.** `resolvePlane` now asks the face spatial index for faces whose bounds contain the region's sample
point, keeps only the candidate faces, and tests those in id order. A face that contains the sample always has it
inside its bounds, and faces aren't modified until every region is assigned. So the covering face, and therefore
the result, is the same as before; the face count and the 703 unit tests plus 2000 fuzz runs confirm it. Face rings
are now projected only for faces that are actually tested.

| Benchmark | Before (Phase 10 baseline) | After |
|---|---|---|
| `draw-line-grid` (31 × 31 lines, 961 faces) | 503 ms | 168 ms |
| `draw-rectangles-1000` | 7.2 ms | 7.0 ms |
| `draw-rectangles-10000` | 85.7 ms | 94.2 ms |
| `draw-rectangles-100000` | 1.06 s | 1.13 s |
| `validate-10000` | 21.7 ms | 24.1 ms |
| `snapshot-restore-10000` | 65.2 ms | 73.1 ms |

The benchmarks other than the line grid don't use this code path; their differences are run-to-run noise from
single-sample timings (±10%).

**Remaining growth.** Outside the benchmark harness, the 31 × 31 grid takes 144 ms and a 61 × 61 grid (3,721 faces)
takes 843 ms: 3.9× the faces for 5.9× the time. Each insertion still gathers and traces the whole connected
coplanar edge graph, which is linear in its size. The new profile shows no dominant function (edge gathering, cycle
tracing and loop keys each take 5–6%). Restricting resolution to the faces the new edges touch would remove that,
but it changes how enclosing faces and islands are found, so it waits for a real model that needs it.

## Phase 10: rendering frame rate

**How it is measured.** `npm run bench:render` builds the e2e-mode production app and runs
`tests/perf/render.perf.ts` with `playwright.perf.config.ts` (Chromium, 1280 × 800, one test at a time, its own
preview port).
- **Models.** Each model is a square grid of separate 1 m boxes (26 entities each: 8 vertices, 12 edges, 6 faces).
  It is built with the kernel in Node, encoded as `.planar`, and opened with `editor.loadFile`, then framed with
  Zoom Extents in the default style.
- **Orbit.** The benchmark orbits the camera for 120 frames after 10 warm-up frames. Each step changes the camera,
  which schedules the viewport's render for the next animation frame. A `requestAnimationFrame` callback registered
  afterwards runs after that render, and the interval between callbacks is the frame time.
- **Load time.** This is the time from `loadFile` until the model has been rendered twice.
- **Renderer.** Each result records the WebGL renderer that was used (`bench/results/render-orbit-*.json`).

**Results, 2026-09-13, Apple M1 Max.**

| Model | Entities | Renderer | Load | Median frame | p95 frame | Median FPS |
|---|---|---|---|---|---|---|
| 39 boxes | 1,014 | Metal (hardware) | 152 ms | 16.7 ms | 16.7 ms | 60 |
| 385 boxes | 10,010 | Metal (hardware) | 101 ms | 16.7 ms | 16.7 ms | 60 |
| 3,847 boxes | 100,022 | Metal (hardware) | 627 ms | 16.7 ms | 16.8 ms | 60 |
| 39 boxes | 1,014 | SwiftShader (software) | 261 ms | 16.7 ms | 16.7 ms | 60 |
| 385 boxes | 10,010 | SwiftShader (software) | 308 ms | 16.7 ms | 16.8 ms | 60 |
| 3,847 boxes | 100,022 | SwiftShader (software) | 844 ms | 66.7 ms | 66.8 ms | 15 |

**Reading the numbers.**
- The plan's targets are met on this machine: 60 FPS orbit at 10k entities, and also at 100k with a hardware GPU.
- Frames are paced by `requestAnimationFrame`, so 60 FPS (16.7 ms) is a ceiling. These runs show the targets are
  met, not how much headroom is left.
- Headless Chromium renders in software (SwiftShader) unless it is launched with GPU flags, and those rows show the
  cost of a software fallback. The config asks for Metal (`--use-angle=metal`); the hardware rows come from that
  configuration.
- Not covered yet: heavier styles (profiles, back edges, shadows, X-ray), textured models, and single models larger
  than 100k entities.

## Phase 10: save/load, import, export, textures, memory and edits

**Environment.** 2026-09-13, Apple M1 Max, 32 GB, macOS (Darwin 25.5).
- **Node benchmarks** (`npm run bench`, `tests/bench/ioPerformance.bench.ts`): Node.js 25.5.0 and Vitest 5, with
  unbundled TypeScript through Vite's transform. Each test times its workload with `performance.now()`: one warm-up
  run, then 3–10 samples, and it reports the median. The import runs are timed once.
- **Memory in Node:** `process.memoryUsage()` after a forced garbage collection, reported as V8 heap and array
  buffers. Mesh positions and texture bytes are typed arrays, so they count as array buffers, not heap.
- **Browser benchmarks** (`npm run bench:render`, `tests/perf/render.perf.ts`): Playwright 1.63 with headless
  Chromium (build 1243) on the ANGLE Metal renderer (Apple M1 Max).
- **Models:** the same box grids as the frame-rate benchmarks (26 entities per box), built by
  `tests/bench/models.ts`.
- Every raw result is in `bench/results/<name>.json`.

### Save and load (`save-load-*`)

`encodePlanarFile` and `decodePlanarFile` on a model in memory, so disk I/O is not included. Decode with repair is
the path `Editor.loadFile` takes.

| Model | File size | Encode | Decode | Decode with `repair: true` | Decoded model heap |
|---|---|---|---|---|---|
| 385 boxes, 10,010 entities | 87 KB | 29.5 ms | 94 ms | 94 ms | 8.0 MB |
| 3,847 boxes, 100,022 entities | 858 KB | 333 ms | 1.11 s | 1.14 s | 78.7 MB |

- Both directions scale linearly with the model, at about 3.3 ms per 1k entities to save and 11 ms per 1k to load.
  Loading costs about 3.3× saving because it restores the snapshot and validates it with the kernel checks.
- On a valid model, the repair path costs the same as a plain decode (within ±3%).
- A decoded model uses about 0.8 KB of heap per entity.

### Large textures (`texture-8192`, `render-textured-*`)

**Kernel and file.** The texture is an 8192 × 8192 PNG placeholder: a valid signature and IHDR followed by 24 MB of
incompressible data (25.2 MB in total). The kernel and the file format only read the header, so it isn't decodable.
The model is the 10k-entity grid with every face painted on both sides.

| Step | Result |
|---|---|
| `addTextureAsset` (header check and copy) | 2.0 ms |
| Build the 10k model and paint every face | 149 ms |
| Encode with the texture (25.3 MB file) | 262 ms (29.5 ms without) |
| Decode | 268 ms (94 ms without) |
| Decode with `repair: true` | 266 ms |
| Decoded model | 8.0 MB heap + 24 MB array buffers |

- The texture adds about 230 ms to saving and 170 ms to loading. The image is stored without recompression, so this
  is time spent on its bytes, which grows with the file size rather than the pixel count.

**Rendering.** The 10k-entity grid is painted on both sides of every face with a real, decodable checkerboard PNG,
generated in the test with fflate.
- *Load* is the time until the model has rendered twice.
- *Texture ready* runs from `loadFile` until `createImageBitmap` has resolved and two more frames have rendered, so
  it includes the GPU upload.

| Texture | PNG size | Load | Texture ready | Median frame | p95 frame | Median FPS | JS heap after load / orbit |
|---|---|---|---|---|---|---|---|
| 4096 × 4096 | 357 KB | 243 ms | 639 ms | 16.7 ms | 16.7 ms | 60 | 11.0 / 11.4 MB |
| 8192 × 8192 | 1.4 MB | 151 ms | 831 ms | 16.7 ms | 16.8 ms | 60 | 10.9 / 11.4 MB |

- Orbiting stays at the 60 FPS cap with either texture size. The decoded image adds 0.4–0.7 s after the geometry
  appears.
- The JS heap matches the untextured 10k model: decoded images and GPU textures are not counted in the JS heap, so
  these numbers don't measure texture memory.
- The checkerboard compresses well, so these files are much smaller than a photo of the same size. Decode time for a
  photo PNG will be higher.

### Import of large meshes (`import-*`)

**Method.** The mesh is a height field on a 10 cm grid with smooth waves, so no two neighboring triangles are
coplanar. It is generated in the test and imported without the worker, the way the app does:
1. `parseImportFiles`, which runs in the io worker in the app.
2. `insertImportedScene` into a new model, with Merge coplanar faces on, as the Import dialog defaults.

Retained memory is measured with both the parsed scene and the model still alive.

| File | Size | Triangles in | Faces out | Parse | Insert into the kernel | Retained heap / array buffers |
|---|---|---|---|---|---|---|
| Binary STL | 4.8 MB | 100,352 | 100,338 | 27 ms | 11.1 s | 284 MB / 8 MB |
| Binary STL (at the limit) | 11.9 MB | 249,218 | 249,177 | 64 ms | 28.7 s | 697 MB / 21 MB |
| GLB, one indexed mesh (at the limit) | 4.3 MB | 249,218 | 249,177 | 23 ms | 26.1 s | 676 MB / 7 MB |
| Binary STL, 1 million triangles | 47.8 MB | 1,002,528 | — | refused in 12 ms | not run | — |

- **The import limit.** `DEFAULT_IMPORT_LIMITS.maxTriangles` is 250,000. The 1M-triangle STL is refused from its
  header in 12 ms, before parsing.
  - With the limit raised to 2M, parsing alone takes 187 ms and holds 84 MB of typed arrays
    (`import-stl-1000000.json`).
  - Inserting it into the kernel was attempted once and aborted the Vitest worker when the V8 heap ran out, so it is
    not measured. The benchmark now stops after parsing.
- **Insertion dominates import time.** Parsing is under 0.3% of the total. Before the Phase 10 optimization below,
  insertion cost about 110 µs and 2.8 KB of heap per triangle, roughly linearly, and about the same for STL and GLB.
  A file at the limit took about half a minute and 700 MB, the slowest workload measured.
- The few faces fewer than triangles come from pairs that Merge coplanar faces joined where the waves are nearly
  flat.

#### Phase 10 optimization: building imported meshes directly

**Measured cause.** CPU profiles of the 100k-triangle STL import (bundled with esbuild, `node --cpu-prof`) showed
no single hotspot. Every triangle took the full sticky-geometry path: its edges were inserted with intersection
checks, then its face was settled with plane resolution (`settleRegion` → `resolvePlane`, about 9%). On top of that,
spatial-index maintenance took about 13%, welding with string cell keys about 14%, and garbage collection about 8%.

**Changes.**
- **Direct build.** When the target context is empty (imports always create a new group), nothing can interact
  with the new geometry except the mesh itself. `insertTriangleMesh` now builds vertices, shared edges and faces
  directly. It then validates that context, and on any problem (self-intersections, overlaps, T-junctions) reverts
  to a transaction savepoint and uses the sticky path as before. The savepoint is `ModelDocument.savepoint()` /
  `revertToSavepoint()`.
- **Numeric keys.** Vertex welding, triangle adjacency and boundary tracing use numeric keys instead of strings.
- **Tests.** `tests/kernel/ops/meshInsert.test.ts` checks that the direct build gives the same faces and areas as
  sticky insertion, that a self-intersecting mesh falls back and stays valid, and that undo restores the document.

| Import | Before (Vitest) | After (Vitest) | After (bundled Node) |
|---|---|---|---|
| Binary STL, 100,352 triangles | 11.1 s | 7.6 s | 2.8 s |
| Binary STL, 249,218 triangles | 28.7 s | 20.6 s | 7.1 s |
| GLB, 249,218 triangles | 26.1 s | 20.4 s | — |

- **Vitest vs bundled.** The Vitest benchmark runs unbundled TypeScript through Vite's transform, which is about
  2.7× slower than the same code bundled. The production app runs bundled code, so the bundled Node column is
  closer to what users see. The bundled script is the same workload (`parseImportFiles`, then
  `insertImportedScene`) bundled with esbuild and run in Node 25.5.
- **Same result.** Faces out are identical before and after (100,338 and 249,177).
- **Memory is unchanged.** Retained heap is about 670 MB at the limit, about 2.7 KB per triangle. Most of it is
  kernel entity records and the spatial index; reducing it needs a more compact store, not faster insertion.
- **Still slow at the limit.** Insertion runs on the main thread, so a 250k-triangle import still blocks the
  interface for several seconds in the app.

### Export (`export-100000`)

`exportModel` of the whole 100k-entity grid (23,082 faces, 46,164 triangles) with Z-up to Y-up on, in memory.

| Format | Time | Output |
|---|---|---|
| STL (binary) | 122 ms | 2.2 MB |
| OBJ + MTL | 320 ms | 3.7 MB |
| GLB | 76 ms | 2.6 MB |
| glTF (embedded buffer) | 142 ms | 3.5 MB |

- All formats export a 100k-entity model in well under half a second. OBJ is the slowest because it formats every
  number as text.

### Memory while rendering (`render-orbit-*`)

**Method.** JS heap is `JSHeapUsedSize` from the Chrome DevTools Protocol (`Performance.getMetrics`) after
`HeapProfiler.collectGarbage`. This is **Chromium only**, and it excludes GPU buffers, textures and decoded images.
The empty app uses 5.5 MB.

| Model | Load (this run) | JS heap after load | After 120 orbit frames | Median FPS |
|---|---|---|---|---|
| 1,014 entities | 32 ms | 6.9 MB | 7.4 MB | 60 |
| 10,010 entities | 110 ms | 10.8 MB | 11.3 MB | 60 |
| 100,022 entities | 645 ms | 48.2 MB | 48.6 MB | 60 |

- Orbiting doesn't grow the heap: +0.4–0.5 MB over 120 frames at every size.
- The app uses about 0.43 KB of JS heap per entity. The Node benchmark measures 0.8 KB for the decoded model alone;
  the difference is between V8 builds and measurement methods, so compare numbers only within one table.

### Geometry update in the app (`render-update-*`)

**Method.** Select All, then `editor.flipSelection('x')` (Flip Along X) on everything, three times in a row.
- *Edit* is the synchronous kernel transaction.
- *Until rendered* is measured in a `requestAnimationFrame` callback registered after the edit. That callback runs
  after the viewport's render for the change.

The medians include the first run, which is slower while the code warms up.

| Model | Selected (faces + edges) | Edit (median) | Until rendered (median) | JS heap after 3 flips |
|---|---|---|---|---|
| 1,014 entities | 702 | 9.4 ms | 19.1 ms | 8.8 MB |
| 10,010 entities | 6,930 | 64.6 ms | 81.4 ms | 17.1 MB |
| 100,022 entities | 69,246 | 669 ms | 858 ms | 99.3 MB |

- The edit scales linearly, at about 9.5 µs per selected entity. Rebuilding and drawing the changed geometry adds
  10–190 ms.
- At 10k entities, transforming the whole model takes 81 ms, about 5 frames. At 100k it takes 0.86 s, a visible
  pause.
- The heap after the flips includes the undo history of three transactions.

### Kernel benchmarks in this run

`npm run bench` also reran the Phase 2 kernel benchmarks, all within their ±10% single-sample noise:
- `draw-rectangles-1000`: 6.9 ms
- `draw-rectangles-10000`: 84 ms
- `draw-rectangles-100000`: 1.05 s
- `draw-line-grid`: 160 ms
- `validate-10000`: 24.1 ms
- `snapshot-restore-10000`: 62.5 ms

## Not measured yet

- Kernel insertion of imports above the 250,000-triangle limit. It ran out of V8 heap in the Node worker before the
  Phase 10 optimization; memory per triangle is unchanged, so the limit stays.
- Import insertion off the main thread: a file at the limit still blocks the interface for several seconds.
- Import and export in the running app: the io worker round trip, file picker and download, and the import dialog.
- Real photographic textures, whose PNG or JPEG decode is slower than the generated checkerboard's. Also GPU memory
  and decoded-image memory, which the JS heap metric doesn't include.
- Memory in browsers other than Chromium (the CDP heap metric is Chromium only), and total process or GPU memory.
- Push/pull and move timings through the tools; only Flip through the editor API is measured.
- Autosave and IndexedDB recovery writes, and saving through the File System Access API.
- Heavier render styles (profiles, back edges, shadows, X-ray) and models larger than 100k entities.
- Headroom above 60 FPS: `requestAnimationFrame` caps every frame-rate measurement.
