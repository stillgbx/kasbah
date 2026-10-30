import { z } from 'zod'
import { DEVICE_KINDS, VEHICLE_FINISHES } from '../devices/kinds'
import { deviceIdSchema, hexColorSchema } from '../devices/descriptor'
export { hexColorSchema }
import { signedArea } from './geometry/vec2'
import { FINISH_IDS, FINISHES, type FinishSurface } from './finishes'

// Description of the house. Reference frame: metric Z-UP, x = east, y = north, z = up (the
// polygons live in XY like `THREE.Shape`, heights are extruded along +Z).
// The room polygons are the finished INNER FACE, counterclockwise (CCW) —
// the order is imposed (not silently reversed) because openings reference a segment index.

export const vec2Schema = z.tuple([z.number(), z.number()])
export const vec3Schema = z.tuple([z.number(), z.number(), z.number()])
export type { Vec2 } from './geometry/vec2'
export type { Vec3 } from './geometry/types'
import type { Vec2 } from './geometry/vec2'

const idSchema = z.string().min(1).regex(/^[a-z0-9_.-]+$/i, 'id: [a-z0-9_.-]+')
const metaSchema = z.record(z.string(), z.unknown()).optional()

/**
 * Identifier of a 3D bodywork: `<pluginId>/<model>`, which is ALSO the path of the file
 * under `public/models/`. The catalog lives on the web side (it alone knows what is shipped); the
 * shared contract therefore only validates the shape, not the existence of the model.
 */
export const model3dSchema = z.string().regex(/^(none|[a-z0-9_]+\/[a-z0-9-]+)$/, "model3d: 'none' ou <pluginId>/<modèle>")

function noConsecutiveDuplicates(poly: Vec2[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) return false
  }
  return true
}

export const polygonSchema = z.array(vec2Schema).min(3)
  .refine(noConsecutiveDuplicates, 'polygon has consecutive duplicate points')
export const ccwPolygonSchema = polygonSchema
  .refine((p) => signedArea(p) > 0, 'polygon must be counter-clockwise (CCW)')

export const geoOriginSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  alt: z.number().default(0),
  /** Heading (degrees, clockwise from true north) of the local +y axis. 0 = +y points north. */
  heading: z.number().min(-360).max(360).default(0),
})
export type GeoOrigin = z.infer<typeof geoOriginSchema>

export const houseDefaultsSchema = z.object({
  levelHeight: z.number().positive(),
  slabThickness: z.number().min(0),
  interiorWallThickness: z.number().min(0),
  exteriorWallThickness: z.number().min(0),
  doorHeight: z.number().positive(),
  windowSill: z.number().min(0),
}).partial()

export const levelSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  /** Short label for the tabs (e.g. "RDC"). */
  shortName: z.string().min(1).max(12).optional(),
  /** z of the finished floor (absolute, house reference frame). */
  elevation: z.number(),
  height: z.number().positive().optional(),
  /** Exterior footprint (outer face of the walls). Used for the roof. */
  outline: polygonSchema.optional(),
  /** Display order of the rooms of the level (UI). The absent rooms follow, in alphabetical order. */
  roomOrder: z.array(idSchema).optional(),
  meta: metaSchema,
})
export type Level = z.infer<typeof levelSchema>

export const WALL_KINDS = ['interior', 'exterior', 'none'] as const
export type WallKind = (typeof WALL_KINDS)[number]

/**
 * `bay` = glazed bay (large glazed opening going down to the floor), `glass-door` = glazed door.
 * Both are GLAZED like a window and set on the floor like a door: this is precisely what
 * none of the first four could say, and why they exist separately.
 *
 * `roof-window` = roof window (Velux) on the roof surface; `skylight` = light well /
 * floor glass. Both are anchored on a surface (`x`, `y`, `yaw`), not on a wall.
 */
export const OPENING_TYPES = ['door', 'window', 'passage', 'garage', 'bay', 'glass-door', 'roof-window', 'skylight'] as const
export type OpeningType = (typeof OPENING_TYPES)[number]

/** Opening set on a floor or a roof, not on a wall. */
export const SURFACE_OPENING_TYPES = ['roof-window', 'skylight'] as const
export type SurfaceOpeningType = (typeof SURFACE_OPENING_TYPES)[number]

export const isSurfaceOpening = (type: OpeningType): type is SurfaceOpeningType =>
  (SURFACE_OPENING_TYPES as readonly string[]).includes(type)

/**
 * Material of the JOINERY of an opening — its frame and its leaves, not the wall that carries it.
 * When absent, the scene keeps what it deduces from the nature (anthracite frame, wooden leaf): a
 * tape-measure survey does not have to describe the material of each window to be right.
 *
 * `glass` GLAZES the opening in addition to tinting it: a solid door declared as glass receives its
 * glazing and loses its opaque panel, exactly like a glass door. `fabric` is the only one that
 * says nothing more than a light: a CANVAS, matte and without reflection — the awning of a blind, the
 * fabric of a curtain, a soft-curtain garage door.
 */
export const OPENING_MATERIALS = ['wood', 'metal', 'glass', 'fabric'] as const
export type OpeningMaterial = (typeof OPENING_MATERIALS)[number]

/** 3D silhouette of a speaker (`media_player` speaker): cylinder, puck, bar, block. */
export const SPEAKER_SHAPES = ['default', 'pebble', 'bar', 'block'] as const
export type SpeakerShape = (typeof SPEAKER_SHAPES)[number]

/** Bounds of the number of leaves. Ten: beyond that, it is no longer an opening, it is a facade. */
export const MIN_OPENING_LEAVES = 1
export const MAX_OPENING_LEAVES = 10
export const openingSchema = z.object({
  id: idSchema,
  /**
   * Plain name, given from edit mode ("Living room bay"). When absent, the survey `id`
   * is displayed: an identifier stays readable, it is just not always a name.
   */
  name: z.string().min(1).max(60).optional(),
  type: z.enum(OPENING_TYPES),
  /**
   * Edge polygon[segment] → polygon[(segment+1) % n]. Required for a WALL opening; absent
   * for `roof-window` / `skylight` (surface anchoring).
   */
  segment: z.number().int().min(0).optional(),
  /** Distance (m) from polygon[segment] to the near edge. Required for a wall opening. */
  offset: z.number().min(0).optional(),
  /**
   * Center in plan (house reference frame) of a SURFACE opening. Required for `roof-window` /
   * `skylight`; absent for a wall opening.
   */
  x: z.number().optional(),
  y: z.number().optional(),
  /**
   * Heading (azimuth, degrees) of a surface opening — same convention as the devices and the
   * spots (0 = facing +y). Required for `roof-window` / `skylight`.
   */
  yaw: z.number().min(-360).max(360).optional(),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Sill height from the finished floor. Default: 0 (door/passage/garage) or defaults.windowSill (window). */
  sill: z.number().min(0).optional(),
  /**
   * Number of leaves. When absent, it is DEDUCED from the nature and the width (`openingLeaves`): a
   * three-meter bay is a sliding door with two or three leaves, everything else has only one.
   * The number draws the divisions of a glazed opening and cuts the panel of a solid door.
   */
  leaves: z.number().int().min(MIN_OPENING_LEAVES).max(MAX_OPENING_LEAVES).optional(),
  /** Material of the joinery. When absent, the scene decides from the nature (`OPENING_MATERIALS`). */
  material: z.enum(OPENING_MATERIALS).optional(),
  /** Color of the joinery (#rrggbb). When absent, it is the palette of the render style that gives it. */
  color: hexColorSchema.optional(),
  style: metaSchema,
  meta: metaSchema,
}).superRefine((o, ctx) => {
  if (isSurfaceOpening(o.type)) {
    if (o.x === undefined) ctx.addIssue({ code: 'custom', path: ['x'], message: 'surface opening requires x' })
    if (o.y === undefined) ctx.addIssue({ code: 'custom', path: ['y'], message: 'surface opening requires y' })
    if (o.yaw === undefined) ctx.addIssue({ code: 'custom', path: ['yaw'], message: 'surface opening requires yaw' })
  } else {
    if (o.segment === undefined) ctx.addIssue({ code: 'custom', path: ['segment'], message: 'wall opening requires segment' })
    if (o.offset === undefined) ctx.addIssue({ code: 'custom', path: ['offset'], message: 'wall opening requires offset' })
  }
})
export type Opening = z.infer<typeof openingSchema>

export const ROOM_KINDS = ['room', 'corridor', 'stairs', 'garage', 'terrace', 'balcony'] as const
export type RoomKind = (typeof ROOM_KINDS)[number]
export const FLOOR_STYLES = ['wood', 'tile', 'concrete', 'carpet'] as const
export type FloorStyle = (typeof FLOOR_STYLES)[number]
/**
 * A finish set on a surface (`finishes.ts`). `tint` replaces the color of the photo and
 * only exists for tintable finishes (paints, plasters).
 */
export const finishSchema = z.object({ id: z.enum(FINISH_IDS), tint: hexColorSchema.optional() }).superRefine((f, ctx) => {
  if (f.tint && !FINISHES[f.id].tintable) ctx.addIssue({ code: 'custom', path: ['tint'], message: `finish "${f.id}" cannot be tinted` })
})
export type Finish = z.infer<typeof finishSchema>
/** A finish that does not dress this surface (a carpet on a facade) is refused. */
const finishOn = (surface: FinishSurface) => finishSchema.refine(
  (f) => (FINISHES[f.id].surfaces as readonly FinishSurface[]).includes(surface),
  { message: `finish not allowed on ${surface}` },
)

export const roomSchema = z.object({
  id: idSchema,
  levelId: idSchema,
  name: z.string().min(1),
  polygon: ccwPolygonSchema,
  kind: z.enum(ROOM_KINDS).default('room'),
  height: z.number().positive().optional(),
  walls: z.array(z.object({
    segment: z.number().int().min(0),
    kind: z.enum(WALL_KINDS).optional(),
    thickness: z.number().min(0).optional(),
  })).optional(),
  openings: z.array(openingSchema).default([]),
  style: z.object({
    color: z.string().optional(),
    floor: z.enum(FLOOR_STYLES).optional(),
    /** Floor finish; takes precedence over `floor` in the styles that interpret finishes. */
    floorFinish: finishOn('floor').optional(),
    /** Finish of the INTERIOR faces of its walls (partitions and interior of facades). */
    wallFinish: finishOn('wall').optional(),
  }).optional(),
  meta: metaSchema,
})
export type Room = z.infer<typeof roomSchema>

export const ZONE_KINDS = ['lawn', 'terrace', 'driveway', 'path', 'pool', 'bed', 'other'] as const
export type ZoneKind = (typeof ZONE_KINDS)[number]
export const zoneSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  kind: z.enum(ZONE_KINDS),
  polygon: polygonSchema,
  style: z.object({ color: z.string().optional() }).optional(),
  meta: metaSchema,
})
export type Zone = z.infer<typeof zoneSchema>

/** Smallest dimension of a spot (m): a zero spot would vanish from the floor without anyone knowing why. */
export const MIN_PARKING_DIM = 0.2
const parkingDimSchema = z.number().min(MIN_PARKING_DIM).max(30)

/**
 * Parking spot: the rectangle on the ground where a mobile vehicle PARKS, oriented (it has a front).
 *
 * It is the answer to the only flaw of devices placed by their GPS (vehicle, robot): the reading
 * is good to within a few meters, which is enough to say "the car is at home" and not to
 * put it in its garage — it ended up across a wall, and the wrong way round. A vehicle AT
 * REST near a compatible spot therefore parks in it exactly (`assignParkings`, `parking.ts`).
 *
 * Two fields, and only two, say who is entitled to a spot:
 * - **`accepts`** — the kind that parks there. A car has no business on a mower's base,
 *   and this field forbids it. It ALSO drives the drawing: a car spot is drawn
 *   on the ground (dashes and "P"), a robot's base is an object (plate and head block).
 * - **`deviceId`** — spot RESERVED for this device. A base is not shared: the mower's
 *   is not the vacuum's. Absent = spot SHARED by all the devices of the
 *   kind, which is the case for cars: any of them parks in any garage.
 */
export const parkingSchema = z.object({
  id: idSchema,
  name: z.string().min(1).optional(),
  accepts: z.enum(DEVICE_KINDS),
  deviceId: deviceIdSchema.optional(),
  /**
   * Level that carries the spot. **Absent = on the ground, on the terrain** (garden). A spot is not
   * always outside: a car parks in a garage, a drone lands on the roof, a
   * vacuum has its base upstairs — and it is the level that gives the marking its altitude, decides
   * the pass that draws it, and makes it disappear when looking at another floor.
   */
  levelId: idSchema.optional(),
  /** Center of the rectangle (m, house reference frame). */
  center: vec2Schema,
  /** `[width, length]` (m): the length is the front-back axis, the one `yaw` orients. */
  size: z.tuple([parkingDimSchema, parkingDimSchema]),
  /** Heading of the FRONT (degrees, 0 = toward +y), same convention as the `yaw` of a device. */
  yaw: z.number(),
  /**
   * Distance (m) beyond the rectangle where the vehicle still snaps. Absent = `PARKING_SNAP_MARGIN`.
   * Set spot by spot because the residual bias of a GPS is not the same in a closed
   * garage and in the middle of a driveway.
   */
  margin: z.number().min(0).max(20).optional(),
  meta: metaSchema,
})
export type Parking = z.infer<typeof parkingSchema>

/** Families of garden landscaping elements. A decoration: no device, no state. */
export const GARDEN_KINDS = ['broadleaf', 'fruit', 'conifer', 'palm', 'bamboo', 'shrub', 'rock', 'hedge'] as const
export type GardenKind = (typeof GARDEN_KINDS)[number]
/** Height bounds of an element (m): a 5 cm pebble vanishes in the lawn, a 40 m tree goes out of the frame. */
export const MIN_GARDEN_HEIGHT = 0.1
export const MAX_GARDEN_HEIGHT = 40
/** Length of a hedge (m): bounds, and value taken when the field is absent. */
export const MIN_HEDGE_LENGTH = 0.5
export const MAX_HEDGE_LENGTH = 100
export const DEFAULT_HEDGE_LENGTH = 3
/** Width (thickness) of a hedge (m): bounds, and value taken when the field is absent. */
export const MIN_HEDGE_WIDTH = 0.2
export const MAX_HEDGE_WIDTH = 5
export const DEFAULT_HEDGE_WIDTH = 0.7
/** Spacing between two plants of a hedge (m, foot to foot). Absent = automatic (the foliage overlaps). */
export const MIN_HEDGE_SPACING = 0.2
export const MAX_HEDGE_SPACING = 5

/**
 * Garden landscaping element (tree, bush, stone), set on the terrain and following its
 * relief. Only the HEIGHT is settable: the width follows from the family and the drawn shape.
 */
export const gardenItemSchema = z.object({
  id: idSchema,
  kind: z.enum(GARDEN_KINDS),
  /** Foot of the element (m, house reference frame). */
  center: vec2Schema,
  height: z.number().min(MIN_GARDEN_HEIGHT).max(MAX_GARDEN_HEIGHT),
  /** Rotation around the vertical (degrees). Absent = 0. */
  yaw: z.number().optional(),
  /**
   * Hedge only: length of the segment (m), centered on `center`, along the local x axis rotated by
   * `yaw`. Absent = `DEFAULT_HEDGE_LENGTH`. An L-shaped hedge = two segments.
   */
  length: z.number().min(MIN_HEDGE_LENGTH).max(MAX_HEDGE_LENGTH).optional(),
  /** Hedge only: width (thickness) of the segment (m), across its axis. Absent = `DEFAULT_HEDGE_WIDTH`. */
  width: z.number().min(MIN_HEDGE_WIDTH).max(MAX_HEDGE_WIDTH).optional(),
  /** Hedge only: foot-to-foot spacing between its plants (m). Absent = automatic, tight. */
  spacing: z.number().min(MIN_HEDGE_SPACING).max(MAX_HEDGE_SPACING).optional(),
  /**
   * Seed of the shape: two firs of the same height are not twins. Absent = drawn from the id;
   * the UI writes one when "another shape" is requested.
   */
  seed: z.number().int().min(0).optional(),
  /**
   * Species ("cherry tree"): a recipe of shape and colors from the app catalog, which refines the
   * family. When absent, or unknown to the app reading the file = the generic shape of the family.
   */
  species: idSchema.optional(),
  meta: metaSchema,
})
export type GardenItem = z.infer<typeof gardenItemSchema>

/**
 * Terrain relief: a regular grid of heights, as an OFFSET from `site.elevation`. Absent = flat terrain,
 * as before the field.
 *
 * `rows`: one string per row, from south (y = `origin[1]`) to north, values in whole CENTIMETERS
 * separated by a space, from west to east. One row per line of the file instead of one number per
 * line: 1,800 points stay 56 readable lines, and a diff shows the row that moved.
 * Outside the grid, the height is that of the nearest edge.
 */
export const reliefSchema = z.object({
  step: z.number().min(0.5).max(10),
  origin: vec2Schema,
  rows: z.array(z.string().regex(/^-?\d+( -?\d+)*$/)).min(2),
}).refine((r) => r.rows.every((row) => row.split(' ').length === r.rows[0]!.split(' ').length && row.split(' ').length >= 2), {
  message: 'relief rows must all have the same number (≥ 2) of values',
})
export type Relief = z.infer<typeof reliefSchema>

export const siteSchema = z.object({
  elevation: z.number().default(0),
  terrain: polygonSchema,
  relief: reliefSchema.optional(),
  zones: z.array(zoneSchema).default([]),
  parkings: z.array(parkingSchema).default([]),
  garden: z.array(gardenItemSchema).default([]),
})
export type Site = z.infer<typeof siteSchema>

/**
 * Lease with purchase option (or long-term) of a vehicle: what is needed to track the
 * mileage against the allowance. **No vendor publishes the financing contract** — Renault
 * exposes at best a maintenance contract based on it —: it is an ENTERED value. `startKm`, the
 * odometer at the handover of the keys, is missing from any reading; absent = 0, a new vehicle.
 */
export const vehicleLeaseSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date : AAAA-MM-JJ'),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date : AAAA-MM-JJ'),
  /** Mileage allowance of the WHOLE contract (km), not per year. */
  km: z.number().int().positive().max(2_000_000),
  startKm: z.number().int().min(0).max(2_000_000).optional(),
}).refine((l) => l.start < l.end, { message: 'lease must end after it starts' })
export type VehicleLease = z.infer<typeof vehicleLeaseSchema>

export const MOUNTS = ['ceiling', 'wall', 'floor', 'free'] as const
export const houseDeviceSchema = z.object({
  id: idSchema,
  /** Absent → the name of the plugin descriptor is authoritative (renaming in the vendor's app propagates). */
  name: z.string().min(1).optional(),
  /** Link to a plugin device (`hue:…`, `mock:…`). Absent → "unlinked" device (displayed grayed out). */
  deviceId: deviceIdSchema.optional(),
  /** Kind hint when the device is not (yet) linked; otherwise the descriptor is authoritative. */
  kind: z.enum(DEVICE_KINDS).optional(),
  /**
   * Absolute x, y; z RELATIVE to the anchor's floor (level, or terrain for outdoor).
   * **Absent = UNPLACED device**: the house knows it (and can give it a `name`) without
   * it occupying a point of the 3D scene. It is the case of a vehicle, which is not an object of the
   * building; its place, the day it gets drawn, will come from its GPS and not from this field.
   */
  position: vec3Schema.optional(),
  /**
   * Correction (m, house reference frame) applied to the COMPUTED place of a device placed by its GPS —
   * a vehicle. Neither the vehicle's reading nor the house origin is exact to the meter: this
   * constant offset, entered once from the vehicle's map, puts the car back on its parking spot.
   * No effect on a device that has a `position`, which already is authoritative.
   */
  gpsOffset: vec2Schema.optional(),
  /**
   * Correction (m, house reference frame) of the TERRAIN MAP of a mower (`site_map` capability), set
   * by its station on the robot's base: neither the base nor the aerial photo is exact to the meter,
   * and it is the whole map that gets realigned on the photo — independently of `gpsOffset`, which
   * only moves the robot.
   */
  mapOffset: vec2Schema.optional(),
  /**
   * Correction (degrees) applied to the COMPUTED orientation of a device placed by its GPS — a
   * vehicle. It adds to what the scene deduced (vendor heading, room axis): neither a measured
   * heading nor the axis of a garage says which way the car parked, and a half-turn
   * is entered here once and for all. No effect on a device that has a `yaw`: it already is authoritative.
   */
  yawOffset: z.number().optional(),
  /**
   * Usable battery capacity (kWh) of a vehicle. **No vendor gives it** — neither Tesla,
   * nor Renault, not even in the vehicle's technical sheet, and a battery code does not translate.
   * It is therefore an ENTERED value, and it has only one use: estimating a charge power that the
   * vehicle does not say (`estimateChargePowerW`). Absent = nothing is estimated.
   */
  batteryKwh: z.number().positive().max(500).optional(),
  /**
   * Bodywork drawn in the 3D scene for a vehicle: `<pluginId>/<model>`, the identifier
   * of a model of the web catalog (`three/models/catalog`). `'none'` = the generic silhouette, which
   * one chooses to get back the footprint mark rather than the real shape. **Absent =
   * automatic**: the catalog decides from the vehicle's plugin, which is right in the
   * common case — a single car per plugin.
   */
  model3d: model3dSchema.optional(),
  /**
   * Body color (`#rrggbb`). The 3D models are shipped WITHOUT color — no
   * vendor publishes the tint of a vehicle, and guessing it from the VIN is not possible.
   * Absent = the scene applies its vehicle color, which follows the theme.
   */
  bodyColor: hexColorSchema.optional(),
  /**
   * Paint finish of a vehicle (`solid` / `metallic` / `matte`). Same rule as the color:
   * what the user chooses takes precedence over what the vendor says, and absence hands back.
   */
  bodyFinish: z.enum(VEHICLE_FINISHES).optional(),
  /** Lease (LOA / LLD) of a vehicle, to track its mileage against the allowance (`vehicleLeaseSchema`). */
  lease: vehicleLeaseSchema.optional(),
  levelId: idSchema.optional(),
  roomId: idSchema.optional(),
  zoneId: idSchema.optional(),
  /** Shutters / opening sensors: the marker hugs the rectangle of the opening. */
  openingId: idSchema.optional(),
  mount: z.enum(MOUNTS).optional(),
  /** Orientation (degrees), 0 = facing +y. */
  yaw: z.number().optional(),
  /**
   * Footprint (m) of what is DRAWN for the device, when the scene has nothing else to
   * size it: a gate or a garage door placed outside are free objects; a
   * television stores here the 16:9 panel derived from its commercial diagonal (entered in inches in
   * the UI); a shutter linked to an opening already hugs its rectangle. `width` across, `height` in
   * height; absent = the default size of the marker.
   */
  size: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
  /**
   * Leaves of a cover: what moves apart when a gate opens, and what CUTS the apron
   * of a shutter linked to an opening (two leaves = hinged shutter, one = single-piece apron).
   * Absent = a single one, except a gate, which has two.
   */
  leaves: z.union([z.literal(1), z.literal(2)]).optional(),
  /**
   * 3D silhouette of a speaker (`SPEAKER_SHAPES`). Absent = cylinder (`default`). No effect on
   * a television or a display, which already have their own geometry.
   */
  speakerShape: z.enum(SPEAKER_SHAPES).optional(),
  /**
   * Material of a cover (`OPENING_MATERIALS`), as `Opening.material` is for joinery.
   * When absent, the scene keeps the cover material of the render style. Prefixed `cover` — `style.color`
   * already occupies the word "color" on a device, and two homonymous fields would be confused.
   *
   * GLASS does not do here what it does on an opening (where it glazes it, cf. `isGlazed`): it
   * makes the panel translucent, and that is what a glazed garage door is.
   */
  coverMaterial: z.enum(OPENING_MATERIALS).optional(),
  /** Color of a cover (#rrggbb). When absent, it is the palette of the render style that gives it. */
  coverColor: hexColorSchema.optional(),
  style: z.object({ icon: z.string().optional(), color: z.string().optional() }).optional(),
  meta: metaSchema,
})
export type HouseDevice = z.infer<typeof houseDeviceSchema>
/**
 * A device of the house that OCCUPIES a point of the scene. The others — a vehicle, for example —
 * are known to the house (name, link) without having a place in it. This type says so once, at the threshold
 * of the 3D, rather than forcing each access to `position` to ask the question again.
 */
export type PlacedHouseDevice = HouseDevice & { position: z.infer<typeof vec3Schema> }
export const isPlaced = (d: HouseDevice): d is PlacedHouseDevice => d.position !== undefined

/** `flat` = slab; `shed` = one slope; `gable` = two slopes and two gables; `hip` = four slopes. */
export const ROOF_TYPES = ['flat', 'shed', 'gable', 'hip'] as const
export type RoofType = (typeof ROOF_TYPES)[number]

/**
 * One roof covers one VOLUME of the building: the main house, an attached garage, a detached
 * outbuilding each get theirs. The pitched roofs are drawn on the rectangle (house axes) that
 * encloses their footprint: a house in L is two volumes, so two roofs.
 */
export const roofSchema = z.object({
  id: idSchema.optional(),
  type: z.enum(ROOF_TYPES),
  /** Level whose walls carry the roof; absent = the highest level. */
  levelId: idSchema.optional(),
  /**
   * Rooms covered (on `levelId`): the footprint is their rectangle, enlarged by the exterior walls
   * on the facade sides only — the side that abuts another room stops at its own wall.
   */
  rooms: z.array(idSchema).min(1).optional(),
  /** Explicit footprint (outer face of the walls), used as written. Wins over `rooms`. */
  outline: polygonSchema.optional(),
  /**
   * Height of the eaves above the floor of `levelId` (m); absent = the level height. The walls of the
   * covered rooms stop there: it is how a garage is lower than the house on the same level.
   */
  eaves: z.number().positive().optional(),
  pitch: z.number().min(5).max(75).default(30),
  /** Axis of the ridge of a `gable`; absent = the longest side (a `hip` always takes the longest). */
  ridgeAxis: z.enum(['x', 'y']).optional(),
  /** `shed`: direction toward which the slope DESCENDS, same convention as a device `yaw` (0 = +y). */
  yaw: z.number().multipleOf(90).default(180),
  overhang: z.number().min(0).default(0.3),
})
export type Roof = z.infer<typeof roofSchema>

/** Common photovoltaic module (m): `width` along the columns, `height` along the rows. */
export const PANEL_SIZE = { width: 1.13, height: 1.76 } as const
/**
 * Peak power (Wp) of a module when the array does not say it: that of a common panel. It is
 * the color SCALE of a module — its slab in 3D, its line in the Energy view — and not a
 * measurement: a microinverter often clips below it, a new array produces a bit beyond.
 */
export const PANEL_PEAK_W = 450
/**
 * Solar panel array: a grid of `rows × cols` modules set on a level (the roof,
 * declared as a level without rooms). The module positions are NOT written: they are
 * derived from the origin, the orientation and the pitch (`panelArrayDevices`), so moving or rotating
 * the array only touches one object.
 *
 * TWO tilts, and it is what avoids treating the flat roof and the pitched roof separately: `slope`
 * is the slope of the support (the array hugs the roof), `tilt` the angle of each module on this support
 * (the frames). A pitched roof is `slope` alone; a flat roof, `tilt` alone; a sloping
 * terrace, both. Both lean the glass the SAME way: toward the azimuth, hence toward the sun. `panels` links each slot, row by row, to its
 * microinverter — it is the breakdown of the vendor's app (an array, then its inverters).
 */
export const panelArraySchema = z.object({
  id: idSchema,
  name: z.string().min(1).optional(),
  /**
   * The INSTALLATION this array is part of (`deviceId` of the site, `enphase:site`…). It is what links
   * the panels to their gateway: removing the installation from the house takes its arrays along. Absent
   * in a hand-written file: the array is then attached to the only installation displayed.
   */
  siteId: deviceIdSchema.optional(),
  levelId: idSchema,
  /** Corner of the array (edge of row 0, column 0): absolute x, y; z RELATIVE to the level floor. */
  origin: vec3Schema,
  /**
   * AZIMUTH of the array (degrees, counterclockwise, 0 = toward +y): the direction the
   * modules face, the one turned toward the sun. It is also the one in which the rows
   * move away from the origin and DESCEND the slope — a roof descends toward the sun, not the reverse.
   * Same convention as the `yaw` of a device: what looks somewhere looks toward +y at 0.
   */
  yaw: z.number().default(0),
  /**
   * Slope of the SUPPORT (degrees): the plane on which the array is set. It is the slope of the roof under
   * it — 0 on a flat roof, on the ground or on a terrace. The array DESCENDS along its rows,
   * in the direction of its azimuth.
   */
  slope: z.number().min(0).max(90).default(0),
  /**
   * Tilt of each MODULE on its support (degrees): the angle of the frames. 0 = laid right on the
   * roof, which is what is done on a pitched roof. POSITIVE, the module tilts up facing the sun: its lower
   * edge on the azimuth side, its upper edge on the opposite — it is the usual mounting of a flat roof.
   * Negative, it tilts the other way (a frame that faces behind the array).
   * The two angles add up for the real tilt of the glass.
   */
  tilt: z.number().min(-90).max(90).default(0),
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
  /** The MODULE of this array: its size, and its peak power (Wp) which says what "full blast" looks like. */
  panel: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    peakW: z.number().positive().max(2000).default(PANEL_PEAK_W),
  }).default({ ...PANEL_SIZE, peakW: PANEL_PEAK_W }),
  /**
   * MAXIMUM OUTPUT POWER of the microinverters of this array (W, 0 = unknown) — the term from
   * data sheets. An inverter does not output more: an IQ8P caps at 480 W under a
   * 500 Wp module, and the measurement hits that, not the glass peak. It is ENTERED, because the gateway never
   * publishes the data sheet: it only gives `maxReportWatts`, the record of each
   * inverter (418 to 440 W on a real device set surveyed), which says what has happened — see
   * `SensorState.maxValue`, which the Energy view marks next to this one.
   */
  maxOutputW: z.number().min(0).max(2000).default(0),
  /** Space between two modules (m). */
  gap: z.number().min(0).default(0.02),
  /** Plugin device of each slot, row by row; `null` = module without a tracked inverter. At most rows × cols. */
  panels: z.array(deviceIdSchema.nullable()),
  meta: metaSchema,
})
export type PanelArray = z.infer<typeof panelArraySchema>

/**
 * Settings of a PLUGIN, decided from Settings → Plugins and kept IN the house: which
 * vendors this house uses, and what is wanted from each. No secret here — keys and tokens
 * stay in `.env`; the house file only carries choices.
 */
export const pluginSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Sub-items of the plugin (the kinds simulated by `mock`…), by id. Absent = the plugin default. */
  parts: z.record(z.string(), z.boolean()).default({}),
  /**
   * Default applied to the animated light scenes that APPEAR (created at the vendor, or that
   * gain a palette). Never touches the already known light scenes.
   */
  autoDynamicForNewScenes: z.boolean().default(false),
})
export type PluginSettings = z.infer<typeof pluginSettingsSchema>

/**
 * Partial modification coming from the UI (`PATCH /api/plugins/:id`): only the present fields are
 * written. Declared by hand and NOT by `pluginSettingsSchema.partial()`: zod still applies
 * the `.default()` of a field made optional, so that a `{ parts }` patch arrived carrying a
 * phantom `enabled: false` — toggling a sub-item turned the plugin off.
 */
export const pluginSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  parts: z.record(z.string(), z.boolean()).optional(),
  autoDynamicForNewScenes: z.boolean().optional(),
})
export type PluginSettingsPatch = z.infer<typeof pluginSettingsPatchSchema>

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = { enabled: false, parts: {}, autoDynamicForNewScenes: false }

/**
 * House without a `plugins` section: the simulation alone, with all its kinds — the demo runs without
 * configuring anything, the rest is activated in the UI. zod 4 does NOT validate the value of a `.default()`,
 * so it is written in full.
 */
export const defaultPlugins = (): Record<string, PluginSettings> => ({ mock: { ...DEFAULT_PLUGIN_SETTINGS, enabled: true } })

/**
 * Plugins turned ON as long as the house says nothing: app features that need neither an
 * account nor hardware (the shopping list), which can be turned off in Settings if not wanted. The
 * vendors, for their part, stay off until they are checked.
 */
export const PLUGINS_ON_BY_DEFAULT: readonly string[] = ['shopping']

/** Effective setting of a plugin: the house's, otherwise its default. */
export function pluginSettingsOf(plugins: Readonly<Record<string, PluginSettings>>, id: string): PluginSettings {
  return plugins[id] ?? (PLUGINS_ON_BY_DEFAULT.includes(id) ? { ...DEFAULT_PLUGIN_SETTINGS, enabled: true } : DEFAULT_PLUGIN_SETTINGS)
}

/**
 * Matter bridge of this house: Kasbah devices published on the local network for Alexa, Google
 * Home or Apple Home. Opt-in device by device: what a voice assistant already reaches through the
 * vendor's own integration would appear twice.
 */
export const matterSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Device ids (`<pluginId>:<externalId>`) to publish. */
  devices: z.array(z.string()).default([]),
  /**
   * Garage doors and gates as Matter 1.5 closures (a garage door to the assistant, opened with a
   * voice PIN) rather than as blinds. Off by default: not every assistant knows closures yet.
   */
  closures: z.boolean().default(false),
})
export type MatterSettings = z.infer<typeof matterSettingsSchema>

/**
 * LIGHT SETTING of the 3D scene, saved in the house (`render.tuning`). These are
 * MULTIPLIERS applied on what the render style computes for the current hour: × 1 everywhere
 * gives the style as is, and the style's day/night curve survives the setting. The last five,
 * for their part, are the very magnitudes of the line that outlines the selected room — it comes from the theme of the
 * application, no style computes it.
 *
 * Why in the HOUSE and not in the browser preferences (like the style or the
 * quality): a light is set once, in front of the house, and then applies to all the
 * screens that look at it. The quality, for its part, depends on the machine that draws.
 *
 * The bounds are wide and strict at once: wide because a taste is not up for debate, strict
 * because a crazy value must be REFUSED at write time (400) rather than written then endured. A
 * house file damaged by hand is refused like any other field of the house.
 */
const factor = (max: number) => z.number().min(0).max(max).default(1)
export const sceneTuningSchema = z.object({
  /** × on the style's exposure (the aperture). */
  exposure: factor(3),
  /** Tone mapping curve; `style` leaves the style's. */
  toneMapping: z.enum(['style', 'aces', 'agx', 'neutral', 'linear']).default('style'),
  /** × on the bloom strength. */
  bloomStrength: factor(3),
  /** × on the bloom THRESHOLD: above 1, only the real sources bleed. */
  bloomThreshold: factor(4),
  /** × on the bloom radius. */
  bloomRadius: factor(3),
  /** × on the vignette. */
  vignette: factor(3),
  /** × on the opacity of the additive halo set on a lit light. */
  glowOpacity: factor(3),
  /** × on the diameter of this halo. */
  glowScale: factor(3),
  /** × on the intensity of a light's point light. */
  lightIntensity: factor(3),
  /** × on the emissive share of a light's globe. */
  emissive: factor(3),
  /** Width (m) of the line set along the walls of the selected room. */
  ringWidth: z.number().min(0.01).max(1).default(0.14),
  /** Brightness of the line: the accent multiplied by this number. Above 1, the bloom catches it. */
  ringBoost: z.number().min(0).max(4).default(1.15),
  /** Share of white mixed into the accent before the brightness. */
  ringWhite: z.number().min(0).max(1).default(0.2),
  /** Opacity of the line. */
  ringOpacity: z.number().min(0).max(1).default(0.92),
  /** Opacity of the veil set on the floor of the room. */
  fillOpacity: z.number().min(0).max(1).default(0.1),
  /** The line goes over the walls instead of being hidden by them. */
  ringThrough: z.boolean().default(true),
  // ---- tilt-shift: the miniature effect (ABSOLUTE values, no style computes them) ----
  /** Strength of the blur outside the sharp band. `0` = effect off, and the pass is not paid for. */
  tiltShift: z.number().min(0).max(1).default(0),
  /** Height of the sharp band in the image (0 = a line, 1 = the whole image). */
  tiltCenter: z.number().min(0).max(1).default(0.5),
  /** Half-height of the sharp band, as a fraction of the image. */
  tiltWidth: z.number().min(0.02).max(1).default(0.18),
  /**
   * How much the device pills follow the blur. They are in the DOM, outside the canvas: sharp
   * above a blurred house, they break the miniature; erased, the scene loses its names.
   * `0` leaves them intact, `1` erases them as much as the blur erases the house.
   */
  tiltPills: z.number().min(0).max(1).default(0.6),
})
export type SceneTuning = z.infer<typeof sceneTuningSchema>

/** The setting that changes nothing: what the style computes, without touch-ups. */
export const NEUTRAL_TUNING: SceneTuning = sceneTuningSchema.parse({})

/** What the house says about the RENDERING of its 3D scene. Absent = the styles as written. */
export const renderSettingsSchema = z.object({
  tuning: sceneTuningSchema.optional(),
})
export type RenderSettings = z.infer<typeof renderSettingsSchema>

export const houseSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  name: z.string().min(1),
  origin: geoOriginSchema,
  defaults: houseDefaultsSchema.optional(),
  levels: z.array(levelSchema).min(1),
  rooms: z.array(roomSchema),
  site: siteSchema,
  devices: z.array(houseDeviceSchema).default([]),
  roofs: z.array(roofSchema).default([]),
  /** Former single roof, still read (`roofsOf`); a file carries `roof` or `roofs`, not both. */
  roof: roofSchema.optional(),
  arrays: z.array(panelArraySchema).default([]),
  /** Plugins of this house: which are active, and their sub-items. */
  plugins: z.record(z.string(), pluginSettingsSchema).default(defaultPlugins),
  /** Matter bridge: which devices are published to the voice assistants. */
  matter: matterSettingsSchema.optional(),
  /** Light setting of the 3D scene, set from the Home view. */
  render: renderSettingsSchema.optional(),
  /** Appearance of the envelope: the finish of the facade (exterior faces of the exterior walls). */
  style: z.object({ facade: finishOn('facade').optional() }).optional(),
  meta: metaSchema,
})
export type House = z.infer<typeof houseSchema>
/** Input shape (before application of the zod defaults) — what is written in the JSON. */
export type HouseInput = z.input<typeof houseSchema>
