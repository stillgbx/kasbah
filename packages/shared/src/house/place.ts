import { z } from 'zod'
import { deviceIdSchema } from '../devices/descriptor'
import { defaultPlugins, hexColorSchema, MAX_OPENING_LEAVES, MIN_OPENING_LEAVES, MIN_PARKING_DIM, model3dSchema, MOUNTS, NEUTRAL_TUNING, OPENING_MATERIALS, OPENING_TYPES, vec2Schema, vec3Schema, type PluginSettingsPatch, type SceneTuning } from './schema'
import { DEVICE_KINDS, VEHICLE_FINISHES } from '../devices/kinds'
import { computeHouseGeometry, openingCentre } from './geometry'
import { parseHouse } from './validate'
import type { Vec3 } from './geometry/types'

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
  /** Vantaux d'un ouvrant (comme `HouseDevice.leaves`) : les battants d'un portail, les panneaux d'un volet. */
  leaves: z.union([z.literal(1), z.literal(2)]).optional(),
  /**
   * Matière d'un ouvrant (comme `HouseDevice.coverMaterial`). **Chaîne vide = effacer** et rendre la
   * main à la matière d'ouvrant du style de rendu, comme pour la couleur de carrosserie.
   */
  coverMaterial: z.union([z.literal(''), z.enum(OPENING_MATERIALS)]).optional(),
  /** Couleur d'un ouvrant (comme `HouseDevice.coverColor`). **Chaîne vide = effacer**, même règle. */
  coverColor: z.union([z.literal(''), hexColorSchema]).optional(),
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
  /**
   * Ouverture que l'appareil habille (comme `HouseDevice.openingId`) : un volet, un capteur de
   * fenêtre épousent son rectangle au lieu d'occuper un point. **Chaîne vide = délier**, comme la
   * chaîne vide pour le nom — c'est le seul moyen de rendre l'appareil à la pièce.
   *
   * Lier RE-ANCRE l'appareil sur la pièce qui porte l'ouverture : la validation croisée l'exige, et
   * le geste vient de la 3D, où l'on montre une fenêtre sans penser à la pièce derrière.
   */
  openingId: z.union([z.literal(''), z.string().min(1)]).optional(),
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

/** Pièce qui porte l'ouverture `openingId` dans le JSON brut. */
function openingOwner(rooms: readonly JsonObject[], openingId: string): JsonObject {
  const owner = rooms.find((r) => Array.isArray(r.openings) && r.openings.some((o) => isObject(o) && o.id === openingId))
  if (!owner) throw new PlacementError(`unknown opening "${openingId}"`)
  return owner
}

/** Deux places identiques au millimètre : inutile de réécrire le fichier pour du bruit de virgule. */
const samePlace = (a: readonly unknown[], b: Vec3) =>
  a.length === 3 && a.every((v, i) => typeof v === 'number' && Math.abs(v - b[i]!) < 1e-6)

/** Au millimètre : un relevé se lit à la main, il n'a pas à porter quinze décimales. */
const roundPlace = (p: Vec3): Vec3 => [
  Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000, Math.round(p[2] * 1000) / 1000,
]

/**
 * Recale sur le centre de leur baie les appareils LIÉS aux ouvertures données.
 *
 * Un volet, un capteur de fenêtre n'occupent pas un point : ils habillent un rectangle, et c'est ce
 * rectangle que la scène dessine — leur `position` n'est plus ce qui les place. Mais elle se LIT,
 * dans un fichier qu'on ouvre à la main, et une ouverture affinée après coup la laissait mentir
 * (2,11 m d'écart mesurés sur le volet du bureau). Elle suit donc la baie, dans la même écriture que
 * l'ouverture qui vient de bouger.
 *
 * Seuls les appareils qui ont DÉJÀ une place sont recalés : lier un appareil jamais posé ne lui en
 * invente pas une, la scène sait s'en passer.
 *
 * Le document est relu pour en tirer la géométrie : c'est le seul moyen d'avoir le MÊME centre que
 * la scène, plutôt qu'un second calcul qui divergerait. Un document que `parseHouse` refuse est
 * rendu tel quel — c'est l'appelant qui valide, et son erreur sera plus claire que la nôtre.
 */
function alignDevicesOnOpenings(doc: JsonObject, openingIds: readonly string[]): JsonObject {
  const devices = Array.isArray(doc.devices) ? doc.devices : []
  const wanted = new Set(openingIds)
  const concerns = (d: unknown): d is JsonObject =>
    isObject(d) && typeof d.openingId === 'string' && wanted.has(d.openingId) && Array.isArray(d.position)
  if (!devices.some(concerns)) return doc
  let centres: Map<string, Vec3>
  try {
    centres = new Map(computeHouseGeometry(parseHouse(doc)).levels
      .flatMap((l) => l.openings)
      .filter((rect) => wanted.has(rect.openingId))
      .map((rect) => [rect.openingId, roundPlace(openingCentre(rect))]))
  } catch { return doc }
  let changed = false
  const next = devices.map((d) => {
    if (!concerns(d)) return d
    const centre = centres.get(d.openingId as string)
    if (!centre || samePlace(d.position as unknown[], centre)) return d
    changed = true
    return { ...d, position: centre }
  })
  return changed ? { ...doc, devices: next } : doc
}

/**
 * Renvoie une copie du document JSON avec l'appareil `id` (re)placé ou renommé : entrée existante
 * mise à jour (position, nom, pièce, mount, yaw, size, leaves, coverMaterial, coverColor, gpsOffset,
 * yawOffset, batteryKwh, model3d, bodyColor, bodyFinish), ou entrée créée
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
    if (placement.coverMaterial !== undefined) {
      if (placement.coverMaterial) next.coverMaterial = placement.coverMaterial
      else delete next.coverMaterial
    }
    if (placement.coverColor !== undefined) {
      if (placement.coverColor) next.coverColor = placement.coverColor
      else delete next.coverColor
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
    // APRÈS l'ancrage : lier une ouverture emporte la pièce qui la porte, quoi qu'ait dit le patch
    if (placement.openingId !== undefined) {
      if (placement.openingId) {
        const owner = openingOwner(rooms, placement.openingId)
        next.openingId = placement.openingId
        next.roomId = owner.id
        if ('levelId' in next) next.levelId = owner.levelId
        delete next.zoneId
      } else delete next.openingId
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
    if (placement.coverMaterial) next.coverMaterial = placement.coverMaterial
    if (placement.coverColor) next.coverColor = placement.coverColor
    if (placement.openingId) {
      const owner = openingOwner(rooms, placement.openingId)
      next.openingId = placement.openingId
      next.roomId = owner.id
    }
  }
  const out = [...devices]
  if (i >= 0) out[i] = next
  else out.push(next)
  // lier un appareil à une ouverture lui donne la place de la baie : il l'habille désormais
  return placement.openingId
    ? alignDevicesOnOpenings({ ...doc, devices: out }, [placement.openingId])
    : { ...doc, devices: out }
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
 * Renvoie une copie du document JSON avec le réglage de lumière de la scène 3D posé
 * (`render.tuning`), tel qu'il sort du banc de la vue Maison. Un réglage NEUTRE n'est pas écrit :
 * il est retiré du fichier, pour qu'une maison sans retouche reste une maison sans section
 * `render` — le style redevient alors la seule source, ce qui est bien ce qu'on veut dire.
 */
export function setRenderTuningInJson(doc: unknown, tuning: SceneTuning): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const render: JsonObject = isObject(doc.render) ? { ...doc.render } : {}
  const neutral = (Object.keys(NEUTRAL_TUNING) as (keyof SceneTuning)[]).every((k) => tuning[k] === NEUTRAL_TUNING[k])
  if (neutral) delete render.tuning
  else render.tuning = { ...tuning }
  const { render: _dropped, ...rest } = doc
  return Object.keys(render).length ? { ...rest, render } : rest
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

/**
 * Ouverture (`rooms[i].openings[j]`) réglée depuis l'UI : cotes et place sur le contour de la pièce.
 * Seuls les champs présents sont posés, comme pour un placement d'appareil — régler l'allège ne doit
 * pas redéposer la largeur qu'on était en train de saisir ailleurs.
 *
 * Le patch ne CRÉE pas : une ouverture naît du relevé, l'UI ne fait que l'ajuster.
 */
export const openingPatchSchema = z.object({
  /** Nom en clair (comme `Opening.name`). **Chaîne vide = effacer** et revenir à l'`id` du relevé. */
  name: z.string().trim().max(60).optional(),
  type: z.enum(OPENING_TYPES).optional(),
  /** Arête de la pièce qui porte l'ouverture (index dans `room.polygon`). */
  segment: z.number().int().min(0).optional(),
  /** Distance (m) depuis le coin `polygon[segment]` jusqu'au bord proche. */
  offset: z.number().min(0).max(100).optional(),
  width: z.number().positive().max(20).optional(),
  height: z.number().positive().max(10).optional(),
  /**
   * Hauteur d'allège depuis le sol fini. **Absente = on n'y touche pas** ; `0` est une valeur, pas
   * un effacement — une porte est à 0 et le reste. L'ouverture qui n'en a jamais eu suit le défaut
   * de la maison (`defaults.windowSill`), c'est `openingSill` qui tranche.
   */
  sill: z.number().min(0).max(10).optional(),
  /**
   * Nombre de vantaux. **Chaîne vide = effacer** et rendre la main à ce qui se déduit
   * (`openingLeaves`) : écrire le nombre déduit au lieu de retirer la clé FIGERAIT une baie qui
   * suivait sa largeur.
   */
  leaves: z.union([z.number().int().min(MIN_OPENING_LEAVES).max(MAX_OPENING_LEAVES), z.literal('')]).optional(),
  /** Matière de la menuiserie. **Chaîne vide = effacer** et rendre la main à la nature de l'ouverture. */
  material: z.union([z.enum(OPENING_MATERIALS), z.literal('')]).optional(),
  /** Couleur de la menuiserie. **Chaîne vide = effacer** et rendre la main à la palette du style. */
  color: z.union([hexColorSchema, z.literal('')]).optional(),
})
export type OpeningPatch = z.infer<typeof openingPatchSchema>

/**
 * Renvoie une copie du document JSON avec l'ouverture `openingId` de la pièce `roomId` modifiée.
 *
 * Contrairement aux autres patches, la cible est IMBRIQUÉE : on recopie la pièce et son tableau
 * d'ouvertures, sans toucher aux autres pièces. Le reste des règles (ouverture dans son segment,
 * sous le plafond, sans chevauchement) est vérifié par `parseHouse` avant écriture, comme partout.
 */
export function patchOpeningInJson(doc: unknown, roomId: string, openingId: string, patch: OpeningPatch): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const rooms = Array.isArray(doc.rooms) ? doc.rooms : []
  const ri = rooms.findIndex((r) => isObject(r) && r.id === roomId)
  if (ri < 0) throw new PlacementError(`unknown room "${roomId}"`)
  const room = rooms[ri] as JsonObject
  const openings = Array.isArray(room.openings) ? room.openings : []
  const oi = openings.findIndex((o) => isObject(o) && o.id === openingId)
  if (oi < 0) throw new PlacementError(`room "${roomId}" has no opening "${openingId}"`)

  const next: JsonObject = { ...(openings[oi] as JsonObject) }
  for (const key of ['type', 'segment', 'offset', 'width', 'height', 'sill'] as const) {
    if (patch[key] !== undefined) next[key] = patch[key]
  }
  // les quatre champs EFFAÇABLES : une chaîne vide retire la clé du fichier, et ce qui la remplace
  // est le défaut déduit — l'id du relevé pour le nom, la largeur pour les vantaux, la nature pour
  // la matière, le style pour la couleur. Écrire un `null` laisserait une clé morte dans un relevé
  // qu'on relit à la main.
  for (const key of ['name', 'leaves', 'material', 'color'] as const) {
    if (patch[key] === undefined) continue
    if (patch[key]) next[key] = patch[key]
    else delete next[key]
  }
  const nextOpenings = [...openings]
  nextOpenings[oi] = next
  const nextRooms = [...rooms]
  nextRooms[ri] = { ...room, openings: nextOpenings }
  // l'ouverture a bougé (ou changé de cotes) : ce qui l'habille la suit, dans la même écriture
  return alignDevicesOnOpenings({ ...doc, rooms: nextRooms }, [openingId])
}

/**
 * Ouverture AJOUTÉE à une pièce depuis le mode édition. Complète, contrairement au patch : une
 * ouverture qui naît doit dire où elle se pose et ce qu'elle mesure, sinon elle n'existe nulle part.
 * L'id est choisi par l'UI, comme celui d'un champ de panneaux.
 */
export const newOpeningSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().trim().max(60).optional(),
  type: z.enum(OPENING_TYPES),
  segment: z.number().int().min(0),
  offset: z.number().min(0).max(100),
  width: z.number().positive().max(20),
  height: z.number().positive().max(10),
  sill: z.number().min(0).max(10).optional(),
})
export type NewOpening = z.infer<typeof newOpeningSchema>

/**
 * Renvoie une copie du document JSON avec une ouverture de PLUS dans la pièce `roomId`. L'id doit
 * être libre dans TOUTE la maison, pas seulement dans la pièce : un ouvrant nomme son ouverture sans
 * dire où elle est (`devices[].openingId`), et `parseHouse` refuserait le doublon.
 *
 * L'allège n'est écrite que si elle dit quelque chose : `0` est le défaut implicite de tout ce qui
 * descend au sol, et l'omettre garde le fichier lisible pour qui relit son relevé. La FENÊTRE fait
 * exception — sans `sill`, elle retomberait sur `defaults.windowSill`, donc un 0 voulu s'écrit.
 */
export function addOpeningToJson(doc: unknown, roomId: string, opening: NewOpening): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const rooms = Array.isArray(doc.rooms) ? doc.rooms : []
  const ri = rooms.findIndex((r) => isObject(r) && r.id === roomId)
  if (ri < 0) throw new PlacementError(`unknown room "${roomId}"`)
  for (const r of rooms) {
    if (!isObject(r) || !Array.isArray(r.openings)) continue
    if (r.openings.some((o) => isObject(o) && o.id === opening.id)) throw new PlacementError(`opening "${opening.id}" already exists`)
  }
  const room = rooms[ri] as JsonObject
  const openings = Array.isArray(room.openings) ? room.openings : []
  const next: JsonObject = {
    id: opening.id, type: opening.type, segment: opening.segment,
    offset: opening.offset, width: opening.width, height: opening.height,
  }
  if (opening.name) next.name = opening.name
  if (opening.sill !== undefined && (opening.sill > 0 || opening.type === 'window')) next.sill = opening.sill
  const nextRooms = [...rooms]
  nextRooms[ri] = { ...room, openings: [...openings, next] }
  return { ...doc, rooms: nextRooms }
}

/**
 * Renvoie une copie du document JSON SANS l'ouverture `openingId` de la pièce `roomId`.
 *
 * L'ouvrant qui l'habillait est LIBÉRÉ dans la même écriture (`openingId` effacé) : un volet qui
 * nomme une ouverture disparue fait rejeter la maison entière par `parseHouse`, et la suppression
 * échouerait sans rien dire de la vraie raison. Le volet reste dans la maison, sans ouverture — la
 * vue Ouvrants le compte alors parmi ceux qui attendent une place.
 */
export function removeOpeningFromJson(doc: unknown, roomId: string, openingId: string): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const rooms = Array.isArray(doc.rooms) ? doc.rooms : []
  const ri = rooms.findIndex((r) => isObject(r) && r.id === roomId)
  if (ri < 0) throw new PlacementError(`unknown room "${roomId}"`)
  const room = rooms[ri] as JsonObject
  const openings = Array.isArray(room.openings) ? room.openings : []
  if (!openings.some((o) => isObject(o) && o.id === openingId)) throw new PlacementError(`room "${roomId}" has no opening "${openingId}"`)
  const nextRooms = [...rooms]
  nextRooms[ri] = { ...room, openings: openings.filter((o) => !(isObject(o) && o.id === openingId)) }

  const devices = Array.isArray(doc.devices) ? doc.devices : []
  let bound = false
  const freed = devices.map((d) => {
    if (!isObject(d) || d.openingId !== openingId) return d
    bound = true
    const { openingId: _gone, ...rest } = d
    return rest
  })
  // pas de clé `devices` posée dans une maison qui n'en avait pas : on ne réécrit que ce qui change
  return { ...doc, rooms: nextRooms, ...(bound ? { devices: freed } : {}) }
}

/**
 * Place de stationnement réglée depuis le mode édition : ses cotes, son centre, son cap.
 * Seuls les champs présents sont posés — régler la cote avant ne redépose pas la largeur.
 *
 * Deux champs suivent la règle du nom vide qui efface (comme `openingPatchSchema`) : `name` rend la
 * main à l'id, et `margin` à la marge commune (`PARKING_SNAP_MARGIN`). Le `deviceId` d'une base,
 * lui, ne se patche pas : une base qui change de robot est une autre place.
 */
export const parkingPatchSchema = z.object({
  name: z.string().trim().max(60).optional(),
  center: vec2Schema.optional(),
  size: z.tuple([z.number().min(MIN_PARKING_DIM).max(30), z.number().min(MIN_PARKING_DIM).max(30)]).optional(),
  /**
   * Cap de l'avant. L'UI le ramène dans `[0, 360[` avant l'envoi, comme le `yaw` d'un appareil
   * orienté (`PlacementControl`) ; les bornes restent larges parce qu'un axe CALCULÉ (celui d'un
   * garage, `longestEdgeYawDeg`) revient négatif, et qu'un refus n'apprendrait rien à personne.
   */
  yaw: z.number().min(-360).max(360).optional(),
  /** `0` EFFACE et rend la main à la marge commune — une place sans marge propre n'accrocherait rien. */
  margin: z.number().min(0).max(20).optional(),
})
export type ParkingPatch = z.infer<typeof parkingPatchSchema>

/** Les places du document, telles qu'elles y sont écrites (tableau absent = maison sans place). */
function parkingsOf(doc: JsonObject): { site: JsonObject; list: unknown[] } {
  const site = isObject(doc.site) ? doc.site : null
  if (!site) throw new PlacementError('house document has no site')
  return { site, list: Array.isArray(site.parkings) ? site.parkings : [] }
}

/** Renvoie une copie du document JSON avec la place `id` modifiée. */
export function patchParkingInJson(doc: unknown, id: string, patch: ParkingPatch): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const { site, list } = parkingsOf(doc)
  const i = list.findIndex((p) => isObject(p) && p.id === id)
  if (i < 0) throw new PlacementError(`unknown parking "${id}"`)
  const next: JsonObject = { ...(list[i] as JsonObject) }
  for (const key of ['center', 'size', 'yaw'] as const) if (patch[key] !== undefined) next[key] = patch[key]
  for (const key of ['name', 'margin'] as const) {
    if (patch[key] === undefined) continue
    if (patch[key]) next[key] = patch[key]
    else delete next[key]
  }
  const nextList = [...list]
  nextList[i] = next
  return { ...doc, site: { ...site, parkings: nextList } }
}

/**
 * Place AJOUTÉE depuis le mode édition. Complète, comme une ouverture qui naît : une place doit dire
 * ce qui s'y range et où elle est, sinon elle n'existe nulle part. L'id est choisi par l'UI.
 */
export const newParkingSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().trim().max(60).optional(),
  accepts: z.enum(DEVICE_KINDS),
  /** Base réservée à cet appareil. Absent = place partagée par tous les appareils du kind. */
  deviceId: deviceIdSchema.optional(),
  /** Niveau qui porte la place, donné par le SOL tapé dans la 3D. Absent = sur le terrain. */
  levelId: z.string().min(1).optional(),
  center: vec2Schema,
  size: z.tuple([z.number().min(MIN_PARKING_DIM).max(30), z.number().min(MIN_PARKING_DIM).max(30)]),
  yaw: z.number().min(-360).max(360),
})
export type NewParking = z.infer<typeof newParkingSchema>

/** Renvoie une copie du document JSON avec une place de PLUS. L'id doit être libre dans la maison. */
export function addParkingToJson(doc: unknown, parking: NewParking): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const { site, list } = parkingsOf(doc)
  if (list.some((p) => isObject(p) && p.id === parking.id)) throw new PlacementError(`parking "${parking.id}" already exists`)
  const next: JsonObject = {
    id: parking.id, accepts: parking.accepts, center: parking.center, size: parking.size, yaw: parking.yaw,
  }
  if (parking.name) next.name = parking.name
  if (parking.deviceId) next.deviceId = parking.deviceId
  if (parking.levelId) next.levelId = parking.levelId
  return { ...doc, site: { ...site, parkings: [...list, next] } }
}

/**
 * Renvoie une copie du document JSON SANS la place `id`. Rien à libérer ailleurs : une place n'est
 * nommée par aucun appareil — c'est elle qui nomme le sien (l'inverse d'une ouverture et de son
 * ouvrant). L'engin qui s'y rangeait retourne simplement à son point GPS.
 */
export function removeParkingFromJson(doc: unknown, id: string): JsonObject {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  const { site, list } = parkingsOf(doc)
  if (!list.some((p) => isObject(p) && p.id === id)) throw new PlacementError(`unknown parking "${id}"`)
  return { ...doc, site: { ...site, parkings: list.filter((p) => !(isObject(p) && p.id === id)) } }
}
