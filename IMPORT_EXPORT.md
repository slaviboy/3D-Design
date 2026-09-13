# Planar Import and Export

Planar exchanges 3D models with other tools through **File > Import…**, **File > Export 3D Model…** and
**File > Export 2D Graphic…**. Everything happens locally: files are read from what the user picks and written
through the browser's save dialog or a download. Nothing is fetched and nothing is uploaded.

## Formats

The dialogs list formats from two registries, so only implemented and tested formats ever appear:
`src/io/import/formats.ts` (`IMPORT_FORMATS`) and `src/io/export/formats.ts` (`EXPORT_FORMATS`).

| Format | Import | Export | Implementation |
|---|---|---|---|
| glTF 2.0 `.glb` | Yes | Yes | Import: three `GLTFLoader` on a rewritten, self-contained GLB. Export: Planar writer |
| glTF 2.0 `.gltf` | Yes (buffers from data URIs or picked `.bin` files) | Yes (buffer embedded as a data URI) | Same as above |
| OBJ `.obj` + `.mtl` | Yes (MTL colors, opacity and `map_Kd` textures) | Yes (OBJ and MTL files) | Import: three `OBJLoader` plus Planar's MTL reader. Export: Planar writer |
| STL `.stl` | Yes (binary and ASCII) | Yes (binary and ASCII) | Import: three `STLLoader`. Export: Planar writer |
| COLLADA `.dae` | Yes | Yes | Planar reader and writer (three's `ColladaLoader` needs `DOMParser`, which workers lack) |
| 3DS `.3ds` | Yes | No | three `TDSLoader`, with texture maps read by Planar (name, scale, offset) instead of loaded through the DOM |
| PNG `.png` | No (image import needs texture materials; see limitations) | Yes (view capture) | `Viewport.capture` through the `ViewCapturePort` |

A zip holding a model and its companion files (MTL, BIN, textures) can be picked instead of loose files.

## Import

1. **Pick files.** The picker allows several files: the model plus the files it refers to, or a zip. Exactly one
   model file is required.
2. **Options.**
   - **File units**: meters per file unit. Defaults: meters for glTF and OBJ, millimeters for STL, inches for 3DS.
   - **Y axis is up in the file**: turns Y-up coordinates into Planar's Z-up, (x, y, z) → (x, −z, y). On by default
     for glTF and OBJ, off for STL and 3DS.
   - **Merge coplanar faces**: regroups adjacent coplanar triangles with the same material into polygons (on by
     default). Off keeps each triangle as its own face.
   - **Import as**: a group or a component.
   - COLLADA files declare their unit and up axis, so the dialog doesn't ask and the file's values are used.
3. **Parsing** runs in `src/workers/io.worker.ts` (typed protocol in `src/workers/ioProtocol.ts`, engine in
   `src/app/io/importEngine.ts`). The worker posts back an `ImportedScene`: plain triangle arrays, materials and a
   node tree (`src/io/mesh/importedScene.ts`). Parsing can be cancelled from the progress dialog, which stops the
   worker.
4. **Conversion** (`src/io/mesh/sceneToKernel.ts`), in one undoable transaction:
   - The scene is validated again on the main thread.
   - Units and axes are baked into vertex positions (so kernel tolerances stay in meters). Node transforms are
     converted with S·T·S⁻¹.
   - Degenerate triangles (repeated corners or no area) are dropped and counted.
   - Each mesh goes through `insertTriangleMesh`, which welds vertices and merges coplanar triangles.
   - Materials become Planar materials on both sides of each face. An identical existing material is reused.
     Textured materials get a texture asset and each textured face a fitted placement (see "Textures").
   - The file becomes one group (or component) at the origin of the open context, placed on the active tag and selected.
   - Nodes become nested groups. A set of meshes drawn by several nodes (glTF meshes, COLLADA library nodes) becomes one
     component with an instance per node.
5. **Summary.** A notification reports faces, groups, components and materials, plus the number of degenerate
   triangles dropped. Up to three warnings follow (skipped external references, missing companion files, ignored
   non-mesh objects, texture names).

If anything fails, the error is shown and the transaction is rolled back, so the model is unchanged.

## Textures

Imports bring in base color (diffuse) textures as texture assets and textured materials, in the same undoable
transaction as the geometry.

### Where images come from

| Format | Texture read | UVs |
|---|---|---|
| glTF / GLB | `pbrMetallicRoughness.baseColorTexture`: an image in a buffer view (GLB or a resolved buffer), a `data:` URI, or a picked file. `KHR_texture_transform` (offset, rotation, scale) is applied to the UVs. | `TEXCOORD_0`, V flipped (glTF's origin is the top-left) |
| OBJ + MTL | `map_Kd` from the picked files; the `-o` (offset) and `-s` (scale) options are applied, other options are skipped. File names may contain spaces. | `vt` |
| COLLADA | The diffuse `<texture>`, followed through `newparam` sampler and surface to `<image><init_from>` (1.4 text or 1.5 `<ref>`) | The first `TEXCOORD` input (lowest `set`) of each primitive |
| 3DS | The material's texture map name (chunk `0xA300`), with the map's U/V scale and offset | Mesh texture vertices |

- **Never fetched.** References resolve only among the picked files (relative to the model's folder, then by file
  name) or from `data:` URIs. A `file:` URI is looked up by file name among the picked files. Other external URLs
  are ignored with the usual "Planar never downloads files" warning.
- **Formats.** Only PNG and JPEG are imported, identified by their header (not the extension). Other images (WebP,
  KTX2 / Basis, AVIF, DDS, BMP, TGA, GIF, TIFF, …) are skipped. So are images larger than 32 MB or 8,192 pixels on a
  side (the kernel's texture limits in `src/kernel/model/assets.ts`), since they aren't scaled down. The material
  keeps its color. The worker lists all skipped images in one counted warning ("Skipped 2 texture images that
  Planar can't use: …"), and the main thread checks the bytes again before adding assets.
- **Deduplication.** One asset per distinct image content (SHA-256 of the bytes), within an import and against
  assets already in the model. Importing the same file twice reuses the images and the identical materials.
- **Summary.** The import notification counts textures next to faces and materials.

### From UVs to Planar's placement

Planar maps a face side with one planar projection: the point is projected onto the face's texture axes
(`textureAxes` in `src/kernel/ops/materials.ts`), then moved by an offset, rotated and scaled per axis, and divided
by the material's tile size. That is an affine map from the face plane to the image **without shear**. Imported
meshes instead carry arbitrary UVs per vertex. `src/io/mesh/texturePlacement.ts` bridges the two for every textured
triangle:

1. The triangle's UVs, after the format's UV transform, are image UVs with the origin at the bottom-left.
2. A least-squares affine fit maps the corners, projected onto the texture axes of the triangle's normal, to those
   UVs.
3. The nearest shear-free map is taken: rows of the form k₀·(cos θ, sin θ) and k₁·(−sin θ, cos θ), with θ the
   dominant eigenvector angle of the rows' outer products. k₀ is kept positive; a negative k₁ is a mirror.
4. The translation is refitted by least squares. The error is the largest UV residual divided by the UV extent.
5. The rotation is θ, the scales are 1/k₀ and 1/k₁, and the offset is solved from the translation.

The fit is computed for a 1 m tile. A material's tile size is the median fitted size of one UV unit over its
triangles (width and height separately), and each placement's scale is divided by it. So a uniformly mapped model
gets scales near 1, and painting the material elsewhere shows a sensible tile. Front and back get the same
placement.

**Merging.** "Merge coplanar faces" still merges adjacent coplanar triangles with the same material, but only when
their placements give the same texture coordinates within a relative tolerance of 10⁻⁶. `samePlacement` in
`src/kernel/ops/solids/mesh.ts` compares the linear part and translation of the two maps. A planar-mapped quad
becomes one face, while halves with different mappings stay separate faces, so textures don't smear.

**Limits.**

- A triangle's three corners always have an affine fit, so only shear is lost. Faithful cases include planar,
  box-projected and per-face mappings, and cylinders or other unwrapped strips whose facets are mapped without
  shear, since each facet is its own face.
- Sheared or non-uniformly skewed mappings (spherical poles, hand-tweaked islands, perspective-corrected quads) get
  the closest shear-free placement. Triangles whose relative error exceeds 2 % are counted in one warning. So are
  triangles whose UVs collapse to a point or a line; those use the default projection.
- Textured triangles without texture coordinates use the default projection and are counted in another warning.
- UV islands shifted by whole tiles look the same but don't merge, because placements are compared without the
  tile size. Such models import with more faces than strictly needed.
- Only one UV set per material (glTF `texCoord` other than 0 is read from the first set, with a warning). Wrap
  modes, filtering, alpha cutoff and every other texture map (normal, roughness, emissive, …) are ignored.
- The default import limit `maxTextureSize` is not used for scaling; images over the kernel limits are refused.

## Export

### 3D models

- **Options**: format, file name, file units (not for glTF, which is always meters), Y axis up (not for glTF,
  which is always Y-up), and selection only. Faces are always triangulated.
- **Content**: the whole model, or the selected faces and groups/components of the open context. Hidden
  entities and entities on hidden tags are left out. Faces without a material use the material painted on their
  group or component, if any.
- **glTF**: each (definition, inherited material) pair is one mesh with one primitive per material. Instances are
  nodes with matrices, so a component drawn several times is stored once. Base color and opacity are written as
  PBR factors (`metallicFactor` 0, `roughnessFactor` 1, `BLEND` when translucent, double-sided). Normals are
  per face.
- **OBJ**: one `o` per drawn mesh in world space, with `vn` normals, `usemtl` groups and an MTL file with `Kd`
  (sRGB) and `d`. Spaces in names become underscores. The OBJ and the MTL are saved as two files.
- **STL**: binary (80-byte header, float32 facets) or ASCII, in world space.
- **COLLADA 1.4.1**: one `<geometry>` per mesh, a `<node>` tree with matrices and `instance_geometry`, Lambert
  effects with diffuse color and transparency, and the unit and up axis in `<asset>`.

Files are saved through `FileAccess.saveCopy`: the save dialog where the browser has one, otherwise a download.

### 2D graphic (PNG)

**Export 2D Graphic…** asks for a width and height (defaulting to the view size, each at most 8192 pixels and
clamped to the GPU's maximum texture size) and whether the background is transparent.
`Viewport.capture` renders the current camera into an offscreen multisampled target. Tool previews, overlays and
the drawing axes are left out. The image is converted to sRGB and encoded as PNG. The app layer reaches it only
through `ViewCapturePort` (`src/app/io/viewCapture.ts`), which the viewport host attaches.

## Limits

Defaults are in `DEFAULT_IMPORT_LIMITS` (`src/io/mesh/limits.ts`) and can be overridden with the editor
environment's `importLimits`.

| Limit | Default | When exceeded |
|---|---|---|
| Single file (also each zip entry, by declared size) | 256 MB | Refused before the options dialog |
| All files after unzipping | 512 MB | Refused |
| Zip entries | 2,000 | Refused |
| Triangles | 250,000 | Refused with the count and the limit |
| Nodes (groups) | 50,000 | Refused |
| Texture image | 32 MB, 8,192 px per side (kernel limits) | Skipped with a warning; the material keeps its color |
| PNG export edge | 8,192 px | Clamped |

Non-finite coordinates or transforms, indices out of range, and node graphs that aren't trees are refused.

## Security

- **No network.** Loaders never fetch. glTF buffers are resolved from data URIs, the GLB binary chunk or the picked
  files before three's loader sees the file, and images are read by Planar and then removed. MTL libraries and
  texture images come only from the picked files or `data:` URIs. COLLADA references outside the document are not
  followed.
  Each external URL is ignored with a warning, and unit tests assert that `fetch` is never called.
- **Parsing in a worker**, so a malformed or huge file can't freeze the interface.
- **COLLADA XML** is parsed by a strict parser that refuses entity declarations and expands only the five
  predefined entities and numeric character references, so there is no entity expansion and no external entity.
- **Zips** are refused if they contain absolute paths, `..` segments, drive letters or backslashes.
- **Layer boundaries.** three.js loaders are used only in `src/io/import`, and the application layer can't import
  the parsers (ESLint, see ARCHITECTURE.md).

## Known limitations

- **Textures** are imported as one planar placement per face (see "Textures" above for what that can't reproduce).
  Standalone PNG/JPEG image import is not offered yet.
- **Texture export**: exporters are unchanged and write materials as flat colors; imported textures stay in the
  model (and in `.planar` files) but aren't written to glTF, OBJ or COLLADA.
- **glTF**: base color factor, alpha and the base color texture are the only material properties mapped. Draco and meshopt compression
  are refused. Skins, morph targets, animations and sparse accessors are dropped, so skinned meshes import in bind pose.
- **OBJ**: faces with `usemtl` names missing from the MTL files get no material. Free-form geometry, lines and
  points are ignored.
- **COLLADA**: only `profile_COMMON` diffuse colors and transparency are read. Polygons are fan-triangulated, so
  concave polygons can come out wrong. `polygons` holes (`<ph>`) are ignored. X-up files are imported as Z-up.
- **3DS**: the loader applies mesh matrices as it reads them; smoothing groups and cameras are ignored. There is no
  3DS export.
- **Export**: edges without faces, guides, dimensions, text and section planes are not exported. Materials export
  as flat colors. glTF and COLLADA are written with double-sided materials instead of back-face materials.
- **PNG**: the image uses the on-screen style. There is no line-width scaling for large images.
