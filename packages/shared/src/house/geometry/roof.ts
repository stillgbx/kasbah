import type { HouseDefaults } from '../defaults'
import type { House, Level, Room } from '../schema'
import type { RoofDescriptor, Vec3 } from './types'
import { bbox, offsetPolygon, type Vec2 } from './vec2'
import { isWalled } from './walls'

const FLAT_THICKNESS = 0.2

/** Highest level (the order of the array is not semantic). */
export function topLevel(levels: readonly Level[]): Level {
  return levels.reduce((best, l) => (l.elevation > best.elevation ? l : best), levels[0]!)
}

/** Default footprint of a level: bbox of the walled rooms enlarged by the exterior thickness. */
export function defaultOutline(level: Level, rooms: readonly Room[], defaults: HouseDefaults): Vec2[] | null {
  const pts = rooms.filter((r) => r.levelId === level.id && isWalled(r)).flatMap((r) => r.polygon)
  if (pts.length === 0) return null
  const { min, max } = bbox(pts)
  const t = defaults.exteriorWallThickness
  return [[min[0] - t, min[1] - t], [max[0] + t, min[1] - t], [max[0] + t, max[1] + t], [min[0] - t, max[1] + t]]
}

export function computeRoof(house: House, defaults: HouseDefaults): RoofDescriptor | undefined {
  const roof = house.roof
  if (!roof) return undefined
  const level = roof.levelId ? house.levels.find((l) => l.id === roof.levelId) : topLevel(house.levels)
  if (!level) return undefined
  const base = roof.outline ?? level.outline ?? defaultOutline(level, house.rooms, defaults)
  if (!base) return undefined
  const outline = roof.overhang > 0 ? offsetPolygon(base, roof.overhang) : [...base]
  const zBase = level.elevation + (level.height ?? defaults.levelHeight)

  if (roof.type === 'flat') {
    return { type: 'flat', outline, zBase, zRidge: zBase + FLAT_THICKNESS, thickness: FLAT_THICKNESS, faces: [] }
  }

  const { min, max } = bbox(outline)
  const sx = max[0] - min[0], sy = max[1] - min[1]
  const axis = roof.ridgeAxis ?? (sx >= sy ? 'x' : 'y')
  const halfSpan = (axis === 'x' ? sy : sx) / 2
  const zRidge = zBase + halfSpan * Math.tan((roof.pitch * Math.PI) / 180)
  const faces: Vec3[][] = []
  if (axis === 'x') {
    const my = (min[1] + max[1]) / 2
    faces.push(
      [[min[0], min[1], zBase], [max[0], min[1], zBase], [max[0], my, zRidge], [min[0], my, zRidge]],   // south slope
      [[max[0], max[1], zBase], [min[0], max[1], zBase], [min[0], my, zRidge], [max[0], my, zRidge]],   // north slope
      [[min[0], max[1], zBase], [min[0], min[1], zBase], [min[0], my, zRidge]],                          // west gable
      [[max[0], min[1], zBase], [max[0], max[1], zBase], [max[0], my, zRidge]],                          // east gable
    )
  } else {
    const mx = (min[0] + max[0]) / 2
    faces.push(
      [[max[0], min[1], zBase], [max[0], max[1], zBase], [mx, max[1], zRidge], [mx, min[1], zRidge]],   // east slope
      [[min[0], max[1], zBase], [min[0], min[1], zBase], [mx, min[1], zRidge], [mx, max[1], zRidge]],   // west slope
      [[min[0], min[1], zBase], [max[0], min[1], zBase], [mx, min[1], zRidge]],                          // south gable
      [[max[0], max[1], zBase], [min[0], max[1], zBase], [mx, max[1], zRidge]],                          // north gable
    )
  }
  return { type: 'gable', outline, zBase, zRidge, thickness: 0, faces }
}
