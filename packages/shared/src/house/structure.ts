import { z } from 'zod'
import { ROOM_KINDS } from './schema'
import { PlacementError } from './place'
import { resolveDefaults } from './defaults'
import { surveyPointsToHouse, type SurveyConventions } from './survey'
import type { Vec2 } from './geometry/vec2'

// La STRUCTURE de la maison changée dans une séance d'édition : pièces et niveaux qui naissent ou
// disparaissent, nom et type d'une pièce, nom d'un niveau, nom de la propriété. Mêmes règles que le reste de la séance : tout est dans le
// patch, rien n'est écrit avant « Valider ». Une pièce qui naît a sa FORME dans `shapes` (des cotes,
// comme les autres) : tous les gestes de l'onglet Dimensions marchent sur elle.

const newIdSchema = z.string().min(1).regex(/^[a-z0-9_.-]+$/i, 'id: [a-z0-9_.-]+')

/** Un niveau naît au-dessus du plus haut étage habité, ou sous le plus bas. */
export const NEW_LEVEL_SIDES = ['above', 'below'] as const
export type NewLevelSide = (typeof NEW_LEVEL_SIDES)[number]

export const structurePatchShape = {
  newLevels: z.array(z.object({
    id: newIdSchema,
    name: z.string().trim().min(1).max(60),
    shortName: z.string().trim().min(1).max(12).optional(),
    side: z.enum(NEW_LEVEL_SIDES),
  })).optional(),
  removeLevels: z.array(z.string().min(1)).optional(),
  /** Pièces nées dans la séance ; leurs cotes sont dans `shapes`, leur nom et leur type dans `rooms`. */
  newRooms: z.array(z.object({ id: newIdSchema, levelId: z.string().min(1) })).optional(),
  removeRooms: z.array(z.string().min(1)).optional(),
  /** Nom et nom court (onglets ; vide = retiré), par niveau (existant ou né dans la séance). */
  levels: z.record(z.string().min(1), z.object({
    name: z.string().trim().min(1).max(60).optional(),
    shortName: z.string().trim().max(12).optional(),
  })).optional(),
  /** Le nom de la propriété (en-tête, sélecteur). */
  propertyName: z.string().trim().min(1).max(60).optional(),
  /** Nom et type, par pièce (existante ou née dans la séance). */
  rooms: z.record(z.string().min(1), z.object({
    name: z.string().trim().min(1).max(60).optional(),
    kind: z.enum(ROOM_KINDS).optional(),
  })).optional(),
}
export type StructurePatch = z.infer<z.ZodObject<typeof structurePatchShape>>

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const round4 = (v: number) => Math.round(v * 1e4) / 1e4
/** Mêmes pièces murées que `WALLED_KINDS` (geometry/walls.ts). */
const WALLED = new Set(['room', 'corridor', 'stairs', 'garage'])

/** Le patch change-t-il quelque chose qui demande de recalculer les murs (pièces, types) ? */
export function structureReshapes(patch: StructurePatch): boolean {
  return !!(patch.newRooms?.length || patch.removeRooms?.length
    || Object.values(patch.rooms ?? {}).some((r) => r.kind !== undefined))
}

/**
 * Applique la structure au JSON brut, AVANT l'apparence et les formes. `shapes` donne les cotes des
 * pièces qui naissent ; `conv` les conventions du relevé (la maison est déjà convertie quand une pièce
 * naît). Ce qui empêche d'écrire (niveau retiré qui porte encore quelque chose) est rendu dans
 * `blocking` ; une référence inconnue lève (`PlacementError`).
 */
export function applyStructureToJson(input: Json, patch: StructurePatch, shapes: Record<string, Vec2[]>, conv: SurveyConventions): { doc: Json; blocking: string[] } {
  const doc: Json = { ...input }
  let levels = (Array.isArray(doc.levels) ? doc.levels : []) as Json[]
  let rooms = (Array.isArray(doc.rooms) ? doc.rooms : []) as Json[]
  const blocking: string[] = []
  const { levelHeight, slabThickness: slab } = resolveDefaults(isObject(doc.defaults) ? doc.defaults : undefined)

  // -- niveaux qui naissent : un étage se pose sur le plus haut niveau HABITÉ, un sous-sol sous le
  //    plus bas. Les niveaux vides au-dessus de l'étage (le niveau du toit) montent d'autant.
  // un niveau né puis retiré dans la même séance n'a jamais existé : il ne monte pas le toit
  const dropped = new Set(patch.removeLevels ?? [])
  const added = new Set<string>()
  const roomLevels = new Set([...rooms.map((r) => r.levelId as string), ...(patch.newRooms ?? []).map((r) => r.levelId)])
  for (const nl of (patch.newLevels ?? []).filter((l) => !dropped.has(l.id))) {
    if (levels.some((l) => l.id === nl.id)) throw new PlacementError(`level "${nl.id}" already exists`)
    const storeys = levels.filter((l) => roomLevels.has(l.id as string) || added.has(l.id as string))
    const elev = (l: Json) => l.elevation as number
    const top = (l: Json) => elev(l) + (typeof l.height === 'number' ? l.height : levelHeight)
    let elevation: number
    if (nl.side === 'above') {
      const high = storeys.reduce<Json | null>((m, l) => (!m || elev(l) > elev(m) ? l : m), null)
      elevation = high ? top(high) + slab : 0
      if (high) {
        const roofBase = top(high)
        levels = levels.map((l) => (l !== high && !storeys.includes(l) && elev(l) >= roofBase - 0.01
          ? { ...l, elevation: round4(elev(l) + levelHeight + slab) } : l))
      }
    } else {
      const low = storeys.reduce<Json | null>((m, l) => (!m || elev(l) < elev(m) ? l : m), null)
      elevation = low ? elev(low) - slab - levelHeight : 0
    }
    const level: Json = { id: nl.id, name: nl.name, ...(nl.shortName ? { shortName: nl.shortName } : {}), elevation: round4(elevation), height: levelHeight }
    levels = nl.side === 'above' ? [...levels, level] : [level, ...levels]
    added.add(nl.id)
  }

  // -- pièces qui naissent : leur polygone provisoire est leur relevé, `fitSurvey` le recalcule
  const removed = new Set(patch.removeRooms ?? [])
  for (const nr of patch.newRooms ?? []) {
    if (removed.has(nr.id)) continue
    if (rooms.some((r) => r.id === nr.id)) throw new PlacementError(`room "${nr.id}" already exists`)
    if (!levels.some((l) => l.id === nr.levelId)) throw new PlacementError(`unknown level "${nr.levelId}"`)
    const points = shapes[nr.id]
    if (!points || points.length < 3) throw new PlacementError(`new room "${nr.id}" has no shape`)
    rooms = [...rooms, {
      id: nr.id, levelId: nr.levelId, name: nr.id,
      polygon: surveyPointsToHouse(points, nr.levelId, conv),
      openings: [],
      meta: { survey: { points: points.map((p) => [p[0], p[1]]) } },
    }]
  }

  // -- noms : la propriété, les niveaux (un nom court vide le retire : l'onglet reprend le nom)
  if (patch.propertyName !== undefined) doc.name = patch.propertyName
  for (const [id, ident] of Object.entries(patch.levels ?? {})) {
    if ((patch.removeLevels ?? []).includes(id)) continue
    const i = levels.findIndex((l) => l.id === id)
    if (i < 0) throw new PlacementError(`unknown level "${id}"`)
    const next: Json = { ...levels[i] }
    if (ident.name !== undefined) next.name = ident.name
    if (ident.shortName !== undefined) {
      if (ident.shortName) next.shortName = ident.shortName
      else delete next.shortName
    }
    levels = levels.map((l, k) => (k === i ? next : l))
  }

  // -- nom et type
  for (const [id, ident] of Object.entries(patch.rooms ?? {})) {
    if (removed.has(id)) continue
    const i = rooms.findIndex((r) => r.id === id)
    if (i < 0) throw new PlacementError(`unknown room "${id}"`)
    const next: Json = { ...rooms[i] }
    if (ident.name !== undefined) next.name = ident.name
    if (ident.kind !== undefined) {
      if (ident.kind === 'room' && !('kind' in rooms[i]!)) delete next.kind
      else next.kind = ident.kind
    }
    rooms = rooms.map((r, k) => (k === i ? next : r))
  }

  // -- pièces retirées : leurs appareils restent connus de la maison, sans place dans la scène
  let devices = (Array.isArray(doc.devices) ? doc.devices : []) as Json[]
  let devicesTouched = false
  for (const id of removed) {
    const room = rooms.find((r) => r.id === id)
    if (!room) {
      if ((patch.newRooms ?? []).some((r) => r.id === id)) continue    // née et retirée dans la séance
      throw new PlacementError(`unknown room "${id}"`)
    }
    const openingIds = new Set((Array.isArray(room.openings) ? room.openings as Json[] : []).map((o) => o.id))
    rooms = rooms.filter((r) => r !== room)
    levels = levels.map((l) => (Array.isArray(l.roomOrder) && l.roomOrder.includes(id)
      ? { ...l, roomOrder: (l.roomOrder as string[]).filter((x) => x !== id) } : l))
    devices = devices.map((d) => {
      if (d.roomId === id) {
        devicesTouched = true
        const { position: _p, roomId: _r, levelId: _l, zoneId: _z, openingId: _o, ...rest } = d
        return rest
      }
      if (typeof d.openingId === 'string' && openingIds.has(d.openingId)) {
        devicesTouched = true
        const { openingId: _o, ...rest } = d
        return rest
      }
      return d
    })
  }

  // -- le toit suit le plus haut niveau qui a des pièces murées (avant le contrôle des niveaux
  //    retirés : l'étage qu'on vide puis retire n'est plus celui qui porte le toit)
  let roof = isObject(doc.roof) ? doc.roof : null
  const moved = !!(patch.newLevels?.length || patch.removeLevels?.length || patch.newRooms?.length || removed.size)
  if (roof && moved) {
    const walled = new Set(rooms.filter((r) => WALLED.has((r.kind as string | undefined) ?? 'room')).map((r) => r.levelId))
    const high = levels.filter((l) => walled.has(l.id)).sort((a, b) => (b.elevation as number) - (a.elevation as number))[0]
    if (high && high.id !== roof.levelId) roof = doc.roof = { ...roof, levelId: high.id }
  }

  // -- niveaux retirés : seulement vides (aucune pièce, aucun appareil, champ, place ni toit dessus)
  const site = isObject(doc.site) ? doc.site : {}
  const parkings = (Array.isArray(site.parkings) ? site.parkings : []) as Json[]
  const arrays = (Array.isArray(doc.arrays) ? doc.arrays : []) as Json[]
  for (const id of patch.removeLevels ?? []) {
    if ((patch.newLevels ?? []).some((l) => l.id === id)) continue
    if (!levels.some((l) => l.id === id)) throw new PlacementError(`unknown level "${id}"`)
    const holds = rooms.some((r) => r.levelId === id) || devices.some((d) => d.levelId === id)
      || parkings.some((p) => p.levelId === id) || arrays.some((a) => a.levelId === id) || roof?.levelId === id
    if (holds) { blocking.push(`${id} : niveau non vide`); continue }
    levels = levels.filter((l) => l.id !== id)
  }

  doc.levels = levels
  doc.rooms = rooms
  if (devicesTouched) doc.devices = devices
  return { doc, blocking }
}
