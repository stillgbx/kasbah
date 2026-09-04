import type { House, HouseDevice, Level, Opening, Room, Zone } from './schema'

// Index en O(1) sur une maison validée. La maison est traitée comme immuable : on ré-indexe
// quand l'objet change (référence), jamais en place.

export interface HouseIndex {
  levelsById: Map<string, Level>
  roomsById: Map<string, Room>
  zonesById: Map<string, Zone>
  devicesById: Map<string, HouseDevice>
  openingsById: Map<string, { room: Room; opening: Opening }>
  /** Niveaux triés par élévation croissante. */
  levelsSorted: Level[]
  roomsByLevel: Map<string, Room[]>
  devicesByRoom: Map<string, HouseDevice[]>
  devicesByLevel: Map<string, HouseDevice[]>
  devicesByZone: Map<string, HouseDevice[]>
  /** Appareils extérieurs (ni niveau, ni pièce). */
  outdoorDevices: HouseDevice[]
  /** Appareils de la maison indexés par `deviceId` de plugin. */
  devicesByBinding: Map<string, HouseDevice>
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k)
  if (arr) arr.push(v)
  else m.set(k, [v])
}

/** Niveau effectif d'un appareil : explicite, sinon celui de sa pièce, sinon null (extérieur). */
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
  const levelsSorted = [...house.levels].sort((a, b) => a.elevation - b.elevation)
  return {
    levelsById, roomsById, zonesById, devicesById, openingsById, levelsSorted,
    roomsByLevel, devicesByRoom, devicesByLevel, devicesByZone, outdoorDevices, devicesByBinding,
  }
}

/** z absolu du sol d'ancrage d'un appareil (niveau, sinon terrain). */
export function deviceFloorZ(house: House, device: HouseDevice, index: HouseIndex): number {
  const lvl = resolveDeviceLevelId(device, index.roomsById)
  if (lvl) return index.levelsById.get(lvl)?.elevation ?? house.site.elevation
  return house.site.elevation
}
