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
| OBJ `.obj` + `.mtl` | Yes (MTL colors and opacity) | Yes (OBJ and MTL files) | Import: three `OBJLoader` plus Planar's MTL reader. Export: Planar writer |
| STL `.stl` | Yes (binary and ASCII) | Yes (binary and ASCII) | Import: three `STLLoader`. Export: Planar writer |
| COLLADA `.dae` | Yes | Yes | Planar reader and writer (three's `ColladaLoader` needs `DOMParser`, which workers lack) |
| 3DS `.3ds` | Yes | No | three `TDSLoader`, with texture maps read for their names only |
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
   - The file becomes one group (or component) at the origin of the open context, placed on the active tag and selected.
   - Nodes become nested groups. A set of meshes drawn by several nodes (glTF meshes, COLLADA library nodes) becomes one
     component with an instance per node.
5. **Summary.** A notification reports faces, groups, components and materials, plus the number of degenerate
   triangles dropped. Up to three warnings follow (skipped external references, missing companion files, ignored
   non-mesh objects, texture names).

If anything fails, the error is shown and the transaction is rolled back, so the model is unchanged.

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
| Texture edge | 4,096 px | Clamped (`clampImageSize`), for when textures are imported |
| PNG export edge | 8,192 px | Clamped |

Non-finite coordinates or transforms, indices out of range, and node graphs that aren't trees are refused.

## Security

- **No network.** Loaders never fetch. glTF buffers are resolved from data URIs, the GLB binary chunk or the picked
  files before three's loader sees the file, and images are removed. MTL libraries come only from the picked files.
  Texture maps in 3DS files are read for their names only. COLLADA references outside the document are not followed.
  Each external URL is ignored with a warning, and unit tests assert that `fetch` is never called.
- **Parsing in a worker**, so a malformed or huge file can't freeze the interface.
- **COLLADA XML** is parsed by a strict parser that refuses entity declarations and expands only the five
  predefined entities and numeric character references, so there is no entity expansion and no external entity.
- **Zips** are refused if they contain absolute paths, `..` segments, drive letters or backslashes.
- **Layer boundaries.** three.js loaders are used only in `src/io/import`, and the application layer can't import
  the parsers (ESLint, see ARCHITECTURE.md).

## Known limitations

- **Textures are not imported.** Texture file names are recorded on imported materials (`textureName`) and listed
  in warnings, but only colors and opacity are mapped, because this branch has no texture material API. For the same
  reason PNG/JPEG image import is not offered.
- **glTF**: the base color factor and alpha are the only material properties mapped. Draco and meshopt compression
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
