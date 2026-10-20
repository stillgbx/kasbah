// Measured survey: the MEASUREMENTS of a room are the reference data, its polygon is deduced from them.
//
// `room.meta.survey.points` (survey unit, cm by default) are measured inside the rooms:
// a shared partition is reduced there to a single shared line. The wall engine, for its part, wants a
// gap of `t + t'` between two facing faces (each room carries its wall toward the outside,
// cf. doc/2_maison/2_1_geometrie.md). `fitSurvey` therefore pulls back each facing face by
// the thickness that the neighbor pushes into it (`t_neighbor × missing / (t + t')`):
//   - two walled rooms → a half-partition each, and a `walls[].thickness` override;
//   - walled room ↔ room WITHOUT walls (terrace, balcony, airlock) → the walled room does not move and keeps its
//     facade, the room without walls absorbs the whole thickness.
// The facade edges do not move: the footprint of the survey is preserved.
//
// IDENTICAL port of `house/fit-survey.mjs` (which is now only a wrapper of this module):
// same rounding, same warnings, same final check. It works on the RAW JSON (like
// `place.ts`) so as not to inject the zod defaults into the user's file.

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
/** What the computation reads from a house (raw JSON or parsed house). */
export interface SurveyDoc extends Json {
  rooms: RawRoom[]
  levels: RawLevel[]
  defaults?: { interiorWallThickness?: number; exteriorWallThickness?: number }
  meta?: Json & { survey?: SurveyConventions }
}
export interface SurveyConventions {
  unit?: 'cm' | 'mm' | 'm'
  /** Full partition between two walled rooms (m); each carries half of it. */
  partition?: number
  /** Correction of the reference frame of a campaign, per level (survey unit). */
  levelOffsets?: Record<string, Vec2>
  [k: string]: unknown
}

/** Same walled rooms as `WALLED_KINDS` (geometry/walls.ts). */
const WALLED = new Set(['room', 'corridor', 'stairs', 'garage'])

const EPS = 1e-9
const round = (v: number) => Math.round(v * 1e4) / 1e4
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
const len = (a: Vec2) => Math.hypot(a[0], a[1])
const signedArea = (p: readonly Vec2[]) => p.reduce((s, a, i) => s + cross(a, p[(i + 1) % p.length]!), 0) / 2

interface Edge { a: Vec2; b: Vec2; d: Vec2; n: Vec2; L: number }
/** Oriented edges of a CCW polygon: unit direction `d` and outward normal `n`. */
export function surveyEdges(poly: readonly Vec2[]): Edge[] {
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!
    const L = len(sub(b, a))
    const d: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
    return { a, b, d, n: [d[1], -d[0]], L }
  })
}

/** Insets each edge by `inset[i]`, vertices at the intersection of the neighboring offset lines. */
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
    if (Math.abs(den) < EPS) return [round(p1[0]), round(p1[1])]   // collinear edges
    const t = cross(sub(p1, p0), cur.d) / den
    return [round(p0[0] + prev.d[0] * t), round(p0[1] + prev.d[1] * t)]
  })
}

interface Fit { id: string; levelId: string; walled: boolean; poly: Vec2[] }
interface Facing { other: Fit; gap: number; lo: number; hi: number }

/** Rooms of which an antiparallel edge faces `e`, with the measured gap and the overlap. */
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

/** Edge length actually covered by facing edges (union of the overlaps). */
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

/** The raw points of a room, in meters in the house reference frame (level offset applied). */
export function surveyPointsToHouse(points: readonly Vec2[], levelId: string, conv: SurveyConventions): Vec2[] {
  const [dx, dy] = conv.levelOffsets?.[levelId] ?? [0, 0]
  const unit = unitOf(conv)
  return points.map(([x, y]) => [round((x + dx) * unit), round((y + dy) * unit)])
}
/** The inverse: a point in house meters to the unit and reference frame of the survey (rounded to 0.01 unit). */
export function houseToSurveyPoint(p: Vec2, levelId: string, conv: SurveyConventions): Vec2 {
  const [dx, dy] = conv.levelOffsets?.[levelId] ?? [0, 0]
  const unit = unitOf(conv)
  const r = (v: number) => Math.round(v * 100) / 100
  return [r(p[0] / unit - dx), r(p[1] / unit - dy)]
}

export interface SurveyReport { id: string; levelId: string; brut: number; fini: number; inset: number; mitoyen: number; total: number }
export interface FitResult<T> {
  /** Copy of the document, polygons, shared overrides and footprints of the surveyed levels recomputed. */
  doc: T
  /** Polygons or footprints that changed. */
  changed: number
  report: SurveyReport[]
  /** Edges to cut (shared AND on the facade): flagged, not blocking. */
  warnings: string[]
  /** Facing gaps tighter than the required thickness: the house is not buildable. */
  problems: string[]
  /** Level footprints rewritten (for the script's report). */
  outlines: { levelId: string; outline: Vec2[] }[]
}

/**
 * Recomputes, from `meta.survey.points`, the polygon of each surveyed room, its shared-wall overrides and the
 * footprint (`outline`) of the surveyed levels. Does not modify `doc`.
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

  /** Thickness that `self` carries on an edge facing `other` (0 if `self` has no wall). */
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
    // The computation OWNS the `interior` overrides (regenerated at every pass); only those it
    // cannot deduce are kept: `none` (open passage) and `exterior` (forced facade).
    const kept = new Map((room.walls ?? [])
      .filter((w) => w.kind === 'none' || w.kind === 'exterior')
      .map((w) => [w.segment, { segment: w.segment, kind: w.kind, ...(w.thickness == null ? {} : { thickness: w.thickness }) }]))
    // An OPEN PASSAGE has no partition: its edge does not pull back (addition to the original script,
    // no effect on a house that declares none — the demo house has one).
    const open = (i: number) => kept.get(i)?.kind === 'none'
    const inset = facing.map((fs, i) => open(i) ? 0 : round(Math.max(0, ...fs.map(({ other, gap }) => {
      const t = thicknessAgainst(self, other), t2 = thicknessAgainst(other, self)
      return t + t2 > EPS ? (t2 * Math.max(0, t + t2 - gap)) / (t + t2) : 0
    }))))
    // A straight alignment stays straight: an edge cut in two (shared part + facade
    // part, the case of a step) takes the inset of its most inset portion.
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

    // Readable key order (walls just before openings, meta last).
    const order = ['id', 'levelId', 'name', 'polygon', 'kind', 'height', 'walls', 'openings', 'style', 'meta']
    const keys = [...order.filter((k) => k in room), ...Object.keys(room).filter((k) => !order.includes(k))]
    house.rooms[house.rooms.indexOf(room)] = Object.fromEntries(keys.map((k) => [k, room[k]])) as RawRoom

    report.push({
      id: room.id, levelId: room.levelId, brut: signedArea(self.poly), fini: signedArea(poly),
      inset: inset.filter(Boolean).length, mitoyen: walls.filter((w) => w.thickness).length, total: inset.length,
    })
  }

  // Footprint of each surveyed level = box of the WALLED rooms, enlarged by the exterior wall.
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

  // Check: no pair of facing faces left below the required gap.
  const byId = new Map(house.rooms.map((r) => [r.id, r]))
  const fitted = new Map(surveyed.map((r) => [r.id, { ...raw.get(r.id)!, poly: byId.get(r.id)!.polygon }]))
  const problems: string[] = []
  for (const room of surveyed) {
    const self = fitted.get(room.id)!
    const others = [...fitted.values()].filter((r) => r.id !== room.id && r.levelId === room.levelId)
    const openEdges = new Set((byId.get(room.id)!.walls ?? []).filter((w) => w.kind === 'none').map((w) => w.segment))
    for (const [i, e] of surveyEdges(self.poly).entries()) {
      if (openEdges.has(i)) continue                     // open passage: no gap required
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

/** Two segments that cross at a point interior to each of them (not a mere contact). */
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
 * Rooms of a same level that OVERLAP (finished faces tightened by 1 cm: two rooms that
 * touch through an open passage, or separated by their partition, do not count). The check of
 * `fitSurvey` only sees facing faces: a room pushed through its neighbor
 * escaped it.
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
