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
- **Lost GPU context.** Tablets take the WebGL context away when the app goes to the background, and browsers can lose
  it after a GPU reset. three.js keeps the loss from being final and rebuilds its state when the context comes back;
  `Viewport` then marks the lighting dirty and draws a frame, since nothing else would ask for one. While the context
  is lost, frames are skipped and the camera and model keep changing as usual.

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
- **Section cuts.** Picking and inference skip what an active section cuts away while cuts are shown, with the same
  planes as the renderer: a context's active plane cuts itself and everything nested in it, and an open group inherits
  the planes of the contexts around it (`src/app/picking/sectionClip.ts`). A click on a cut-away face reaches what is
  visible behind it.
- **Inference sees what the camera sees** (`src/app/picking/visibility.ts`). A snap candidate is dropped when a
  visible face lies between it and the camera, tested with a ray from the camera to the candidate: the face must be
  crossed inside its outline (more than half a pixel from its edges, so silhouettes don't hide the points just behind
  them) and the candidate must lie off the face's plane by more than 0.75 px (points on a face stay visible). Faces
  hide nothing in X-ray and wireframe, and Back Edges keeps points on edges visible (they're drawn dashed); the origin
  and points on the drawing axes' lines (On Red, Green or Blue Axis, ranked just after On Edge so an edge lying on an
  axis reads On Edge) are tested like other points, since the axes are drawn with depth testing. Push/Pull and Offset
  leave the axes out: their result would jump to the level of the axis point under the pointer. Candidates are tested
  lazily in ranking order, at most 16 per pointer move, with definition bounds cached until the document changes.
- **Ties never come down to rounding.** A line inference (an axis, Parallel, Perpendicular, an edge's extension or
  From Point) that passes within half a pixel of a point the model offers yields to that point. So moving along an
  edge reads On Edge all the way, even where the axis line through a remembered corner runs along the edge. The two
  are the same place worked out in two ways, and their pixel distances differ only by rounding (about 1e-14 px),
  which would otherwise pick one on every pointer move. Lines of the same rank that tie are settled by kind: an
  edge's extension before a From Point line.
- **A tool's own preview.** Move, Rotate, Push/Pull and Offset preview by applying their operation to the model, so
  inference sees the preview where it is on screen: it hides what lies behind it, but what it added or moved is never
  a snap target (`exclusionForChanges` in `src/app/inference/exclusion.ts`), nor, for Move and Rotate, the face under
  the pointer, which would feed the result back into itself.

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
| Selection state in a `DataTexture` | A separate overlay mesh for selected faces and edges, plus box outlines for instances. Selected edges are wide lines (`SelectedEdgeMaterial`, 3 px) in the selection color while they are selected. Overlay lines (`OverlayLineMaterial` and the wide ones) lie exactly on the model's edges, so they are nudged toward the camera by 1e-5 in normalized depth: they win over the edge underneath whichever is drawn first, and still hide behind nearer faces | Performance phase, if measurements show a need |
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

- Section fills don't hide points: a point inside a cut solid can be snapped to through the fill. Window and crossing
  selection ignore cuts.
- Translucent materials hide points behind them for inference, as they do for picking, though they are see-through on
  screen.
- Section planes are picked by the outline of their rectangle only, not by clicking inside it, and are not included in
  window or crossing selection or Select All. They can't yet be moved or rotated with Move and Rotate, and Align View is
  not implemented.
- Fills are one solid color (no hatch pattern), and there are no markers at gaps in open outlines.
- The ground receiver is a finite plane and does not follow the camera; very large or far-away models may need a
  larger extent. Shadow quality is fixed (no cascades).

## Current implementation (Phase 7): styles, fog and environments

Style, fog and environment settings are document data (`StyleSettings`, `FogSettings`, `EnvironmentSettings` in
`src/kernel/model/types.ts`), changed through undoable `document.style`, `document.fog` and `document.environment`
changes. The renderer reads them from the document; there is no separate `StyleApplier` object. The default style
reproduces the fixed colors of earlier phases exactly (colors are sRGB and go through `Color.setRGB(…, SRGBColorSpace)`,
which is what the old hex constants did).

### Faces (`ModelRenderer.#faceMaterial`)

- **Shaded with textures** is the earlier behavior. **Shaded** is the same without texture maps.
- **Monochrome** ignores materials: every face uses the style's front or back color (Lambert).
- **Hidden line** draws unlit faces in the background color (`MeshBasicMaterial`), so they only hide what is behind them.
- **Wireframe** keeps the face meshes but makes them invisible.
- **X-ray** (combinable with any mode) makes every face material transparent at 45 % opacity without depth writes.
- Any style change disposes all face materials and rebuilds every definition's geometry and the scene tree. Style
  changes are rare single user actions, so this is simpler than tracking which parts depend on which setting.

### Edges (`src/render/styles/`)

- **Plain edges** are 1 px `LineSegments` with per-vertex colors (`buildEdgeStyleArrays`). "All the same" uses the edge
  color; "by material" uses the edge's own material (edges without one use the edge color); "by axis" gives edges
  parallel to the document's red, green or blue axis the axis colors. Axis matching uses each definition's own
  coordinates, so edges inside rotated groups are compared with unrotated axes (an approximation).
- **Back edges** redraw the edge geometry with `depthFunc = GreaterDepth` and no depth writes, after the faces, so only
  edges hidden behind faces appear, dashed. Dash lengths are world distances scaled by the view (`pixels per unit / depth`
  in perspective), so dashes stay *roughly* 5 px long; they stretch slightly along steep edges. Off in wireframe and
  x-ray, and for faded contexts.
- **Profiles** are wide screen-space lines (three's bundled `LineSegments2` / `LineMaterial`) for every edge that bounds a
  visible face. Each carries two directions pointing from the edge into its faces. The vertex shader keeps the edge only
  when both faces lie on the same side of the plane through the edge and the eye (or the edge bounds a single face),
  so outlines follow the camera without CPU work and do not depend on face orientation. Width is in CSS pixels.
- **Depth cue** replaces the plain edges with wide lines whose width falls linearly from the style's width at the
  nearest model point to 1 px at the farthest (the model's bounding sphere gives the range). This is an approximation of
  depth-dependent line weight.
- **Extensions** push both ends of every edge outward by a fixed number of pixels in the vertex shader (plain edges use an
  `edgeOther` attribute holding the other end; wide lines use the line direction they already compute).
- **Endpoints** are drawn as square `Points` (4 px) at every distinct edge end, an approximation of short thick end
  strokes.
- Section clipping applies to all of these: the section overlay clones them like any other model material. The style
  materials share one set of view uniforms (resolution, pixel ratio, depth range) with their clones.
- Shader changes are made by replacing named fragments of three's shader source; a fragment that is missing throws, so
  an incompatible three.js update fails loudly (the E2E suite fails on console errors).

### Background, sky and ground (`BackgroundController`)

- The background color is the renderer's clear color.
- Sky and ground are one full-screen quad drawn first. Each pixel rebuilds its view ray from the inverse projection and
  camera matrices. A ray that reaches the ground plane (z = 0) shows the ground color, blended with the background right
  at the horizon; other rays above the horizon blend from the background color at the horizon to the sky color about
  25° up. With the camera below the ground, the ground shows only when "show ground from below" is on. Parallel views
  have one ray direction, so there the ray's origin height decides between sky and ground, and the sky is a flat blend.
- The ground is not geometry: it never hides model geometry below z = 0 (unlike an opaque ground plane would).

### Fog

`scene.fog` is a three.js linear `Fog` from `start` to `end` meters (model units) while fog is on, in the background
color or the fog color. It applies to faces, edges and overlays; the sky quad is not fogged.

### Environments

- **Built-in environments** are generated in code (`environments.ts`): 256 × 128 half-float equirectangular textures
  from simple formulas: "Soft Studio" (bright ceiling, gray horizon, darker floor, three soft light panels) and "Warm
  Dusk" (blue zenith, orange horizon, low sun). No image files are bundled or downloaded; each uses about 0.5 MB of GPU
  memory and adds only code to the bundle.
- The texture is prefiltered with `PMREMGenerator` and used as `scene.environment` when "use for reflections" is on, so
  painted (`MeshStandardMaterial`) faces are lit and reflect it. Default-material faces stay Lambert and are unaffected.
  "Show as background" sets the equirectangular texture as `scene.background` in perspective views. Parallel views keep
  the style background, because three's background box does not project correctly with an orthographic camera.
- **Rotation** and the Y-up to Z-up turn use `scene.environmentRotation` and `scene.backgroundRotation` (Euler
  `(90°, 0, rotation)`, order `ZXY`). **Exposure** sets `environmentIntensity` and `backgroundIntensity`.
- **Local HDR files** (`.hdr`, Radiance RGBE) are picked through the existing file access, checked for a Radiance
  header and a 64 MB limit in the application layer, and parsed from memory by three's bundled `HDRLoader` on the main
  thread. They are session-only: the model stores the `custom` environment id, and a file opened without a loaded image
  falls back to the studio. Unreadable files also fall back to the studio. EXR is not supported.

### Known limitations

- Edges inside hidden-line faces use the same depth offset as before; very shallow angles can still show edges through
  faces.
- Profiles are evaluated per edge, not per pixel: a curved surface's outline follows its facets, and non-manifold edges
  use their first two visible faces.
- Endpoints and extensions have fixed shapes; there is no jitter, halo or per-tag dash pattern yet.
- Style changes rebuild all geometry; very large models pause briefly when switching styles.
- User HDR images are not saved in the `.planar` file.
