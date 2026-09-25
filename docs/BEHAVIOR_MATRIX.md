# Planar — Behavior Matrix

This file lists the scenarios that turn the modeling behaviors described in the reference docs into exact
**topology outcomes**. Each row becomes a Vitest fixture in `tests/kernel/behavior/*.test.ts` before the operation
it covers is written. Every scenario checks four things:

1. The counts `V / E / F` in the active context. Loose, non-face edges are included in E.
2. The kernel invariant validator passes.
3. Undo restores the exact store hash from before the operation, and redo restores the hash from after it.
4. Any extra assertion listed in the row: face normals, flags, areas, or which ids are kept.

Units are meters. `R(w,h)` is an axis-aligned rectangle drawn on the ground plane z = 0 with its corner at the origin.
`Box(w,d,h)` means `R(w,d)` push/pulled up by `h`. "Ground face" means a face lying in the plane z = 0.

Rows marked **⚑ verify** are cases where the docs leave the behavior unclear. They record the result we chose, and
the reasoning behind it is in GEOMETRY.md. They must be re-checked against the reference application before the
tool is marked Done.

## A. Edge insertion, auto-split, auto-face

| # | Scenario | Expected V/E/F | Extra assertions |
|---|---|---|---|
| A1 | Line (0,0,0)→(1,0,0) | 2/1/0 | — |
| A2 | Draw 4 lines closing a 1×1 square on ground | 4/4/1 | Face normal −Z (ground faces start back-side-up); area 1 |
| A3 | `R(2,1)` via rectangle tool | 4/4/1 | Same as A2 |
| A4 | A3, then line from midpoint (1,0) to midpoint (1,1) | 6/7/2 | Both faces area 1; larger/first region keeps the original face id and materials |
| A5 | A4, then erase the dividing line | 6/6/1 | Heal: one face area 2; the midpoint vertices stay (edges stay split) |
| A6 | A3, then erase edge (0,0)→(2,0) | 4/3/0 | Face removed with its boundary edge |
| A7 | A6, then redraw the same edge | 4/4/1 | Face re-created |
| A8 | A3, then a dangling line from (1,0) to (1,0.5) | 6/6/1 | Edge is loose on the face; the face is not split |
| A9 | A3, then a 24-segment circle, center (1,0.5), r 0.25 | 28/28/2 | Outer face has 1 inner loop; disc face has none; circle is 1 curve entity |
| A10 | A9, then erase the disc face only (Delete, not Eraser) | 28/28/1 | Hole remains |
| A11 | Two crossing lines (−1,0)→(1,0) and (0,−1)→(0,1) | 5/4/0 | Crossing split at the origin |
| A12 | Edge (0,0)→(2,0), then line (1,0)→(3,0) (collinear overlap) | 4/3/0 | Overlap merged; no duplicate edges |
| A13 | Line identical to an existing edge | unchanged | Operation is a no-op and creates no history entry |
| A14 | Line with length < EPS_LEN | unchanged | Rejected with a user-visible hint; no history entry |
| A15 | Endpoint within EPS_LEN/2 of an existing vertex | welds | No new vertex |
| A16 | T-junction: line ending exactly on the interior of an edge | +1 V split | No vertex lies on an edge interior |
| A17 | `R(1,1)`, then `R(1,1)` offset by (1,0) sharing an edge | 6/7/2 | Shared edge has 2 faces |
| A18 | `R(2,2)`, then a larger `R(4,4)` at (−1,−1) around it | 8/8/2 | Outer ring face has a hole equal to the inner rectangle; inner face unchanged |
| A19 | Vertical rectangle in plane x = 0 sharing a ground edge with A3 | 6/7/2 | Non-coplanar faces share the edge; orientation consistent |
| A20 | Rectangle drawn on a face inside a group, from outside the group context | group unchanged | Isolation: new geometry lives in the root context and does not split the group's face |
| A21 | A3 with all coordinates offset by (10000, 10000, 0) | 4/4/1 | Precision far from the origin |
| A22 | 1e-5 m square | 4/4/1 | Tiny features still form faces |

## B. Push/Pull

| # | Scenario | Expected V/E/F | Extra assertions |
|---|---|---|---|
| B1 | `R(1,1)`, push/pull the face by +1 (toward +Z) | 8/12/6 | Closed shell; all normals outward; volume 1 |
| B2 | B1, then push/pull the top by +0.5 | 8/12/6 | **Stretch**: no new entities; top face keeps its id; height 1.5 |
| B3 | B1, then push/pull the top by −1 (flush with the bottom) | rejected ⚑ verify | Stretching would flatten the side faces, so the operation is refused and the model is unchanged |
| B4 | B1, then `R(0.5,0.5)` centered on the top face | 12/16/7 | Top becomes a ring face with a hole plus an inner face |
| B5 | B4, then pull the inner face +0.2 | 16/24/11 | **Frame remains**; inner face keeps its id at z = 1.2 |
| B6 | B4, then push the inner face −0.3 (pocket) | 16/24/11 | Pocket side normals point into the pocket (outward from the solid) |
| B7 | B4, then push the inner face −1 (through-cut) | 16/24/10 | Inner face and the matching bottom region cancel; bottom has a hole; genus-1 solid |
| B8 | B1, then Ctrl+push/pull the top by +0.5 | 12/20/11 | Original top stays as an internal face; new top face created |
| B9 | 24-segment circle on ground, push/pull +1 | 48/72/26 | 24 vertical edges soft+smooth; top/bottom circles remain curve entities |
| B10 | B1, then double-click Push/Pull on a side face | 8/12/6 | Repeats the last distance (1); neighbors are perpendicular, so it stretches (box width 2) |
| B11 | Push/pull a face in a 1-face context by 0 | unchanged | No-op; no history entry |
| B12 | B1, then push/pull a side face by +0.5 | 8/12/6 | Stretch (neighbors perpendicular) |
| B13 | Sloped neighbor: prism with a triangular cross-section, pull one rectangular face along its normal | +V ⚑ verify | Extrude mode (neighbors not perpendicular); new side faces |
| B14 | Retype the distance `2` right after B1 | 8/12/6 | Single history entry; height 2; same face ids as the original operation |
| B15 | B6, then push the pocket floor −0.7 (to the bottom) | 16/24/10 | The floor stretches onto the bottom and cancels with it: the same hole as B7, no second bottom |
| B16 | B4, then push the inner face −1.2; or B6, then push the floor −0.8 | rejected | Past the far side of the shape ("offset limited"); the model is unchanged. A distance a rounding error short of the far side lands on it |
| B17 | B1, and a unit box floating at z = 2 above it; pull the lower top +1 | 16/24/10 | The top's corners land on the upper box's, so the stretch goes as an extrusion; the faces cancel and the boxes join; the side walls heal into one face each |
| B18 | B1 with a slot marked at its front edge (x 0.25–0.75, y 0–0.5); push the slot −1 | 16/24/10 | Cut through; no edges left bounding nothing across the opening |
| B19 | B18's slot pushed −0.4, then its floor −0.6 | 20/28/10 | The floor would land on the bottom's edge, so it goes as an extrusion; same slot as B18, with a vertex left on each wall edge where the old floor was |

## C. Move / stretch / autofold

| # | Scenario | Expected V/E/F | Extra assertions |
|---|---|---|---|
| C1 | B1, then move the whole selection by (1,0,0) | 8/12/6 | Pure translation; detached geometry is re-inserted so it merges at its destination, which gives it new ids |
| C2 | B1, then move the top face by (0,0,0.5) | 8/12/6 | Equivalent to B2 |
| C3 | B1, then move top edge y = 1 by (0,0.5,0) | 8/12/6 | All faces stay planar; no fold |
| C4 | B1, then move top vertex (1,1,1) by (0,0,0.5) | 8/13/7 | **Autofold**: top face splits into 2 triangles; the fold edge avoids the moved vertex |
| C5 | C4 with autofold disabled (Alt) | rejected ⚑ verify | Refused with a message; the model is unchanged |
| C6 | Move copy of `R(1,1)` by (2,0,0) | 8/8/2 | Disjoint copy |
| C7 | C6, then type `3x` | 16/16/4 | 3 copies at 2, 4, 6 |
| C8 | C6, then type `4/` | 20/20/5 | 4 copies evenly between 0 and 2 (0.5 spacing) ⚑ verify count semantics |
| C9 | Move copy that lands exactly overlapping an existing coplanar face | merged | Coincident faces deduplicate; edges merge |
| C10 | Move a group onto loose geometry | unchanged topology | Group isolation: no merging |

## D. Rotate / scale / flip

"Box" is B1 (a unit box made by push/pull, with outward faces). A pivot `p` means the transform is applied about `p`.

| # | Scenario | Expected V/E/F | Extra assertions |
|---|---|---|---|
| D1 | Box, select all, rotate 90° about Z with pivot (1,0,0) | 8/12/6 | Bounds x ∈ [0,1], y ∈ [−1,0]; all normals outward; orientation consistent; undo restores the hash |
| D2 | Box, rotate the top face 30° about its edge y = 0 (X axis, pivot (0,0,1)), autofold off | 8/12/6 ⚑ verify | Every side face stays planar, so no fold is needed and autofold off is not refused; top rises to z = 1.5 |
| D3 | Box, twist the top face 30° about Z with pivot (0,0,1) | 8/16/10 | All four side quads fold into triangles; with autofold off the move is refused and the hash is unchanged |
| D4 | Box at (2,−0.5), rotated copy repeated 5× at 60° steps about Z through the origin | 48/72/36 | Radial array of 6 boxes; 30 new faces. A 6th copy (at 360°) merges with the original: still 48/72/36 |
| D5 | Box, select all, scale (2, 0.5, 3) about the origin | 8/12/6 | Bounds max (2, 0.5, 3); faces planar and outward |
| D6 | 12-segment cylinder, select all, scale (2, 1, 1) | 24/36/14 | Both rim curves become polylines (circle parameters dropped); faces outward |
| D7 | Box, select all, mirror with `scaling(−1,1,1)` about (2,0,0) | 8/12/6 | Box at x ∈ [3,4]; all normals outward. A mirrored copy about y = 2 is outward too (16/24/12) |
| D8 | Box with a prism pulled 0.5 from a square on its top; mirror the prism's cap and walls across y = 0.5 | 16/24/11 | Moved in place (connected to the top ring). Carried loops are reversed, so the cap still faces +Z; orientation consistent; a symmetric prism stays outward |
| D9 | Group of a box, flip it along red about x = 0.5 | root 0/0/0; group 8/12/6 | Instance transform determinant −1; the definition is untouched |
| D10 | Scale by 0 on any axis: detached geometry, a connected face, an instance, inside an array | rejected | `KernelError`; hash unchanged |
| D11 | Box, scale the top face (2, 0.5, 1) about its center | 8/12/6 | Every face stays planar; top x ∈ [−0.5, 1.5] |
| D12 | Box, scale top corners (0,0,1) and (1,1,1) by (1, 1, 1.5) about the origin | 8/13/7 | Top face folds along its unmoved diagonal; with autofold off the move is refused and the hash is unchanged |

## E. Offset

Positive distances move toward a face's interior. For edges, they move to the left of the chain direction when looking
against the given normal (GEOMETRY.md, "Algorithm: Offset").

| # | Scenario | Expected V/E/F | Extra assertions |
|---|---|---|---|
| E1 | `R(2,2)`, offset the face inward by 0.25 | 8/8/2 | Ring 1.75 + inner face 2.25; both normals −Z; 1 created face; undo/redo hash identity |
| E2 | `R(2,2)`, offset outward by 0.25 (distance −0.25) | 8/8/2 | New ring face (area 2.25) with one hole, normal −Z; original area 4 |
| E3 | L shape (3×3 body + 3×1 arm), inward offset 0.75 (> the arm's half-width 0.5) | 10/10/2 | Arm part removed; inner square area 2.25, ring 9.75. With `keepOverlaps`: 13/14/3 (self-crossing loop kept, tail region becomes a face) |
| E4 | 24-segment circle face r = 1, offset inward by 0.1 | 48/48/2 | New curve kind `circle`, radius 0.9, 24 segments; every vertex at radius 1 or 0.9 |
| E5 | `R(2,2)` centered on the origin with a 12-segment circle hole r = 0.25, offset the ring face inward by 0.1 | 32/32/4 | Hole grows: circle curves with radii 0.25 and 0.35 |
| E6 | Half-disc: 12-segment arc r = 1 closed by its diameter, offset inward by 0.1 | 26/26/2 | Arc ends are mitered against the diameter's offset, so the offset curve is a polyline; the original arc stays |
| E7 | `R(2,2)` inward by 1.5, 1 or 0 (also 1.5 with `keepOverlaps`); circle r = 0.5 inward by 0.6; ring face whose hole grows past the shrinking outline | rejected | `KernelError`; hash and undo depth unchanged |
| E8 | Open chain (0,0)→(2,0)→(2,2), offset 0.5 with normal +Z | 6/4/0 | Mitered corner at (1.5, 0.5); start at (0, 0.5). Listing the second edge first with normal −Z lands on the other side |
| E9 | Hook (0,0)→(4,0)→(4,1)→(3,1), offset 0.6 with normal +Z | 6/4/0 | Trimmed where it enters the 0.6 band around (3,1): ends at x = 3 − √0.2. A U whose width is less than twice the distance is rejected |
| E10 | `R(2,2)` edges as a closed chain, offset 0.25 with normal +Z / −Z | 8/8/2 | +Z: inward (areas 1.75, 2.25); −Z: outward (areas 2.25, 4) |

## F. Erase modifiers & flags

| # | Scenario | Expected | Extra assertions |
|---|---|---|---|
| F1 | Eraser + Shift on an edge | edge hidden | Counts unchanged |
| F2 | Eraser + Ctrl on the edge between two faces | soft + smooth | Counts unchanged; the two faces form a surface |
| F3 | Eraser + Alt on a soft edge | un-soften | Flags cleared |
| F4 | Drag the eraser across 3 edges | 3 edges removed in one history entry | Single transaction |

## G. Groups & components

| # | Scenario | Expected | Extra assertions |
|---|---|---|---|
| G1 | B1, Make Group | root 0/0/0; group definition 8/12/6 | One instance; selection = the group |
| G2 | G1, Explode | root 8/12/6 | Merges with existing root geometry via insertion rules |
| G3 | B1, Make Component, copy instance ×2 | 1 definition, 3 instances | — |
| G4 | G3, edit the definition: push/pull the top +1 | All instances height 2 | — |
| G5 | G3, Make Unique on one instance | 2 definitions | Only the unique instance changes on further edits |
| G6 | Nested: group inside a component; edit the nested group | Transform chain correct | Inference points reported in world space |
| G7 | Undo G1 | Root restored, same ids | Hash identity |

## H. Solids (manifold round trip)

| # | Scenario | Expected | Extra assertions |
|---|---|---|---|
| H1 | Two overlapping unit boxes, Union | 1 solid | Volume = union volume; coplanar triangles regrouped into quads |
| H2 | Subtract | Cutter deleted | Face materials preserved from sources |
| H3 | Trim | Cutter kept | — |
| H4 | Intersect | Overlap only | — |
| H5 | Split | 3 solids | — |
| H6 | Outer Shell on 3 overlapping boxes | 1 solid | No internal faces |
| H7 | Non-solid input (open box) | Tool refuses | Clear message; no history entry |
| H8 | B1 | solid | `isSolid` true; volume from triangulated faces |
| H9 | B1 with one face deleted; B1 plus a fin edge; B1 with one face reversed; empty definition | not solid | — |
| H10 | B1 → triangle mesh → faces in a new definition | 8/12/6 | Solid; same volume; face materials restored; undo restores the hash |
| H11 | H10 through a mirroring transform | 8/12/6 | Faces still point outward (positive volume) |
| H12 | H10 with positions rounded to single precision | 8/12/6 | Vertices snap back onto their face planes; model valid |

Solid tools take the first selected object to be the one created first (lowest id). H1–H7 use A = [0,2]³ (the first)
and B = [1,3]³: Union volume 15, Subtract B − A volume 7, Trim leaves volumes 7 and 8, Intersect gives a unit cube
8/12/6, Split gives volumes 1, 7 and 7, and Outer Shell on three boxes overlapping along X gives one 8/12/6 box.

## K. Intersect Faces

| # | Scenario | Expected V/E/F | Extra assertions |
|---|---|---|---|
| K1 | `Box(2,2,2)` at the origin and a box [1,3]³, drawn in one context; intersect all faces with the model | 16/24/12 → 22/36/18 | 6 new edges forming one closed loop, each on 4 faces; undo restores the hash |
| K2 | `Box(1,1,1)` and a 3×3 rectangle at z = 0.5 around it; intersect the rectangle with the model | 12/16/7 → 16/24/12 | The four sides split; the rectangle gets a hole plus an inner face |
| K3 | Rectangle in a group, overlapping coplanar rectangle in the root; intersect with the model | unchanged | Coplanar faces give no edges and no history entry |
| K4 | Box [1,3]³ in a group, `Box(2,2,2)` in the root; intersect with the model | root 14/21/9 | The group is unchanged |
| K5 | `Box(2,2,2)` and a 4×4 rectangle at z = 1; intersect one side face with the selection | 1 edge | A single selected face creates nothing |

## L. Follow Me

| # | Scenario | Expected V/E/F | Extra assertions |
|---|---|---|---|
| L1 | 1×1 square in plane x = 0 (z from 0.5 to 1.5), loose L-shaped path (0,0,0)→(5,0,0)→(5,5,0) | 15/22/10 | The original face is the start cap; mitred corner; consistent orientation; volume 10 |
| L2 | 24-sided circle r 0.25 in plane x = 2, closed loose path (0,0,0)→(2,0,0)→(4,0,0)→(4,3,0)→(0,3,0) | 125/245/120 | Closed ring, no caps; the profile face is removed; volume = area × 14 |
| L3 | 1×1 rectangle in plane y = 0 spanning x 1–2, closed 24-segment circle path r 1 as one curve | 96/192/96 | Lathe is a solid with positive volume; the 96 ring edges are soft and smooth |
| L4 | L1 with a straight path | 10/13/6 | Undo restores the hash |
| L5 | Disconnected path; branching path | rejected | `KernelError`; hash and history unchanged |
| L6 | Profile plane parallel to the path; empty path | rejected | `KernelError`; hash unchanged |

## I. VCB parsing (default units: meters, decimal)

| Input | Tool context | Parsed intent |
|---|---|---|
| `2.5` | length | Length 2.5 m |
| `250cm` | length | Length 2.5 m |
| `3' 6"` | length | Length 1.0668 m |
| `3'6-1/2"` | length | Length 1.0795 m |
| `1/2"` | length | Length 0.0127 m |
| `-35mm` | length | Length −0.035 m |
| `8',20'` | pair | LengthPair (2.4384, 6.096) |
| `3,` / `,3` | pair | LengthPair (3, keep) / (keep, 3) |
| `3x` / `3*` / `3/` | array | Copies {n: 3, external} / {n: 3, external} / {n: 3, internal} |
| `[1,2,3]` | point | AbsPoint (1,2,3) |
| `<1,2,3>` | point | RelPoint (1,2,3) |
| `12s` / `20c` | curve | Segments 12 / CircleSegments 20 |
| `24r` / `5mr` | arc | Radius 24 (model units) / Radius 5 m |
| `45` | rotate | Angle 45° |
| `8:12` | rotate | Slope → atan(8/12) |
| `2` / `2,3` / `2,3,4` | scale | Uniform 2 / axis pair / per-axis triple |
| `abc`, `3xx`, `[1,2]` | any | Parse error with a message; no change |

## J. Selection

| # | Scenario | Expected selection |
|---|---|---|
| J1 | Click the top face of B1 | {top face} |
| J2 | Double-click the top face | top face + 4 edges |
| J3 | Double-click a top edge | edge + 2 faces |
| J4 | Triple-click any entity | all 18 connected entities (12 E + 6 F; vertices are not selectable) |
| J5 | Window drag left→right partially covering B1 | only fully enclosed entities |
| J6 | Crossing drag right→left partially covering B1 | all touched entities |
| J7 | Shift-click a selected face | toggled off |
| J8 | Click inside a group from the root context | the group instance |

## K. Divide / weld / explode curve

| # | Scenario | Expected V/E/F | Extra assertions |
|---|---|---|---|
| K1 | Loose line (0,0)→(3,0), divide into 3 | 4/3/0 | Parts returned in order: [0,1], [1,2], [2,3] |
| K2 | `R(2,1)`, divide the bottom edge into 4 | 7/7/1 | Face kept; outer loop has 7 uses; area 2; undo restores the hash |
| K3 | Divide into 1, 0, −2, 2.5, NaN or 1000 parts; divide a 3e-6 m edge into 3 | rejected | `KernelError`; hash unchanged |
| K4 | Loose 12-segment quarter arc r = 1, divide one of its edges into 6 | 7/6/0 | Whole arc re-divided: curve kind `arc`, 6 segments, curve edges = returned edges; end vertices keep their ids; every vertex at radius 1 |
| K5 | `R(4,4)` centered on the origin with a 24-segment circle r = 1, divide a circle edge into 8 | 12/12/2 | Disc is an octagon (area 2√2); ring area 16 − 2√2; curve kind `circle`, 8 segments |
| K6 | 12-segment cylinder, divide a bottom rim edge into 2 | 25/37/14 | Rim vertices carry side edges, so only that edge splits (equal halves); rim curve becomes a polyline of 13 edges ⚑ verify |
| K7 | Three connected loose lines, one of them vertical, weld (listed out of order) | unchanged | One polyline curve; edges in walking order from the first listed edge's `v0` |
| K8 | `R(1,1)` edges: weld two, weld the other two, then weld all four | unchanged | 2 curves, then 1 merged curve with 4 edges; welding the same four again returns the same curve |
| K9 | Weld a branching set, two disconnected edges, a single edge, or 3 edges of an 8-segment circle | rejected | `KernelError`; hash unchanged |
| K10 | 16-segment circle, Explode Curve | 16/16/1 | Curve count 0; edges no longer reference a curve; exploding again is refused |

## L. Soften by angle

| # | Scenario | Expected | Extra assertions |
|---|---|---|---|
| L1 | B1 box, all edges, max 30° / max 91° | 0 changed / 12 changed | 30°: no history entry. 91°: every edge soft and smooth; undo restores the hash |
| L2 | B9-style 24-segment cylinder, all edges, max 20° smooth on → smooth off → max 10° | 0 → 24 → 24 changed | Side edges (15°) stay soft; rims (90°) stay hard; smooth off clears smooth; 10° unsoftens the sides |
| L3 | A4 (split rectangle), the dividing edge | angle 0, coplanar | Softened only with `softenCoplanar`; softening again without it unsoftens the edge |
| L4 | Rectangle face plus a loose line, all edges, max 180° with coplanar on | 0 changed | Edges without exactly two faces have no angle and are never softened |
| L5 | B13 triangular prism, the ridge edge between its two sloped faces | angle π − 2·atan(½) ≈ 126.87° | The same angle after reversing one of the faces; not softened at 90°, softened at 130° |
| L6 | Max angle −0.1, NaN or 4 rad | rejected | `KernelError` |
