import { z } from 'zod'
import { deviceIdSchema } from '../devices/descriptor'
import { MOUNTS, vec3Schema } from './schema'

// Placement d'un appareil depuis l'UI : la seule écriture que le serveur fait dans house.json.
// On travaille sur le JSON BRUT (pas la maison parsée) pour ne réécrire que ce qui a changé et ne
// pas injecter les défauts zod (kind: 'room', openings: []…) dans le fichier de l'utilisateur.
// Le résultat doit ensuite être validé par `parseHouse` avant d'être écrit.

export const devicePlacementSchema = z.object({
  /** x, y absolus ; z relatif au sol de l'ancre (comme `HouseDevice.position`). */
  position: vec3Schema,
  /** Nouvelle pièce d'ancrage (déplacement vers une pièce voisine du même niveau). */
  roomId: z.string().min(1).optional(),
  mount: z.enum(MOUNTS).optional(),
  /** Requis quand l'appareil n'existe pas encore dans le JSON (appareil auto-placé). */
  deviceId: deviceIdSchema.optional(),
})
export type DevicePlacement = z.infer<typeof devicePlacementSchema>

export class PlacementError extends Error {
  readonly statusCode = 400
  readonly code = 'INVALID_PLACEMENT'
  constructor(message: string) { super(message); this.name = 'PlacementError' }
}

type JsonObject = Record<string, unknown>
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Renvoie une copie du document JSON avec l'appareil `id` (re)placé : entrée existante mise à jour
 * (position, pièce, mount), ou entrée minimale créée `{ id, deviceId, position, roomId, mount }`.
 */
export function placeDeviceInJson(doc: unknown, id: string, placement: DevicePlacement): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const devices = Array.isArray(doc.devices) ? doc.devices : []
  const rooms = Array.isArray(doc.rooms) ? doc.rooms.filter(isObject) : []
  const room = placement.roomId ? rooms.find((r) => r.id === placement.roomId) : undefined
  if (placement.roomId && !room) throw new PlacementError(`unknown room "${placement.roomId}"`)

  const i = devices.findIndex((d) => isObject(d) && d.id === id)
  let next: JsonObject
  if (i >= 0) {
    const prev = devices[i] as JsonObject
    next = { ...prev, position: placement.position }
    if (placement.mount) next.mount = placement.mount
    if (room) {
      next.roomId = room.id
      // le JSON de démo porte roomId ET levelId : garder les deux cohérents, sans en ajouter
      if ('levelId' in prev) next.levelId = room.levelId
      delete next.zoneId
    }
  } else {
    if (!placement.deviceId) throw new PlacementError(`device "${id}" is not in house.json: deviceId is required to create it`)
    next = { id, deviceId: placement.deviceId, position: placement.position }
    if (room) next.roomId = room.id
    if (placement.mount) next.mount = placement.mount
  }
  const out = [...devices]
  if (i >= 0) out[i] = next
  else out.push(next)
  return { ...doc, devices: out }
}
