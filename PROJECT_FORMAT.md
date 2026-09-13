# Planar Project Format

Planar's native file is a `.planar` project. It is a ZIP container (fflate) and holds everything needed to reopen a
model with no network access.

## Container layout

```
example.planar
├── manifest.json            format identification and versions
├── model.json               document, definitions, geometry
├── assets/textures/<sha256>.<png|jpg|webp>
├── assets/environments/<sha256>.<hdr|exr>
└── thumbnail.png            preview image (optional)
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
  "materials": [{ "id": 1, "name": "Brick", "color": [0.7, 0.3, 0.2], "opacity": 1, "roughness": 0.9,
                  "metalness": 0, "texture": { "asset": "<sha256>", "width": 0.5, "height": 0.25 }, ... }],
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
6. **Textures.** Texture assets are decoded lazily. A missing or undecodable asset falls back to the material's color,
   with a warning.

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
