import type { DeviceKind } from '../devices/kinds'
import { resolveDefaults } from './defaults'
import { indexHouse, type HouseIndex } from './lookup'
import type { House, HouseDevice, Vec2 } from './schema'
import { roomHeight } from './geometry/walls'
import { centroid, pointInPolygon } from './geometry/vec2'

// Auto-placement : un appareil remonté par un plugin mais absent du JSON est rattaché à la pièce
// dont le nom (ou l'id) correspond à la pièce déclarée par le plugin (`meta.room` : pièce Hue…).
// Sens UNIQUE plugin → placement : le JSON ne contient que les positions qu'on veut préciser,
// l'inventaire, le kind, les capacités et le nom restent au plugin.

/** Ce qu'il faut d'un appareil de plugin pour le placer. */
export interface PlaceableDevice {
  /** `<plugin>:<externalId>`. */
  id: string
  kind: DeviceKind
  /** Pièce déclarée par le plugin. */
  room?: string | undefined
}

export interface AutoPlacement {
  /** Appareils synthétisés, à concaténer à `house.devices`. */
  placed: HouseDevice[]
  /** Appareils qu'aucune pièce ne réclame : listés dans l'UI, absents de la scène. */
  unplaced: PlaceableDevice[]
}

/** Clé de rapprochement : sans accents, sans casse, sans séparateurs (« Chambre 1 » = `chambre1`). */
export function roomKey(label: string): string {
  return label.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/gu, '')
}

/** Écart au centroïde quand plusieurs appareils partagent une pièce (m). */
const SPREAD_R = 0.9
/** Retrait sous le plafond pour un appareil au plafond (m). */
const CEILING_GAP = 0.15
/** Hauteur d'un appareil non plafonnier (m). */
const FREE_Z = 1.2

function spread(poly: readonly Vec2[], c: Vec2, i: number, n: number): Vec2 {
  if (n < 2) return c
  const a = (i / n) * Math.PI * 2
  const p: Vec2 = [c[0] + Math.cos(a) * SPREAD_R, c[1] + Math.sin(a) * SPREAD_R]
  return pointInPolygon(p, poly) ? p : c
}

export function autoPlaceDevices(house: House, devices: readonly PlaceableDevice[], index: HouseIndex = indexHouse(house)): AutoPlacement {
  const byKey = new Map<string, string>()
  for (const room of house.rooms) {
    byKey.set(roomKey(room.id), room.id)
    byKey.set(roomKey(room.name), room.id)
  }
  const defaults = resolveDefaults(house.defaults)
  const candidates = [...devices]
    .filter((d) => !index.devicesByBinding.has(d.id))
    .sort((a, b) => a.id.localeCompare(b.id))

  const perRoom = new Map<string, PlaceableDevice[]>()
  const unplaced: PlaceableDevice[] = []
  for (const d of candidates) {
    const roomId = d.room ? byKey.get(roomKey(d.room)) : undefined
    if (!roomId) { unplaced.push(d); continue }
    const arr = perRoom.get(roomId)
    if (arr) arr.push(d)
    else perRoom.set(roomId, [d])
  }

  const placed: HouseDevice[] = []
  for (const [roomId, list] of perRoom) {
    const room = index.roomsById.get(roomId)!
    const level = index.levelsById.get(room.levelId)
    const c = centroid(room.polygon)
    const ceiling = level ? roomHeight(room, level, defaults) - CEILING_GAP : FREE_Z
    list.forEach((d, i) => {
      const [x, y] = spread(room.polygon, c, i, list.length)
      const onCeiling = d.kind === 'light'
      placed.push({
        id: autoId(d.id, index),
        deviceId: d.id,
        kind: d.kind,
        position: [round(x), round(y), round(onCeiling ? ceiling : FREE_Z)],
        roomId,
        mount: onCeiling ? 'ceiling' : 'free',
        meta: { autoPlaced: true },
      })
    })
  }
  return { placed, unplaced }
}

const round = (v: number) => Math.round(v * 100) / 100

/** Id d'appareil maison dérivé du `deviceId` (les caractères hors `[a-z0-9_.-]` sont remplacés). */
export function houseIdForDevice(deviceId: string): string {
  return `auto.${deviceId.replace(/[^a-z0-9_.-]+/gi, '-')}`
}

/** Le même, rendu unique dans la maison courante. */
function autoId(deviceId: string, index: HouseIndex): string {
  const base = houseIdForDevice(deviceId)
  if (!index.devicesById.has(base)) return base
  let n = 2
  while (index.devicesById.has(`${base}.${n}`)) n++
  return `${base}.${n}`
}
