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
└── thumbnail.png            320×240 PNG preview of the view at save time (optional, stored uncompressed, ≤ 2 MB)
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
  "scenes": [{ "id": 4, "name": "Front", "saves": { "camera": true, ... }, "camera": { ... }, ... }],  // only when present
  "shadows": { "enabled": true, "dateTime": "2026-06-21T14:00:00+02:00", "latitude": 48.2, ... },  // only when not default
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

### Scenes, section planes and shadow settings (implemented)

The current `model.json` is the kernel snapshot (`src/kernel/model/snapshot.ts`). These three parts are written only
when they hold something, so documents that don't use them keep their exact bytes and content hash, and files saved
before they existed load unchanged.

- **Section planes** (per definition, `sectionPlanes`, present only when the definition has any):
  `{ "id", "name", "point": {x,y,z}, "normal": {x,y,z}, "active" }`, in the definition's own coordinates.
  - `normal` must be a unit vector. Geometry on the side it points to is cut away while the plane is active.
  - At most one plane per definition may be active; a file with two is rejected (`multiple-active-sections`).
  - Section plane ids share the document id space and must be below `nextId`.
- **Shadow settings** (document level, `shadows`, present only when any field differs from the default):
  - `enabled`, `useSunForShading`, `onFaces`, `onGround`: booleans.
  - `dateTime`: local date and time with its UTC offset, always written as `YYYY-MM-DDTHH:MM:SS±HH:MM`. Offsets
    range from −12:00 to +14:00. There is no named time zone and no daylight-saving rule: the offset is what
    the user chose.
  - `latitude` (−90…90), `longitude` (−180…180) and `northAngle` (degrees clockwise, seen from above, from the
    model's +Y axis to true north, stored in 0…360). Location is entered by hand; nothing is looked up online.
  - `light` and `dark`: 0…1. The defaults (0.8 and 0.45) reproduce the lighting of earlier versions.
- **Scenes** (document level, `scenes`, in display order, present only when there are scenes):
  - `id`, `name` (not empty), `description`, `includeInAnimation`.
  - `saves`: `{ "camera", "visibleTags", "activeSections", "shadows", "axes" }` booleans.
  - Saved values, each `null` when its flag was off at the last update:
    - `camera`: `{ eye, target, up, fovDegrees, projection: "perspective" | "parallel", orthoHalfHeight }`;
    - `hiddenTags`: tag ids that were hidden;
    - `sections`: `[{ "context": definitionId, "plane": sectionPlaneId | null }]`, one entry per definition that had
      section planes;
    - `shadows`: a full shadow settings object;
    - `axes`: `{ origin, xAxis, yAxis }`.
  - Scenes may refer to tags, definitions or section planes deleted after the scene was saved. Such references are
    kept in the file and skipped when the scene is shown.
  - The scene transition time and animation delay are editor settings and are not stored in the file yet.

### Styles, fog and environment (implemented)

All four fields are document level and written only when they differ from the default (or, for `styles`, when the
list is not empty), so files without them keep their bytes and hash, and older files load unchanged.

- **Style** (`style`): `faceStyle` (`"wireframe" | "hiddenLine" | "shaded" | "shadedWithTextures" | "monochrome"`),
  `xRay`, `showEdges`, `backEdges`, `profiles`, `depthCue`, `extensions`, `endpoints`, `sky`, `ground`,
  `groundFromBelow` (booleans); `profileWidth` and `depthCueWidth` (pixels, 1…20); `extensionLength` (pixels, 0…100);
  `edgeColorMode` (`"allSame" | "byMaterial" | "byAxis"`); and the colors `frontColor`, `backColor`, `edgeColor`,
  `backgroundColor`, `skyColor`, `groundColor` as `{ r, g, b }` in **sRGB**, each channel in [0, 1] (material colors
  remain linear). The default reproduces the viewport colors of earlier versions.
- **In-model styles** (`styles`): `[{ "name", "settings": <style> }]` in display order. Names are unique, not empty,
  at most 80 characters, without surrounding spaces. Built-in presets are application data and are not stored.
- **Fog** (`fog`): `enabled`, `useBackgroundColor` (booleans), `start` ≥ 0 and `end` > `start` (meters), `color` (sRGB).
- **Environment** (`environment`): `enabled`, `showAsBackground`, `useForReflections` (booleans), `environmentId` (a
  lowercase id matching `^[a-z][a-z0-9-]{0,39}$`: `studio` and `dusk` are built in, `custom` is an HDR image loaded in the
  current session and never stored; unknown ids show the studio), `rotationDegrees` in [0, 360), `exposure` in [0, 4].
- **Scenes** may also save the style and fog: `saves.style` and `saves.fog` are written only when `true`, and the scene's
  `style` and `fog` objects only when saved. A missing flag reads as `false` and a missing object as `null`.
- Invalid values are refused by validation (`invalid-style`, `invalid-styles`, `invalid-fog`, `invalid-environment`,
  or `invalid-scene` for a scene's saved style or fog). Opening with repair resets the document-level setting to its
  default (the whole in-model style list for `invalid-styles`) and removes an invalid scene.

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
5. **Build the kernel stores.** Then run the kernel invariant validator (GEOMETRY.md). The editor opens files with
   repair (`restoreSnapshotWithRepair` in `src/kernel/model/repair.ts`); `decodePlanarFile` without the `repair`
   option stays strict.
   - **Repaired:** references to missing materials, tags or texture images are cleared. Entities that can't be built
     (a face whose edge is missing, an instance of a missing definition) are left out with everything that depends
     on them. Entities the validator reports as invalid are left out. Invalid drawing axes and shadow settings return
     to their defaults, and only the first active section plane of a context is kept. The build and validation repeat
     until the document is valid, for at most 25 passes.
   - **After a repair** the model opens with unsaved changes and a notice listing the fixes. The file on disk is
     unchanged until the user saves, and an in-place save backs up the original bytes first.
   - **Refused:** structural problems (unreadable fields, duplicate ids, ids at or above `nextId`) and problems only
     topology operations could fix (unwelded vertices, T-junctions, crossing edges, overlapping faces). Loading
     aborts with an explicit error and the current model is not touched.
6. **Textures.** Image bytes are verified (size, header, SHA-256) while loading, so a missing or corrupt texture
   refuses the file. The renderer decodes images lazily, on first use. An image that passes validation but can't be
   decoded falls back to the material's color. There is no user-visible warning for that yet.

## Migrations

- **Location.** `src/io/format/migrations.ts` maps each schema version to a pure function that upgrades a parsed
  `model.json` by one step; `migrateModel` chains them. Schema 1 is the first release, so the table is still empty.
- **Tests.** Each migration has fixture files from the previous version and a test that asserts the migrated result
  validates.
- **Compatibility promise.** Every earlier schema version stays loadable.

## Local storage (IndexedDB)

| Store | Content |
|---|---|
| `recovery` | Versioned snapshots `{id, sessionId, kind: autosave \| backup, documentName, savedAt, bytes}`: the 3 newest versions of each kind per session, for the 5 newest sessions. Records written before versions existed read as autosaves whose session is their id |
| `recent` | Recently opened and saved files (database version 2): keyed by file name, the newest 10, with the time and a File System Access handle where the browser supports it. Thumbnails are planned |
| `libraries` | User materials, components, styles, environments |
| `settings` | Preferences, keyboard shortcuts, panel layout |

- **Persistence.** On first save, Planar calls `navigator.storage.persist()`.
- **Exit marker.** A clean exit clears the session's recovery marker. At startup, any leftover snapshots are offered
  in a recovery dialog.

## Save and open

- **Chromium-based browsers:** the File System Access API. Save writes back to the same file.
- **Firefox and Safari:** open with a file picker, and save by downloading.
- **Backup.** Before overwriting a file, the previous saved version is kept as a recovery snapshot.
