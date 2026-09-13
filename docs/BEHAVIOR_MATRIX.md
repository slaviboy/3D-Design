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

| # | Scenario | Expected | Extra assertions |
|---|---|---|---|
| D1 | B1, then rotate all 90° about the Z axis through the origin | 8/12/6 | Coordinates rotated within EPS; normals rotated |
| D2 | Rotate with Ctrl copy, then `3x` at 90° | 4 boxes | Radial array |
| D3 | Scale B1 uniformly by 2 about the corner | 8/12/6 | Volume 8 |
| D4 | Scale B1 on the blue axis by −1 (mirror) | 8/12/6 | Normals remain outward (orientation corrected) |
| D5 | Flip a group along red | Transform determinant −1 | Rendered in the mirrored bucket; bounds flipped |
| D6 | Scale a circle curve non-uniformly | curve → polyline ⚑ | Arc parameters dropped |

## E. Offset

| # | Scenario | Expected V/E/F | Extra assertions |
|---|---|---|---|
| E1 | `R(2,2)`, offset the face inward by 0.25 | 8/8/2 | Ring + inner face; inner area 2.25 |
| E2 | `R(2,2)`, offset outward by 0.25 | 8/8/2 | Outer ring face created around the original |
| E3 | L-shaped face, inward offset larger than the narrow arm half-width | overlaps removed | No self-intersecting loop; Alt keeps overlaps |
| E4 | Circle face, offset inward by 0.1 | curve kept | Offset result is an arc curve with radius r − 0.1 |

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
