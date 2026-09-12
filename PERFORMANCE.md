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

## Not measured yet

Rendering frame rate, memory, texture and import/export workloads need the viewport and file pipeline. They are
added to this file as those phases land, following the plan in TESTING.md.
