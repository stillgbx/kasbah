import { z } from 'zod'
import { deviceIdSchema } from '../devices/descriptor'
import { defaultPlugins, MOUNTS, vec3Schema, type PluginSettingsPatch } from './schema'

// Écritures de l'UI dans house.json (placement d'un appareil, ordre d'affichage des pièces).
// On travaille sur le JSON BRUT (pas la maison parsée) pour ne réécrire que ce qui a changé et ne
// pas injecter les défauts zod (kind: 'room', openings: []…) dans le fichier de l'utilisateur.
// Le résultat doit ensuite être validé par `parseHouse` avant d'être écrit.

export const devicePlacementSchema = z.object({
  /** x, y absolus ; z relatif au sol de l'ancre (comme `HouseDevice.position`). */
  position: vec3Schema,
  /** Nouvelle pièce d'ancrage (déplacement vers une pièce voisine du même niveau). */
  roomId: z.string().min(1).optional(),
  /** Niveau d'ancrage quand l'appareil n'est dans AUCUNE pièce (couloir non relevé, façade) ; ignoré si `roomId` est donné. */
  levelId: z.string().min(1).optional(),
  mount: z.enum(MOUNTS).optional(),
  /** Orientation en degrés, 0 = face à +y (comme `HouseDevice.yaw`) : un écran, une caméra regardent quelque part. */
  yaw: z.number().min(0).max(360).optional(),
  /** Requis quand l'appareil n'existe pas encore dans le JSON (appareil auto-placé). */
  deviceId: deviceIdSchema.optional(),
})
export type DevicePlacement = z.infer<typeof devicePlacementSchema>

export const roomOrderSchema = z.object({
  /** Ordre voulu, complet ou partiel ; les pièces absentes suivent, par ordre alphabétique. */
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

/**
 * Renvoie une copie du document JSON avec l'appareil `id` (re)placé : entrée existante mise à jour
 * (position, pièce, mount, yaw), ou entrée minimale créée `{ id, deviceId, position, roomId, mount }`
 * (plus `yaw` s'il est donné).
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
    next = { ...prev, position: placement.position }
    if (placement.mount) next.mount = placement.mount
    if (placement.yaw !== undefined) next.yaw = placement.yaw
    if (room) {
      next.roomId = room.id
      // le JSON de démo porte roomId ET levelId : garder les deux cohérents, sans en ajouter
      if ('levelId' in prev) next.levelId = room.levelId
      delete next.zoneId
    } else if (level) {
      // sorti de toute pièce : le niveau devient l'ancre, la pièce et la zone tombent
      next.levelId = level.id
      delete next.roomId
      delete next.zoneId
    }
  } else {
    if (!placement.deviceId) throw new PlacementError(`device "${id}" is not in house.json: deviceId is required to create it`)
    next = { id, deviceId: placement.deviceId, position: placement.position }
    if (room) next.roomId = room.id
    else if (level) next.levelId = level.id
    if (placement.mount) next.mount = placement.mount
    if (placement.yaw !== undefined) next.yaw = placement.yaw
  }
  const out = [...devices]
  if (i >= 0) out[i] = next
  else out.push(next)
  return { ...doc, devices: out }
}

/**
 * Renvoie une copie du document JSON SANS l'appareil `id` : il sort de la maison et redevient ce qu'il
 * était avant d'être posé — auto-placé si sa pièce de plugin existe, sinon « non placé ». Geste inverse
 * du placement, confirmé côté UI. Un id inconnu est refusé (rien à retirer).
 */
export function removeDeviceFromJson(doc: unknown, id: string): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const devices = Array.isArray(doc.devices) ? doc.devices : []
  const i = devices.findIndex((d) => isObject(d) && d.id === id)
  if (i < 0) throw new PlacementError(`device "${id}" is not in house.json`)
  return { ...doc, devices: devices.filter((_, k) => k !== i) }
}

/**
 * Renvoie une copie du document JSON avec les réglages du plugin `pluginId` modifiés (activation,
 * sous-items, défaut des ambiances). Une maison qui n'a pas encore de section `plugins` la reçoit
 * ÉCRITE EN ENTIER à partir du défaut : sans ça, activer Hue dans une maison muette éteindrait la
 * simulation, que seul le défaut du schéma gardait allumée.
 */
export function setPluginInJson(doc: unknown, pluginId: string, patch: PluginSettingsPatch): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const plugins: JsonObject = isObject(doc.plugins) ? { ...doc.plugins } : defaultPlugins()
  const prev = isObject(plugins[pluginId]) ? (plugins[pluginId] as JsonObject) : {}
  const next: JsonObject = { ...prev }
  if (patch.enabled !== undefined) next.enabled = patch.enabled
  if (patch.autoDynamicForNewScenes !== undefined) next.autoDynamicForNewScenes = patch.autoDynamicForNewScenes
  // les sous-items se fusionnent clé à clé : l'UI n'envoie que celui qu'on vient de basculer
  if (patch.parts) next.parts = { ...(isObject(prev.parts) ? prev.parts : {}), ...patch.parts }
  plugins[pluginId] = next
  return { ...doc, plugins }
}

/**
 * Renvoie une copie du document JSON avec `roomOrder` posé sur le niveau `levelId`. Les ids qui ne
 * sont pas des pièces de ce niveau sont refusés (un ordre qui ne correspond plus à la maison serait
 * silencieusement ignoré à l'affichage).
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
