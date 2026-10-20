import { z } from 'zod'
import { deviceIdSchema } from '../devices/descriptor'
import { defaultPlugins, GARDEN_KINDS, hexColorSchema, MAX_GARDEN_HEIGHT, MAX_HEDGE_LENGTH, MAX_HEDGE_SPACING, MAX_HEDGE_WIDTH, MIN_GARDEN_HEIGHT, MIN_HEDGE_LENGTH, MIN_HEDGE_SPACING, MIN_HEDGE_WIDTH, MAX_OPENING_LEAVES, MIN_OPENING_LEAVES, MIN_PARKING_DIM, model3dSchema, MOUNTS, NEUTRAL_TUNING, OPENING_MATERIALS, OPENING_TYPES, SPEAKER_SHAPES, vec2Schema, vec3Schema, type GeoOrigin, type PluginSettingsPatch, type Relief, type SceneTuning, vehicleLeaseSchema } from './schema'
import { DEVICE_KINDS, VEHICLE_FINISHES } from '../devices/kinds'
import { computeHouseGeometry, extendReliefGrid, isSimplePolygon, openingCentre, parseRelief, serializeRelief, type Vec2 } from './geometry'
import { parseHouse } from './validate'
import type { Vec3 } from './geometry/types'

// Writes from the UI into house.json (placement of a device, display order of the rooms).
// We work on the RAW JSON (not the parsed house) so as to rewrite only what changed and not
// inject the zod defaults (kind: 'room', openings: []…) into the user's file.
// The result must then be validated by `parseHouse` before being written.

export const devicePlacementSchema = z.object({
  /**
   * Absolute x, y; z relative to the anchor's floor (like `HouseDevice.position`). **Absent = the place
   * is not touched**: an existing entry keeps its own, a created entry receives none
   * (device known to the house but not placed — a vehicle that is only being renamed).
   */
  position: vec3Schema.optional(),
  /**
   * Name chosen by the user, which takes precedence over that of the plugin descriptor. **Empty string =
   * clear** and go back to the vendor's name — it is the only way to undo a rename.
   */
  name: z.string().trim().max(60).optional(),
  /** New anchor room (move to a neighboring room of the same level). */
  roomId: z.string().min(1).optional(),
  /** Anchor level when the device is in NO room (unsurveyed hallway, facade); ignored if `roomId` is given. */
  levelId: z.string().min(1).optional(),
  mount: z.enum(MOUNTS).optional(),
  /** Orientation in degrees, 0 = facing +y (like `HouseDevice.yaw`): a display, a camera look somewhere. */
  yaw: z.number().min(0).max(360).optional(),
  /** Drawn footprint (m, like `HouseDevice.size`): a gate placed outside has no opening to size it. */
  size: z.object({ width: z.number().positive().max(50), height: z.number().positive().max(50) }).optional(),
  /** Leaves of a cover (like `HouseDevice.leaves`): the wings of a gate, the panels of a shutter. */
  leaves: z.union([z.literal(1), z.literal(2)]).optional(),
  /**
   * Material of a cover (like `HouseDevice.coverMaterial`). **Empty string = clear** and hand back to
   * the cover material of the render style, as for the body color.
   */
  coverMaterial: z.union([z.literal(''), z.enum(OPENING_MATERIALS)]).optional(),
  /** Color of a cover (like `HouseDevice.coverColor`). **Empty string = clear**, same rule. */
  coverColor: z.union([z.literal(''), hexColorSchema]).optional(),
  /**
   * Correction (m, house reference frame) of the computed place of a device placed by its GPS — a
   * vehicle (like `HouseDevice.gpsOffset`). `[0, 0]` CLEARS the correction: it is the only way
   * to get back to the raw reading, like the empty string for the name.
   */
  gpsOffset: vec2Schema.optional(),
  /** Correction (m, house reference frame) of the terrain map of a mower (like `HouseDevice.mapOffset`). `[0, 0]` CLEARS. */
  mapOffset: vec2Schema.optional(),
  /**
   * Correction (degrees, ±180) of the computed orientation of a device placed by its GPS — a
   * vehicle (like `HouseDevice.yawOffset`). `0` CLEARS the correction, like `[0, 0]` for the
   * offset: we go back to what the scene deduces on its own.
   */
  yawOffset: z.number().min(-180).max(180).optional(),
  /**
   * Battery capacity of a vehicle (kWh, like `HouseDevice.batteryKwh`), entered since vendors
   * do not give it. `0` CLEARS the value, like `[0, 0]` for the offset.
   */
  batteryKwh: z.number().min(0).max(500).optional(),
  /**
   * 3D bodywork of a vehicle (like `HouseDevice.model3d`): a catalog identifier, or
   * `'none'` for the generic silhouette. **Empty string = clear** and go back to the automatic
   * choice, as for the name — `'none'` is a choice, not an absence of choice.
   */
  model3d: z.union([z.literal(''), model3dSchema]).optional(),
  /**
   * Body color (like `HouseDevice.bodyColor`). **Empty string = clear** and hand back to
   * the scene's vehicle color, which follows the theme.
   */
  bodyColor: z.union([z.literal(''), hexColorSchema]).optional(),
  /**
   * Paint finish (like `HouseDevice.bodyFinish`). **Empty string = clear** and hand back to
   * what the vendor says, as for the color.
   */
  bodyFinish: z.union([z.literal(''), z.enum(VEHICLE_FINISHES)]).optional(),
  /**
   * 3D silhouette of a speaker (like `HouseDevice.speakerShape`). **Empty string = clear** and
   * go back to the default cylinder.
   */
  speakerShape: z.union([z.literal(''), z.enum(SPEAKER_SHAPES)]).optional(),
  /**
   * Lease (LOA / LLD) of a vehicle (like `HouseDevice.lease`), written in one block: start, end and flat fee
   * only make sense together. **Empty string = clear**, as for the name.
   */
  lease: z.union([z.literal(''), vehicleLeaseSchema]).optional(),
  /**
   * Opening the device dresses (like `HouseDevice.openingId`): a shutter, a window sensor
   * hug its rectangle instead of occupying a point. **Empty string = unlink**, like the empty
   * string for the name — it is the only way to give the device back to the room.
   *
   * Linking RE-ANCHORS the device on the room that carries the opening: the cross validation requires it, and
   * the gesture comes from the 3D, where a window is shown without thinking of the room behind it.
   */
  openingId: z.union([z.literal(''), z.string().min(1)]).optional(),
  /** Required when the device does not exist yet in the JSON (auto-placed device). */
  deviceId: deviceIdSchema.optional(),
})
export type DevicePlacement = z.infer<typeof devicePlacementSchema>

export const roomOrderSchema = z.object({
  /** Wanted order, complete or partial; the absent rooms follow, in alphabetical order. */
  roomIds: z.array(z.string().min(1)),
})
export type RoomOrder = z.infer<typeof roomOrderSchema>

export class PlacementError extends Error {
  readonly statusCode = 400
  readonly code = 'INVALID_PLACEMENT'
  constructor(message: string) { super(message); this.name = 'PlacementError' }
}

type JsonObject = Record<string, unknown>
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Room that carries the opening `openingId` in the raw JSON. */
function openingOwner(rooms: readonly JsonObject[], openingId: string): JsonObject {
  const owner = rooms.find((r) => Array.isArray(r.openings) && r.openings.some((o) => isObject(o) && o.id === openingId))
  if (!owner) throw new PlacementError(`unknown opening "${openingId}"`)
  return owner
}

/** Two places identical to the millimeter: no point rewriting the file for decimal noise. */
const samePlace = (a: readonly unknown[], b: Vec3) =>
  a.length === 3 && a.every((v, i) => typeof v === 'number' && Math.abs(v - b[i]!) < 1e-6)

/** To the millimeter: a survey is read by hand, it does not have to carry fifteen decimals. */
const roundPlace = (p: Vec3): Vec3 => [
  Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000, Math.round(p[2] * 1000) / 1000,
]

/**
 * Realigns on the center of their bay the devices LINKED to the given openings.
 *
 * A shutter, a window sensor do not occupy a point: they dress a rectangle, and it is that
 * rectangle the scene draws — their `position` is no longer what places them. But it is READ,
 * in a file that is opened by hand, and an opening refined after the fact let it lie
 * (2.11 m of gap measured on the office shutter). It therefore follows the bay, in the same write as
 * the opening that has just moved.
 *
 * Only the devices that ALREADY have a place are realigned: linking a device never placed does not invent
 * one for it, the scene can do without.
 *
 * The document is re-read to extract the geometry: it is the only way to get the SAME center as
 * the scene, rather than a second computation that would diverge. A document that `parseHouse` refuses is
 * returned as is — it is the caller that validates, and its error will be clearer than ours.
 */
function alignDevicesOnOpenings(doc: JsonObject, openingIds: readonly string[]): JsonObject {
  const devices = Array.isArray(doc.devices) ? doc.devices : []
  const wanted = new Set(openingIds)
  const concerns = (d: unknown): d is JsonObject =>
    isObject(d) && typeof d.openingId === 'string' && wanted.has(d.openingId) && Array.isArray(d.position)
  if (!devices.some(concerns)) return doc
  let centres: Map<string, Vec3>
  try {
    centres = new Map(computeHouseGeometry(parseHouse(doc)).levels
      .flatMap((l) => l.openings)
      .filter((rect) => wanted.has(rect.openingId))
      .map((rect) => [rect.openingId, roundPlace(openingCentre(rect))]))
  } catch { return doc }
  let changed = false
  const next = devices.map((d) => {
    if (!concerns(d)) return d
    const centre = centres.get(d.openingId as string)
    if (!centre || samePlace(d.position as unknown[], centre)) return d
    changed = true
    return { ...d, position: centre }
  })
  return changed ? { ...doc, devices: next } : doc
}

/**
 * Returns a copy of the JSON document with the device `id` (re)placed or renamed: existing entry
 * updated (position, name, room, mount, yaw, size, leaves, coverMaterial, coverColor, gpsOffset, mapOffset,
 * yawOffset, batteryKwh, model3d, bodyColor, bodyFinish, lease), or entry created
 * `{ id, deviceId, … }` with what was given.
 *
 * Everything is optional, position included: renaming a device that has NO place in the scene
 * (a vehicle) is a use in its own right, and it is what gives it its entry in the house.
 */
export function placeDeviceInJson(doc: unknown, id: string, placement: DevicePlacement): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const devices = Array.isArray(doc.devices) ? doc.devices : []
  const rooms = Array.isArray(doc.rooms) ? doc.rooms.filter(isObject) : []
  const room = placement.roomId ? rooms.find((r) => r.id === placement.roomId) : undefined
  if (placement.roomId && !room) throw new PlacementError(`unknown room "${placement.roomId}"`)
  const levels = Array.isArray(doc.levels) ? doc.levels.filter(isObject) : []
  const level = !room && placement.levelId ? levels.find((l) => l.id === placement.levelId) : undefined
  if (!room && placement.levelId && !level) throw new PlacementError(`unknown level "${placement.levelId}"`)

  const i = devices.findIndex((d) => isObject(d) && d.id === id)
  let next: JsonObject
  if (i >= 0) {
    const prev = devices[i] as JsonObject
    next = { ...prev }
    if (placement.position) next.position = placement.position
    if (placement.name !== undefined) {
      if (placement.name) next.name = placement.name
      else delete next.name
    }
    if (placement.mount) next.mount = placement.mount
    if (placement.yaw !== undefined) next.yaw = placement.yaw
    if (placement.size) next.size = placement.size
    if (placement.leaves !== undefined) next.leaves = placement.leaves
    if (placement.gpsOffset) {
      if (placement.gpsOffset[0] === 0 && placement.gpsOffset[1] === 0) delete next.gpsOffset
      else next.gpsOffset = placement.gpsOffset
    }
    if (placement.mapOffset) {
      if (placement.mapOffset[0] === 0 && placement.mapOffset[1] === 0) delete next.mapOffset
      else next.mapOffset = placement.mapOffset
    }
    if (placement.yawOffset !== undefined) {
      if (placement.yawOffset === 0) delete next.yawOffset
      else next.yawOffset = placement.yawOffset
    }
    if (placement.batteryKwh !== undefined) {
      if (placement.batteryKwh === 0) delete next.batteryKwh
      else next.batteryKwh = placement.batteryKwh
    }
    if (placement.model3d !== undefined) {
      if (placement.model3d) next.model3d = placement.model3d
      else delete next.model3d
    }
    if (placement.bodyColor !== undefined) {
      if (placement.bodyColor) next.bodyColor = placement.bodyColor
      else delete next.bodyColor
    }
    if (placement.bodyFinish !== undefined) {
      if (placement.bodyFinish) next.bodyFinish = placement.bodyFinish
      else delete next.bodyFinish
    }
    if (placement.speakerShape !== undefined) {
      if (placement.speakerShape) next.speakerShape = placement.speakerShape
      else delete next.speakerShape
    }
    if (placement.lease !== undefined) {
      if (placement.lease) next.lease = placement.lease
      else delete next.lease
    }
    if (placement.coverMaterial !== undefined) {
      if (placement.coverMaterial) next.coverMaterial = placement.coverMaterial
      else delete next.coverMaterial
    }
    if (placement.coverColor !== undefined) {
      if (placement.coverColor) next.coverColor = placement.coverColor
      else delete next.coverColor
    }
    if (room) {
      next.roomId = room.id
      // the demo JSON carries roomId AND levelId: keep both consistent, without adding any
      if ('levelId' in prev) next.levelId = room.levelId
      delete next.zoneId
    } else if (level) {
      // out of any room: the level becomes the anchor, the room and the zone drop
      next.levelId = level.id
      delete next.roomId
      delete next.zoneId
    }
    // AFTER the anchoring: linking an opening takes along the room that carries it, whatever the patch said
    if (placement.openingId !== undefined) {
      if (placement.openingId) {
        const owner = openingOwner(rooms, placement.openingId)
        next.openingId = placement.openingId
        next.roomId = owner.id
        if ('levelId' in next) next.levelId = owner.levelId
        delete next.zoneId
      } else delete next.openingId
    }
  } else {
    if (!placement.deviceId) throw new PlacementError(`device "${id}" is not in house.json: deviceId is required to create it`)
    next = { id, deviceId: placement.deviceId }
    if (placement.position) next.position = placement.position
    if (placement.name) next.name = placement.name
    if (room) next.roomId = room.id
    else if (level) next.levelId = level.id
    if (placement.mount) next.mount = placement.mount
    if (placement.yaw !== undefined) next.yaw = placement.yaw
    if (placement.size) next.size = placement.size
    if (placement.leaves !== undefined) next.leaves = placement.leaves
    if (placement.gpsOffset && (placement.gpsOffset[0] !== 0 || placement.gpsOffset[1] !== 0)) next.gpsOffset = placement.gpsOffset
    if (placement.mapOffset && (placement.mapOffset[0] !== 0 || placement.mapOffset[1] !== 0)) next.mapOffset = placement.mapOffset
    if (placement.yawOffset) next.yawOffset = placement.yawOffset
    if (placement.batteryKwh) next.batteryKwh = placement.batteryKwh
    if (placement.model3d) next.model3d = placement.model3d
    if (placement.bodyColor) next.bodyColor = placement.bodyColor
    if (placement.bodyFinish) next.bodyFinish = placement.bodyFinish
    if (placement.speakerShape) next.speakerShape = placement.speakerShape
    if (placement.lease) next.lease = placement.lease
    if (placement.coverMaterial) next.coverMaterial = placement.coverMaterial
    if (placement.coverColor) next.coverColor = placement.coverColor
    if (placement.openingId) {
      const owner = openingOwner(rooms, placement.openingId)
      next.openingId = placement.openingId
      next.roomId = owner.id
    }
  }
  const out = [...devices]
  if (i >= 0) out[i] = next
  else out.push(next)
  // linking a device to an opening gives it the place of the bay: it now dresses it
  return placement.openingId
    ? alignDevicesOnOpenings({ ...doc, devices: out }, [placement.openingId])
    : { ...doc, devices: out }
}

/**
 * Returns a copy of the JSON document WITHOUT the device `id`: it leaves the house and becomes what it
 * was before being placed — auto-placed if its plugin room exists, otherwise "unplaced". Inverse gesture
 * of placement, confirmed on the UI side. An unknown id is refused (nothing to remove).
 *
 * The PANEL ARRAYS that name this device (`siteId`) leave with it: a solar installation
 * removed from the house does not leave twenty orphan modules in it, which no panel could
 * ever set. The arrays of another site, or those that name nobody, stay.
 */
export function removeDeviceFromJson(doc: unknown, id: string): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const devices = Array.isArray(doc.devices) ? doc.devices : []
  const i = devices.findIndex((d) => isObject(d) && d.id === id)
  if (i < 0) throw new PlacementError(`device "${id}" is not in house.json`)
  const deviceId = (devices[i] as JsonObject).deviceId
  const arrays = Array.isArray(doc.arrays) ? doc.arrays : []
  const kept = deviceId ? arrays.filter((a) => !(isObject(a) && a.siteId === deviceId)) : arrays
  return {
    ...doc,
    devices: devices.filter((_, k) => k !== i),
    ...(kept.length === arrays.length ? {} : { arrays: kept }),
  }
}

/**
 * Returns a copy of the JSON document with the 3D scene light setting set
 * (`render.tuning`), as it comes out of the Home view test bench. A NEUTRAL setting is not written:
 * it is removed from the file, so that a house without touch-ups remains a house without a `render`
 * section — the style then becomes the only source, which is exactly what we mean.
 */
export function setRenderTuningInJson(doc: unknown, tuning: SceneTuning): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const render: JsonObject = isObject(doc.render) ? { ...doc.render } : {}
  const neutral = (Object.keys(NEUTRAL_TUNING) as (keyof SceneTuning)[]).every((k) => tuning[k] === NEUTRAL_TUNING[k])
  if (neutral) delete render.tuning
  else render.tuning = { ...tuning }
  const { render: _dropped, ...rest } = doc
  return Object.keys(render).length ? { ...rest, render } : rest
}

/**
 * Returns a copy of the JSON document with the GPS origin (`origin`) replaced, as it comes out of the
 * alignment on the photo in Settings. Nothing else changes: rooms, terrain, relief, spots and
 * device offsets stay in the house reference frame — it is the WHOLE house that slides over the world.
 */
export function setOriginInJson(doc: unknown, origin: GeoOrigin): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  return { ...doc, origin: { lat: origin.lat, lon: origin.lon, alt: origin.alt, heading: origin.heading } }
}

/**
 * Returns a copy of the JSON document with the terrain relief set (`site.relief`), as it comes out of
 * the Home view editor. A FLAT relief (all heights at zero) or `null` is not written:
 * it is removed, so that a terrain without relief remains a terrain without the field.
 */
export function setReliefInJson(doc: unknown, relief: Relief | null): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  if (!isObject(doc.site)) throw new PlacementError('house document has no site')
  const { relief: _dropped, ...site } = doc.site
  const flat = !relief || relief.rows.every((row) => row.split(' ').every((v) => Number(v) === 0))
  return { ...doc, site: flat ? site : { ...site, relief: { step: relief.step, origin: [...relief.origin], rows: [...relief.rows] } } }
}

/**
 * Returns a copy of the JSON document with the terrain OUTLINE (`site.terrain`) replaced, set
 * from the Home view editor. An outline that crosses itself is refused (400, nothing is
 * written). An existing relief is enlarged if it no longer covers the outline (`extendReliefGrid`): its
 * new nodes take the height of the edge, the already shaped terrain does not move. What ends
 * up outside the outline (trees, spots, zones) is NOT removed: the editor flags it.
 */
export function setTerrainInJson(doc: unknown, polygon: readonly Vec2[]): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  if (!isObject(doc.site)) throw new PlacementError('house document has no site')
  if (!isSimplePolygon(polygon)) throw new PlacementError('terrain outline must be a simple polygon (no crossing edges)')
  const site: JsonObject = { ...doc.site, terrain: polygon.map((p) => [p[0], p[1]]) }
  const grid = parseRelief(doc.site.relief as Relief | undefined)
  if (grid) {
    const grown = extendReliefGrid(grid, polygon)
    if (grown !== grid) site.relief = serializeRelief(grown)
  }
  return { ...doc, site }
}

/**
 * Returns a copy of the JSON document with the settings of the plugin `pluginId` modified (activation,
 * sub-items, default light scene). A house that does not yet have a `plugins` section receives it
 * WRITTEN IN FULL from the default: without this, enabling Hue in a silent house would turn off the
 * simulation, which only the schema default kept on.
 */
export function setPluginInJson(doc: unknown, pluginId: string, patch: PluginSettingsPatch): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const plugins: JsonObject = isObject(doc.plugins) ? { ...doc.plugins } : defaultPlugins()
  const prev = isObject(plugins[pluginId]) ? (plugins[pluginId] as JsonObject) : {}
  const next: JsonObject = { ...prev }
  if (patch.enabled !== undefined) next.enabled = patch.enabled
  if (patch.autoDynamicForNewScenes !== undefined) next.autoDynamicForNewScenes = patch.autoDynamicForNewScenes
  // sub-items merge key by key: the UI only sends the one that has just been toggled
  if (patch.parts) next.parts = { ...(isObject(prev.parts) ? prev.parts : {}), ...patch.parts }
  plugins[pluginId] = next
  return { ...doc, plugins }
}

/**
 * Returns a copy of the JSON document with `roomOrder` set on the level `levelId`. Ids that are
 * not rooms of this level are refused (an order that no longer matches the house would be
 * silently ignored at display time).
 */
export function setRoomOrderInJson(doc: unknown, levelId: string, roomIds: string[]): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const levels = Array.isArray(doc.levels) ? doc.levels.filter(isObject) : []
  const i = levels.findIndex((l) => l.id === levelId)
  if (i < 0) throw new PlacementError(`unknown level "${levelId}"`)
  const rooms = Array.isArray(doc.rooms) ? doc.rooms.filter(isObject) : []
  const ofLevel = new Set(rooms.filter((r) => r.levelId === levelId).map((r) => r.id))
  const unknown = roomIds.find((id) => !ofLevel.has(id))
  if (unknown) throw new PlacementError(`room "${unknown}" is not on level "${levelId}"`)
  if (new Set(roomIds).size !== roomIds.length) throw new PlacementError('roomIds contains duplicates')
  const out = [...levels]
  out[i] = { ...levels[i]!, roomOrder: roomIds }
  return { ...doc, levels: out }
}

/**
 * Panel array (`house.arrays`) written from the UI: only the present fields are set, as
 * for a device placement. `levelId` and `origin` are required at CREATION — an array without a
 * level or a corner has nowhere to be drawn.
 */
export const panelArrayPatchSchema = z.object({
  name: z.string().min(1).optional(),
  /** Installation the array is part of (`deviceId` of the site): it takes it along when it is removed. */
  siteId: deviceIdSchema.optional(),
  levelId: z.string().min(1).optional(),
  /** Corner of the array: absolute x, y; z relative to the level floor (like `PanelArray.origin`). */
  origin: vec3Schema.optional(),
  yaw: z.number().min(0).max(360).optional(),
  /** Slope of the support (the roof under the array); `tilt` is the angle of the modules ON this support. */
  slope: z.number().min(0).max(90).optional(),
  /** Tilt of the modules: positive, they tilt up facing the azimuth (see `panelArraySchema`). */
  tilt: z.number().min(-90).max(90).optional(),
  rows: z.number().int().min(1).max(20).optional(),
  cols: z.number().int().min(1).max(20).optional(),
  /** Module: `width` along the columns, `height` along the rows (portrait ↔ landscape = the two swapped). */
  panel: z.object({
    width: z.number().positive().max(5).optional(),
    height: z.number().positive().max(5).optional(),
    /** Peak power of the module (Wp): the color scale of the array, cf. `panelArraySchema`. */
    peakW: z.number().positive().max(2000).optional(),
  }).optional(),
  /** Maximum output power of the array inverters (W, 0 = unknown): see `panelArraySchema`. */
  maxOutputW: z.number().min(0).max(2000).optional(),
  gap: z.number().min(0).max(1).optional(),
  /** Inverter of each slot, row by row; `null` = untracked slot. */
  panels: z.array(deviceIdSchema.nullable()).optional(),
})
export type PanelArrayPatch = z.infer<typeof panelArrayPatchSchema>

/**
 * Returns a copy of the JSON document with the array `id` created or modified. The inverter list is
 * BROUGHT BACK to the grid: shrinking an array from 2 × 5 to 2 × 3 would otherwise leave more modules than
 * slots, which the validation refuses — the UI cannot have it refused in the middle of a gesture.
 * The empty slots at the end are not written (a half-equipped array keeps a short JSON).
 */
export function putArrayInJson(doc: unknown, id: string, patch: PanelArrayPatch): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const arrays = Array.isArray(doc.arrays) ? doc.arrays : []
  const i = arrays.findIndex((a) => isObject(a) && a.id === id)
  const prev = i >= 0 ? (arrays[i] as JsonObject) : null
  const levelId = patch.levelId ?? (prev?.levelId as string | undefined)
  if (!levelId) throw new PlacementError(`panel array "${id}": levelId is required to create it`)
  const levels = Array.isArray(doc.levels) ? doc.levels.filter(isObject) : []
  if (!levels.some((l) => l.id === levelId)) throw new PlacementError(`unknown level "${levelId}"`)
  if (!prev && !patch.origin) throw new PlacementError(`panel array "${id}": origin is required to create it`)

  const next: JsonObject = { ...(prev ?? { id }), levelId }
  for (const key of ['name', 'siteId', 'origin', 'yaw', 'slope', 'tilt', 'rows', 'cols', 'maxOutputW', 'gap'] as const) {
    if (patch[key] !== undefined) next[key] = patch[key]
  }
  // The module is patched field by field, though: tilting a module (`width`/`height` swapped) must
  // not clear its peak power, which would then fall back on the default value.
  if (patch.panel) next.panel = { ...(isObject(prev?.panel) ? prev.panel : {}), ...patch.panel }
  const rows = Number(next.rows ?? 1), cols = Number(next.cols ?? 1)
  next.rows = rows
  next.cols = cols
  const panels = patch.panels ?? (Array.isArray(prev?.panels) ? (prev.panels as unknown[]) : [])
  const fitted = panels.slice(0, rows * cols)
  while (fitted.length > 0 && fitted[fitted.length - 1] == null) fitted.pop()
  next.panels = fitted

  const out = [...arrays]
  if (i >= 0) out[i] = next
  else out.push(next)
  return { ...doc, arrays: out }
}

/**
 * Returns a copy of the JSON document WITHOUT the array `id`: its modules disappear from the house
 * (they only existed derived) and its inverters become devices to place again. An unknown id
 * is refused.
 */
export function removeArrayFromJson(doc: unknown, id: string): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const arrays = Array.isArray(doc.arrays) ? doc.arrays : []
  const i = arrays.findIndex((a) => isObject(a) && a.id === id)
  if (i < 0) throw new PlacementError(`panel array "${id}" is not in house.json`)
  return { ...doc, arrays: arrays.filter((_, k) => k !== i) }
}

/**
 * Opening (`rooms[i].openings[j]`) set from the UI: dimensions and place on the outline of the room.
 * Only the present fields are set, as for a device placement — setting the sill must not
 * redeposit the width that was being typed elsewhere.
 *
 * The patch does not CREATE: an opening is born from the survey, the UI only adjusts it.
 */
export const openingPatchSchema = z.object({
  /** Plain name (like `Opening.name`). **Empty string = clear** and go back to the survey `id`. */
  name: z.string().trim().max(60).optional(),
  type: z.enum(OPENING_TYPES).optional(),
  /** Edge of the room that carries the opening (index in `room.polygon`). */
  segment: z.number().int().min(0).optional(),
  /** Distance (m) from the corner `polygon[segment]` to the near edge. */
  offset: z.number().min(0).max(100).optional(),
  /** Center in plan of a surface opening. */
  x: z.number().optional(),
  y: z.number().optional(),
  /** Heading (azimuth) of a surface opening. */
  yaw: z.number().min(-360).max(360).optional(),
  width: z.number().positive().max(20).optional(),
  height: z.number().positive().max(10).optional(),
  /**
   * Sill height from the finished floor. **Absent = not touched**; `0` is a value, not
   * a clearing — a door is at 0 and the rest. An opening that never had one follows the house default
   * (`defaults.windowSill`), it is `openingSill` that decides.
   */
  sill: z.number().min(0).max(10).optional(),
  /**
   * Number of leaves. **Empty string = clear** and hand back to what is deduced
   * (`openingLeaves`): writing the deduced number instead of removing the key would FREEZE a bay that
   * followed its width.
   */
  leaves: z.union([z.number().int().min(MIN_OPENING_LEAVES).max(MAX_OPENING_LEAVES), z.literal('')]).optional(),
  /** Material of the joinery. **Empty string = clear** and hand back to the nature of the opening. */
  material: z.union([z.enum(OPENING_MATERIALS), z.literal('')]).optional(),
  /** Color of the joinery. **Empty string = clear** and hand back to the style palette. */
  color: z.union([hexColorSchema, z.literal('')]).optional(),
})
export type OpeningPatch = z.infer<typeof openingPatchSchema>

/**
 * Returns a copy of the JSON document with the opening `openingId` of the room `roomId` modified.
 *
 * Unlike the other patches, the target is NESTED: we copy the room and its array
 * of openings, without touching the other rooms. The rest of the rules (opening within its segment,
 * under the ceiling, without overlap) is checked by `parseHouse` before writing, as everywhere.
 */
export function patchOpeningInJson(doc: unknown, roomId: string, openingId: string, patch: OpeningPatch): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const rooms = Array.isArray(doc.rooms) ? doc.rooms : []
  const ri = rooms.findIndex((r) => isObject(r) && r.id === roomId)
  if (ri < 0) throw new PlacementError(`unknown room "${roomId}"`)
  const room = rooms[ri] as JsonObject
  const openings = Array.isArray(room.openings) ? room.openings : []
  const oi = openings.findIndex((o) => isObject(o) && o.id === openingId)
  if (oi < 0) throw new PlacementError(`room "${roomId}" has no opening "${openingId}"`)

  const next: JsonObject = { ...(openings[oi] as JsonObject) }
  for (const key of ['type', 'segment', 'offset', 'x', 'y', 'yaw', 'width', 'height', 'sill'] as const) {
    if (patch[key] !== undefined) next[key] = patch[key]
  }
  // the four CLEARABLE fields: an empty string removes the key from the file, and what replaces it
  // is the deduced default — the survey id for the name, the width for the leaves, the nature for
  // the material, the style for the color. Writing a `null` would leave a dead key in a survey
  // that is reread by hand.
  for (const key of ['name', 'leaves', 'material', 'color'] as const) {
    if (patch[key] === undefined) continue
    if (patch[key]) next[key] = patch[key]
    else delete next[key]
  }
  const nextOpenings = [...openings]
  nextOpenings[oi] = next
  const nextRooms = [...rooms]
  nextRooms[ri] = { ...room, openings: nextOpenings }
  // the opening moved (or changed dimensions): what dresses it follows, in the same write
  return alignDevicesOnOpenings({ ...doc, rooms: nextRooms }, [openingId])
}

/**
 * Opening ADDED to a room from edit mode. Complete, unlike the patch: an
 * opening that is born must say where it sits and what it measures, otherwise it exists nowhere.
 * The id is chosen by the UI, like that of a panel array.
 */
export const newOpeningSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().trim().max(60).optional(),
  type: z.enum(OPENING_TYPES),
  segment: z.number().int().min(0).optional(),
  offset: z.number().min(0).max(100).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  yaw: z.number().min(-360).max(360).optional(),
  width: z.number().positive().max(20),
  height: z.number().positive().max(10),
  sill: z.number().min(0).max(10).optional(),
}).superRefine((o, ctx) => {
  const surface = o.type === 'roof-window' || o.type === 'skylight'
  if (surface) {
    if (o.x === undefined) ctx.addIssue({ code: 'custom', path: ['x'], message: 'surface opening requires x' })
    if (o.y === undefined) ctx.addIssue({ code: 'custom', path: ['y'], message: 'surface opening requires y' })
    if (o.yaw === undefined) ctx.addIssue({ code: 'custom', path: ['yaw'], message: 'surface opening requires yaw' })
  } else {
    if (o.segment === undefined) ctx.addIssue({ code: 'custom', path: ['segment'], message: 'wall opening requires segment' })
    if (o.offset === undefined) ctx.addIssue({ code: 'custom', path: ['offset'], message: 'wall opening requires offset' })
  }
})
export type NewOpening = z.infer<typeof newOpeningSchema>

/**
 * Returns a copy of the JSON document with one MORE opening in the room `roomId`. The id must be
 * free in the WHOLE house, not only in the room: a cover names its opening without
 * saying where it is (`devices[].openingId`), and `parseHouse` would refuse the duplicate.
 *
 * The sill is only written if it says something: `0` is the implicit default of everything that
 * goes down to the floor, and omitting it keeps the file readable for whoever rereads their survey. The WINDOW makes an
 * exception — without `sill`, it would fall back on `defaults.windowSill`, so an intended 0 is written.
 */
export function addOpeningToJson(doc: unknown, roomId: string, opening: NewOpening): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const rooms = Array.isArray(doc.rooms) ? doc.rooms : []
  const ri = rooms.findIndex((r) => isObject(r) && r.id === roomId)
  if (ri < 0) throw new PlacementError(`unknown room "${roomId}"`)
  for (const r of rooms) {
    if (!isObject(r) || !Array.isArray(r.openings)) continue
    if (r.openings.some((o) => isObject(o) && o.id === opening.id)) throw new PlacementError(`opening "${opening.id}" already exists`)
  }
  const room = rooms[ri] as JsonObject
  const openings = Array.isArray(room.openings) ? room.openings : []
  const next: JsonObject = {
    id: opening.id, type: opening.type, width: opening.width, height: opening.height,
  }
  if (opening.type === 'roof-window' || opening.type === 'skylight') {
    next.x = opening.x
    next.y = opening.y
    next.yaw = opening.yaw
  } else {
    next.segment = opening.segment
    next.offset = opening.offset
  }
  if (opening.name) next.name = opening.name
  if (opening.sill !== undefined && (opening.sill > 0 || opening.type === 'window')) next.sill = opening.sill
  const nextRooms = [...rooms]
  nextRooms[ri] = { ...room, openings: [...openings, next] }
  return { ...doc, rooms: nextRooms }
}

/**
 * Returns a copy of the JSON document WITHOUT the opening `openingId` of the room `roomId`.
 *
 * The cover that dressed it is FREED in the same write (`openingId` cleared): a shutter that
 * names a vanished opening makes `parseHouse` reject the whole house, and the deletion
 * would fail without saying the real reason. The shutter stays in the house, without an opening — the
 * Covers view then counts it among those waiting for a place.
 */
export function removeOpeningFromJson(doc: unknown, roomId: string, openingId: string): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const rooms = Array.isArray(doc.rooms) ? doc.rooms : []
  const ri = rooms.findIndex((r) => isObject(r) && r.id === roomId)
  if (ri < 0) throw new PlacementError(`unknown room "${roomId}"`)
  const room = rooms[ri] as JsonObject
  const openings = Array.isArray(room.openings) ? room.openings : []
  if (!openings.some((o) => isObject(o) && o.id === openingId)) throw new PlacementError(`room "${roomId}" has no opening "${openingId}"`)
  const nextRooms = [...rooms]
  nextRooms[ri] = { ...room, openings: openings.filter((o) => !(isObject(o) && o.id === openingId)) }

  const devices = Array.isArray(doc.devices) ? doc.devices : []
  let bound = false
  const freed = devices.map((d) => {
    if (!isObject(d) || d.openingId !== openingId) return d
    bound = true
    const { openingId: _gone, ...rest } = d
    return rest
  })
  // no `devices` key set in a house that had none: we only rewrite what changes
  return { ...doc, rooms: nextRooms, ...(bound ? { devices: freed } : {}) }
}

/**
 * Parking spot set from edit mode: its dimensions, its center, its heading.
 * Only the present fields are set — setting the front dimension does not redeposit the width.
 *
 * Two fields follow the rule of the empty name that clears (like `openingPatchSchema`): `name` hands
 * back to the id, and `margin` to the common margin (`PARKING_SNAP_MARGIN`). The `deviceId` of a base,
 * for its part, is not patched: a base that changes robot is another spot.
 */
export const parkingPatchSchema = z.object({
  name: z.string().trim().max(60).optional(),
  center: vec2Schema.optional(),
  size: z.tuple([z.number().min(MIN_PARKING_DIM).max(30), z.number().min(MIN_PARKING_DIM).max(30)]).optional(),
  /**
   * Heading of the front. The UI brings it back into `[0, 360[` before sending, like the `yaw` of an
   * oriented device (`PlacementControl`); the bounds stay wide because a COMPUTED axis (that of a
   * garage, `longestEdgeYawDeg`) comes back negative, and a refusal would teach nobody anything.
   */
  yaw: z.number().min(-360).max(360).optional(),
  /** `0` CLEARS and hands back to the common margin — a spot without its own margin would snap nothing. */
  margin: z.number().min(0).max(20).optional(),
})
export type ParkingPatch = z.infer<typeof parkingPatchSchema>

/** The spots of the document, as they are written there (absent array = house without spots). */
function parkingsOf(doc: JsonObject): { site: JsonObject; list: unknown[] } {
  const site = isObject(doc.site) ? doc.site : null
  if (!site) throw new PlacementError('house document has no site')
  return { site, list: Array.isArray(site.parkings) ? site.parkings : [] }
}

/** Returns a copy of the JSON document with the spot `id` modified. */
export function patchParkingInJson(doc: unknown, id: string, patch: ParkingPatch): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const { site, list } = parkingsOf(doc)
  const i = list.findIndex((p) => isObject(p) && p.id === id)
  if (i < 0) throw new PlacementError(`unknown parking "${id}"`)
  const next: JsonObject = { ...(list[i] as JsonObject) }
  for (const key of ['center', 'size', 'yaw'] as const) if (patch[key] !== undefined) next[key] = patch[key]
  for (const key of ['name', 'margin'] as const) {
    if (patch[key] === undefined) continue
    if (patch[key]) next[key] = patch[key]
    else delete next[key]
  }
  const nextList = [...list]
  nextList[i] = next
  return { ...doc, site: { ...site, parkings: nextList } }
}

/**
 * Spot ADDED from edit mode. Complete, like an opening that is born: a spot must say
 * what parks in it and where it is, otherwise it exists nowhere. The id is chosen by the UI.
 */
export const newParkingSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().trim().max(60).optional(),
  accepts: z.enum(DEVICE_KINDS),
  /** Base reserved for this device. Absent = spot shared by all the devices of the kind. */
  deviceId: deviceIdSchema.optional(),
  /** Level that carries the spot, given by the GROUND tapped in the 3D. Absent = on the terrain. */
  levelId: z.string().min(1).optional(),
  center: vec2Schema,
  size: z.tuple([z.number().min(MIN_PARKING_DIM).max(30), z.number().min(MIN_PARKING_DIM).max(30)]),
  yaw: z.number().min(-360).max(360),
})
export type NewParking = z.infer<typeof newParkingSchema>

/** Returns a copy of the JSON document with one MORE spot. The id must be free in the house. */
export function addParkingToJson(doc: unknown, parking: NewParking): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const { site, list } = parkingsOf(doc)
  if (list.some((p) => isObject(p) && p.id === parking.id)) throw new PlacementError(`parking "${parking.id}" already exists`)
  const next: JsonObject = {
    id: parking.id, accepts: parking.accepts, center: parking.center, size: parking.size, yaw: parking.yaw,
  }
  if (parking.name) next.name = parking.name
  if (parking.deviceId) next.deviceId = parking.deviceId
  if (parking.levelId) next.levelId = parking.levelId
  return { ...doc, site: { ...site, parkings: [...list, next] } }
}

/**
 * Returns a copy of the JSON document WITHOUT the spot `id`. Nothing to free elsewhere: a spot is not
 * named by any device — it is the spot that names its own (the inverse of an opening and its
 * cover). The vehicle that parked there simply goes back to its GPS point.
 */
export function removeParkingFromJson(doc: unknown, id: string): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const { site, list } = parkingsOf(doc)
  if (!list.some((p) => isObject(p) && p.id === id)) throw new PlacementError(`unknown parking "${id}"`)
  return { ...doc, site: { ...site, parkings: list.filter((p) => !(isObject(p) && p.id === id)) } }
}

/** Garden element ADDED from edit mode. The id is chosen by the UI. */
export const newGardenItemSchema = z.object({
  id: z.string().min(1).max(60),
  kind: z.enum(GARDEN_KINDS),
  center: vec2Schema,
  height: z.number().min(MIN_GARDEN_HEIGHT).max(MAX_GARDEN_HEIGHT),
  yaw: z.number().min(-360).max(360).optional(),
  /** Length of a hedge (m). */
  length: z.number().min(MIN_HEDGE_LENGTH).max(MAX_HEDGE_LENGTH).optional(),
  /** Width of a hedge (m). */
  width: z.number().min(MIN_HEDGE_WIDTH).max(MAX_HEDGE_WIDTH).optional(),
  /** Spacing between the plants of a hedge (m). */
  spacing: z.number().min(MIN_HEDGE_SPACING).max(MAX_HEDGE_SPACING).optional(),
  seed: z.number().int().min(0).optional(),
  /** Species from the app catalog. In a setting, the empty string CLEARS it (back to the family). */
  species: z.string().regex(/^([a-z0-9_.-]+)?$/i).max(60).optional(),
})
export type NewGardenItem = z.infer<typeof newGardenItemSchema>

/**
 * Garden element set: only the present fields are set. Changing family is allowed.
 * `spacing: null` CLEARS the spacing of a hedge (back to automatic).
 */
export const gardenItemPatchSchema = newGardenItemSchema.omit({ id: true }).partial().extend({
  spacing: z.number().min(MIN_HEDGE_SPACING).max(MAX_HEDGE_SPACING).nullable().optional(),
})
export type GardenItemPatch = z.infer<typeof gardenItemPatchSchema>

/** The garden elements, as they are written (absent array = empty garden). */
function gardenOf(doc: JsonObject): { site: JsonObject; list: unknown[] } {
  const site = isObject(doc.site) ? doc.site : null
  if (!site) throw new PlacementError('house document has no site')
  return { site, list: Array.isArray(site.garden) ? site.garden : [] }
}

/** Returns a copy of the JSON document with one MORE garden element. The id must be free. */
export function addGardenItemToJson(doc: unknown, item: NewGardenItem): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const { site, list } = gardenOf(doc)
  if (list.some((g) => isObject(g) && g.id === item.id)) throw new PlacementError(`garden item "${item.id}" already exists`)
  const next: JsonObject = { id: item.id, kind: item.kind, center: item.center, height: item.height }
  if (item.yaw) next.yaw = item.yaw
  if (item.length !== undefined) next.length = item.length
  if (item.width !== undefined) next.width = item.width
  if (item.spacing !== undefined) next.spacing = item.spacing
  if (item.seed !== undefined) next.seed = item.seed
  if (item.species) next.species = item.species
  return { ...doc, site: { ...site, garden: [...list, next] } }
}

/** Returns a copy of the JSON document with the garden element `id` modified. */
export function patchGardenItemInJson(doc: unknown, id: string, patch: GardenItemPatch): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const { site, list } = gardenOf(doc)
  const i = list.findIndex((g) => isObject(g) && g.id === id)
  if (i < 0) throw new PlacementError(`unknown garden item "${id}"`)
  const next: JsonObject = { ...(list[i] as JsonObject) }
  for (const key of ['kind', 'center', 'height', 'length', 'width', 'seed'] as const) if (patch[key] !== undefined) next[key] = patch[key]
  if (patch.spacing !== undefined) { if (patch.spacing === null) delete next.spacing; else next.spacing = patch.spacing }
  // a zero heading is not written: it is the default value
  if (patch.yaw !== undefined) { if (patch.yaw) next.yaw = patch.yaw; else delete next.yaw }
  if (patch.species !== undefined) { if (patch.species) next.species = patch.species; else delete next.species }
  const nextList = [...list]
  nextList[i] = next
  return { ...doc, site: { ...site, garden: nextList } }
}

/** Returns a copy of the JSON document WITHOUT the garden element `id`. Nothing names it elsewhere. */
export function removeGardenItemFromJson(doc: unknown, id: string): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const { site, list } = gardenOf(doc)
  if (!list.some((g) => isObject(g) && g.id === id)) throw new PlacementError(`unknown garden item "${id}"`)
  return { ...doc, site: { ...site, garden: list.filter((g) => !(isObject(g) && g.id === id)) } }
}
