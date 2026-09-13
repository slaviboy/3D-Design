# Planar Project Format

Planar's native file is a `.planar` project. It is a ZIP container (fflate) and holds everything needed to reopen a
model with no network access.

## Container layout

```
example.planar
├── manifest.json            format identification and versions
├── model.json               document, definitions, geometry
├── assets/textures/<sha256>.<png|jpg>   texture images, stored without recompression
├── assets/environments/<sha256>.<hdr|exr>   (planned)
└── thumbnail.png            preview image (optional, planned)
```

## manifest.json

```json
{
  "format": "planar-model",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "createdAt": "2026-09-13T10:00:00.000Z",
  "modifiedAt": "2026-09-13T10:30:00.000Z"
}
```

- **`format`** must equal `planar-model`. Any other value is rejected as "not a Planar project".
- **`schemaVersion`** is an integer.
  - A file with an **older** version is migrated on load, one version at a time.
  - A file with a **newer** version is refused with a clear message, and is never partially loaded.

## model.json (schema v1 outline)

```jsonc
{
  "units": { "format": "decimal", "length": "m", "area": "m2", "volume": "m3", "precision": 3, ... },
  "modelInfo": { "title": "", "description": "", "author": "" },
  "nextId": 12345,
  "materials": [{ "id": 1, "name": "Brick", "color": { "r": 0.7, "g": 0.3, "b": 0.2 }, "opacity": 1,
                  "roughness": 0.9, "metalness": 0.1,                    // only when not 1 and 0
                  "texture": { "assetId": 3, "width": 0.5, "height": 0.25 } }],  // only when textured
  "textures": [{ "id": 3, "name": "bricks.png", "mimeType": "image/png", "width": 512, "height": 256,
                 "byteLength": 48213, "sha256": "<64 hex digits>" }],   // only when the model has textures
  "tags": [{ "id": 2, "name": "Walls", "visible": true, "color": [..], "dash": "solid", "folderId": null }],
  "axes": { "origin": { "x": 0, "y": 0, "z": 0 }, "xAxis": {..}, "yAxis": {..} },  // only when moved from the default
  // per definition, only when present:
  "annotations": [{ "id": 40, "geometry": { "kind": "linear-dimension", "start": { "point": {..}, "vertex": 7 }, "end": {..}, "offset": {..} }, "attributes": { "text": null, "hidden": false, "tagId": null } }],
  "tagFolders": [],
  "styles": [ /* StyleSpec */ ],
  "activeStyleId": 3,
  "scenes": [{ "id": 4, "name": "Front", "saves": { "camera": true, ... }, "camera": { ... }, ... }],
  "shadows": { ... }, "geo": { "latitude": 0, "longitude": 0, "northAngle": 0, "timeZone": 0 },
  "environment": null,
  "camera": { ... },
  "rootDefinitionId": 5,
  "definitions": [{
    "id": 5, "name": "Model", "isGroup": false,
    "geometry": {
      "vertexIds":   "<base64 Float64Array or Uint32Array>",
      "positions":   "<base64 Float64Array, xyz per vertex>",
      "edges":       { "ids": "...", "v0": "...", "v1": "...", "flags": "...", "curve": "...", "material": "...", "tag": "..." },
      "faces":       { "ids": "...", "loopOffsets": "...", "loopEdges": "...", "loopReversed": "...", "attrs": [...] },
      "curves":      [{ "id": 9, "kind": "circle", "params": { ... }, "edges": [..] }]
    },
    "instances": [{ "id": 6, "definitionId": 7, "transform": [16 numbers], "name": "", "tagId": 2, ... }],
    "guides": [], "dimensions": [], "texts": [], "sectionPlanes": [], "images": []
  }]
}
```

## Materials and texture assets (implemented)

The current `model.json` is the kernel snapshot (`src/kernel/model/snapshot.ts`), not yet the columnar layout above.
Its material and texture parts are final:

- **Materials** have `id`, `name`, `color` (linear RGB, each channel in [0, 1]) and `opacity` in [0, 1].
  - `metalness` (default 0) and `roughness` (default 1), both in [0, 1], are written only when they differ from the
    default. Files written before these attributes existed therefore load unchanged and hash identically.
  - `texture` is written only when set: `assetId` names a texture asset, and `width` and `height` are the size of one
    tile in meters (each longer than `EPS_LEN`). Aspect locking is a UI concern and is not stored.
- **Faces** keep `frontMaterialId` and `backMaterialId` (null for the default material). Each side can also have
  `frontTexturePlacement` / `backTexturePlacement` = `{ offsetX, offsetY, rotation, scaleX, scaleY }` (meters, radians,
  non-zero scale factors), written only when set. Without one, the side uses the default planar projection.
- **Instances** keep `materialId`, which faces with no material inside the instance show.
- **Texture assets** (`textures`) describe images stored in the archive. `mimeType` is `image/png` or `image/jpeg`,
  `width` and `height` are pixel sizes, and `sha256` names the archive entry
  `assets/textures/<sha256>.<png|jpg>`. Assets are document-level entities with ids from the same counter as
  everything else, added and removed through the `asset.add` and `asset.remove` changes, so importing or removing
  a texture is undoable.

**Validation and limits** (`src/kernel/model/assets.ts`, `validate.ts`, `io/format/planarFile.ts`):

- A texture entry larger than `MAX_TEXTURE_BYTES` (32 MB) is refused from the archive directory before it is
  decompressed, and again after decompression.
- An image must be a PNG or JPEG whose header is readable, and at most `MAX_TEXTURE_DIMENSION` (8192) pixels on each
  side. The stored `mimeType`, `width` and `height` must match the header.
- A missing image, or bytes whose length or SHA-256 differ from the record, refuse the whole file.
- A material's texture must reference an existing asset. Out-of-range color, opacity, metalness or roughness, a
  non-positive tile size, and a non-finite or zero-scale placement are all refused.
- Importing through the editor applies the same checks, and copies the bytes so the model can't be changed from
  outside.

Bulk geometry is stored as columnar typed arrays encoded in base64. Compared with arrays of small objects, this is
smaller, parses faster, and transfers to workers without copying. The exact field list is fixed in
`src/io/format/schemaV1.ts` when persistence is implemented. This outline is the design target.

## Loading pipeline

1. **Size check.** The file size is compared against the configured limit, and the ZIP is checked to be a valid
   container.
2. **Unzip.** `manifest.json` and `model.json` must be present. Unexpected entries are ignored, and paths with `..`
   or absolute prefixes are rejected.
3. **Parse and validate the manifest.** Migrate the model if its schema is older.
4. **Structural validation.** A hand-written validator checks types, finite numbers, enum values, array lengths
   (`positions.length === 3 × vertex count`, loop offsets monotonic and in range), and that every id reference
   resolves.
5. **Build the kernel stores.** Then run the kernel invariant validator (GEOMETRY.md).
   - Recoverable problems (duplicate vertices, zero-length edges, orphan references) are repaired, and the user sees a
     report.
   - Unrecoverable corruption aborts loading with an explicit error. The current model is not touched.
6. **Textures.** Image bytes are verified (size, header, SHA-256) while loading, so a missing or corrupt texture
   refuses the file. The renderer decodes images lazily, on first use. An image that passes validation but can't be
   decoded falls back to the material's color. There is no user-visible warning for that yet.

## Migrations

- **Location.** `src/io/format/migrations/` holds one pure function per version step (`v1ToV2`, …).
- **Tests.** Each migration has fixture files from the previous version and a test that asserts the migrated result
  validates.
- **Compatibility promise.** Every earlier schema version stays loadable.

## Local storage (IndexedDB)

| Store | Content |
|---|---|
| `recovery` | Autosave snapshots per session: `{sessionId, documentName, savedAt, bytes}`, keeping the last N (default 5) |
| `recent` | Recently opened files: name, time, thumbnail, and a File System Access handle where supported |
| `libraries` | User materials, components, styles, environments |
| `settings` | Preferences, keyboard shortcuts, panel layout |

- **Persistence.** On first save, Planar calls `navigator.storage.persist()`.
- **Exit marker.** A clean exit clears the session's recovery marker. At startup, any leftover snapshots are offered
  in a recovery dialog.

## Save and open

- **Chromium-based browsers:** the File System Access API. Save writes back to the same file.
- **Firefox and Safari:** open with a file picker, and save by downloading.
- **Backup.** Before overwriting a file, the previous saved version is kept as a recovery snapshot.
