import type { Footprint, ReliefGrid } from './relief'
import type { Vec2 } from './vec2'
import type { Finish, FloorStyle, OpeningMaterial, OpeningType, RoofType, RoomKind, ZoneKind } from '../schema'

// PURE geometric descriptors (no three dependency): this is the tested contract.
// The web-side builders transform them into BufferGeometry without thinking.
// Unless stated otherwise, z values are LEVEL-LOCAL (finished floor = 0).

export type Vec3 = [number, number, number]

export interface AABB3 { min: Vec3; max: Vec3 }

export interface WallPrism {
  roomId: string
  levelId: string
  segment: number
  kind: 'interior' | 'exterior'
  /** Convex CCW quad (plan), extruded from z0 to z1. */
  footprint: [Vec2, Vec2, Vec2, Vec2]
  z0: number
  z1: number
  /** Set for the pieces below/above an opening (sill, lintel). */
  openingId?: string
}

export interface OpeningRect {
  openingId: string
  roomId: string
  levelId: string
  type: OpeningType
  /** Surface that carries the opening: wall, floor (skylight) or roof (Velux). */
  host: 'wall' | 'floor' | 'roof'
  /** Bottom-left corner of the opening (local z = sill for a wall; bottom face of the slab / roof for a surface). */
  origin: Vec3
  /** Unit direction along the width (in the plane). */
  u: Vec2
  /** Unit outward normal of the wall (in the plane); `[0, 0]` for a horizontal surface. */
  normal: Vec2
  width: number
  height: number
  /** Thickness of the carrier (wall, slab or roof). */
  depth: number
  /** EFFECTIVE number of leaves (`openingLeaves`): never the file's optional value. */
  leaves: number
  /** Heading (azimuth) of a surface opening. */
  yaw?: number
  /** Slope (degrees from the horizontal) of a roof window; 0 = flat / floor. */
  slope?: number
  /** Material of the joinery, if the file imposes one. */
  material?: OpeningMaterial
  /** Color of the joinery (#rrggbb), if the file imposes one. */
  color?: string
}

export interface FloorHole {
  openingId: string
  /** CCW quad of the hole in the plane of the room. */
  polygon: [Vec2, Vec2, Vec2, Vec2]
}

export interface FloorDescriptor {
  roomId: string
  levelId: string
  polygon: Vec2[]
  z0: number
  z1: number
  kind: RoomKind
  floorStyle?: FloorStyle
  /** Floor finish chosen for the room (`room.style.floorFinish`). */
  finish?: Finish
  /** Holes of the skylights (`skylight`) of the room. */
  holes?: FloorHole[]
}

export interface TerrainDescriptor {
  polygon: Vec2[]
  z: number
  /** Parsed relief (`site.relief`), `null` = flat terrain. Height at a point: `terrainHeight`. */
  relief: ReliefGrid | null
  /** Footprints around which the terrain stays flat: the basins. */
  pads: Vec2[][]
  /** Footprints of the rooms: under them, the terrain is clipped below the floor. */
  footprints: Footprint[]
}
export interface ZoneDescriptor { zoneId: string; kind: ZoneKind; polygon: Vec2[]; z: number }

export interface RoofHole {
  openingId: string
  roomId: string
  /** CCW quad in plan (projection) — enough for a flat roof; for a gable, also projected on the face. */
  polygon: [Vec2, Vec2, Vec2, Vec2]
  /** Index of the gable face touched; absent for a flat roof. */
  faceIndex?: number
  /** Four 3D corners on the face (absolute) when `faceIndex` is set. */
  corners?: [Vec3, Vec3, Vec3, Vec3]
}

export interface RoofDescriptor {
  /** `roofs[].id` when written. */
  id?: string
  type: RoofType
  /** Level whose walls carry the roof. */
  levelId: string
  /** Walled rooms under the roof, on `levelId`. */
  rooms: string[]
  /** Written eaves height (above the floor of `levelId`): the walls of `rooms` stop there. */
  eaves?: number
  /** Footprint enlarged by the overhang (plan). */
  outline: Vec2[]
  /** Absolute z of the base of the roof (top of the walls it covers). */
  zBase: number
  /** Absolute z of the highest point. */
  zRidge: number
  thickness: number
  /** Flat convex faces (ABSOLUTE coordinates), empty for a flat roof (the builder extrudes `outline`). */
  faces: Vec3[][]
  /** Holes of the roof windows. */
  holes?: RoofHole[]
}

export interface LabelAnchor { roomId: string; position: Vec2 }

export interface LevelGeometry {
  levelId: string
  elevation: number
  height: number
  floors: FloorDescriptor[]
  walls: WallPrism[]
  openings: OpeningRect[]
  labelAnchors: LabelAnchor[]
  /** Finish of the interior faces of the walls, per room (`room.style.wallFinish`); absent = that of the style. */
  wallFinishes?: Record<string, Finish>
}

export interface HouseGeometry {
  levels: LevelGeometry[]
  terrain: TerrainDescriptor
  zones: ZoneDescriptor[]
  /** One per volume (`house.roofs`), in the order of the file. */
  roofs: RoofDescriptor[]
  /** Finish of the facade (`house.style.facade`); absent = that of the style. */
  facade?: Finish
  /** ABSOLUTE bounding box of everything (levels, terrain, roof). */
  bounds: AABB3
}
