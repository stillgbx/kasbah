import { resolveDefaults, type HouseDefaults } from '../defaults'
import type { Finish, House, Room } from '../schema'
import { houseBounds } from './bounds'
import { computeFloors, computeLabelAnchors } from './floors'
import { computeRoof } from './roof'
import { terrainFootprints, terrainPads } from './relief'
import { computeTerrain, computeZones } from './site'
import { computeSurfaceOpenings, roofHolesOf } from './surface'
import type { HouseGeometry, LevelGeometry } from './types'
import { computeWalls } from './walls'

export * from './types'
export * from './vec2'
export * from './walls'
export * from './floors'
export * from './site'
export * from './relief'
export * from './roof'
export * from './bounds'
export * from './surface'

/** Entry point: all the descriptive geometry of a house, levels sorted by elevation. */
/** The wall finishes of the rooms that have one; nothing at all if none has one (geometry unchanged). */
function wallFinishesOf(rooms: readonly Room[]): { wallFinishes?: Record<string, Finish> } {
  const out: Record<string, Finish> = {}
  for (const r of rooms) if (r.style?.wallFinish) out[r.id] = r.style.wallFinish
  return Object.keys(out).length ? { wallFinishes: out } : {}
}

export function computeHouseGeometry(house: House, defaultsOverride?: HouseDefaults): HouseGeometry {
  const defaults = defaultsOverride ?? resolveDefaults(house.defaults)
  const roofBase = computeRoof(house, defaults)
  const levels: LevelGeometry[] = [...house.levels]
    .sort((a, b) => a.elevation - b.elevation)
    .map((level) => {
      const rooms = house.rooms.filter((r) => r.levelId === level.id)
      const { prisms, openings: wallOpenings } = computeWalls(level, rooms, defaults)
      const { openings: surfaceOpenings, floorHoles } = computeSurfaceOpenings(level, rooms, defaults, roofBase)
      return {
        levelId: level.id,
        elevation: level.elevation,
        height: level.height ?? defaults.levelHeight,
        floors: computeFloors(level, rooms, defaults, floorHoles),
        walls: prisms,
        openings: [...wallOpenings, ...surfaceOpenings],
        labelAnchors: computeLabelAnchors(rooms),
        ...wallFinishesOf(rooms),
      }
    })
  const roof = roofBase
    ? { ...roofBase, holes: roofHolesOf(house, roofBase) }
    : undefined
  return {
    levels,
    terrain: computeTerrain(house.site, terrainPads(house), terrainFootprints(house, defaults)),
    zones: computeZones(house.site),
    ...(roof ? { roof } : {}),
    ...(house.style?.facade ? { facade: house.style.facade } : {}),
    bounds: houseBounds(house, defaults, roof),
  }
}
