# Planar Rendering

The renderer lives in `src/render/` and is the only layer that creates three.js objects. It reads the kernel
and its dirty sets, and never stores model data of its own.

## Frame loop

- **Render on demand.** A frame is drawn only when the camera, the model, a style, or an overlay changes. There is no
  continuous `requestAnimationFrame` loop while idle.
- **Near/far planes** are computed from the visible model bounds every frame, so switching between perspective and
  parallel projection never clips.
- **Projections:** perspective (field of view 1–120°, default 35°), parallel (orthographic), and two-point
  perspective (a shifted-lens camera that keeps verticals vertical).
- **Precision.** Vertex positions are stored relative to each chunk's origin, which avoids float32 jitter far from the
  model origin.

## Faces

- **Buckets.** Faces are grouped per definition, first by material, then into spatial chunks of about 16k triangles.
  Each chunk is one merged `BufferGeometry` with `position`, `normal`, `uv` and `faceIndex` attributes.
- **Triangulation cache.** Triangulation is cached per face id. Editing a face re-triangulates only that face and
  rebuilds only its chunk.
- **Materials.** Each face is drawn with its front and back materials. A face with no material uses the style's
  front or back color, and inherits an instance's material override when inside one.

## Edges

All edges are drawn by one instanced, screen-space quad pipeline. Plain 1 px `LineSegments` can't do profiles
or line widths, so they aren't used.

- **Instance attributes:** `p0`, `p1`, `n1`, `n2` (normals of the adjacent faces), `flags` (soft, smooth, hidden,
  border), and `edgeIndex`.
- **What the vertex shader does:**
  - discards soft and hidden edges, unless hidden geometry is being shown;
  - detects profile edges when the view direction's dot product with `n1` and with `n2` differ in sign, or when the
    edge is a border edge;
  - widens each quad to its configured pixel width;
  - applies a small depth bias so edges draw on top of their own faces.
- **Style effects** come from the same pipeline through shader uniforms: color by axis, material or tag; tag dashes;
  dashed back edges; depth cue; extensions; endpoints; jitter.

## Selection, hover, hidden and locked state

- **State texture.** A `DataTexture` (RGBA8) indexed by `faceIndex` or `edgeIndex` stores per-entity state bits.
  Materials are patched with `onBeforeCompile` to read it.
- **Cost.** Changing the selection updates this texture only; it never rebuilds geometry. Selecting 50k entities costs
  one texture upload.
- **Appearance.** Selected faces are tinted with a stipple pattern, locked entities use the locked color, and the
  hovered entity is pre-highlighted.

## Components and groups

- **Instancing.** Each definition's geometry is built once and drawn instanced, using world matrices flattened from
  the nesting tree.
- **Separate buckets** are kept for:
  - mirrored transforms (negative determinant), because winding flips;
  - instances with a material override.
- **Editing.** Editing a definition rebuilds that definition's buffers once. While a context is open, the rest of the
  model can be faded or hidden, as set in preferences.

## Picking

- **On the CPU.** Picking uses the kernel's dynamic AABB tree for each definition, which holds faces, edges and
  instance bounds. Rays and selection frustums are transformed into each instance's local space while the tree is
  traversed.
- **Edges** are picked by their distance in pixels on screen.
- **Window and crossing selection** use frustum containment and intersection tests against the same trees.
- **Why not GPU id buffers:** inference needs vertices, midpoints and edges with pixel tolerance. GPU readback stalls
  the pipeline and doesn't account for section clipping or x-ray.

## Styles

Styles are data (`StyleSpec`): face mode, edge settings, background, modeling colors, watermarks and fog. A
`StyleApplier` turns a spec into material modes and shader uniforms, so no style decision is hardcoded elsewhere in
the renderer.

- **Face modes:** wireframe, hidden line, shaded, shaded with textures, monochrome, and x-ray (which can be combined
  with any mode).
- **Edges:** edges, back edges, profiles, depth cue, extension, endpoints, jitter, and color mode.
- **Background:** background color, sky, horizon, ground, and show ground from below.

## Lighting, shadows, environments

- **Sun.** A directional light positioned by Planar's own implementation of the NOAA solar position algorithm (date,
  time, latitude, longitude, north angle, time zone), plus hemisphere ambient light. There is no online location
  service.
- **Shadows.** The shadow camera is fitted to the visible bounds. Shadow maps are not updated while orbiting.
  Settings: on faces, on ground, light/dark levels, use sun for shading, and per-instance cast/receive.
- **Environments.** Local HDR/EXR files are loaded with three's bundled RGBE/EXR loaders and prefiltered with PMREM.
  Options: skydome, reflections, rotation, and exposure.

## Section planes

- **Clipping.** Each active section plane (at most one active per context, transformed into that context) becomes a
  renderer clipping plane.
- **Fills.** Fills are computed in the kernel by slicing faces with the Intersect Faces code, then drawn as overlay
  meshes. The kernel approach works on open and non-manifold models, where stencil caps fail.

## Overlays

The overlay layer draws:

- inference markers, which use a distinct shape and a text label as well as a color;
- rubber-band previews, grips, and the protractor;
- guides, axes, and section plane gizmos;
- dimensions and text, drawn in screen space so they stay readable at any zoom.

## Performance budgets (validated in the performance phase)

| Scenario | Target |
|---|---|
| Orbiting a 10k-entity model | 60 FPS on a laptop GPU |
| Orbiting a 100k-entity model | Stays interactive (≥ 30 FPS), with graceful degradation |
| Selection change | < 16 ms |
| Single-face edit | < 8 ms including chunk rebuild |

## Current implementation (Phase 4)

The foundation renderer (`src/render/Viewport.ts`, `ModelRenderer.ts`) follows the structure above in a simpler
form. These are the known differences from the target design, each scheduled for a later phase:

| Target design | Current implementation | Planned |
|---|---|---|
| Spatial chunks of ~16k triangles per material | One merged geometry per definition, rebuilt when that definition changes | Performance phase |
| Instanced screen-space edge quads with profiles and styles | 1 px `LineSegments`; soft and hidden edges skipped | Visualization phase |
| Selection state in a `DataTexture` | A separate overlay mesh for selected faces and edges, plus box outlines for instances | Performance phase, if measurements show a need |
| Chunk-relative positions against float32 jitter | World positions in float32 buffers | Performance phase |
| Styles, shadows, environments, sections | Fixed front and back colors, ambient plus one directional light | Visualization phase |
| Overlay sprites for inference markers and dimensions | Tool previews are world-space `LineSegments` without depth test; inference markers and tooltips are DOM elements positioned over the canvas | Visualization phase |
| Dashed guides clipped to the view | Solid guide lines drawn 1 km to each side of their anchor, excluded from the bounds that set the clipping planes | Visualization phase |

What is already in place: render on demand, near and far planes from model bounds, shared geometry for all
instances of a definition, and invalidation driven by the kernel's change events.

While a group or component is open, geometry outside it is drawn with transparent materials (30 % opacity). The
open context and everything inside it keep the normal materials. The face or edges a tool would act on are tinted
with the hover color, separately from the selection overlay.
