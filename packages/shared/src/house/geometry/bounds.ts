import type { HouseDefaults } from '../defaults'
import type { House } from '../schema'
import type { AABB3, RoofDescriptor, Vec3 } from './types'
import { parseRelief, reliefRange } from './relief'
import { bbox, type Vec2 } from './vec2'

// ABSOLUTE bounding boxes (house reference frame, absolute z) for camera framing.

export function emptyBounds(): AABB3 {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
}

export function expandBounds(b: AABB3, p: Vec3): AABB3 {
  return {
    min: [Math.min(b.min[0], p[0]), Math.min(b.min[1], p[1]), Math.min(b.min[2], p[2])],
    max: [Math.max(b.max[0], p[0]), Math.max(b.max[1], p[1]), Math.max(b.max[2], p[2])],
  }
}

export function unionBounds(a: AABB3, b: AABB3): AABB3 {
  return expandBounds(expandBounds(a, b.min), b.max)
}

export function isEmptyBounds(b: AABB3): boolean {
  return !Number.isFinite(b.min[0]) || !Number.isFinite(b.max[0])
}

function fromPolygon(poly: readonly Vec2[], z0: number, z1: number): AABB3 {
  const { min, max } = bbox(poly)
  return { min: [min[0], min[1], z0], max: [max[0], max[1], z1] }
}

export function roomBounds(house: House, roomId: string, defaults: HouseDefaults): AABB3 | null {
  const room = house.rooms.find((r) => r.id === roomId)
  const level = room && house.levels.find((l) => l.id === room.levelId)
  if (!room || !level) return null
  const h = room.height ?? level.height ?? defaults.levelHeight
  return fromPolygon(room.polygon, level.elevation, level.elevation + h)
}

export function levelBounds(house: House, levelId: string, defaults: HouseDefaults): AABB3 | null {
  const level = house.levels.find((l) => l.id === levelId)
  if (!level) return null
  let b = emptyBounds()
  const h = level.height ?? defaults.levelHeight
  for (const room of house.rooms) {
    if (room.levelId !== levelId) continue
    b = unionBounds(b, fromPolygon(room.polygon, level.elevation, level.elevation + (room.height ?? h)))
  }
  if (level.outline) b = unionBounds(b, fromPolygon(level.outline, level.elevation, level.elevation + h))
  return isEmptyBounds(b) ? null : b
}

export function zoneBounds(house: House, zoneId: string): AABB3 | null {
  const zone = house.site.zones.find((z) => z.id === zoneId)
  if (!zone) return null
  const [lo, hi] = reliefRange(parseRelief(house.site.relief))
  return fromPolygon(zone.polygon, house.site.elevation + lo, house.site.elevation + hi + 0.1)
}

/** Footprint of the roof slab alone: the roof level is framed on it, not on the whole building. */
export function roofBounds(roof: RoofDescriptor): AABB3 {
  return fromPolygon(roof.outline, roof.zBase, roof.zRidge)
}

export function siteBounds(house: House): AABB3 {
  const [lo, hi] = reliefRange(parseRelief(house.site.relief))
  return fromPolygon(house.site.terrain, house.site.elevation + lo, house.site.elevation + hi)
}

export function houseBounds(house: House, defaults: HouseDefaults, roof?: RoofDescriptor): AABB3 {
  let b = siteBounds(house)
  for (const level of house.levels) {
    const lb = levelBounds(house, level.id, defaults)
    if (lb) b = unionBounds(b, lb)
  }
  if (roof) b = unionBounds(b, fromPolygon(roof.outline, roof.zBase, roof.zRidge))
  return b
}

/** "Built" footprint (levels + roof, without the terrain) — for the default view centered on the house. */
export function buildingBounds(house: House, defaults: HouseDefaults, roof?: RoofDescriptor): AABB3 {
  let b = emptyBounds()
  for (const level of house.levels) {
    const lb = levelBounds(house, level.id, defaults)
    if (lb) b = unionBounds(b, lb)
  }
  if (roof) b = unionBounds(b, fromPolygon(roof.outline, roof.zBase, roof.zRidge))
  return isEmptyBounds(b) ? siteBounds(house) : b
}

export function boundsCenter(b: AABB3): Vec3 {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
}

export function boundsRadius(b: AABB3): number {
  return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2
}
