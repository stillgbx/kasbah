import type { House, HouseDevice, Level, Opening, Room, Zone } from './schema'
import { resolveDefaults } from './defaults'
import { terrainFootprints, terrainHeight, terrainPads } from './geometry/relief'
import { computeTerrain } from './geometry/site'
import type { TerrainDescriptor } from './geometry/types'

// O(1) index on a validated house. The house is treated as immutable: it is re-indexed
// when the object changes (reference), never in place.

export interface HouseIndex {
  levelsById: Map<string, Level>
  roomsById: Map<string, Room>
  zonesById: Map<string, Zone>
  devicesById: Map<string, HouseDevice>
  openingsById: Map<string, { room: Room; opening: Opening }>
  /** Levels in display order: from the highest to the lowest (we go down into the house). */
  levelsSorted: Level[]
  /** Rooms of a level in display order: `level.roomOrder` first, then the others by name. */
  roomsByLevel: Map<string, Room[]>
  devicesByRoom: Map<string, HouseDevice[]>
  devicesByLevel: Map<string, HouseDevice[]>
  devicesByZone: Map<string, HouseDevice[]>
  /** Outdoor devices (neither level nor room). */
  outdoorDevices: HouseDevice[]
  /** Devices of the house indexed by plugin `deviceId`. */
  devicesByBinding: Map<string, HouseDevice>
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k)
  if (arr) arr.push(v)
  else m.set(k, [v])
}

/** Effective level of a device: explicit, otherwise that of its room, otherwise null (outdoor). */
export function resolveDeviceLevelId(device: HouseDevice, roomsById: Map<string, Room>): string | null {
  if (device.levelId) return device.levelId
  if (device.roomId) return roomsById.get(device.roomId)?.levelId ?? null
  return null
}

export function indexHouse(house: House): HouseIndex {
  const levelsById = new Map(house.levels.map((l) => [l.id, l]))
  const roomsById = new Map(house.rooms.map((r) => [r.id, r]))
  const zonesById = new Map(house.site.zones.map((z) => [z.id, z]))
  const devicesById = new Map(house.devices.map((d) => [d.id, d]))
  const openingsById = new Map<string, { room: Room; opening: Opening }>()
  const roomsByLevel = new Map<string, Room[]>()
  const devicesByRoom = new Map<string, HouseDevice[]>()
  const devicesByLevel = new Map<string, HouseDevice[]>()
  const devicesByZone = new Map<string, HouseDevice[]>()
  const outdoorDevices: HouseDevice[] = []
  const devicesByBinding = new Map<string, HouseDevice>()

  for (const level of house.levels) roomsByLevel.set(level.id, [])
  for (const room of house.rooms) {
    push(roomsByLevel, room.levelId, room)
    for (const o of room.openings) openingsById.set(o.id, { room, opening: o })
  }
  for (const d of house.devices) {
    if (d.roomId) push(devicesByRoom, d.roomId, d)
    const lvl = resolveDeviceLevelId(d, roomsById)
    if (lvl) push(devicesByLevel, lvl, d)
    else outdoorDevices.push(d)
    if (d.zoneId) push(devicesByZone, d.zoneId, d)
    if (d.deviceId) devicesByBinding.set(d.deviceId, d)
  }
  // Display order, common to all the UI lists (tabs, house panel, Lights view):
  // levels from top to bottom, rooms in the order chosen by the user then alphabetical.
  const levelsSorted = [...house.levels].sort((a, b) => b.elevation - a.elevation)
  for (const level of house.levels) {
    const rank = new Map((level.roomOrder ?? []).map((id, i) => [id, i]))
    const at = (id: string) => rank.get(id) ?? rank.size
    roomsByLevel.get(level.id)?.sort((a, b) => at(a.id) - at(b.id) || a.name.localeCompare(b.name))
  }
  return {
    levelsById, roomsById, zonesById, devicesById, openingsById, levelsSorted,
    roomsByLevel, devicesByRoom, devicesByLevel, devicesByZone, outdoorDevices, devicesByBinding,
  }
}

const terrains = new WeakMap<House, TerrainDescriptor>()
/** The terrain of a house, relief included, computed once per house object (immutable). */
export function houseTerrain(house: House): TerrainDescriptor {
  let t = terrains.get(house)
  if (!t) { t = computeTerrain(house.site, terrainPads(house), terrainFootprints(house, resolveDefaults(house.defaults))); terrains.set(house, t) }
  return t
}

/**
 * Absolute z of the anchoring floor of a device: its level, otherwise the terrain UNDER IT — a garden
 * device placed on a bump follows the bump.
 */
export function deviceFloorZ(house: House, device: HouseDevice, index: HouseIndex): number {
  const lvl = resolveDeviceLevelId(device, index.roomsById)
  if (lvl) return index.levelsById.get(lvl)?.elevation ?? house.site.elevation
  return device.position ? terrainHeight(houseTerrain(house), device.position[0], device.position[1]) : house.site.elevation
}
