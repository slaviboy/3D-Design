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
  front or back color, and inherits an instance's material override when inside one. See "Materials (Phase 7)"
  below for what is implemented.

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
| Styles and environments | Default faces use fixed front and back colors | Visualization phase |
| Shadows and sections | Implemented in Phase 7 in a simpler form; see "Current implementation (Phase 7)" below | Later refinements noted there |
| Material chunks with a per-face state texture | One merged geometry per (side, material) per definition; any edit to a definition rebuilds all of its buckets and the scene tree | Performance phase |
| Overlay sprites for inference markers and dimensions | Tool previews are world-space `LineSegments` without depth test; inference markers and tooltips are DOM elements positioned over the canvas | Visualization phase |
| Dashed guides clipped to the view | Solid guide lines drawn 1 km to each side of their anchor, excluded from the bounds that set the clipping planes | Visualization phase |

What is already in place: render on demand, near and far planes from model bounds, shared geometry for all
instances of a definition, and invalidation driven by the kernel's change events.

While a group or component is open, geometry outside it is drawn with transparent materials (30 % opacity). The
open context and everything inside it keep the normal materials. The face or edges a tool would act on are tinted
with the hover color, separately from the selection overlay.

## Materials (Phase 7)

Implemented in `src/render/ModelRenderer.ts`, with pure helpers in `src/kernel/ops/materials.ts` (projection) and
`src/kernel/ops/shading.ts` (smooth normals).

- **Buckets.** A definition's visible faces are split into one merged `BufferGeometry` per side (front or back) and
  material. The default material is its own bucket. Each vertex carries `position`, `normal` and `uv`. Front buckets
  are drawn with `FrontSide` and back buckets with `BackSide`.
- **Material resolution.** A bucket with a material uses it. A default bucket uses the material of the innermost
  painted group or component it is drawn inside, found while walking the instance tree, so one shared geometry can
  show different inherited materials per instance. Otherwise it uses the style's front or back color.
- **three.js materials.**
  - Model materials become `MeshStandardMaterial` with color, opacity, metalness and roughness.
  - Default faces keep `MeshLambertMaterial`, so unpainted models look exactly as before.
  - With only ambient and directional light, roughness 1 and metalness 0 shade close to the Lambert look. Metallic
    materials look dark until environments exist.
  - Materials are cached per (material, side, faded) and disposed when their material or its texture asset changes,
    when the document is replaced, and when the renderer is disposed.
- **Transparency.** A material with opacity below 1 is `transparent` with `depthWrite` off. three.js draws
  transparent objects after opaque ones, sorted back to front by object. Sorting is per bucket, not per triangle, so
  intersecting transparent surfaces in one bucket can still blend in the wrong order. Faded contexts multiply opacity
  by 30 % and keep writing depth, as before.
- **Textures.**
  - Asset bytes are decoded with `createImageBitmap(new Blob([bytes], { type }), { imageOrientation: 'flipY' })`.
    That needs no object URL, no `img` element and no network. The CSP would allow `blob:` images, but they are not
    needed.
  - Each asset gets one `THREE.Texture` (sRGB, repeat wrapping). Each material clones it, which shares the uploaded
    image, and sets `repeat = (1 / tile width, 1 / tile height)`. The material color is then white, so the image is
    not tinted.
  - Decoding is asynchronous. The material shows its color until the image is ready, then the renderer rebuilds the
    affected materials and asks the viewport for a frame.
  - Removed assets close their `ImageBitmap` and dispose their texture.
- **UVs.** Texture coordinates are in meters, from the planar projection in `textureAxes`.
  - Horizontal faces project along the red and green axes.
  - Other faces use a horizontal `u` and an upward `v`, so wall textures stand upright.
  - The side's placement (offset, rotation, scale) is applied before writing the UV. Dividing by the tile size is
    left to the texture's repeat, so resizing a texture never rebuilds geometry.
- **Smooth shading.** Faces joined by edges that are both soft and smooth form a surface (union-find over those
  edges). At each vertex, a face in such a surface gets the normalized sum of the normals of the surface's faces that
  touch the vertex. Every other face keeps its flat normal. Soft edges that are not smooth still hide the edge but
  shade flat.
- **Selection, hover, fading and hidden tags** are unchanged. Overlays use their own flat meshes, hidden faces and
  hidden tags are skipped while buckets are built, and fading applies per node as before.

**Known limitations**

- Textures are not clamped to the GPU's maximum texture size (the file limit is 8192 px).
- Mipmaps are generated only for the three.js defaults.
- There is no texture-only style mode yet.
- Edges don't show edge materials.
- Back sides show textures mirrored, because both sides share one projection.

## Current implementation (Phase 7): shadows and section planes

### Sun and shadows (`src/render/shadows/ShadowController.ts`)

- **Sun position.** `src/kernel/sun/solar.ts` implements the NOAA solar calculator equations (after Meeus): Julian
  century, the sun's apparent longitude and declination, the equation of time, the hour angle, and elevation with
  NOAA's refraction correction. It is tested against the NREL SPA reference case and Meeus's worked examples, all
  within 0.5°. `sunDirection` turns azimuth and altitude into a world vector using the document's north angle (clockwise
  from +Y). Time comes from the settings' local date-time and UTC offset; there are no named time zones or
  daylight-saving rules.
- **Lights.** One directional light and one ambient light. Their intensities scale with `light` and `dark`; the
  default settings give exactly the fixed intensities of earlier phases. The light direction follows the sun when
  shadows are on or "use sun for shading" is set, and otherwise stays at the old fixed direction. With the sun below
  the horizon the directional light is switched off.
- **Shadow map.** `renderer.shadowMap.enabled` follows the "enabled" setting. The orthographic shadow camera is fitted
  to the bounding sphere of the visible model, not to the view, so the map is re-rendered (`autoUpdate` is off, and
  `needsUpdate` is set) only after model, selection, context or settings changes. Orbiting, panning and zooming never
  re-render the shadow map. PCF filtering, a 2048² map, and a normal bias of about 1.5 texels.
- **Per-instance flags.** The model renderer stores each instance's `castShadows` and `receiveShadows` on its group; the
  controller sets `castShadow` and `receiveShadow` on the face meshes below it (an instance that doesn't cast also stops
  everything nested inside it from casting). Faces receive only when "on faces" is set. Edges neither cast nor receive.
- **Ground.** A `ShadowMaterial` plane at z = 0 under the model center, eight bounding radii wide, receives shadows when
  "on ground" is set. It draws only the shadows, never a visible ground.

### Section planes (`src/render/sections/`)

- **Clipping.** After each rebuild of the model tree, `SectionOverlay` walks the per-instance groups. A context with an
  active plane contributes a world-space `THREE.Plane` (the stored plane transformed by that instance's world matrix,
  facing away from the removed side). Every mesh and line set of that context and of everything nested inside it is
  clipped by the planes of its own context and all enclosing contexts. Because materials are shared between instances,
  `ClippingMaterials` gives clipped objects cached clones with their own `clippingPlanes`, and disposes clones a pass
  no longer uses. `renderer.localClippingEnabled` is on.
- **Cut fill.** `sectionCut` (kernel, `ops/sections.ts`) intersects the plane with every visible face of the context
  (vertices within the length tolerance count as in front of the plane, so touching vertices and in-plane edges pair up
  consistently), joins the segments into closed loops on a welding grid, treats nested loops as holes by even-odd
  depth, and triangulates with earcut. The overlay draws the triangles in a solid dark color with a polygon offset, per
  instance, and caches the cut per context until the model changes. It only slices the context's own faces: geometry
  inside nested groups is clipped but gets no fill of its own unless its own context has an active plane.
- **Plane display.** Each section plane is drawn as a translucent rectangle with an outline (orange while active, blue
  while selected), sized to the content bounds of its context (`sectionRectangle`, 15 % beyond the bounding sphere).
  The same rectangle is used for picking, so what is drawn is what can be clicked.
- **View toggles.** "Section Planes" hides the rectangles; "Section Cuts" turns clipping and fills off. Both are session
  view state, not model data.

### Known limitations

- CPU picking and inference do not respect clipping: geometry cut away by a section can still be hovered and picked.
- Section planes are picked by the outline of their rectangle only, not by clicking inside it, and are not included in
  window or crossing selection or Select All. They can't yet be moved or rotated with Move and Rotate, and Align View is
  not implemented.
- Fills are one solid color (no hatch pattern), and there are no markers at gaps in open outlines.
- The ground receiver is a finite plane and does not follow the camera; very large or far-away models may need a
  larger extent. Shadow quality is fixed (no cascades).
