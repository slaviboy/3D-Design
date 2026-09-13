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
| `EPS_MESH_SNAP` | 1e-4 m | A vertex coming back from a triangle mesh (a boolean result, computed in single precision) is snapped back onto its source face planes if it lies within this distance of them. |

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
Annotation { id, geometry: linear-dimension(start, end, offset) | radial-dimension(curve, diameter, labelPoint)
             | leader-text(target, offset) | screen-text(x, y), text, hidden, tagId }
```

- **Loose and non-manifold edges.** An edge knows its faces as a small array. It can have zero faces (a loose edge),
  one or two (manifold), or more (for example, a fin standing on a box). A half-edge structure can't represent loose
  edges or fins cleanly.
- **Faces.** A face is a planar polygon with one outer loop and zero or more inner loops (holes).
- **Adjacency.** Each vertex's list of edges is maintained incrementally.
- **Surfaces** are not stored. A surface is a connected set of faces joined by soft edges, derived on demand.
- **Annotations** (dimensions and text) never take part in topology. A dimension anchor stores a point and,
  optionally, a vertex id: while that vertex exists the anchor follows it, and afterwards the stored point is used.
  Radial dimensions follow their curve and show "?" once it is gone.
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

## Algorithm: Offset

`offsetFace(doc, context, face, d, { keepOverlaps })` offsets every loop of a face within its plane.
`offsetEdges(doc, context, edges, d, normal)` offsets one connected, coplanar chain of edges, open or closed. Both
return `{ edges, faces }`: the edges that carry the offset, and the faces it created.

**Sign conventions**

- **Face:** a positive `d` moves toward the face's interior, so the outer loop shrinks and holes grow. A negative `d`
  moves away from it.
- **Edges:** the chain is walked from the first listed edge's `v0` to its `v1`. Looking against `normal` (from its
  tip down onto the plane), a positive `d` moves to the left of that walking direction. For a chain that runs
  counter-clockwise in that view, positive is inward.

**Steps**

1. **Project.** Face loops are projected into the face's own basis, where the outer loop is counter-clockwise and
   holes are clockwise, so the face always lies to the left of every loop. A chain is projected into the basis of
   `normal`. Refused: a distance that is not finite or not longer than `EPS_LEN`, a chain that branches or is
   disconnected, and a chain with a vertex farther than `EPS_LEN` from the plane.
2. **Offset lines.**
   - A straight edge shifts by `d` along its left normal.
   - An edge of an arc or circle curve moves radially instead, to the circle with the same center and radius
     `r − d` (or `r + d` when the center is to the right of the edge). This only applies when the curve's
     parameters still fit the edge: normal parallel to the plane, center on it, and both endpoints within `EPS_LEN`
     of the radius. If the new radius would not be longer than `EPS_LEN`, the edge shifts straight instead.
   - Polygon and polyline edges are straight edges.
3. **Miter joins.** Consecutive offset lines are intersected. Parallel lines (from collinear edges) meet at the start
   of the second one. The ends of an open chain are offset perpendicular to their edge, with no end caps.
4. **Split.** The mitered segments are cut where they cross or collinearly overlap each other. They are also cut
   where they enter or leave the *clearance capsule* of each source edge: the set of points closer to the edge than
   that edge's own offset distance (minus `EPS_LEN`). Pieces not longer than `EPS_LEN` are dropped.
5. **Keep.**
   - **Clearance.** The midpoint of a kept piece is at least the offset distance (minus `EPS_LEN`) away from every
     source edge. Pieces that came closer belong to an overlap, an inverted part or a collapsed part. This rule is
     what catches a convex loop pushed past its center: that loop is point-reflected, so its winding does not change.
   - **Winding (closed loops only).** Sample points `EPS_LEN / 2` to either side of the piece's midpoint are
     classified by their total winding number over all offset loops, using exact orientation tests. A piece is kept
     when exactly one side has winding ≥ 1. This drops swallowtails and merges overlaps. For a closed chain that runs
     clockwise, the winding is negated first.
   - **`keepOverlaps` (faces only).** Neither rule is applied, and every mitered segment is inserted as it is. The
     only exception is a loop in which no segment clears its own source loop: that loop inverted or collapsed as a
     whole and is dropped.
   - If nothing is kept, the operation is refused with `KernelError` and the document is unchanged.
6. **Insert** the pieces with insertSegments (`autoFace: true`). An inward offset splits the face into a ring and an
   inner face; the largest region keeps the face's id. An outward offset closes a new ring face, which is oriented
   from the edges it shares with the original face.
7. **Rebuild curves.** Consecutive surviving pieces that came from one arc or circle become a curve entity. The curve
   keeps the source parameters with the new radius (so also the same segment count) when all of these hold: every
   chord survived whole as one edge, the run covers the whole source curve, and its ends were not mitered. Otherwise
   it becomes a polyline. Straight edges get no curve.

**Limitations**

- Miter joins have no limit, so very sharp corners produce long spikes.
- Open chains get no round end caps; the trimmed offset simply stops where it enters another edge's capsule.
- A near-coincident pair of offset segments closer than `EPS_LEN / 2` (but not collinear within `EPS_LEN`) can be
  misclassified by the winding probe.
- Pairwise intersection is O(n²) in the number of loop edges.
- No Clipper dependency is needed.

## Algorithm: Divide, Weld and Explode Curve

- **`divideEdge(doc, context, edge, n)`** returns the edges that replace the edge, in chain order. `n` must be a
  whole number from 2 to `MAX_CURVE_SEGMENTS` (999), and each part must be longer than `EPS_LEN`.
  - **Re-dividing an arc or circle.** Suppose the edge belongs to an arc or circle whose edge count equals its
    `segments` parameter, whose vertices all lie on the circle (arc ends at the parameter angles), and whose inner
    vertices join only curve edges. Then the whole curve is re-divided:
    1. New points are generated from the parameters with `n` segments. They are oriented like the old chain: arcs by
       their start point, circles by their turning direction around the curve normal.
    2. Old vertices at new positions are reused (always the arc ends).
    3. Every face loop that used the chain gets the new chain in the same direction of travel. Faces keep their ids.
    4. The curve keeps its id and parameters, with `segments = n`.
    5. Old edges and vertices are removed.

    The operation is refused if a new chord would touch any other edge.
  - **Any other edge** is split with `splitEdge` at `i/n` along its length. A circle, arc or polygon curve that the
    edge belongs to becomes a polyline, because its parameters no longer describe its edges. This includes a
    cylinder's rim, whose vertices also carry the side edges.
- **`weldEdges(doc, context, edges)`** turns a connected, simple chain of at least two edges, open or closed, into one
  polyline curve and returns its id.
  - The chain is ordered by walking from the first listed edge's `v0`. Branches, gaps and single edges are refused.
  - Edges may already belong to curves only if every edge of those curves is selected. Those curves are removed and
    merged. A selection that is exactly one existing curve returns that curve unchanged.
  - Welding needs no coplanarity, because polylines may be 3D.
- **`explodeCurve(doc, context, curve)`** removes the curve entity. Its edges, and their flags, stay.

## Algorithm: Soften by angle

`softenEdgesByAngle(doc, context, edges, { maxAngleRadians, softenCoplanar, smooth })` returns the number of edges
whose flags changed. A call that changes nothing creates no history entry. `maxAngleRadians` must lie in [0, π].

1. **Measure.** Only an edge with exactly two faces has an angle.
   - Consistently oriented faces traverse their shared edge in opposite directions. If both traverse it in the same
     direction, the second normal is flipped first, so the angle measures the fold rather than an orientation
     mismatch.
   - The angle is `atan2(|n₁ × n₂|, n₁ · n₂)`: 0 for a flat pair, π/2 for a box edge.
   - The pair is **coplanar** when the normals point the same way and every vertex of each face lies within `EPS_LEN`
     of the other face's plane. Coplanarity is never decided by the angle.
2. **Decide.**
   - A coplanar pair is softened only with `softenCoplanar`.
   - Any other pair is softened when its angle is at most `maxAngleRadians`.
   - A softened edge becomes `soft = true`, `smooth = smooth`.
   - Every other listed edge, including edges with zero, one or three or more faces, becomes
     `soft = false, smooth = false`.

## Algorithm: Intersect Faces

`intersectFaces(doc, context, faceIds, { with })` in `src/kernel/ops/intersect.ts`. The faces don't need to form solids.

1. **Collect polygons.** The given faces of the context are the *selected* polygons. The *other* polygons are:
   - `with: 'selection'`: the selected polygons themselves;
   - `with: 'model'`: every other face of the context, plus the faces of every group and component inside it at any
     depth, with their loops transformed into context coordinates. Those instances are read, never changed.
2. **Pair up.** Each selected polygon is paired with each other polygon whose bounding box, inflated by `EPS_LEN`,
   overlaps its own. A pair of context faces is visited once.
3. **Intersect the planes.** The line direction is `u = n₁ × n₂`. When `|u|` is within `EPS_PARALLEL` the planes are
   parallel, and coplanar or parallel pairs produce nothing. Otherwise the line passes through
   `(d₁ (n₂ × u) + d₂ (u × n₁)) / |u|²`.
4. **Clip against each polygon, holes included.** Project the line and every loop into the polygon's 2D basis.
   - Each loop edge whose endpoints lie strictly on opposite sides of the line contributes its crossing parameter.
   - An endpoint within `EPS_LEN` of the line contributes its own parameter.
   - Sort the parameters and merge any closer than `EPS_LEN`.
   - Between each consecutive pair, classify the midpoint with the exact point-in-polygon test. Inside or boundary
     keeps the interval; adjacent kept intervals merge.
5. **Overlap.** Intersect the two interval sets. Every overlap longer than `EPS_LEN` is a segment.
6. **Insert.** All segments go through insertSegments with `autoFace` on, in one transaction. Each segment lies in the
   planes of both faces it came from, so candidate-plane collection (insertSegments step 5) splits both. Existing edges
   the line runs along are reused, so touching faces add nothing. The created edges are returned. When there are no
   segments, nothing is recorded in history.

## Algorithm: Follow Me

`followMe(doc, context, profileFaceId, pathEdgeIds)` in `src/kernel/ops/followMe.ts`.

1. **Order the path.** Path edges that belong to the profile are ignored. The remaining edges must form one chain, open
   (two ends) or closed (no ends, at least three edges). A vertex with three or more path edges is a branch, and a chain
   that doesn't reach every edge is disconnected. Both are refused with `KernelError`.
2. **Start at the profile.**
   - Open path: start at the end nearer the profile's centroid.
   - Closed path: start at the path vertex nearest the centroid, and run in the direction whose first segment is more
     nearly perpendicular to the profile.
   - If the first segment direction `d₀` is parallel to the profile plane (`|n·d₀|` within `EPS_PARALLEL`), refuse.
3. **Miter planes.** At interior path vertex *i* the plane passes through the vertex, with normal
   `normalize(dᵢ₋₁ + dᵢ)`: the bisector of the joint. At the end of an open path the normal is the last direction.
   A joint that turns straight back is refused.
4. **Profile copies.**
   - Copy 0 is the profile itself for an open path. For a closed path it is the profile slid along `d₀` onto the miter
     plane at the start.
   - Copy *i + 1* is copy *i* with every point slid along `dᵢ` onto the next miter plane: `q + t·dᵢ`, with `t` chosen to
     land on the plane.
   - Sliding keeps each cross-section perpendicular to its segment, so a closed planar path returns exactly to copy 0,
     and a regular polygon path gives an exact rotation (a lathe).
5. **Faces.**
   - Each loop edge `a → b` of the profile, together with its copy on the next ring, makes a four-sided side face
     `a, b, b′, a′`. It is planar because both new points moved along the same direction. Coincident points collapse,
     so a profile point on the axis gives triangles.
   - Open paths add caps: the start cap (the original face) and an end cap.
   - Closed paths wrap the last ring back to copy 0 and remove the original face, along with its boundary edges that
     are left with no faces, before inserting.
6. **Orientation.** The planned faces enclose a closed shell. If its signed volume, `⅓ Σ A·p` over all loops, is
   negative, every loop is reversed. For an open path, the original face is reversed first if it faces into the sweep.
7. **Soft edges.**
   - A ring at a path vertex is soft and smooth when the two path edges meeting there belong to the same curve.
   - A longitudinal edge is soft and smooth when the two profile edges meeting at its profile point belong to the same
     curve.
8. **Insert.** Rings and longitudinal segments go through insertSegments with `autoFace` off. Every planned face is
   then settled with `settleRegion` (rule `merge`) and the profile's attributes, all in one transaction.
9. **Known limit.** A closed path that isn't planar twists the profile, so the last band isn't planar. The transaction
   then fails validation and rolls back.

## Algorithm: solid detection

`isSolid(store)` in `src/kernel/ops/solids/solid.ts` is true when all of these hold:

- the definition has at least one face and no nested groups or components;
- every edge bounds exactly two faces, so there are no loose edges, no open borders and no fins;
- the two faces at each edge traverse it in opposite directions (consistent orientation).

`solidVolume(store)` sums `a · ((b − a) × (c − a)) / 6` over the triangles of every face (the divergence theorem). It
is positive when the faces point outward. Entity Info shows "Solid Group" or "Solid Component" with the absolute
volume, scaled by the instance transform's determinant.

## Algorithm: mesh round trip

`src/kernel/ops/solids/mesh.ts` moves solids between the kernel and triangle meshes, as the solid tools need.

1. **To a mesh.** `toTriangleMesh(store, transform)` triangulates each face (`triangulateFace`) into one indexed mesh,
   sharing vertices. Each triangle records its source face id. Under a mirroring transform the winding is swapped so
   triangles still face outward. `faceProvenance(store, transform)` records each face's transformed plane and
   attributes. The solid tools rekey the face ids per input, so two instances of one component stay distinct.
2. **Booleans** (`src/workers/manifoldBoolean.ts`, run in `boolean.worker`).
   - The meshes are centered at the origin and converted to single precision.
   - Each triangle's face key is passed as manifold-3d's `faceID`, which survives the operation.
   - Union, difference, intersection, or split (intersection, A − B, B − A) runs, and the results are shifted back.
3. **From a mesh.** `insertTriangleMesh(doc, context, mesh, provenance)`:
   1. Weld vertices within `EPS_LEN` and drop degenerate triangles.
   2. A triangle whose corners all lie within `EPS_MESH_SNAP` of its source face plane uses that plane.
   3. Each vertex moves to the least-squares point of the distinct source planes around it: onto a single plane, onto
      the line where two meet, or to the corner of three or more. A tiny pull toward the original position keeps the
      system well posed. The move is kept only if it is within `EPS_MESH_SNAP`.
   4. Union-find merges triangles across each two-triangle edge when they face the same way, have identical
      attributes, and are coplanar: they share a source face, or each triangle's corners lie within `EPS_LEN` of the
      other's plane.
   5. Each group's boundary is the directed edges whose reverse isn't in the group; they are traced into loops. The
      edges shared by coplanar triangles are dropped.
   6. A boundary vertex is dropped from its loops when exactly two boundary edges meet there and they are collinear,
      so no face needs it as a corner.
   7. Loops with positive area in the group's plane basis are outlines. Holes go to the smallest outline containing
      them.
   8. All loop segments go through insertSegments with `autoFace` off. Each outline is settled with `settleRegion`
      (rule `merge`), facing the group's normal, with the source face's attributes: front and back materials, tag and
      hidden flag.
4. **Guarantee.** Faces → mesh → faces gives back the same V/E/F counts for planar-faced solids (behavior matrix H10).

## Other operations

This section is expanded as each operation is implemented.

- **Move, rotate, scale, flip, autofold.** All of these go through `transformEntities` with an affine `Mat4`.
  - **Refusal.** A transform that is not finite or has a singular linear part (a scale factor of 0) is refused before
    anything changes.
  - **Detached geometry and copies** are captured as a fragment and inserted again. Face normals are carried by the
    inverse transpose, so faces stay outward even under a mirror (determinant < 0). Circular curve parameters survive
    similarity transforms, and non-uniform scaling turns them into polylines.
  - **Connected geometry** is moved in place, and so is its connected closure.
    - After the move, any non-planar four-sided face is creased into planar triangles, with the fold edge placed to
      avoid the moved vertices. Any other bent face, or any bend when autofold is off, is refused.
    - Under a mirror, every face loop whose vertices all moved is reversed. Otherwise those faces would turn inside
      out, and a hole would wind like an outline.
    - Rotating a box's top face about one of its own edges keeps every side face planar, so it needs no fold. A twist
      about a perpendicular axis does fold the sides.
  - **Instances** only get the composed transform. A flipped instance has a negative determinant.
  - **At commit,** moved geometry is imprinted and healed against its surroundings.
- **Follow Me, Intersect Faces, solids.** See the algorithm sections above.
- **Solid tools** (`src/app/solids/solidTools.ts`).
  - Every selected group or component must pass `isSolid`; otherwise the tool refuses with a message.
  - Each input is meshed in context coordinates, and meshes enclosing negative volume are reversed.
  - The boolean runs in `boolean.worker`: Outer Shell and Union take the union of all inputs, Intersect the
    intersection, Subtract and Trim the second input minus the first, and Split three results.
  - The inputs are replaced by new groups rebuilt with `insertTriangleMesh`, in one undoable transaction. Subtract
    deletes the cutter and Trim keeps it.
  - Soft-edge flags are not restored yet.
- **Triangulation.** earcut on loops projected to 2D, with a check that triangle areas sum to the polygon area. On
  failure, fall back to ear clipping with exact predicates and log a diagnostic.
