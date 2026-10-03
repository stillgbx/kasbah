// Relevé métré : les COTES d'une pièce sont la donnée de référence, son polygone en est déduit.
//
// `room.meta.survey.points` (unité du relevé, cm par défaut) sont mesurés à l'intérieur des pièces :
// une cloison mitoyenne y est réduite à une seule ligne partagée. Le moteur de murs veut, lui, un
// écart de `t + t'` entre deux faces en vis-à-vis (chaque pièce porte son mur vers l'extérieur,
// cf. doc/2_maison/2_1_geometrie.md). `fitSurvey` recule donc chaque face en vis-à-vis de
// l'épaisseur que le voisin pousse dans elle (`t_voisin × manque / (t + t')`) :
//   - deux pièces murées → demi-cloison chacune, et une surcharge `walls[].thickness` ;
//   - pièce murée ↔ pièce SANS mur (terrasse, balcon, sas) → la pièce murée ne bouge pas et garde sa
//     façade, la pièce sans mur absorbe toute l'épaisseur.
// Les arêtes de façade ne bougent pas : l'emprise du relevé est conservée.
//
// Portage À L'IDENTIQUE de `house/fit-survey.mjs` (qui n'est plus qu'une enveloppe de ce module) :
// même arrondi, mêmes avertissements, même contrôle final. Il travaille sur le JSON BRUT (comme
// `place.ts`) pour ne pas injecter les défauts zod dans le fichier de l'utilisateur.

import type { Vec2 } from './geometry/vec2'

type Json = Record<string, unknown>
interface RawRoom extends Json {
  id: string
  levelId: string
  kind?: string
  polygon: Vec2[]
  walls?: { segment: number; kind?: string; thickness?: number }[]
  meta?: Json & { survey?: { points?: Vec2[] } }
}
interface RawLevel extends Json { id: string; outline?: Vec2[] }
/** Ce que le calcul lit d'une maison (JSON brut ou maison parsée). */
export interface SurveyDoc extends Json {
  rooms: RawRoom[]
  levels: RawLevel[]
  defaults?: { interiorWallThickness?: number; exteriorWallThickness?: number }
  meta?: Json & { survey?: SurveyConventions }
}
export interface SurveyConventions {
  unit?: 'cm' | 'mm' | 'm'
  /** Cloison complète entre deux pièces murées (m) ; chacune en porte la moitié. */
  partition?: number
  /** Correction du repère d'une campagne, par niveau (unité du relevé). */
  levelOffsets?: Record<string, Vec2>
  [k: string]: unknown
}

/** Mêmes pièces murées que `WALLED_KINDS` (geometry/walls.ts). */
const WALLED = new Set(['room', 'corridor', 'stairs', 'garage'])

const EPS = 1e-9
const round = (v: number) => Math.round(v * 1e4) / 1e4
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
const len = (a: Vec2) => Math.hypot(a[0], a[1])
const signedArea = (p: readonly Vec2[]) => p.reduce((s, a, i) => s + cross(a, p[(i + 1) % p.length]!), 0) / 2

interface Edge { a: Vec2; b: Vec2; d: Vec2; n: Vec2; L: number }
/** Arêtes orientées d'un polygone CCW : direction unitaire `d` et normale extérieure `n`. */
export function surveyEdges(poly: readonly Vec2[]): Edge[] {
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!
    const L = len(sub(b, a))
    const d: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
    return { a, b, d, n: [d[1], -d[0]], L }
  })
}

/** Rentre chaque arête de `inset[i]`, sommets à l'intersection des droites décalées voisines. */
function insetPolygon(poly: readonly Vec2[], inset: readonly number[]): Vec2[] {
  const es = surveyEdges(poly)
  const n = poly.length
  return poly.map((_, i) => {
    const prev = es[(i - 1 + n) % n]!
    const cur = es[i]!
    const pi = inset[(i - 1 + n) % n]!, ci = inset[i]!
    const p0: Vec2 = [prev.a[0] - prev.n[0] * pi, prev.a[1] - prev.n[1] * pi]
    const p1: Vec2 = [cur.a[0] - cur.n[0] * ci, cur.a[1] - cur.n[1] * ci]
    const den = cross(prev.d, cur.d)
    if (Math.abs(den) < EPS) return [round(p1[0]), round(p1[1])]   // arêtes colinéaires
    const t = cross(sub(p1, p0), cur.d) / den
    return [round(p0[0] + prev.d[0] * t), round(p0[1] + prev.d[1] * t)]
  })
}

interface Fit { id: string; levelId: string; walled: boolean; poly: Vec2[] }
interface Facing { other: Fit; gap: number; lo: number; hi: number }

/** Pièces dont une arête antiparallèle fait face à `e`, avec l'écart mesuré et le recouvrement. */
function facingRooms(e: Edge, others: readonly Fit[]): Facing[] {
  const out: Facing[] = []
  for (const other of others) {
    for (const o of surveyEdges(other.poly)) {
      if (dot(e.d, o.d) > -0.999) continue
      const u = (p: Vec2) => dot(sub(p, e.a), e.d)
      const lo = Math.max(0, Math.min(u(o.a), u(o.b)))
      const hi = Math.min(e.L, Math.max(u(o.a), u(o.b)))
      if (hi - lo < 0.01) continue
      const gap = dot(sub(o.a, e.a), e.n)
      if (gap < -0.01 || gap > 1) continue
      out.push({ other, gap, lo, hi })
    }
  }
  return out
}

/** Longueur d'arête effectivement couverte par des vis-à-vis (union des recouvrements). */
function covered(facings: readonly Facing[]): number {
  const spans = facings.map(({ lo, hi }) => [lo, hi] as const).sort((a, b) => a[0] - b[0])
  let total = 0, end = -Infinity
  for (const [lo, hi] of spans) {
    if (hi <= end) continue
    total += hi - Math.max(lo, end)
    end = hi
  }
  return total
}

const unitOf = (c: SurveyConventions) => (c.unit === 'cm' ? 0.01 : c.unit === 'mm' ? 0.001 : 1)

/** Les points bruts d'une pièce, en mètres dans le repère de la maison (décalage de niveau appliqué). */
export function surveyPointsToHouse(points: readonly Vec2[], levelId: string, conv: SurveyConventions): Vec2[] {
  const [dx, dy] = conv.levelOffsets?.[levelId] ?? [0, 0]
  const unit = unitOf(conv)
  return points.map(([x, y]) => [round((x + dx) * unit), round((y + dy) * unit)])
}
/** L'inverse : un point en mètres de la maison vers l'unité et le repère du relevé (arrondi 0,01 unité). */
export function houseToSurveyPoint(p: Vec2, levelId: string, conv: SurveyConventions): Vec2 {
  const [dx, dy] = conv.levelOffsets?.[levelId] ?? [0, 0]
  const unit = unitOf(conv)
  const r = (v: number) => Math.round(v * 100) / 100
  return [r(p[0] / unit - dx), r(p[1] / unit - dy)]
}

export interface SurveyReport { id: string; levelId: string; brut: number; fini: number; inset: number; mitoyen: number; total: number }
export interface FitResult<T> {
  /** Copie du document, polygones, surcharges mitoyennes et emprises des niveaux relevés recalculés. */
  doc: T
  /** Polygones ou emprises qui ont changé. */
  changed: number
  report: SurveyReport[]
  /** Arêtes à couper (mitoyennes ET en façade) : signalées, pas bloquantes. */
  warnings: string[]
  /** Vis-à-vis plus serrés que l'épaisseur requise : la maison n'est pas constructible. */
  problems: string[]
  /** Emprises de niveau réécrites (pour le compte rendu du script). */
  outlines: { levelId: string; outline: Vec2[] }[]
}

/**
 * Recalcule, depuis `meta.survey.points`, le polygone de chaque pièce relevée, ses surcharges de
 * murs mitoyens et l'emprise (`outline`) des niveaux relevés. Ne modifie pas `doc`.
 */
export function fitSurvey<T extends SurveyDoc>(input: T): FitResult<T> {
  const house = JSON.parse(JSON.stringify(input)) as SurveyDoc
  const conv: SurveyConventions = house.meta?.survey ?? {}
  const partition = conv.partition ?? 2 * (house.defaults?.interiorWallThickness ?? 0.1)
  const half = round(partition / 2)
  const ext = house.defaults?.exteriorWallThickness ?? 0.3
  const surveyed = house.rooms.filter((r) => r.meta?.survey?.points)
  const empty: FitResult<T> = { doc: house as T, changed: 0, report: [], warnings: [], problems: [], outlines: [] }
  if (!surveyed.length) return empty

  /** Épaisseur que `self` porte sur une arête faisant face à `other` (0 si `self` n'a pas de mur). */
  const thicknessAgainst = (self: Fit, other: Fit) => (!self.walled ? 0 : other.walled ? half : ext)
  const raw = new Map<string, Fit>(surveyed.map((r) => [r.id, {
    id: r.id, levelId: r.levelId, walled: WALLED.has(r.kind ?? 'room'),
    poly: surveyPointsToHouse(r.meta!.survey!.points!, r.levelId, conv),
  }]))

  let changed = 0
  const report: SurveyReport[] = []
  const warnings: string[] = []
  for (const room of surveyed) {
    const self = raw.get(room.id)!
    if (signedArea(self.poly) <= 0) throw new SurveyError(`${room.id} : relevé non CCW (${signedArea(self.poly).toFixed(2)} m²) — inverser les points`)
    const others = [...raw.values()].filter((r) => r.id !== room.id && r.levelId === room.levelId)
    const es = surveyEdges(self.poly)
    const facing = es.map((e) => facingRooms(e, others))
    // Le calcul POSSÈDE les surcharges `interior` (régénérées à chaque passage) ; seules celles qu'il
    // ne sait pas déduire sont gardées : `none` (passage ouvert) et `exterior` (façade forcée).
    const kept = new Map((room.walls ?? [])
      .filter((w) => w.kind === 'none' || w.kind === 'exterior')
      .map((w) => [w.segment, { segment: w.segment, kind: w.kind, ...(w.thickness == null ? {} : { thickness: w.thickness }) }]))
    // Un PASSAGE OUVERT n'a pas de cloison : son arête ne recule pas (ajout au script d'origine,
    // sans effet sur une maison qui n'en déclare aucun — la maison de démo en a un).
    const open = (i: number) => kept.get(i)?.kind === 'none'
    const inset = facing.map((fs, i) => open(i) ? 0 : round(Math.max(0, ...fs.map(({ other, gap }) => {
      const t = thicknessAgainst(self, other), t2 = thicknessAgainst(other, self)
      return t + t2 > EPS ? (t2 * Math.max(0, t + t2 - gap)) / (t + t2) : 0
    }))))
    // Un alignement droit reste droit : une arête coupée en deux (partie mitoyenne + partie
    // façade, cas d'un décroché) prend le rentrement de sa portion la plus rentrée.
    for (let pass = 0; pass < inset.length; pass++) {
      for (let i = 0; i < inset.length; i++) {
        const j = (i + 1) % inset.length
        if (Math.abs(cross(es[i]!.d, es[j]!.d)) > EPS || dot(es[i]!.d, es[j]!.d) < 0) continue
        const m = Math.max(inset[i]!, inset[j]!)
        inset[i] = m; inset[j] = m
      }
    }
    const poly = insetPolygon(self.poly, inset)

    const walls = poly
      .map((_, i) => {
        if (!self.walled || open(i)) return kept.get(i)
        const mitoyen = facing[i]!.filter(({ other }) => other.walled)
        if (!mitoyen.length) return kept.get(i)
        const free = round(es[i]!.L - covered(mitoyen))
        if (free > partition) {
          warnings.push(`${room.id} arête ${i} (${es[i]!.L.toFixed(2)} m) : mitoyenne ET en façade sur ` +
            `${(free * 100).toFixed(0)} cm — couper l'arête en ajoutant un point colinéaire au relevé`)
        }
        return { segment: i, kind: 'interior', thickness: half, ...kept.get(i) }
      })
      .filter((w): w is NonNullable<typeof w> => !!w)

    const before = JSON.stringify([room.polygon, room.walls ?? null])
    room.polygon = poly
    if (walls.length) room.walls = walls
    else delete room.walls
    if (before !== JSON.stringify([room.polygon, room.walls ?? null])) changed++

    // Ordre de clés lisible (walls juste avant openings, meta en dernier).
    const order = ['id', 'levelId', 'name', 'polygon', 'kind', 'height', 'walls', 'openings', 'style', 'meta']
    const keys = [...order.filter((k) => k in room), ...Object.keys(room).filter((k) => !order.includes(k))]
    house.rooms[house.rooms.indexOf(room)] = Object.fromEntries(keys.map((k) => [k, room[k]])) as RawRoom

    report.push({
      id: room.id, levelId: room.levelId, brut: signedArea(self.poly), fini: signedArea(poly),
      inset: inset.filter(Boolean).length, mitoyen: walls.filter((w) => w.thickness).length, total: inset.length,
    })
  }

  // Emprise de chaque niveau relevé = boîte des pièces MURÉES, élargie du mur extérieur.
  const outlines: { levelId: string; outline: Vec2[] }[] = []
  for (const level of house.levels) {
    const polys = [...raw.values()].filter((r) => r.levelId === level.id && r.walled).map((r) => r.poly)
    if (!polys.length) continue
    const xs = polys.flat().map((p) => p[0]), ys = polys.flat().map((p) => p[1])
    const outline: Vec2[] = [
      [round(Math.min(...xs) - ext), round(Math.min(...ys) - ext)],
      [round(Math.max(...xs) + ext), round(Math.min(...ys) - ext)],
      [round(Math.max(...xs) + ext), round(Math.max(...ys) + ext)],
      [round(Math.min(...xs) - ext), round(Math.max(...ys) + ext)],
    ]
    if (JSON.stringify(level.outline) !== JSON.stringify(outline)) {
      level.outline = outline
      changed++
      outlines.push({ levelId: level.id, outline })
    }
  }

  // Contrôle : plus aucune paire de faces en vis-à-vis en dessous de l'écart requis.
  const byId = new Map(house.rooms.map((r) => [r.id, r]))
  const fitted = new Map(surveyed.map((r) => [r.id, { ...raw.get(r.id)!, poly: byId.get(r.id)!.polygon }]))
  const problems: string[] = []
  for (const room of surveyed) {
    const self = fitted.get(room.id)!
    const others = [...fitted.values()].filter((r) => r.id !== room.id && r.levelId === room.levelId)
    const openEdges = new Set((byId.get(room.id)!.walls ?? []).filter((w) => w.kind === 'none').map((w) => w.segment))
    for (const [i, e] of surveyEdges(self.poly).entries()) {
      if (openEdges.has(i)) continue                     // passage ouvert : aucun écart requis
      for (const { other, gap } of facingRooms(e, others)) {
        const need = thicknessAgainst(self, other) + thicknessAgainst(other, self)
        if (gap < need - 1e-3) problems.push(`${room.id} ↔ ${other.id} : écart ${(gap * 100).toFixed(1)} cm < ${(need * 100).toFixed(0)} cm`)
      }
    }
  }
  return { doc: house as T, changed, report, warnings: [...new Set(warnings)], problems: [...new Set(problems)], outlines }
}

export class SurveyError extends Error {
  readonly statusCode = 400
  readonly code = 'INVALID_SURVEY'
  constructor(message: string) { super(message); this.name = 'SurveyError' }
}

/** Deux segments qui se coupent en un point intérieur à chacun (pas un simple contact). */
function crosses(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const d1 = cross(sub(p2, p1), sub(q1, p1)), d2 = cross(sub(p2, p1), sub(q2, p1))
  const d3 = cross(sub(q2, q1), sub(p1, q1)), d4 = cross(sub(q2, q1), sub(p2, q1))
  return d1 * d2 < 0 && d3 * d4 < 0
}
function inside(p: Vec2, poly: readonly Vec2[]): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c
  }
  return c
}

/**
 * Pièces d'un même niveau qui se CHEVAUCHENT (faces finies resserrées d'1 cm : deux pièces qui se
 * touchent par un passage ouvert, ou séparées par leur cloison, ne comptent pas). Le contrôle de
 * `fitSurvey` ne voit que les faces en vis-à-vis : une pièce poussée au travers de sa voisine lui
 * échappait.
 */
export function overlappingRooms(doc: Pick<SurveyDoc, 'rooms'>): string[] {
  const shrunk = doc.rooms.map((r) => ({ r, p: insetPolygon(r.polygon, r.polygon.map(() => 0.01)) }))
  const out: string[] = []
  for (let i = 0; i < shrunk.length; i++) {
    for (let j = i + 1; j < shrunk.length; j++) {
      const a = shrunk[i]!, b = shrunk[j]!
      if (a.r.levelId !== b.r.levelId) continue
      const hit = a.p.some((p) => inside(p, b.p)) || b.p.some((p) => inside(p, a.p))
        || a.p.some((p, k) => b.p.some((q, l) => crosses(p, a.p[(k + 1) % a.p.length]!, q, b.p[(l + 1) % b.p.length]!)))
      if (hit) out.push(`${a.r.id} ↔ ${b.r.id} : les pièces se chevauchent`)
    }
  }
  return out
}
