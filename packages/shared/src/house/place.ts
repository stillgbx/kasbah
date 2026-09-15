import { z } from 'zod'
import { deviceIdSchema } from '../devices/descriptor'
import { defaultPlugins, hexColorSchema, model3dSchema, MOUNTS, vec2Schema, vec3Schema, type PluginSettingsPatch } from './schema'
import { VEHICLE_FINISHES } from '../devices/kinds'

// Écritures de l'UI dans house.json (placement d'un appareil, ordre d'affichage des pièces).
// On travaille sur le JSON BRUT (pas la maison parsée) pour ne réécrire que ce qui a changé et ne
// pas injecter les défauts zod (kind: 'room', openings: []…) dans le fichier de l'utilisateur.
// Le résultat doit ensuite être validé par `parseHouse` avant d'être écrit.

export const devicePlacementSchema = z.object({
  /**
   * x, y absolus ; z relatif au sol de l'ancre (comme `HouseDevice.position`). **Absente = on ne
   * touche pas à la place** : une entrée existante garde la sienne, une entrée créée n'en reçoit
   * aucune (appareil connu de la maison mais non placé — un véhicule qu'on ne fait que renommer).
   */
  position: vec3Schema.optional(),
  /**
   * Nom choisi par l'utilisateur, qui l'emporte sur celui du descripteur de plugin. **Chaîne vide =
   * effacer** et revenir au nom du fabricant — c'est le seul moyen de défaire un renommage.
   */
  name: z.string().trim().max(60).optional(),
  /** Nouvelle pièce d'ancrage (déplacement vers une pièce voisine du même niveau). */
  roomId: z.string().min(1).optional(),
  /** Niveau d'ancrage quand l'appareil n'est dans AUCUNE pièce (couloir non relevé, façade) ; ignoré si `roomId` est donné. */
  levelId: z.string().min(1).optional(),
  mount: z.enum(MOUNTS).optional(),
  /** Orientation en degrés, 0 = face à +y (comme `HouseDevice.yaw`) : un écran, une caméra regardent quelque part. */
  yaw: z.number().min(0).max(360).optional(),
  /** Encombrement dessiné (m, comme `HouseDevice.size`) : un portail posé dehors n'a pas d'ouverture pour le dimensionner. */
  size: z.object({ width: z.number().positive().max(50), height: z.number().positive().max(50) }).optional(),
  /** Battants d'un portail (comme `HouseDevice.leaves`) : un panneau, ou deux qui s'écartent. */
  leaves: z.union([z.literal(1), z.literal(2)]).optional(),
  /**
   * Correction (m, repère maison) de la place calculée d'un appareil placé par son GPS — un
   * véhicule (comme `HouseDevice.gpsOffset`). `[0, 0]` EFFACE la correction : c'est le seul moyen
   * de revenir au relevé brut, comme la chaîne vide pour le nom.
   */
  gpsOffset: vec2Schema.optional(),
  /**
   * Correction (degrés, ±180) de l'orientation calculée d'un appareil placé par son GPS — un
   * véhicule (comme `HouseDevice.yawOffset`). `0` EFFACE la correction, comme `[0, 0]` pour le
   * décalage : on revient à ce que la scène déduit toute seule.
   */
  yawOffset: z.number().min(-180).max(180).optional(),
  /**
   * Capacité de la batterie d'un véhicule (kWh, comme `HouseDevice.batteryKwh`), saisie faute que
   * les fabricants la donnent. `0` EFFACE la valeur, comme `[0, 0]` pour le décalage.
   */
  batteryKwh: z.number().min(0).max(500).optional(),
  /**
   * Carrosserie 3D d'un véhicule (comme `HouseDevice.model3d`) : un identifiant du catalogue, ou
   * `'none'` pour la silhouette générique. **Chaîne vide = effacer** et revenir au choix
   * automatique, comme pour le nom — `'none'` est un choix, pas une absence de choix.
   */
  model3d: z.union([z.literal(''), model3dSchema]).optional(),
  /**
   * Couleur de carrosserie (comme `HouseDevice.bodyColor`). **Chaîne vide = effacer** et rendre la
   * main à la couleur de véhicule de la scène, qui suit le thème.
   */
  bodyColor: z.union([z.literal(''), hexColorSchema]).optional(),
  /**
   * Aspect de la peinture (comme `HouseDevice.bodyFinish`). **Chaîne vide = effacer** et rendre la
   * main à ce que le fabricant dit, comme pour la couleur.
   */
  bodyFinish: z.union([z.literal(''), z.enum(VEHICLE_FINISHES)]).optional(),
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
 * Renvoie une copie du document JSON avec l'appareil `id` (re)placé ou renommé : entrée existante
 * mise à jour (position, nom, pièce, mount, yaw, size, leaves, gpsOffset, yawOffset, batteryKwh,
 * model3d, bodyColor, bodyFinish), ou entrée créée
 * `{ id, deviceId, … }` avec ce qui a été donné.
 *
 * Tout est facultatif, position comprise : renommer un appareil qui n'a PAS de place dans la scène
 * (un véhicule) est un usage à part entière, et c'est ce qui lui donne son entrée dans la maison.
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
    next = { ...prev }
    if (placement.position) next.position = placement.position
    if (placement.name !== undefined) {
      if (placement.name) next.name = placement.name
      else delete next.name
    }
    if (placement.mount) next.mount = placement.mount
    if (placement.yaw !== undefined) next.yaw = placement.yaw
    if (placement.size) next.size = placement.size
    if (placement.leaves !== undefined) next.leaves = placement.leaves
    if (placement.gpsOffset) {
      if (placement.gpsOffset[0] === 0 && placement.gpsOffset[1] === 0) delete next.gpsOffset
      else next.gpsOffset = placement.gpsOffset
    }
    if (placement.yawOffset !== undefined) {
      if (placement.yawOffset === 0) delete next.yawOffset
      else next.yawOffset = placement.yawOffset
    }
    if (placement.batteryKwh !== undefined) {
      if (placement.batteryKwh === 0) delete next.batteryKwh
      else next.batteryKwh = placement.batteryKwh
    }
    if (placement.model3d !== undefined) {
      if (placement.model3d) next.model3d = placement.model3d
      else delete next.model3d
    }
    if (placement.bodyColor !== undefined) {
      if (placement.bodyColor) next.bodyColor = placement.bodyColor
      else delete next.bodyColor
    }
    if (placement.bodyFinish !== undefined) {
      if (placement.bodyFinish) next.bodyFinish = placement.bodyFinish
      else delete next.bodyFinish
    }
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
    next = { id, deviceId: placement.deviceId }
    if (placement.position) next.position = placement.position
    if (placement.name) next.name = placement.name
    if (room) next.roomId = room.id
    else if (level) next.levelId = level.id
    if (placement.mount) next.mount = placement.mount
    if (placement.yaw !== undefined) next.yaw = placement.yaw
    if (placement.size) next.size = placement.size
    if (placement.leaves !== undefined) next.leaves = placement.leaves
    if (placement.gpsOffset && (placement.gpsOffset[0] !== 0 || placement.gpsOffset[1] !== 0)) next.gpsOffset = placement.gpsOffset
    if (placement.yawOffset) next.yawOffset = placement.yawOffset
    if (placement.batteryKwh) next.batteryKwh = placement.batteryKwh
    if (placement.model3d) next.model3d = placement.model3d
    if (placement.bodyColor) next.bodyColor = placement.bodyColor
    if (placement.bodyFinish) next.bodyFinish = placement.bodyFinish
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
 *
 * Les CHAMPS DE PANNEAUX qui nomment cet appareil (`siteId`) partent avec lui : une installation
 * solaire retirée de la maison n'y laisse pas vingt modules orphelins, que plus aucun panneau ne
 * permettrait de régler. Les champs d'un autre site, ou ceux qui ne nomment personne, restent.
 */
export function removeDeviceFromJson(doc: unknown, id: string): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const devices = Array.isArray(doc.devices) ? doc.devices : []
  const i = devices.findIndex((d) => isObject(d) && d.id === id)
  if (i < 0) throw new PlacementError(`device "${id}" is not in house.json`)
  const deviceId = (devices[i] as JsonObject).deviceId
  const arrays = Array.isArray(doc.arrays) ? doc.arrays : []
  const kept = deviceId ? arrays.filter((a) => !(isObject(a) && a.siteId === deviceId)) : arrays
  return {
    ...doc,
    devices: devices.filter((_, k) => k !== i),
    ...(kept.length === arrays.length ? {} : { arrays: kept }),
  }
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

/**
 * Champ de panneaux (`house.arrays`) écrit depuis l'UI : seuls les champs présents sont posés, comme
 * pour un placement d'appareil. `levelId` et `origin` sont requis à la CRÉATION — un champ sans
 * niveau ni coin n'a nulle part où se dessiner.
 */
export const panelArrayPatchSchema = z.object({
  name: z.string().min(1).optional(),
  /** Installation dont le champ fait partie (`deviceId` du site) : elle l'emporte quand elle se retire. */
  siteId: deviceIdSchema.optional(),
  levelId: z.string().min(1).optional(),
  /** Coin du champ : x, y absolus ; z relatif au sol du niveau (comme `PanelArray.origin`). */
  origin: vec3Schema.optional(),
  yaw: z.number().min(0).max(360).optional(),
  /** Pente du support (le toit sous le champ) ; `tilt` est l'angle des modules SUR ce support. */
  slope: z.number().min(0).max(90).optional(),
  /** Inclinaison des modules : positive, ils se redressent face à l'azimut (voir `panelArraySchema`). */
  tilt: z.number().min(-90).max(90).optional(),
  rows: z.number().int().min(1).max(20).optional(),
  cols: z.number().int().min(1).max(20).optional(),
  /** Module : `width` le long des colonnes, `height` le long des rangées (portrait ↔ paysage = les deux échangées). */
  panel: z.object({
    width: z.number().positive().max(5).optional(),
    height: z.number().positive().max(5).optional(),
    /** Puissance crête du module (Wc) : l'échelle de couleur du champ, cf. `panelArraySchema`. */
    peakW: z.number().positive().max(2000).optional(),
  }).optional(),
  /** Puissance de sortie max des onduleurs du champ (W, 0 = inconnue) : voir `panelArraySchema`. */
  maxOutputW: z.number().min(0).max(2000).optional(),
  gap: z.number().min(0).max(1).optional(),
  /** Onduleur de chaque emplacement, rangée par rangée ; `null` = emplacement non suivi. */
  panels: z.array(deviceIdSchema.nullable()).optional(),
})
export type PanelArrayPatch = z.infer<typeof panelArrayPatchSchema>

/**
 * Renvoie une copie du document JSON avec le champ `id` créé ou modifié. La liste des onduleurs est
 * RAMENÉE à la grille : rétrécir un champ de 2 × 5 à 2 × 3 laisserait sinon plus de modules que
 * d'emplacements, ce que la validation refuse — l'UI ne peut pas se le voir refuser en plein geste.
 * Les emplacements vides de la fin ne sont pas écrits (un champ à demi équipé garde un JSON court).
 */
export function putArrayInJson(doc: unknown, id: string, patch: PanelArrayPatch): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const arrays = Array.isArray(doc.arrays) ? doc.arrays : []
  const i = arrays.findIndex((a) => isObject(a) && a.id === id)
  const prev = i >= 0 ? (arrays[i] as JsonObject) : null
  const levelId = patch.levelId ?? (prev?.levelId as string | undefined)
  if (!levelId) throw new PlacementError(`panel array "${id}": levelId is required to create it`)
  const levels = Array.isArray(doc.levels) ? doc.levels.filter(isObject) : []
  if (!levels.some((l) => l.id === levelId)) throw new PlacementError(`unknown level "${levelId}"`)
  if (!prev && !patch.origin) throw new PlacementError(`panel array "${id}": origin is required to create it`)

  const next: JsonObject = { ...(prev ?? { id }), levelId }
  for (const key of ['name', 'siteId', 'origin', 'yaw', 'slope', 'tilt', 'rows', 'cols', 'maxOutputW', 'gap'] as const) {
    if (patch[key] !== undefined) next[key] = patch[key]
  }
  // Le module se patche champ par champ, lui : coucher un module (`width`/`height` échangées) ne
  // doit pas effacer sa puissance crête, qui retomberait alors sur la valeur par défaut.
  if (patch.panel) next.panel = { ...(isObject(prev?.panel) ? prev.panel : {}), ...patch.panel }
  const rows = Number(next.rows ?? 1), cols = Number(next.cols ?? 1)
  next.rows = rows
  next.cols = cols
  const panels = patch.panels ?? (Array.isArray(prev?.panels) ? (prev.panels as unknown[]) : [])
  const fitted = panels.slice(0, rows * cols)
  while (fitted.length > 0 && fitted[fitted.length - 1] == null) fitted.pop()
  next.panels = fitted

  const out = [...arrays]
  if (i >= 0) out[i] = next
  else out.push(next)
  return { ...doc, arrays: out }
}

/**
 * Renvoie une copie du document JSON SANS le champ `id` : ses modules disparaissent de la maison
 * (ils n'existaient que dérivés) et ses onduleurs redeviennent des appareils à placer. Un id inconnu
 * est refusé.
 */
export function removeArrayFromJson(doc: unknown, id: string): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const arrays = Array.isArray(doc.arrays) ? doc.arrays : []
  const i = arrays.findIndex((a) => isObject(a) && a.id === id)
  if (i < 0) throw new PlacementError(`panel array "${id}" is not in house.json`)
  return { ...doc, arrays: arrays.filter((_, k) => k !== i) }
}
