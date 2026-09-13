# Planar Geometry Kernel

The kernel lives in `src/kernel/`. It is pure TypeScript with no dependency on three.js, React, the DOM, or Node, so
the same code runs on the main thread, in workers, and in Node tests. The expected topology results for common
scenarios are tabulated in [docs/BEHAVIOR_MATRIX.md](docs/BEHAVIOR_MATRIX.md).

## Tolerances

Every tolerance value and tolerance predicate is defined in `src/kernel/tolerance.ts`. Literal epsilons anywhere else
are a code-review defect.

| Constant | Value | Meaning |
|---|---|---|
| `EPS_LEN` | 1e-6 m | Points closer than this are the same point. Also used for point-on-edge and point-on-plane tests. |
| `EPS_PARALLEL` | 1e-7 | Two unit directions are parallel when the sine of the angle between them is below this. |
| `EPS_UNIT_LENGTH` | 1e-9 | A stored unit direction (such as a guide line's) may differ from length 1 by at most this. |
| `SMALL_EDGE_WARNING_LEN` | 1e-5 m | Edges shorter than this are allowed, but the user is warned. |

**Why these values**

- **Precision at scale.** Float64 resolves about 2e-12 m at 10 km. What causes trouble is ill-conditioned
  constructions, such as intersecting nearly parallel lines, which amplify error. One consistent tolerance, plus
  exact orientation predicates for topology decisions, keeps the model consistent.
- **Coplanarity.** A point is coplanar with a face when its distance to the face's plane is at most `EPS_LEN`. We never
  test coplanarity by comparing normal angles, because angle error means very different vertex deviations on a 1 mm
  face and a 100 m face.
- **Face planes.** A face's plane is computed with Newell's method over its outer loop.
- **Angle tests.** Angle tolerances are used only for "parallel" and "perpendicular" questions: axis inference,
  Push/Pull mode selection, and push direction.

## Identifiers

- Every entity id is a document-global integer that increases monotonically and is never reused.
- The id counter only moves forward; undo does not roll it back.
- Selection, scenes, dimensions and history records all refer to entities by id across contexts.

## Topology: radial-edge-lite

Each component definition, including the model root, is its own **context** with its own `EntityStore`.

```ts
Vertex { id, position: Vec3 }
Edge   { id, v0, v1, faces: FaceId[], curveId?, soft, smooth, hidden, materialId?, tagId }
Face   { id, outer: Loop, inners: Loop[], plane, frontMaterialId?, backMaterialId?, frontUv, backUv, tagId }
Loop   = Array<{ edge: EdgeId, reversed: boolean }>
Curve  { id, kind: 'arc' | 'circle' | 'polygon' | 'polyline', params, edgeIds: EdgeId[] }
```

- **Loose and non-manifold edges.** An edge knows its faces as a small array. It can have zero faces (a loose edge),
  one or two (manifold), or more (for example, a fin standing on a box). A half-edge structure can't represent loose
  edges or fins cleanly.
- **Faces.** A face is a planar polygon with one outer loop and zero or more inner loops (holes).
- **Adjacency.** Each vertex's list of edges is maintained incrementally.
- **Surfaces** are not stored. A surface is a connected set of faces joined by soft edges, derived on demand.
- **Dangling edges** that lie on a face's plane but don't close a region are ordinary loose edges. They are found by
  spatial query when needed.
- **Curves** keep their parameters (center, radius, start and end angle, segment count) so they can be edited later.
  Splitting a curve edge calls a curve hook: an arc splits into two arcs, and a polygon downgrades to a polyline.
- **Radial ordering** of faces around an edge is computed on demand, not stored. It is needed for solid detection,
  outer shell, and intersection.

## Invariants

`src/kernel/store/validate.ts` checks these after every transaction in development and test builds, and before
saving:

1. Every referenced id exists: edge → vertices, loop → edges, edge → faces, face → materials and tags, curve → edges.
2. No edge has `v0 === v1`, and every edge is at least `EPS_LEN` long.
3. At most one edge joins any unordered pair of vertices in a context.
4. No two vertices in a context are within `EPS_LEN` of each other.
5. No vertex lies within `EPS_LEN` of the interior of an edge it doesn't belong to (no T-junctions).
6. Edges in a context don't cross or overlap except at shared vertices.
7. Each vertex's edge adjacency is exactly the set of edges that reference that vertex.
8. A face is in `edge.faces` if and only if the edge appears in one of that face's loops. An edge appears at most once
   across all loops of one face.
9. Loops are closed: each edge use ends at the vertex where the next one starts, taking `reversed` into account. Every
   loop has at least 3 edges.
10. Each loop is simple: no vertex repeats within a loop. Different loops of the same face may touch at a single
    vertex (for example, a hole whose corner touches the outer boundary), but never share an edge.
11. Every vertex of a face lies within `EPS_LEN` of the face's plane.
12. The outer loop is counter-clockwise around the face normal (positive signed area), and inner loops are clockwise.
13. Inner loops lie inside the outer loop and do not overlap or nest. They may touch the outer loop or each other at
    single vertices.
14. No two faces in a context cover overlapping regions of the same plane.
15. A curve's edges form one connected, ordered chain, and each of those edges' `curveId` points back to the curve.
16. Every entity a primitive touched is in the dirty set, which means rebuilding all caches from scratch produces
    identical results.
17. Undo restores the store hash from before the transaction, and redo restores the hash from after it.

## Mutation primitives

Only these primitives may mutate an `EntityStore`. Each one records forward and inverse data in the active transaction
and adds the ids it touched to the dirty set.

`addVertex`, `removeVertex`, `setVertexPosition`, `addEdge`, `removeEdge`, `splitEdge`, `addFace`, `removeFace`,
`setFaceLoops`, `setEdgeFlags`, `setFaceAttributes`, `addCurve`, `removeCurve`, `setCurveEdges`, `addInstance`,
`removeInstance`, `setInstanceAttributes`, `addGuideLine`, `addGuidePoint`, `removeGuide`, `setGuideAttributes`, plus
bulk variants that take typed-array payloads for imports.

Higher-level operations (`src/kernel/ops/`) are built only from primitives.

## Algorithm: insertSegments

This implements "sticky geometry": auto-split, auto-face, face split, and holes. Its input is a list of 3D segments
for the active context, plus options such as `autoFace`.

1. **Resolve endpoints.** Weld each endpoint to an existing vertex (vertex hash grid, cell size `2·EPS_LEN`, nearest
   match, never transitive). If there is none within tolerance, record a split on the edge whose interior the point
   lies on. If it lies within `EPS_LEN` of a face and inside it, project it exactly onto that face's plane.
2. **Broad phase.** Query the AABB tree for existing edges whose bounding boxes, inflated by `EPS_LEN`, overlap each new
   segment. Also test the new segments against each other.
3. **Narrow phase.** Compute the closest points between the two lines.
   - Parallel and within `EPS_LEN`: record collinear overlap endpoints as splits on both edges.
   - Otherwise: if the closest distance is at most `EPS_LEN` and both parameters are within the segments (allowing a
     tolerance margin), record the intersection. Snap it to an endpoint if it is within `EPS_LEN` of one.
   - Crossing a face's interior out of plane does **not** split the face. That only happens through Intersect Faces.
4. **Apply splits.** Sort and deduplicate the split parameters per edge, call `splitEdge` (which is curve-aware), cut
   the new segments into sub-edges, and skip any sub-edge that already exists.
5. **Collect candidate planes.**
   - Planes of existing faces that contain a new edge.
   - Planes spanned by each new edge and each non-collinear edge at one of its endpoints.
   - Deduplicate by (normal up to sign, offset).
6. **Build a local planar graph per plane.** Starting from the new edges, walk connected edges that lie in the plane,
   and add the full loops of any faces being split. When splitting an existing face, limit the search to the face's
   bounding box. Project to a 2D orthonormal basis of the plane, reusing the face's basis when splitting so orientation
   carries over.
7. **Embed.** Sort outgoing half-edges at each vertex by angle, using a quadrant test followed by the exact `orient2d`
   predicate (`robust-predicates`); never `atan2` ties. Link `next(h)` to the twin of `h` rotated one step clockwise
   around its destination, then trace the cycles.
8. **Prune.** An edge whose two half-edges lie on the same cycle is a spur or a bridge. Remove it from the embedding
   and re-trace; it stays a loose edge in the model. Repeat until nothing changes.
9. **Classify cycles.**
   - A traced cycle that passes through the same vertex twice (a region pinched at a vertex) is first split there
     into simple loops. A pinched region boundary yields one counter-clockwise outer loop plus clockwise loops that
     are holes touching it; a pinched component outline yields several clockwise loops.
   - A positive signed area is a region boundary. A negative one is the outside of a connected component and becomes
     a hole candidate, assigned to the smallest positive cycle from another component that contains a point strictly
     inside it (exact point-in-polygon test).
10. **Decide faces.** Pick a sample point strictly inside each region (the centroid of its largest triangle).
    - If an existing face covers the sample and has identical loops: leave it unchanged.
    - If an existing face covers the sample but its loops differ: **split** it. The largest region keeps the face's id,
      materials and UVs; the other regions become new faces with copied attributes.
    - If no face covers the sample and `autoFace` is set: create a face.
    - A closed loop inside a face produces a hole in that face plus a new inner face.
11. **Orient new faces.**
    - A face that shares an edge with an existing face is oriented so the shared edge is used in opposite directions.
    - Otherwise, a face on the ground plane (z within `EPS_LEN` of 0) gets a −Z normal, so its back side faces up, as
      in the reference workflows.
    - Otherwise, the normal points away from the camera view direction.
12. **Validate** in development and test builds, and emit the dirty sets.

## Algorithm: erase and heal

**Erasing edge E, with faces `F = E.faces`:**

- **Heal.** If `|F| = 2`, both faces are coplanar with the same normal, and removing E still leaves valid cycles: run
  steps 6–10 of insertSegments on that plane with E excluded and `autoFace` off. The merged face keeps the larger
  face's id.
- **Otherwise,** remove every face in F, then remove E.
- **Vertices.** A vertex left with no edges is removed. Vertices with two edges stay, so previously split edges remain
  split.

**Delete versus Eraser.** The Delete command can remove faces directly. The Eraser tool works only on edges, guides,
and other non-face entities.

## Algorithm: Push/Pull

Push/Pull applies to a planar face F. Let `n` be F's normal and `d` the signed distance.

1. **Choose the mode.** A vertex u of F is *movable* if every face at u other than F contains the direction `n` (that
   is, is perpendicular to F) and is not coplanar with F.
   - **Stretch:** used when Ctrl is not held, every loop vertex is movable, and F has at least one neighbor face.
   - **Extrude:** used in every other case.
2. **Stretch.** Move all of F's vertices by `d·n`. If a neighbor face would collapse, run the imprint step.
3. **Extrude.**
   - Create offset vertices and an offset face F′ that copies F's attributes.
   - Create one side quad per loop edge, with its winding chosen by the sign of `d`.
   - Side edges that come from curve edges are marked soft and smooth.
   - What happens to F depends on the case:
     - **Ctrl held:** F is kept.
     - **F has no neighbors:** F is kept, flipped, as the base of a closed shell.
     - **F has neighbors (the "frame remains" case):** F is removed and F′ takes over its id.
4. **Imprint (on commit only).** For F′ and each side face, find existing faces in the same plane whose bounding boxes
   overlap. Imprint the boundaries in both directions with insertSegments (`autoFace` off). Then compare coincident
   regions:
   - **Opposite normals:** remove both regions. This is the through-cut, leaving a hole.
   - **Same normals:** heal the two regions into one.
5. **Clean up.** Remove edges that this operation created and that are left with no faces. Then validate.

**Behavior during interaction**

- **Preview.** The drag preview runs steps 1–3 in a speculative transaction and skips imprinting.
- **Snapping.** Inference snaps the distance to existing geometry, so flush positions are exact.
- **Repeat.** Double-clicking reuses the last distance.

Rows marked ⚑ in the behavior matrix are cases where the reference behavior is unclear and must be confirmed before
this tool is marked done.

## Other operations

This section is expanded as each operation is implemented.

- **Move, stretch, autofold.** Selected vertices move together with their connected closure. After the move, any
  non-planar face is creased into planar triangles, with the fold edge placed to avoid the moved vertices. At commit,
  moved geometry is imprinted and healed against its surroundings.
- **Offset.** Each loop is offset in the face's 2D basis using miter joins. Arcs are offset analytically. Overlaps are
  removed by inserting the result into the same planar arrangement engine and keeping regions by winding number, so no
  Clipper dependency is needed.
- **Follow Me.** The profile is propagated through miter planes along the path, with stitching for closed paths and
  lathe paths. Edges along a curve path are softened.
- **Intersect Faces.** For each pair of non-parallel faces, intersect the two planes, clip the resulting line against
  both polygons, intersect the two sets of intervals, and insert the segments with insertSegments. Section fill and the
  Split tool reuse this.
- **Solid tools.**
  - Check that the input is a valid solid: every edge has exactly two faces and orientation is consistent.
  - Triangulate, keeping each triangle's source face id.
  - Run the operation with manifold-3d in a worker.
  - Group coplanar triangles by source face, extract their boundaries, and rebuild faces with insertSegments.
  - Restore materials and soft-edge flags.
- **Triangulation.** earcut on loops projected to 2D, with a check that triangle areas sum to the polygon area. On
  failure, fall back to ear clipping with exact predicates and log a diagnostic.
