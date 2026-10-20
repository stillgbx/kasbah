# The `house.json` format

The file describes the house and garden; it is validated when the server starts (`parseHouse`, zod schema in `packages/shared/src/house/schema.ts`): a structural error prevents startup and is reported with a readable path (`rooms[1].openings[0].offset: opening exceeds segment length`). Non-blocking inconsistencies (a room without devices, an unlinked device) are logged as warnings.

## Reference frame

- **Units: meters. Axes: `x` east, `y` north, `z` up** (Z-up). Polygons are lists of `[x, y]` points in the plane; heights are expressed in `z`.
- `origin` gives the GPS position of point `(0, 0, 0)`: `lat`, `lon`, `alt`, and `heading` = bearing (degrees, clockwise from true north) of the local `+y` axis. With `heading: 0`, `+y` points north; with `heading: 90`, `+y` points east. Used to place vehicles from their GPS.
- **Room** polygons are the **finished inner face** of the walls, **counter-clockwise (CCW)** — the order is mandatory because openings reference an edge index.

## Structure

```jsonc
{
  "schemaVersion": 1,
  "id": "house", "name": "My house",
  "origin": { "lat": 47.309343, "lon": 5.045591, "alt": 180, "heading": 15 },
  "defaults": {                       // all optional
    "levelHeight": 2.6, "slabThickness": 0.25,
    "interiorWallThickness": 0.10, "exteriorWallThickness": 0.30,
    "doorHeight": 2.10, "windowSill": 0.9
  },
  "levels": [ { "id": "ground", "name": "Ground floor", "elevation": 0.2, "height": 2.6, "outline": [[…]] } ],
  "rooms": [ /* see below */ ],
  "site": { "elevation": 0, "terrain": [[…]], "zones": [ { "id": "lawn", "name": "Lawn", "kind": "lawn", "polygon": [[…]] } ] },
  "devices": [ /* see below */ ],
  "roof": { "type": "gable", "levelId": "upstairs", "ridgeAxis": "x", "pitch": 35, "overhang": 0.4 }
}
```

### Levels (`levels`)

- `elevation`: `z` of the finished floor (absolute). Put the ground floor **above** the terrain (`0.2` if the terrain is at `0`) so that floor and terrain don't merge.
- `shortName` (optional): short label for the level tab (“GF”).
- `height`: ceiling height (default `defaults.levelHeight`).
- `outline` (optional): outer footprint, used by the roof. Otherwise the bounding box of the walled rooms, enlarged by the exterior wall thickness.
- `roomOrder` (optional): display order of the level's rooms (ids). Rooms missing from the list follow in alphabetical order. Written by drag and drop in the Lights view; delete the key to go back to alphabetical order. Levels themselves read from top to bottom in lists (the level tabs, on the other hand, go up).

### Rooms (`rooms`)

```jsonc
{
  "id": "living", "levelId": "ground", "name": "Living room",
  "polygon": [[3.2, 0], [10, 0], [10, 5], [3.2, 5]],     // CCW, inner face
  "kind": "room",                                        // room | corridor | stairs | garage | terrace | balcony
  "height": 2.6,                                         // optional
  "walls": [{ "segment": 2, "kind": "none" }],           // per-edge overrides: interior | exterior | none, thickness
  "openings": [
    { "id": "bay", "type": "window", "segment": 0, "offset": 1.5, "width": 2.4, "height": 2.15, "sill": 0.2 }
  ],
  "style": { "floor": "wood" }                           // wood | tile | concrete | carpet
}
```

**Walls.** Each room carries its walls outward from its inner face. An edge is automatically classified as `interior` (another walled room on the same level lies right behind it) or `exterior`, with the matching thickness. Two adjacent rooms are therefore written with a **gap equal to the sum of the half-partitions**: `0.20 m` with the defaults (`0.10 + 0.10`). An open space (living room/kitchen) is declared with `"kind": "none"` on the shared edge, on both sides. Corners are mitered automatically; `terrace` and `balcony` have no walls.

**Openings.** Anchored on the edge `polygon[segment] → polygon[segment+1]`: `offset` is the distance from the first vertex to the edge of the opening, `width`/`height` its dimensions, `sill` the sill height (default `0` for `door`/`passage`/`garage`, `defaults.windowSill` for `window`). An interior door declared in one room is **cut automatically through the wall of the room opposite**: no need to declare it twice. Windows get translucent glazing; a shutter-type device linked to an opening (`openingId`) animates a slat there.

### Garden (`site`)

`terrain`: polygon of the plot (doesn't need to be CCW). `zones`: colored areas (`lawn`, `terrace`, `driveway`, `path`, `pool`, `bed`, `other`) that also serve as anchors for outdoor devices and as camera framing targets.

`relief` (optional): terrain relief, as an offset from `elevation`. `step` = grid spacing (m), `origin` = south-west corner of the grid (m), `rows` = one string per row, from south to north, heights in **whole centimetres** separated by a space, from west to east. Absent = flat terrain. Under rooms, the terrain stays below the floor; around a pool, it stays flat. Shaped from the UI: Settings → 3D rendering → “Shape the terrain”.

```jsonc
"relief": { "step": 2, "origin": [-28, -40], "rows": ["0 0 12 15", "0 3 20 41"] }
```

`garden` (optional): trees, shrubs and rocks, placed on the terrain and following its relief. `kind` = `broadleaf`, `conifer`, `palm`, `shrub`, `rock` or `hedge`; `center` = base (m); `height` = height (0.1 to 40 m, the width follows from it); `yaw` = orientation (degrees, optional); `seed` = drawn shape (optional); `species` = species from the app's catalog (`cherry`…, optional; unknown = generic shape of the family); for a hedge only, `length` = length of the segment (0.5 to 100 m, optional, 3 by default, along the axis rotated by `yaw`) and `width` = width (0.2 to 5 m, optional, 0.7 by default), `spacing` = base-to-base spacing between its plants (0.2 to 5 m, optional; absent = automatic, the foliage overlaps). An L-shaped hedge = two segments. Placed from the UI: Settings → Edit mode, then the “Garden” section of the Home view.

```jsonc
"garden": [{ "id": "garden.broadleaf-1", "kind": "broadleaf", "center": [4, 19], "height": 7, "yaw": 145, "species": "cherry" }]
```

### Devices (`devices`)

```jsonc
{
  "id": "light.living", "name": "Living room ceiling light",  // optional: absent → the plugin's name wins
  "deviceId": "hue:6f2c…",              // plugin link: "<pluginId>:<externalId>"; absent → shown as “unlinked”
  "kind": "light",                      // a hint if unlinked; otherwise the plugin's descriptor wins
  "position": [6.6, 2.5, 2.5],          // absolute x, y; z RELATIVE to the anchor's floor (level or terrain)
  "levelId": "ground", "roomId": "living",  // indoor anchor
  "zoneId": "driveway",                 // or outdoor anchor
  "openingId": "bay",                   // shutters: the marker fits the opening
  "mount": "ceiling", "yaw": 0          // optional (yaw in degrees, 0 = facing +y)
}
```

A device can be reduced to its **link** and its **position** (`{ id, deviceId, position, roomId, mount }`): name, kind and capabilities come from the plugin. Better still: a plugin device **missing** from this array is placed automatically at the center of the ceiling of the room that has the name of its vendor-side room (Hue room); the JSON entry is therefore only needed to **refine** a position. A lamp that no room claims can still be controlled from the Lights view, without a 3D marker.

**From the UI**: a device's panel → “Edit” → drag in 3D (x;y), presets and a slider for the height. Each drop is sent to the server (`PUT /api/house/devices/:id`, body `{ position, roomId?, mount?, deviceId? }`), which **rewrites the file** (`KASBAH_HOUSE_FILE`) after full validation, keeps the previous version as `<file>.bak` and pushes the house to connected screens (`house` WebSocket message). An auto-placed device gains its minimal entry there; the file is reformatted (`JSON.stringify` with two spaces), and key order is preserved. Shutters (anchored to an opening) and the mower can't be moved this way.

**Leased vehicle**: `lease` holds the contract, to track mileage against the allowance. `start` and `end` are in `YYYY-MM-DD` format, `km` is the allowance for the **whole** contract and `startKm` (optional, 0 by default) the odometer reading at handover. The vehicle card then shows the km driven against the km allowed to date, pro rata of the elapsed time, and a projection to the end date. No manufacturer publishes the financing contract: it is entered from the card (“Edit” → Lease). For a Renault, “Look up at Renault” suggests the account's mileage-capped maintenance contract, which is often aligned with the lease.

```jsonc
{ "id": "vehicle.r5", "deviceId": "renault:VF1…", "lease": { "start": "2025-03-01", "end": "2029-03-31", "km": 40000, "startKm": 12 } }
```

Device ids from the `mock` plugin are stable (`mock:light-living`, `mock:cover-kitchen`, `mock:energy-site`, `mock:vehicle-tesla`…); Hue ids are the UUIDs of the bridge's `light` resources (visible in `GET /api/devices`).

### Scenes

There is no `scenes` section any more (removed on 2026-10-06: nothing executed it any longer). A `scenes` key left in an old file is ignored on load, then disappears the next time the server writes the file. Light scenes come from the plugins (Hue) and are recalled from the Home panel or an automation.

### Roof (`roof`)

`flat` (a slab over the footprint) or `gable` (two slopes); `pitch` in degrees, `ridgeAxis` (`x` or `y`, default: the longer side), `overhang` in meters. Hidden as soon as a level is focused.

## Measured survey (`meta.survey`)

A real house is measured **inside the rooms**: each shared partition is reduced to a single shared line there, whereas the polygons must be spaced apart by the sum of the half-partitions (see **Walls** above). Rather than correcting the measurements by hand, the raw measurements are kept in `meta` — which the schema leaves free — and the `polygon`s are **derived** from them by a script.

```jsonc
{
  "meta": {
    "survey": {
      "unit": "cm",                        // cm | mm | absent → meters
      "frame": "0;0 = south-west corner of the plan, +x east, +y north",
      "partition": 0.08,                   // FULL partition between two walled rooms (m)
      "levelOffsets": { "ground": [0, 92] }   // frame correction for a level, in the survey's unit
    }
  },
  "rooms": [{
    "id": "bedroom", "levelId": "upstairs", "name": "Bedroom",
    "polygon": [[…]],                                                    // DERIVED — do not edit
    "walls": [{ "segment": 2, "kind": "interior", "thickness": 0.04 }],  // DERIVED as well
    "meta": {
      "survey": {
        "points": [[0, 0], [360, 0], [360, 120], [360, 300], [0, 300]],  // the measurements as taken, never touched
        "note": "point 360;120 added (collinear): the east wall is shared beyond it, a facade below it"
      }
    }
  }]
}
```

Regenerate after any change to a survey:

```bash
node house/fit-survey.mjs house/my-house.json           # rewrites polygon, walls and outline
node house/fit-survey.mjs house/my-house.json --check   # checks without writing (exit 1 on divergence)
```

The script pulls each face in by the thickness its neighbor pushes into it, leaves the facades where they are (so the survey's footprint is preserved), sets `kind` and `thickness` on shared edges, and recomputes the level's `outline` from its walled rooms. Five things to know:

- **`partition` is independent of `defaults.interiorWallThickness`**: the global default still applies to levels without a survey; a survey can carry thinner partitions without moving them.
- **`levelOffsets`** corrects the **frame** of a survey campaign whose `0;0` doesn't match the other levels': it is a translation applied to the raw points, so there is a single number to adjust, and the measurements stay intact.
- **An edge carries only one nature and one thickness.** A straddling edge — shared over part of its length, facade over the rest (a step in the facade) — must be split by inserting a **collinear** point into `points`: the measured room is unchanged and each portion gets its own wall. The script reports the edges concerned.
- **A room without walls** (`terrace`, `balcony`: terrace, balcony, open porch) doesn't create a shared wall: the walled room opposite keeps its facade, and it is the room without walls that absorbs it. Its `polygon` is therefore its **finished floor** — the raw step minus the facades that border it.
- **Openings are anchored on an edge index**: they need reviewing as soon as a survey changes a polygon. The same goes for device `position`s, which may end up outside their room.

Finally, `origin` expects the GPS position of the survey's `0;0`. If the only known point lies elsewhere (an address marker, a mapping service's reference point), **bring it back** to `0;0` rather than copying it as is; and `heading` is measured on the building's edges, since a survey is aligned on the walls, not on north. Both are then refined on the aerial photo: **Settings → GPS origin → “Align on the photo”** slides and rotates the house (roof, ground-floor rooms, a mower's lawn) in steps of 0.1 to 2 m. A level's `outline` is used by the roof: on a ground floor, it can be an envelope larger than the house, which should not be aligned on the photo.

## Complete example

Three demo properties, each linked device by device to its simulated device set:

- [house/demos/tilleuls.json](../house/demos/tilleuls.json) — two-story house with a gable roof: relief, garden, parking spots (garage, driveway, robot docks), upstairs terrace over the garage, roof window, finishes, roof-mounted panel array;
- [house/demos/embruns.json](../house/demos/embruns.json) — L-shaped single-story house with a flat roof: non-rectangular rooms open onto each other, L-shaped `outline`, skylights, two arrays on frames (`tilt`);
- [house/demos/belvedere.json](../house/demos/belvedere.json) — upper-floor apartment, balcony, no roof.

`meta.demo` (`{ "scenario": "tilleuls", "kind": "house" }`) marks a demo property: the `mock` plugin scenario that populates it and its nature (`house` or `apartment`). A server started without `KASBAH_HOUSE_FILE` offers them all.

[house/demo-house.json](../house/demo-house.json) remains the **test** house (two levels, seven rooms, `default` scenario).

## Checking a file

```bash
KASBAH_HOUSE_FILE=path/to/my-house.json npm run dev -w @kasbah/server
```

The server refuses to start on an invalid file and prints each problem with its path; `GET /api/house/warnings` lists the warnings.
