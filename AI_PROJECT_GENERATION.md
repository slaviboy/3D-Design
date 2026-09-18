# Generating Planar Projects with AI

This guide is written for an AI model (or a developer) that must **create a `.planar` project file from a
description**, for example "a two-storey house with a garage and a flat roof". A file that follows this guide opens in
Planar with **File > Open** (Ctrl+O / Cmd+O) and works like a model drawn by hand: groups can be moved, faces painted,
tags toggled and scenes clicked.

How to use it:

1. Read sections 1–9 to understand the format and the geometry rules.
2. Copy the reference generator in section 10 (Python 3, standard library only) and write a build script with its
   helpers (section 9 explains the modeling strategy).
3. Run the script. It writes the `.planar` file.
4. Check the result against the checklist in section 12.

Everything here matches the loader in the Planar source code (`src/io/format/planarFile.ts`,
`src/kernel/model/snapshot.ts`, `src/kernel/model/validate.ts`). The reference generator and its example house were
verified by opening them in the app.

---

## 1. The container

A `.planar` file is a standard **ZIP archive** (deflate or stored) with these entries **at the archive root**:

| Entry                                 | Required | Content                                        |
| ------------------------------------- | -------- | ---------------------------------------------- |
| `manifest.json`                       | yes      | Format identification (section 2)              |
| `model.json`                          | yes      | The whole model as JSON (sections 3–8)         |
| `assets/textures/<sha256>.png` or `.jpg` | no    | Texture images referenced by `model.json`      |
| `thumbnail.png`                       | no       | PNG preview for the start screen, at most 2 MB |

- Do **not** put the entries inside a folder (`House/manifest.json` fails with "the archive is missing its manifest
  or model"). Zipping a folder with the operating system's "Compress" command usually does exactly that.
- Paths must not be absolute or contain `..` or backslashes. Other unexpected entries are ignored.
- Limits: the file at most 512 MB, at most 10,000 entries.
- Use the extension `.planar` so the Open dialog shows the file.

## 2. manifest.json

```json
{
  "format": "planar-model",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "createdAt": "2026-09-15T10:00:00.000Z",
  "modifiedAt": "2026-09-15T10:00:00.000Z"
}
```

- `format` must be exactly `planar-model`, and `schemaVersion` must be `1`.
- `appVersion`, `createdAt` and `modifiedAt` must be strings (ISO 8601 times are expected).

## 3. model.json: top level

```jsonc
{
  "format": "planar-document", // required, exactly this
  "version": 1, // required, exactly 1
  "nextId": 128, // required: an integer greater than every id in the file
  "rootDefinitionId": 2, // required: id of the definition that is the model itself
  "materials": [], // required (may be empty), section 6
  "tags": [], // required (may be empty), section 6
  "definitions": [], // required: the root definition, groups and components, section 4

  // Optional. Leave a key out to get the default.
  "shadows": {}, // sun and shadows, section 7
  "scenes": [], // saved views (tabs above the viewport), section 7
  "style": {}, // how the view is drawn, section 7
  "styles": [], // named styles saved in the model, section 7
  "fog": {}, // section 7
  "environment": {}, // section 7
  "axes": {}, // drawing axes, section 7
  "textures": [], // texture images, section 8
}
```

**Every key shown inside the objects in this guide is required unless it is marked optional.** Missing keys or wrong
types refuse the file with "Invalid document structure: $.path: expected …".

### Units, axes and colors

- **Lengths are meters.** Coordinates are 64-bit floats.
- **Z is up.** X is the red axis, Y the green axis. The ground is the plane z = 0; put floors at z = 0 and footings or
  slabs below it.
- A useful convention: +Y points north, +X east. Shadows use it (`northAngle` 0 means north is +Y).
- **Material colors are linear RGB**, each channel 0–1. Convert an sRGB hex color (`#RRGGBB`) with
  `c = v/255; linear = c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)^2.4`.
- **Style, fog and tag colors are sRGB** 0–1 (`v/255`).

### Ids

- Every entity has an **id: a positive integer, unique across the whole file**. Vertices, edges, faces, instances,
  definitions, materials, tags, scenes and so on all share one id space.
- Gaps are allowed. `nextId` must be greater than the largest id.
- The simplest approach is one counter starting at 1 for everything.

## 4. Definitions, groups, components and instances

A **definition** is a container of geometry with its own local coordinates. There are three kinds:

| Kind             | `isGroup` | Instances       | Meaning                                                   |
| ---------------- | --------- | --------------- | --------------------------------------------------------- |
| Root (the model) | `false`   | never instanced | `rootDefinitionId` points to it; its name is the title    |
| Group            | `true`    | exactly one     | A single object: a wall, a slab, a roof                   |
| Component        | `false`   | any number      | A reusable part: a window, a chair; listed in Components  |

```jsonc
{
  "id": 3,
  "name": "Wall south",
  "isGroup": true,
  "vertices": [], // required
  "edges": [], // required
  "faces": [], // required
  "curves": [], // required; leave empty (section 5)
  "instances": [], // required: groups and components placed inside this definition
  "guides": [], // optional
  "annotations": [], // optional, section 7
  "sectionPlanes": [], // optional, section 7
}
```

An **instance** places a definition inside another definition (usually inside the root):

```json
{
  "id": 40,
  "definitionId": 3,
  "transform": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  "attributes": {
    "name": "Wall south",
    "tagId": null,
    "materialId": null,
    "hidden": false,
    "locked": false,
    "castShadows": true,
    "receiveShadows": true
  }
}
```

- `transform` is a **4×4 affine matrix, column-major** (like three.js and glTF). Element (row r, column c) is
  `m[c*4 + r]`. The translation is in `m[12], m[13], m[14]`. It must be invertible (no zero scale).
  - Rotation by angle `a` about +Z, then translation `(tx, ty, tz)`:
    `[cos a, sin a, 0, 0, -sin a, cos a, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]`.
- `materialId` paints faces inside the instance that have no material of their own.
- Definitions may be nested (a "House" group holding wall groups). A definition may not contain itself through its
  instances, and the root may never be instanced.
- **Simplest valid strategy:** draw every group's geometry directly in world coordinates, and place it with the
  identity transform. Use real transforms for components that repeat (windows, columns, chairs).

## 5. Geometry: vertices, edges, faces

Geometry lives inside a definition. It is a boundary representation: vertices, straight edges between them, and planar
faces bounded by loops of edges.

```jsonc
// vertex
{ "id": 10, "position": { "x": 0, "y": 0, "z": 0 } }

// edge: joins two vertices
{ "id": 20, "v0": 10, "v1": 11,
  "attributes": { "soft": false, "smooth": false, "hidden": false, "materialId": null, "tagId": null } }

// face
{ "id": 30,
  "outer":  [ { "edge": 20, "reversed": false }, { "edge": 21, "reversed": false }, { "edge": 22, "reversed": true } ],
  "inners": [ /* holes: one loop per hole, same format as outer */ ],
  "attributes": { "frontMaterialId": 1, "backMaterialId": 1, "tagId": null, "hidden": false } }
```

**Loops.**

- A loop is a list of edge uses that walks around a polygon.
- `reversed: false` means the walk goes from the edge's `v0` to its `v1`, and `reversed: true` means from `v1` to
  `v0`.
- Each use must end at the vertex where the next use starts, and the last must end where the first starts.
- A loop needs at least 3 edges and may not visit a vertex twice.

**Winding decides the front side.**

- The outer loop runs **counter-clockwise when you look at the front side** (right-hand rule: curl your fingers along
  the loop and your thumb points out of the front).
- Holes (`inners`) run the **opposite way** (clockwise seen from the front).
- For closed solids, make every front side point outward. The front uses `frontMaterialId`, and the back shows
  `backMaterialId` (or the style's blue-gray back color when it is null).
- Setting both materials to the same id makes winding mistakes invisible, and the reference generator does that for
  solids.

**Faces are shared through edges.** Two faces that meet along a line must use **the same edge id** (and therefore the
same two vertex ids). Never create two vertices at the same position, or two edges between the same pair of vertices.

**Curves.** Leave `curves` empty. Approximate arcs and circles by polygons with straight edges (for example 24–48
segments per circle). Curve records only add editing metadata, and a wrong one refuses the file.

**Soft/smooth edges.** On a faceted round surface (a column made of 32 side faces), set the vertical edges'
`soft: true, smooth: true` so they render smooth and hide their lines.

## 6. Materials and tags

```jsonc
// material
{
  "id": 1,
  "name": "Brick",
  "color": { "r": 0.45, "g": 0.12, "b": 0.07 },
  "opacity": 1,
  "roughness": 0.9, // optional, 0–1, default 1 (matte)
  "metalness": 0, // optional, 0–1, default 0
  "texture": { "assetId": 5, "width": 0.5, "height": 0.25 }, // optional, section 8
}
```

```json
{ "id": 7, "name": "Roof", "visible": true, "color": { "r": 0.54, "g": 0.23, "b": 0.16 } }
```

- `opacity` is 0 (invisible) to 1 (opaque). Use about 0.3–0.4 for glass.
- A tag (the second object) is a visibility layer shown in the Tags panel.
- Tags can be attached to instances, faces, edges, guides and annotations through `tagId`. Tag instances (whole
  objects), such as "Walls", "Roof", "Furniture" or "Level 1", so users can hide categories.
- Every `materialId` and `tagId` used anywhere must exist.

## 7. Optional document settings

Leave any of these out to use the default. When present, every field is required.

### Shadows (the sun)

```json
{
  "enabled": true,
  "dateTime": "2026-06-21T15:00:00+02:00",
  "latitude": 48.2,
  "longitude": 16.4,
  "northAngle": 0,
  "light": 0.8,
  "dark": 0.45,
  "useSunForShading": true,
  "onFaces": true,
  "onGround": true
}
```

- `dateTime` is exactly `YYYY-MM-DDTHH:MM:SS±HH:MM`, with an offset from −12:00 to +14:00.
- `latitude` is −90…90 and `longitude` −180…180.
- `northAngle` is in degrees, clockwise seen from above, from +Y to true north (0…360).
- `light` and `dark` are 0…1.

### Scenes (saved camera views, shown as tabs; clicking one moves the camera)

```json
{
  "id": 90,
  "name": "Street view",
  "description": "",
  "includeInAnimation": true,
  "saves": { "camera": true, "visibleTags": false, "activeSections": false, "shadows": false, "axes": false },
  "camera": {
    "eye": { "x": 22, "y": -16, "z": 11 },
    "target": { "x": 5, "y": 4, "z": 1.8 },
    "up": { "x": 0, "y": 0, "z": 1 },
    "fovDegrees": 35,
    "projection": "perspective",
    "orthoHalfHeight": 5
  },
  "hiddenTags": null,
  "sections": null,
  "shadows": null,
  "axes": null
}
```

- `name` must not be empty. `projection` is `perspective` or `parallel` (`orthoHalfHeight` is the half height of the
  view in meters for `parallel`).
- `hiddenTags`, `sections`, `shadows` and `axes` must be present. Use `null`, or saved values with the matching
  `saves` flag set to `true`:
  - `hiddenTags`: a list of tag ids;
  - `sections`: `[{"context": definitionId, "plane": sectionPlaneId | null}]`;
  - `shadows` and `axes`: full objects.
- Optional extras: `saves.style` and `saves.fog` (booleans), with `style` and `fog` objects.
- A top view looks straight down. Offset the eye slightly in y, or use `up: {x:0, y:1, z:0}`.

### Style (all 21 fields; colors sRGB)

```json
{
  "faceStyle": "shadedWithTextures",
  "xRay": false,
  "frontColor": { "r": 0.949, "g": 0.941, "b": 0.918 },
  "backColor": { "r": 0.62, "g": 0.686, "b": 0.765 },
  "showEdges": true,
  "backEdges": false,
  "profiles": true,
  "profileWidth": 3,
  "depthCue": false,
  "depthCueWidth": 4,
  "extensions": false,
  "extensionLength": 6,
  "endpoints": false,
  "edgeColorMode": "allSame",
  "edgeColor": { "r": 0.114, "g": 0.137, "b": 0.169 },
  "backgroundColor": { "r": 0.875, "g": 0.898, "b": 0.922 },
  "sky": true,
  "skyColor": { "r": 0.612, "g": 0.765, "b": 0.902 },
  "ground": true,
  "groundColor": { "r": 0.788, "g": 0.757, "b": 0.69 },
  "groundFromBelow": false
}
```

- `faceStyle` is one of `wireframe`, `hiddenLine`, `shaded`, `shadedWithTextures` or `monochrome`.
- `edgeColorMode` is one of `allSame`, `byMaterial` or `byAxis`.
- `profileWidth` and `depthCueWidth` are 1–20, and `extensionLength` is 0–100.
- `styles` is a list of `{"name": "Presentation", "settings": <style>}`. Names must be unique, 1–80 characters, and
  have no surrounding spaces.

### Fog, environment and axes

```json
{ "enabled": true, "start": 30, "end": 300, "useBackgroundColor": true, "color": { "r": 0.87, "g": 0.9, "b": 0.92 } }
```

```json
{
  "enabled": true,
  "environmentId": "studio",
  "rotationDegrees": 0,
  "exposure": 1,
  "showAsBackground": false,
  "useForReflections": true
}
```

- **Fog** (the first object): `start` must be ≥ 0 and `end` greater than `start`.
- **Environment** (image lighting, the second object):
  - `environmentId` is `studio` or `dusk`;
  - `rotationDegrees` is in [0, 360) and `exposure` 0–4.
- **Axes:** `{"origin": {x,y,z}, "xAxis": {x,y,z}, "yAxis": {x,y,z}}`. The two axes must be perpendicular unit
  vectors. Normally leave this out.

### Annotations, guides and section planes (per definition)

```jsonc
// annotations: a text label with a leader line pointing at a spot
{
  "id": 95,
  "geometry": {
    "kind": "leader-text",
    "target": { "point": { "x": 5, "y": 4, "z": 0 }, "vertex": null },
    "offset": { "x": 0, "y": 0, "z": 2.5 },
  },
  "attributes": { "text": "Living room", "hidden": false, "tagId": null },
}
```

```jsonc
// annotations: a dimension; text null shows the measured length
{
  "id": 96,
  "geometry": {
    "kind": "linear-dimension",
    "start": { "point": { "x": 0, "y": 0, "z": 0 }, "vertex": null },
    "end": { "point": { "x": 10, "y": 0, "z": 0 }, "vertex": null },
    "offset": { "x": 0, "y": -1.5, "z": 0 },
  },
  "attributes": { "text": null, "hidden": false, "tagId": null },
}
```

- **Annotations** (key `annotations`): `vertex` may name a vertex id of the same definition, and the annotation then
  follows that vertex.
- **Guides** (key `guides`), construction lines:
  - a line: `{"id": 97, "geometry": {"kind": "line", "point": {x,y,z}, "direction": <unit vector>}, "attributes":
    {"hidden": false, "tagId": null}}`;
  - a point: the same, with `"geometry": {"kind": "point", "point": {x,y,z}}`.
- **Section planes** (key `sectionPlanes`):
  `{"id": 98, "name": "Plan cut", "point": {"x": 0, "y": 0, "z": 1.2}, "normal": {"x": 0, "y": 0, "z": 1}, "active": false}`.
  - `normal` must be a unit vector. Geometry on the side it points to is hidden while the plane is active.
  - At most one plane per definition may be active.

## 8. Textures (optional)

Prefer plain colors. Add textures only when you can supply real PNG or JPEG bytes.

```json
{
  "id": 5,
  "name": "brick.png",
  "mimeType": "image/png",
  "width": 512,
  "height": 256,
  "byteLength": 48213,
  "sha256": "<64 lowercase hex digits of the file's SHA-256>"
}
```

- Store the image bytes unchanged at `assets/textures/<sha256>.png` (or `.jpg` for `image/jpeg`).
- `width` and `height` are the image's pixel size and must match its header. The image may be at most 8192 px on a
  side and 32 MB.
- A material uses it with `"texture": {"assetId": 5, "width": 0.5, "height": 0.25}`, where the tile size is in
  meters.
- Optionally, per face side, add `frontTexturePlacement` or `backTexturePlacement` =
  `{"offsetX", "offsetY", "rotation", "scaleX", "scaleY"}` (meters, radians, non-zero scales).
- A missing image, or bytes whose size or hash differ, refuse the whole file.

## 9. Geometry rules and the modeling strategy

### The rules

The app checks these rules **separately inside each definition** (tolerance 1e-6 m). Geometry in _different_ groups
never interacts: two groups may overlap, touch or intersect freely.

1. No two vertices closer than 1e-6 m. Weld them into one vertex.
2. No edge shorter than 1e-6 m, and no two edges between the same pair of vertices.
3. **No T-junctions:** a vertex may not lie on the middle of an edge it does not belong to. Split the edge at that
   vertex.
4. **Edges may not cross or touch** except at a shared vertex.
5. Face loops are closed and simple, with at least 3 edges and each edge at most once per face.
6. **Faces are planar:** every vertex lies within 1e-6 m of the face plane.
7. The outer loop runs counter-clockwise around the face normal, holes clockwise. Holes lie inside the outer loop and
   do not overlap each other. A hole may touch the outer loop only at a single vertex, never along an edge.
8. **No two faces in a definition overlap on the same plane.**
9. All referenced ids exist. Instance transforms are finite and invertible. There are no definition cycles.

### Strategy that always satisfies them

- **One solid per group.** Make every wall, slab, roof plane, beam, stair flight or piece of furniture its own group.
  Inside a group, build one closed solid (a box or an extruded polygon). This avoids rules 3, 4 and 8 entirely,
  because different groups are checked independently.
- **Never put two touching boxes in the same group.** Two boxes sharing part of a face create T-junctions and
  crossing edges, and the file is refused. Use two groups instead.
- **Extrude 2D profiles.** A prism (a 2D polygon with optional holes, extruded by a thickness) is always valid when
  the polygon is simple and the holes are strictly inside. Walls, slabs, roof planes, gables, stairs seen from the
  side, and L-shaped or U-shaped floors are all prisms.
- **Doors and windows.**
  - A window is a **hole** in the wall's elevation profile.
  - A door that reaches the floor is a **notch** in the outer outline. It is not a hole, because a hole may not share
    an edge with the outline.
  - Keep openings at least a few centimeters from the wall ends and the top.
- **Wall corners.** Run two parallel walls the full length, and fit the other two between them (butt joints). This
  avoids visible coplanar overlaps (z-fighting) between groups.
- **Glass.** Use one face with the same glass material on both sides, placed in the middle of the wall opening.
  Define it once as a component and place it in every window with a transform.
- **Never leave two visible surfaces in the same plane, or a few centimeters apart.** Both flicker as the camera
  moves, because the depth buffer can't separate them. The usual mistakes, all of which show up in generated models:
  - a floor sunk into the slab below it, or two paving slabs whose tops are both at z = 0;
  - two floor patches that overlap in plan at the same height — give each room its own area, or let one tuck under;
  - **walls whose tops are level with the top of the slab above them.** A wall carries the slab, so it stops at the
    slab's underside: a 3.02 m wall under a slab spanning 3.02–3.20, not a 3.20 m wall.

  Stack solids flush, so the touching faces are hidden between them (a floor's underside exactly on a slab's top),
  or leave a real gap of a few tenths of a meter. Faces that touch flush are fine; faces that nearly touch are not.
- **Sloped surfaces.** Do not round the coordinates of a sloped quad to millimeters, because that breaks planarity.
  Compute its points from one exact origin and exact axis vectors (as `prism()` does). Rounding is only safe on
  axis-aligned faces.
- **Round shapes.** Build them as prisms of a polygon with 24–48 sides.
- **Storeys.** Use `base_z = level × storey height`. Put each level's slab below its floor height, and tag groups per
  level ("Level 1", "Level 2").
- **Realistic sizes.** Typical dimensions:
  - exterior walls 0.25–0.4 m thick, interior walls 0.1–0.15 m;
  - storey height about 3 m, doors 0.9 × 2.1 m;
  - windows with a sill at about 0.9 m, stair risers 0.17 m and treads 0.28 m.
- Give groups meaningful `name`s. They appear in the Outliner.
- Add one or two scenes (an eye-level street view and a view from above) so the user can jump between them.
- Leave `locked` and `hidden` false on instances. A locked group refuses every edit.

### How the user edits the result

A generated project is fully editable, but grouped geometry is edited the way groups work in Planar:

- **Click** a wall to select the whole group. Move, Rotate and Scale then act on the group as a unit.
- **Double-click** a group to open it. Push/Pull, Move, Line, Eraser and the other tools then edit its faces and
  edges: raise a wall, thicken it, or move a window. Click outside the group or press Esc to close it.
- **Explode** a group to merge its geometry into the model around it. Exploding every group gives one connected
  model in which walls, slabs and roof share edges, as if drawn by hand. Components (such as the window glass) stay
  reusable.

## 10. Reference generator (Python 3, standard library only)

Save as `planar_gen.py`.

- Running it directly writes `example-house.planar`: a 10 × 8 m house with a slab, four walls, a door, five windows
  with glass, gables, a pitched roof, tags, shadows and two scenes.
- To build other projects, import it and use `Project`, `Definition.box`, `Definition.prism`, `Definition.face`,
  `wall` and `transform`.

```python
#!/usr/bin/env python3
"""planar_gen: writes Planar .planar project files using only the Python standard library.

Coordinates are meters, Z is up. Each solid building element goes in its own group,
because the geometry rules are checked separately inside every group.
"""
import datetime
import json
import math
import zipfile

IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
WELD = 1e-5  # points closer than this become one vertex (the app refuses distinct points within 1e-6)


# ----------------------------------------------------------------------------- math helpers

def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def mul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def length(a): return math.sqrt(dot(a, a))


def normalize(a):
    n = length(a)
    if n == 0:
        raise ValueError("zero-length vector")
    return (a[0] / n, a[1] / n, a[2] / n)


def newell_normal(points):
    """Unnormalized normal of a polygon; points counter-clockwise around it (right-hand rule)."""
    nx = ny = nz = 0.0
    for i, p in enumerate(points):
        q = points[(i + 1) % len(points)]
        nx += (p[1] - q[1]) * (p[2] + q[2])
        ny += (p[2] - q[2]) * (p[0] + q[0])
        nz += (p[0] - q[0]) * (p[1] + q[1])
    return (nx, ny, nz)


def signed_area_2d(points):
    return 0.5 * sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(points, points[1:] + points[:1]))


def transform(translate=(0, 0, 0), rotate_z_deg=0.0, scale=1.0):
    """Column-major 4x4 matrix: scale, then rotate about +Z, then translate."""
    c = math.cos(math.radians(rotate_z_deg)) * scale
    s = math.sin(math.radians(rotate_z_deg)) * scale
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, scale, 0, translate[0], translate[1], translate[2], 1]


def srgb_hex_to_linear(hex_color):
    """'#RRGGBB' (as seen in a color picker) -> linear RGB dict used by materials."""
    h = hex_color.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return {"r": round(out[0], 6), "g": round(out[1], 6), "b": round(out[2], 6)}


# ----------------------------------------------------------------------------- definitions

class Definition:
    """A context with its own geometry: the root model, a group or a component."""

    def __init__(self, project, def_id, name, is_group):
        self.project = project
        self.id = def_id
        self.name = name
        self.is_group = is_group
        self.vertices = []           # {"id", "position"}
        self._cells = {}             # weld grid: cell -> [(vertex id, point)]
        self.edges = {}              # (min vid, max vid) -> edge dict
        self.faces = []
        self.instances = []

    # -- low level
    def vertex(self, p):
        p = (float(p[0]), float(p[1]), float(p[2]))
        if not all(math.isfinite(c) for c in p):
            raise ValueError(f"non-finite point {p}")
        cell = tuple(math.floor(c / (WELD * 10)) for c in p)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for vid, q in self._cells.get((cell[0] + dx, cell[1] + dy, cell[2] + dz), []):
                        if length(sub(p, q)) <= WELD:
                            return vid
        vid = self.project.new_id()
        self.vertices.append({"id": vid, "position": {"x": p[0], "y": p[1], "z": p[2]}})
        self._cells.setdefault(cell, []).append((vid, p))
        return vid

    def _use(self, a, b):
        """Loop use of the edge from vertex a to vertex b, creating the edge if needed."""
        key = (min(a, b), max(a, b))
        edge = self.edges.get(key)
        if edge is None:
            edge = {"id": self.project.new_id(), "v0": a, "v1": b,
                    "attributes": {"soft": False, "smooth": False, "hidden": False,
                                   "materialId": None, "tagId": None}}
            self.edges[key] = edge
        return {"edge": edge["id"], "reversed": edge["v0"] != a}

    def _ring(self, points):
        ids = []
        for p in points:
            v = self.vertex(p)
            if not ids or ids[-1] != v:
                ids.append(v)
        if len(ids) > 1 and ids[0] == ids[-1]:
            ids.pop()
        if len(ids) < 3 or len(set(ids)) != len(ids):
            raise ValueError(f"face loop needs 3+ distinct points and must not revisit a point: {points}")
        return ids

    # -- geometry
    def face(self, outer, holes=(), front=None, back=None, tag=None, hidden=False):
        """A planar polygon. `outer` is counter-clockwise seen from the front side; holes are fixed automatically."""
        outer_ids = self._ring(outer)
        normal = newell_normal(outer)
        if length(normal) < 1e-9:
            raise ValueError("face has no area")
        unit = normalize(normal)
        for p in outer:
            if abs(dot(sub(p, outer[0]), unit)) > 1e-7:
                raise ValueError("face points are not coplanar")
        loops = [outer_ids]
        for hole in holes:
            hole = list(hole)
            if dot(newell_normal(hole), normal) > 0:
                hole.reverse()  # holes run clockwise around the face normal
            loops.append(self._ring(hole))
        uses = [[self._use(r[i], r[(i + 1) % len(r)]) for i in range(len(r))] for r in loops]
        attributes = {"frontMaterialId": front, "backMaterialId": back, "tagId": tag, "hidden": hidden}
        self.faces.append({"id": self.project.new_id(), "outer": uses[0], "inners": uses[1:],
                           "attributes": attributes})

    def prism(self, profile, depth, origin=(0, 0, 0), u=(1, 0, 0), v=(0, 1, 0), holes=(), material=None):
        """Closed solid: a 2D polygon (with optional holes) in the (u, v) plane at `origin`, extruded along u x v."""
        u, v = normalize(u), normalize(v)
        if abs(dot(u, v)) > 1e-9:
            raise ValueError("u and v must be perpendicular")
        n = cross(u, v)
        if depth < 0:
            n, depth = mul(n, -1), -depth
            u = mul(u, -1)  # keep (u, v, n) right-handed
            profile = [(-x, y) for x, y in profile]
            holes = [[(-x, y) for x, y in h] for h in holes]
        profile = list(profile) if signed_area_2d(list(profile)) > 0 else list(reversed(profile))
        holes = [list(h) if signed_area_2d(list(h)) < 0 else list(reversed(h)) for h in holes]

        def at(p, h):
            return add(add(origin, add(mul(u, p[0]), mul(v, p[1]))), mul(n, h))

        top = [at(p, depth) for p in profile]
        bottom = [at(p, 0) for p in reversed(profile)]
        self.face(top, [[at(p, depth) for p in h] for h in holes], front=material, back=material)
        self.face(bottom, [[at(p, 0) for p in h] for h in holes], front=material, back=material)
        for ring in [profile, *holes]:
            for i, a in enumerate(ring):
                b = ring[(i + 1) % len(ring)]
                self.face([at(a, 0), at(b, 0), at(b, depth), at(a, depth)], front=material, back=material)

    def box(self, lo, hi, material=None):
        self.prism([(lo[0], lo[1]), (hi[0], lo[1]), (hi[0], hi[1]), (lo[0], hi[1])],
                   hi[2] - lo[2], origin=(0, 0, lo[2]), material=material)

    def instance(self, definition, matrix=None, name="", tag=None, material=None):
        self.instances.append({
            "id": self.project.new_id(), "definitionId": definition.id,
            "transform": list(matrix or IDENTITY),
            "attributes": {"name": name, "tagId": tag, "materialId": material, "hidden": False,
                           "locked": False, "castShadows": True, "receiveShadows": True}})

    def to_json(self):
        return {"id": self.id, "name": self.name, "isGroup": self.is_group,
                "vertices": self.vertices, "edges": list(self.edges.values()), "faces": self.faces,
                "curves": [], "instances": self.instances, "guides": []}


# ----------------------------------------------------------------------------- project

class Project:
    def __init__(self, title="Model"):
        self._next = 1
        self.materials, self.tags, self.scenes, self.definitions = [], [], [], []
        self.shadows = None
        self.root = self._definition(title, False)

    def new_id(self):
        self._next += 1
        return self._next - 1

    def _definition(self, name, is_group):
        d = Definition(self, self.new_id(), name, is_group)
        self.definitions.append(d)
        return d

    def material(self, name, hex_color, opacity=1.0, roughness=1.0, metalness=0.0):
        m = {"id": self.new_id(), "name": name, "color": srgb_hex_to_linear(hex_color), "opacity": opacity}
        if metalness != 0:
            m["metalness"] = metalness
        if roughness != 1:
            m["roughness"] = roughness
        self.materials.append(m)
        return m["id"]

    def tag(self, name, hex_color="#808080", visible=True):
        c = hex_color.lstrip("#")
        t = {"id": self.new_id(), "name": name, "visible": visible,
             "color": {k: int(c[i:i + 2], 16) / 255 for k, i in (("r", 0), ("g", 2), ("b", 4))}}
        self.tags.append(t)
        return t["id"]

    def group(self, name, parent=None, tag=None, matrix=None):
        """A new group placed once in `parent` (default: the root). Draw its geometry in its own coordinates."""
        d = self._definition(name, True)
        (parent or self.root).instance(d, matrix, name=name, tag=tag)
        return d

    def component(self, name):
        """A reusable definition. Place it with `parent.instance(component, transform(...))`."""
        return self._definition(name, False)

    def scene(self, name, eye, target, fov_degrees=35.0):
        self.scenes.append({
            "id": self.new_id(), "name": name, "description": "", "includeInAnimation": True,
            "saves": {"camera": True, "visibleTags": False, "activeSections": False,
                      "shadows": False, "axes": False},
            "camera": {"eye": dict(zip("xyz", map(float, eye))), "target": dict(zip("xyz", map(float, target))),
                       "up": {"x": 0.0, "y": 0.0, "z": 1.0}, "fovDegrees": fov_degrees,
                       "projection": "perspective", "orthoHalfHeight": 5.0},
            "hiddenTags": None, "sections": None, "shadows": None, "axes": None})

    def model_json(self):
        model = {"format": "planar-document", "version": 1, "nextId": self._next,
                 "rootDefinitionId": self.root.id, "materials": self.materials, "tags": self.tags,
                 "definitions": [d.to_json() for d in self.definitions]}
        if self.shadows:
            model["shadows"] = self.shadows
        if self.scenes:
            model["scenes"] = self.scenes
        return model

    def save(self, path, app_version="0.1.0"):
        now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        manifest = {"format": "planar-model", "schemaVersion": 1, "appVersion": app_version,
                    "createdAt": now, "modifiedAt": now}
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("manifest.json", json.dumps(manifest, indent=2))
            z.writestr("model.json", json.dumps(self.model_json(), separators=(",", ":")))


# ----------------------------------------------------------------------------- building helpers

def wall(project, name, start, end, height, thickness, base_z=0.0, openings=(), material=None, tag=None):
    """A straight wall centered on the line start -> end (x, y), as its own group.

    openings: dicts {"offset": distance from start to the opening's left side, "width", "sill", "height"}.
    sill == 0 cuts a doorway from the bottom; sill > 0 cuts a window hole. Openings must not overlap,
    touch the wall ends or reach the top.
    """
    d = (end[0] - start[0], end[1] - start[1], 0.0)
    wall_length = length(d)
    u = normalize(d)
    v = (0.0, 0.0, 1.0)
    n = cross(u, v)
    origin = add((start[0], start[1], base_z), mul(n, -thickness / 2))
    doors, holes = [], []
    for o in sorted(openings, key=lambda o: o["offset"]):
        x0, x1, top = o["offset"], o["offset"] + o["width"], o["sill"] + o["height"]
        if x0 <= 1e-3 or x1 >= wall_length - 1e-3 or top >= height - 1e-3:
            raise ValueError(f"opening {o} does not fit inside wall {name}")
        if o["sill"] <= 1e-6:
            doors.append((x0, x1, top))
        else:
            holes.append([(x0, o["sill"]), (x1, o["sill"]), (x1, top), (x0, top)])
    outline = [(0.0, 0.0)]
    for x0, x1, top in doors:
        outline += [(x0, 0.0), (x0, top), (x1, top), (x1, 0.0)]
    outline += [(wall_length, 0.0), (wall_length, height), (0.0, height)]
    g = project.group(name, tag=tag)
    g.prism(outline, thickness, origin=origin, u=u, v=v, holes=holes, material=material)
    return g


if __name__ == "__main__":
    # Example: a 10 x 8 m single-storey house with a gable roof, a door, windows and glass.
    p = Project("Example House")
    concrete = p.material("Concrete", "#9a9a96")
    plaster = p.material("Plaster", "#efe9dc")
    roof_tiles = p.material("Roof tiles", "#8a3b2a", roughness=0.8)
    glass = p.material("Glass", "#a8c8dc", opacity=0.35, roughness=0.05)
    wood = p.material("Door wood", "#6b4a2f")
    t_struct, t_roof, t_open = p.tag("Structure", "#7a7a7a"), p.tag("Roof", "#8a3b2a"), p.tag("Openings", "#3a7bd5")

    W, D, H, T = 10.0, 8.0, 3.0, 0.3
    p.group("Floor slab", tag=t_struct).box((-0.2, -0.2, -0.25), (W + 0.2, D + 0.2, 0.0), material=concrete)

    window = {"width": 1.2, "sill": 0.9, "height": 1.3}
    # Front and back walls run the full width; side walls fit between them (butt joints, no overlap).
    front = [{"offset": 1.5, **window}, {"offset": 4.4, "width": 1.2, "sill": 0.0, "height": 2.1},
             {"offset": 7.3, **window}]
    wall(p, "Wall south", (0, T / 2), (W, T / 2), H, T, openings=front, material=plaster, tag=t_struct)
    wall(p, "Wall north", (W, D - T / 2), (0, D - T / 2), H, T,
         openings=[{"offset": 2.0, **window}, {"offset": 6.8, **window}], material=plaster, tag=t_struct)
    wall(p, "Wall east", (W - T / 2, T), (W - T / 2, D - T), H, T,
         openings=[{"offset": 2.8, **window}], material=plaster, tag=t_struct)
    wall(p, "Wall west", (T / 2, D - T), (T / 2, T), H, T, material=plaster, tag=t_struct)

    # One glass component, placed in every window with a rotation and translation.
    pane = p.component("Window pane")
    pane.face([(0, 0, 0), (1.2, 0, 0), (1.2, 0, 1.3), (0, 0, 1.3)], front=glass, back=glass)
    for x, y, angle in [(1.5, T / 2, 0), (7.3, T / 2, 0), (W - 2.0, D - T / 2, 180), (W - 6.8, D - T / 2, 180),
                        (W - T / 2, T + 2.8, 90)]:
        p.root.instance(pane, transform((x, y, 0.9), angle), name="Window pane", tag=t_open)
    p.group("Front door", tag=t_open).box((4.405, T / 2 - 0.025, 0.0), (5.595, T / 2 + 0.025, 2.095), material=wood)

    # Gable ends (triangles on the side walls) and two roof slabs.
    ridge, overhang, roof_t = 1.8, 0.4, 0.15
    for name, x in (("Gable west", 0.0), ("Gable east", W - T)):
        p.group(name, tag=t_roof).prism([(0, 0), (D, 0), (D / 2, ridge)], T, origin=(x, 0, H),
                                        u=(0, 1, 0), v=(0, 0, 1), material=plaster)
    slope = math.hypot(D / 2 + overhang, ridge + overhang * ridge / (D / 2))
    for name, y0, direction in (("Roof south", -overhang, 1), ("Roof north", D + overhang, -1)):
        rise = ridge + overhang * ridge / (D / 2)
        up = normalize((0, direction * (D / 2 + overhang), rise))
        u = (1, 0, 0) if direction == 1 else (-1, 0, 0)
        x0 = -overhang if direction == 1 else W + overhang
        p.group(name, tag=t_roof).prism(
            [(0, 0), (W + 2 * overhang, 0), (W + 2 * overhang, slope), (0, slope)], roof_t,
            origin=(x0, y0, H - overhang * ridge / (D / 2)), u=u, v=up, material=roof_tiles)

    p.shadows = {"enabled": True, "dateTime": "2026-06-21T15:00:00+02:00", "latitude": 48.2,
                 "longitude": 16.4, "northAngle": 0, "light": 0.8, "dark": 0.45,
                 "useSunForShading": True, "onFaces": True, "onGround": True}
    p.scene("South-east view", eye=(22, -16, 11), target=(W / 2, D / 2, 1.8))
    p.scene("Top view", eye=(W / 2, D / 2 - 0.01, 40), target=(W / 2, D / 2, 0))
    p.save("example-house.planar")
    print("wrote example-house.planar")
```

### Helper reference

- `prism(profile, depth, origin, u, v, holes, material)` builds a closed solid.
  - `profile` is a list of 2D points `(a, b)` meaning `origin + a·u + b·v`, and `holes` are lists of 2D points
    strictly inside it.
  - The solid is extruded by `depth` along `u × v`. Point order does not matter, because it is normalized.
  - `u` and `v` must be perpendicular. Examples:
    - a floor: `u=(1,0,0), v=(0,1,0)`, extruded up;
    - a wall along X: `u=(1,0,0), v=(0,0,1)`, extruded toward −Y;
    - a roof plane: `u` along the ridge and `v` up the slope.
- `box(lo, hi, material)` builds an axis-aligned box from two corners.
- `face(outer, holes, front, back, tag)` builds a single planar face. `outer` is counter-clockwise seen from the front,
  and hole winding is corrected automatically.
- `wall(project, name, start, end, height, thickness, base_z, openings, material, tag)` builds a wall group with
  doors (`sill: 0`) and windows.
- `Project.group(name, parent=None, tag=None, matrix=None)` creates a group placed once. `Project.component(name)`
  plus `parent.instance(component, transform((x, y, z), rotate_z_deg))` places a reusable part.
- `Project.scene(name, eye, target)`, and `project.shadows = {...}` for optional settings.
- Extras not covered by a helper (annotations, style, fog, section planes) can be added to the dict returned by
  `model_json()` before writing, following section 7.

Example: an L-shaped slab, and a straight stair built as one prism of its side profile (a single closed solid, so no
touching boxes).

```python
from planar_gen import Project

p = Project("Stair test")
stone = p.material("Stone", "#b5b0a6")
p.group("Slab").prism([(0, 0), (8, 0), (8, 3), (3, 3), (3, 7), (0, 7)], 0.2, origin=(0, 0, -0.2), material=stone)
steps, riser, tread = 17, 0.17, 0.28
profile = [(0, 0)]
for i in range(steps):
    profile += [(i * tread, (i + 1) * riser), ((i + 1) * tread, (i + 1) * riser)]
profile += [(steps * tread, 0)]
p.group("Stair").prism(profile, 1.0, origin=(4, 4, 0), u=(1, 0, 0), v=(0, 0, 1), material=stone)
p.save("stair-test.planar")
```

## 11. Minimal complete example

A 1 × 1 m floor tile as a group with one material. This is the smallest useful file; zip these two JSON documents as
`manifest.json` (section 2) and `model.json`.

```json
{
  "format": "planar-document",
  "version": 1,
  "nextId": 14,
  "rootDefinitionId": 2,
  "materials": [{ "id": 1, "name": "Concrete", "color": { "r": 0.32, "g": 0.32, "b": 0.3 }, "opacity": 1 }],
  "tags": [],
  "definitions": [
    {
      "id": 2,
      "name": "Tile model",
      "isGroup": false,
      "vertices": [],
      "edges": [],
      "faces": [],
      "curves": [],
      "instances": [
        {
          "id": 13,
          "definitionId": 3,
          "transform": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          "attributes": {
            "name": "Tile",
            "tagId": null,
            "materialId": null,
            "hidden": false,
            "locked": false,
            "castShadows": true,
            "receiveShadows": true
          }
        }
      ]
    },
    {
      "id": 3,
      "name": "Tile",
      "isGroup": true,
      "vertices": [
        { "id": 4, "position": { "x": 0, "y": 0, "z": 0 } },
        { "id": 5, "position": { "x": 1, "y": 0, "z": 0 } },
        { "id": 6, "position": { "x": 1, "y": 1, "z": 0 } },
        { "id": 7, "position": { "x": 0, "y": 1, "z": 0 } }
      ],
      "edges": [
        {
          "id": 8,
          "v0": 4,
          "v1": 5,
          "attributes": { "soft": false, "smooth": false, "hidden": false, "materialId": null, "tagId": null }
        },
        {
          "id": 9,
          "v0": 5,
          "v1": 6,
          "attributes": { "soft": false, "smooth": false, "hidden": false, "materialId": null, "tagId": null }
        },
        {
          "id": 10,
          "v0": 7,
          "v1": 6,
          "attributes": { "soft": false, "smooth": false, "hidden": false, "materialId": null, "tagId": null }
        },
        {
          "id": 11,
          "v0": 7,
          "v1": 4,
          "attributes": { "soft": false, "smooth": false, "hidden": false, "materialId": null, "tagId": null }
        }
      ],
      "faces": [
        {
          "id": 12,
          "outer": [
            { "edge": 8, "reversed": false },
            { "edge": 9, "reversed": false },
            { "edge": 10, "reversed": true },
            { "edge": 11, "reversed": false }
          ],
          "inners": [],
          "attributes": { "frontMaterialId": 1, "backMaterialId": 1, "tagId": null, "hidden": false }
        }
      ],
      "curves": [],
      "instances": []
    }
  ]
}
```

The loop walks 4 → 5 → 6 → 7 → 4, counter-clockwise seen from above, so the front faces +Z. Edge 10 is stored as
7 → 6, so walking 6 → 7 uses it with `reversed: true`.

## 12. Checklist and troubleshooting

Before handing over the file, check:

- [ ] `manifest.json` and `model.json` are at the ZIP root, and the file name ends in `.planar`.
- [ ] `model.json` has `"format": "planar-document"`, `"version": 1`, `nextId` greater than every id, and a root
      definition that is never instanced.
- [ ] Every id is a unique positive integer. Every referenced id (vertex, edge, material, tag, definition) exists.
- [ ] Every object has all its required keys, including `curves`, `instances`, `inners`, all edge, face and instance
      attributes, and every scene's `null` fields.
- [ ] Each solid is in its own group. No touching or overlapping solids share a group.
- [ ] Faces that meet share edge and vertex ids. There are no duplicate vertices and no vertex lying on another edge.
- [ ] Faces are planar, and holes are strictly inside the outline with the opposite winding.
- [ ] Colors are 0–1 (materials linear, style, fog and tags sRGB); opacity, roughness and metalness are 0–1.

The app opens files **with repair**. It removes invalid faces and entities or clears broken references, then opens
the model with a "Repaired N problems" notice. A file that needs repair is a bug in the generator: fix the cause.

| Message (or part of it)                                                  | Cause and fix                                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `the file is not a valid Planar archive`                                 | Not a ZIP file.                                                                                 |
| `the archive is missing its manifest or model`                           | Entries are inside a folder, or misnamed. Put them at the root.                                 |
| `this is not a Planar model file`                                        | `manifest.json` `format` is not `planar-model`.                                                 |
| `This is not a Planar document`                                          | `model.json` lacks `"format": "planar-document"`.                                               |
| `Invalid document structure: $.definitions[1]…: expected …`              | A missing key or wrong type at that JSON path.                                                  |
| `id N is used more than once` / `id N is not below nextId`               | Ids must be unique across the file; raise `nextId`.                                             |
| `t-junction`, `edges-intersect`, `overlapping-faces`, `unwelded-vertices` | Touching solids in one group, or duplicate points. Split into groups and weld. Never repaired. |
| `non-planar-face`                                                        | A face's points are not coplanar (often rounded coordinates on a slope).                        |
| `inner-loop-orientation` / `outer-loop-orientation`                      | A hole has the same winding as the outline, or a loop has zero area.                            |
| `hole-outside-face` / `overlapping-holes`                                | Holes must be strictly inside the outline and apart from each other.                            |
| `open-loop` / `loop-not-simple` / `short-loop`                           | Uses don't chain (check `reversed`), a loop revisits a vertex, or it has fewer than 3 edges.    |
| `duplicate-edge` / `short-edge` / `degenerate-edge`                      | Two edges join the same vertices, or an edge is (nearly) zero length.                           |
| `missing-reference`                                                      | A material, tag, edge, vertex or definition id does not exist.                                  |
| `invalid-transform` / `definition-cycle` / `root-instanced`              | A singular matrix, a definition that contains itself, or the root placed as an instance.        |
| `invalid-shadows`, `invalid-style`, `invalid-fog`, `invalid-scene`       | A setting is out of range, or a scene has an empty name.                                        |

## 13. Prompt template

When asking an AI to generate a project, attach this guide and use a prompt like:

> Using the attached "Generating Planar Projects with AI" guide and its `planar_gen.py`, write a Python script that
> builds a `.planar` file for: _a two-storey family house, 12 × 9 m, flat roof with a parapet, an attached single
> garage on the east side, large sliding windows facing south, an interior staircase, and a terrace slab_. Use one
> group per wall, slab, roof element and stair; components for repeated windows; tags per storey and for roof,
> openings and terrain; realistic dimensions; and two scenes (street view and aerial view). Follow the checklist in
> section 12, then run the script and give me the `.planar` file.
