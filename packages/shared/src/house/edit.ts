import { z } from 'zod'
import { vec2Schema } from './schema'
import { appearancePatchSchema, applyAppearanceToJson } from './appearance'
import { fitSurvey, houseToSurveyPoint, overlappingRooms, surveyEdges, surveyPointsToHouse, type SurveyConventions, type SurveyDoc } from './survey'
import { PlacementError } from './place'
import { applyStructureToJson, structurePatchShape, structureReshapes } from './structure'
import type { Vec2 } from './geometry/vec2'

// Une SÉANCE d'édition de la maison, écrite d'un coup par « Valider » : l'apparence (finitions), la
// FORME des pièces (leurs cotes) et la STRUCTURE (pièces et niveaux qui naissent ou disparaissent,
// nom et type d'une pièce, `structure.ts`). Un seul patch, un seul brouillon côté écran, une seule
// route (`PUT /api/house/edit`).
//
// La forme s'écrit en COTES (`meta.survey.points`, unité du relevé) : le polygone, les murs
// mitoyens et l'emprise des niveaux en sont recalculés par `fitSurvey`, et les ouvertures de chaque
// pièce dont le polygone change sont recalées à leur place réelle sur leur mur.

export const houseEditPatchSchema = z.object({
  appearance: appearancePatchSchema.optional(),
  /** Nouvelles cotes, par pièce (unité et repère du relevé : `house.meta.survey`). */
  shapes: z.record(z.string().min(1), z.array(vec2Schema).min(3)).optional(),
  ...structurePatchShape,
})
export type HouseEditPatch = z.infer<typeof houseEditPatchSchema>

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const round4 = (v: number) => Math.round(v * 1e4) / 1e4

/** Conventions d'une maison qui n'a jamais été relevée : centimètres, cloison = deux murs intérieurs. */
function defaultConventions(doc: SurveyDoc): SurveyConventions {
  return { unit: 'cm', partition: round4(2 * (doc.defaults?.interiorWallThickness ?? 0.1)) }
}

/**
 * Donne des COTES à chaque pièce qui n'en a pas, par le calcul inverse de `fitSurvey` : chaque arête
 * mitoyenne est repoussée de la moitié de l'écart (deux pièces murées dos à dos), l'arête d'une pièce
 * sans mur qui touche une façade est repoussée jusqu'à la face intérieure de la pièce murée. Une
 * maison convertie redonne exactement ses polygones par `fitSurvey` (vérifié par les tests).
 */
export function withSurveyPoints<T extends SurveyDoc>(input: T): T {
  if (input.rooms.every((r) => r.meta?.survey?.points)) return input
  const doc = JSON.parse(JSON.stringify(input)) as SurveyDoc
  const meta: Json = isObject(doc.meta) ? doc.meta : {}
  const conv: SurveyConventions = isObject(meta.survey) ? (meta.survey as SurveyConventions) : defaultConventions(doc)
  doc.meta = { ...meta, survey: conv }
  const walled = new Set(['room', 'corridor', 'stairs', 'garage'])
  const half = round4((conv.partition ?? 2 * (doc.defaults?.interiorWallThickness ?? 0.1)) / 2)
  const ext = doc.defaults?.exteriorWallThickness ?? 0.3
  for (const room of doc.rooms) {
    if (room.meta?.survey?.points) continue
    const self = walled.has(room.kind ?? 'room')
    const es = surveyEdges(room.polygon)
    const others = doc.rooms.filter((r) => r !== room && r.levelId === room.levelId)
    const out = es.map((e) => {
      let push = 0
      for (const other of others) {
        const otherWalled = walled.has(other.kind ?? 'room')
        for (const o of surveyEdges(other.polygon)) {
          if (e.d[0] * o.d[0] + e.d[1] * o.d[1] > -0.999) continue
          const u = (p: Vec2) => (p[0] - e.a[0]) * e.d[0] + (p[1] - e.a[1]) * e.d[1]
          const lo = Math.max(0, Math.min(u(o.a), u(o.b))), hi = Math.min(e.L, Math.max(u(o.a), u(o.b)))
          if (hi - lo < 0.01) continue
          const gap = (o.a[0] - e.a[0]) * e.n[0] + (o.a[1] - e.a[1]) * e.n[1]
          if (gap < -0.01 || gap > 1) continue
          if (self && otherWalled && gap <= 2 * half + 0.01) push = Math.max(push, gap / 2)
          else if (!self && otherWalled && gap <= ext + 0.01) push = Math.max(push, gap)
        }
      }
      return push
    })
    // la règle de `fitSurvey` : deux arêtes consécutives alignées prennent le même rentrement
    for (let pass = 0; pass < out.length; pass++) {
      for (let i = 0; i < out.length; i++) {
        const j = (i + 1) % out.length
        const a = es[i]!.d, b = es[j]!.d
        if (Math.abs(a[0] * b[1] - a[1] * b[0]) > 1e-9 || a[0] * b[0] + a[1] * b[1] < 0) continue
        const m = Math.max(out[i]!, out[j]!)
        out[i] = m; out[j] = m
      }
    }
    const raw = offsetEdges(room.polygon, out)
    room.meta = { ...room.meta, survey: { points: raw.map((p) => houseToSurveyPoint(p, room.levelId, conv)) } }
  }
  return doc as T
}

/** Repousse chaque arête de `push[i]` vers l'extérieur (sommets à l'intersection des droites voisines). */
function offsetEdges(poly: readonly Vec2[], push: readonly number[]): Vec2[] {
  const es = surveyEdges(poly)
  const n = poly.length
  return poly.map((_, i) => {
    const prev = es[(i - 1 + n) % n]!, cur = es[i]!
    const pp = push[(i - 1 + n) % n]!, cp = push[i]!
    const p0: Vec2 = [prev.a[0] + prev.n[0] * pp, prev.a[1] + prev.n[1] * pp]
    const p1: Vec2 = [cur.a[0] + cur.n[0] * cp, cur.a[1] + cur.n[1] * cp]
    const den = prev.d[0] * cur.d[1] - prev.d[1] * cur.d[0]
    if (Math.abs(den) < 1e-9) return p1
    const t = ((p1[0] - p0[0]) * cur.d[1] - (p1[1] - p0[1]) * cur.d[0]) / den
    return [p0[0] + prev.d[0] * t, p0[1] + prev.d[1] * t]
  })
}

/**
 * L'arête de `next` qui prolonge l'arête `seg` de `prev` : même sens, et la plus proche du point
 * `at` (sur la droite, puis hors de l'arête). `-1` si aucune arête n'a plus ce sens.
 */
function matchEdge(prev: readonly Vec2[], seg: number, next: readonly Vec2[], at: Vec2): number {
  const d = surveyEdges(prev)[seg]?.d
  if (!d) return -1
  let best = -1, bestCost = Infinity
  surveyEdges(next).forEach((e, j) => {
    if (e.d[0] * d[0] + e.d[1] * d[1] < 0.999) return
    const off = Math.abs((at[0] - e.a[0]) * e.n[0] + (at[1] - e.a[1]) * e.n[1])
    const u = (at[0] - e.a[0]) * e.d[0] + (at[1] - e.a[1]) * e.d[1]
    const out = u < 0 ? -u : u > e.L ? u - e.L : 0
    const cost = off + out + (j === seg && prev.length === next.length ? -1e-6 : 0)
    if (cost < bestCost) { bestCost = cost; best = j }
  })
  return best
}

/**
 * Recale les ouvertures MURALES d'une pièce dont le polygone a changé : chacune garde sa place
 * réelle (son centre, projeté sur l'arête qui prolonge son ancien mur), pas sa distance au coin —
 * pousser le mur voisin ne la fait pas glisser. Aucune n'est rognée : une ouverture qui ne tient
 * plus est refusée par la validation de la maison, et l'écran le dit.
 */
function remapOpenings(room: Json, prev: readonly Vec2[], next: readonly Vec2[]): Json {
  if (!Array.isArray(room.openings)) return room
  const es = surveyEdges(prev)
  const openings = (room.openings as Json[]).map((o) => {
    if (typeof o.segment !== 'number' || typeof o.offset !== 'number' || typeof o.width !== 'number') return o
    const e = es[o.segment]
    if (!e) return o
    const c: Vec2 = [e.a[0] + e.d[0] * (o.offset + o.width / 2), e.a[1] + e.d[1] * (o.offset + o.width / 2)]
    const j = matchEdge(prev, o.segment, next, c)
    if (j < 0) return o
    const ne = surveyEdges(next)[j]!
    const u = (c[0] - ne.a[0]) * ne.d[0] + (c[1] - ne.a[1]) * ne.d[1]
    return { ...o, segment: j, offset: round4(u - o.width / 2) }
  })
  return { ...room, openings }
}

/** Les surcharges que `fitSurvey` garde (`none`, `exterior`) suivent leur arête quand on ajoute ou retire un sommet. */
function remapKeptWalls(room: Json, prevRaw: readonly Vec2[], nextRaw: readonly Vec2[]): Json {
  if (!Array.isArray(room.walls) || prevRaw.length === nextRaw.length) return room
  const es = surveyEdges(prevRaw)
  const walls = (room.walls as Json[]).flatMap((w) => {
    if (w.kind !== 'none' && w.kind !== 'exterior') return [w]
    const e = es[w.segment as number]
    if (!e) return []
    const j = matchEdge(prevRaw, w.segment as number, nextRaw, [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2])
    return j < 0 ? [] : [{ ...w, segment: j }]
  })
  return { ...room, walls }
}

export interface HouseEditResult<T> {
  doc: T
  /** Ce qui empêche d'écrire (vis-à-vis trop serré, relevé retourné) : « Valider » reste grisé. */
  blocking: string[]
  /** À signaler sans bloquer (arête mitoyenne ET en façade). */
  warnings: string[]
}

/**
 * Applique une séance d'édition. Ne lève que pour une pièce inconnue (`PlacementError`) ; ce qui
 * rend la maison inconstructible est rendu dans `blocking` — le serveur refuse alors d'écrire, l'écran
 * l'affiche. La validation complète (ouvertures qui ne tiennent plus…) reste celle de `parseHouse`.
 */
export function applyHouseEditToJson<T>(input: T, patch: HouseEditPatch): HouseEditResult<T> {
  if (!isObject(input)) throw new PlacementError('house document is not an object')
  // ce que la séance dit d'une pièce qu'elle retire ne compte plus (ses cotes, ses finitions)
  const removed = new Set(patch.removeRooms ?? [])
  const shapes = Object.entries(patch.shapes ?? {}).filter(([id]) => !removed.has(id))
  const reshape = shapes.length > 0 || structureReshapes(patch)
  // une pièce qui naît s'écrit en cotes : la maison est convertie en relevé AVANT
  let doc: unknown = reshape ? withSurveyPoints(input as unknown as SurveyDoc) : input
  const structure = applyStructureToJson(doc as Json, patch, Object.fromEntries(shapes), (doc as SurveyDoc).meta?.survey ?? {})
  doc = structure.doc
  const appearance = patch.appearance?.rooms
    ? { ...patch.appearance, rooms: Object.fromEntries(Object.entries(patch.appearance.rooms).filter(([id]) => !removed.has(id))) }
    : patch.appearance
  if (appearance) doc = applyAppearanceToJson(doc, appearance)
  if (!reshape) return { doc: doc as T, blocking: structure.blocking, warnings: [] }
  const base = doc as SurveyDoc
  const known = new Set(base.rooms.map((r) => r.id))
  for (const [id] of shapes) if (!known.has(id)) throw new PlacementError(`unknown room "${id}"`)
  const conv: SurveyConventions = base.meta?.survey ?? {}
  const prevPoly = new Map(base.rooms.map((r) => [r.id, r.polygon]))
  const changedShapes = new Map(shapes)
  doc = {
    ...base,
    rooms: base.rooms.map((r) => {
      const points = changedShapes.get(r.id)
      if (!points) return r
      const prevRaw = surveyPointsToHouse(r.meta!.survey!.points!, r.levelId, conv)
      const nextRaw = surveyPointsToHouse(points, r.levelId, conv)
      const moved = remapKeptWalls(r, prevRaw, nextRaw)
      return { ...moved, meta: { ...r.meta, survey: { ...r.meta?.survey, points: points.map((p) => [p[0], p[1]]) } } }
    }),
  }
  let fit
  try { fit = fitSurvey(doc as SurveyDoc) } catch (err) { return { doc: doc as T, blocking: [...structure.blocking, (err as Error).message], warnings: [] } }
  const rooms = fit.doc.rooms.map((r) => {
    const prev = prevPoly.get(r.id)
    return prev && JSON.stringify(prev) !== JSON.stringify(r.polygon) ? remapOpenings(r, prev, r.polygon) : r
  })
  return { doc: { ...fit.doc, rooms } as T, blocking: [...structure.blocking, ...fit.problems, ...overlappingRooms({ rooms: rooms as SurveyDoc['rooms'] })], warnings: fit.warnings }
}
