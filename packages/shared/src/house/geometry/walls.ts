import type { HouseDefaults } from '../defaults'
import type { Level, Opening, Room, WallKind } from '../schema'
import type { OpeningRect, WallPrism } from './types'
import { add, clipConvex, cross, dot, isConvex, lineIntersect, normalize, perpRight, pointInPolygon, scale, signedArea, sub, type Vec2 } from './vec2'

// Murs : chaque pièce porte ses propres murs vers l'EXTÉRIEUR de sa face intérieure.
// Deux pièces adjacentes s'écrivent avec un écart = t + t' ; chaque côté remplit sa moitié.
// Pas de CSG ni de Shape à trous : on découpe chaque mur le long de sa longueur autour des
// ouvertures en quads convexes (mitrés aux coins), extrudés vers le haut. Robuste et rapide.

const EPS = 1e-6
const MIRROR_TOL = 0.02          // tolérance (m) sur l'écart t + t' entre faces en vis-à-vis
const PROBE_MARGIN = 0.05
const MAX_MITER_FACTOR = 3
const OVERLAP_MIN_AREA = 1e-4    // m² de recouvrement sous lesquels rien ne se voit
const TRIM_EPS = 1e-4

export interface WallSegment {
  index: number
  a: Vec2
  b: Vec2
  d: Vec2          // direction unitaire a → b
  n: Vec2          // normale extérieure unitaire
  L: number
  kind: WallKind
  thickness: number
}

export interface Hole {
  u0: number
  u1: number
  z0: number
  z1: number
  openingId: string
  mirrored: boolean
}

export const WALLED_KINDS: ReadonlySet<Room['kind']> = new Set(['room', 'corridor', 'stairs', 'garage'])
export const isWalled = (room: Room) => WALLED_KINDS.has(room.kind)

export function roomHeight(room: Room, level: Level, defaults: HouseDefaults): number {
  return room.height ?? level.height ?? defaults.levelHeight
}

/**
 * Hauteur d'un MUR, qui n'est pas celle de la pièce. `room.height` décrit le PLAFOND : c'est
 * lui qu'`autoplace` utilise pour accrocher un plafonnier, lui que `validate` compare à une
 * ouverture. Une cloison le suit. Une FAÇADE, elle, appartient à l'enveloppe du bâtiment : un
 * plafond plus bas ne la fait pas redescendre, sinon le mur extérieur marche d'une pièce à
 * l'autre (relevé de la remise à 2,20 m au milieu d'un niveau à 2,60 m).
 *
 * `max` et non la hauteur du niveau : une pièce plus HAUTE que son niveau garde sa façade haute.
 */
export function wallHeight(room: Room, level: Level, defaults: HouseDefaults, kind: WallKind): number {
  const h = roomHeight(room, level, defaults)
  return kind === 'exterior' ? Math.max(h, level.height ?? defaults.levelHeight) : h
}

export function openingSill(o: Opening, defaults: HouseDefaults): number {
  return o.sill ?? (o.type === 'window' ? defaults.windowSill : 0)
}

/** Largeur (m) de vantail au-delà de laquelle une baie en prend un de plus : une coulissante. */
const BAY_LEAF_W = 1.6
const BAY_LEAVES_AUTO_MAX = 3

/**
 * Nombre de vantaux EFFECTIF : celui du fichier, sinon celui qui se déduit. Seule la baie vitrée
 * en déduit plus d'un — trois mètres de verre d'un seul tenant ne ressemblent à rien, et personne
 * ne va renseigner ce nombre sur un relevé pour que la scène soit juste.
 *
 * Ici et non dans `openings.ts` : `computeWalls` en a besoin, et `openings.ts` importe déjà ce
 * module — le placer là-bas ferait un cycle.
 */
export function openingLeaves(o: Opening): number {
  if (o.leaves !== undefined) return o.leaves
  if (o.type === 'bay') return Math.min(BAY_LEAVES_AUTO_MAX, Math.max(2, Math.round(o.width / BAY_LEAF_W)))
  return 1
}

/** Classe chaque arête de la pièce (intérieur / extérieur / none) et fixe son épaisseur. */
export function classifySegments(room: Room, roomsOnLevel: readonly Room[], defaults: HouseDefaults): WallSegment[] {
  const poly = room.polygon
  const n = poly.length
  const others = roomsOnLevel.filter((r) => r.id !== room.id && isWalled(r))
  const overrides = new Map((room.walls ?? []).map((w) => [w.segment, w]))
  const segs: WallSegment[] = []
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!
    const d = normalize(sub(b, a))
    const nrm = perpRight(d)
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const ov = overrides.get(i)
    let kind: WallKind
    if (ov?.kind) kind = ov.kind
    else {
      const mid = add(a, scale(d, L / 2))
      const probe = add(mid, scale(nrm, 2 * defaults.interiorWallThickness + PROBE_MARGIN))
      kind = others.some((r) => pointInPolygon(probe, r.polygon)) ? 'interior' : 'exterior'
    }
    const thickness = kind === 'none' ? 0
      : ov?.thickness ?? (kind === 'interior' ? defaults.interiorWallThickness : defaults.exteriorWallThickness)
    segs.push({ index: i, a, b, d, n: nrm, L, kind, thickness })
  }
  return segs
}

export interface SegmentCorners {
  outerStart: Vec2
  outerEnd: Vec2
  /** Débord (m) au-delà de `u = 0` : une façade passe DEVANT la cloison qui la rejoint. */
  startExt: number
  /** Débord (m) au-delà de `u = L`, même raison. */
  endExt: number
}

/**
 * Points extérieurs aux deux bouts de chaque arête : intersection des lignes décalées des
 * arêtes voisines (miter). Bout droit si voisin `none`, colinéaire ou angle trop aigu.
 *
 * Exception au T façade / cloison (`extendAcross`) : la FAÇADE passe devant, la cloison s'arrête.
 */
export function miterCorners(segs: readonly WallSegment[]): SegmentCorners[] {
  const n = segs.length
  const butt = (s: WallSegment, at: 'start' | 'end'): Vec2 =>
    add(at === 'start' ? s.a : s.b, scale(s.n, s.thickness))
  const out: SegmentCorners[] = segs.map((s) => ({
    outerStart: butt(s, 'start'), outerEnd: butt(s, 'end'), startExt: 0, endExt: 0,
  }))
  for (let i = 0; i < n; i++) {
    const A = segs[(i - 1 + n) % n]!, B = segs[i]!
    if (A.kind === 'none' || B.kind === 'none') continue
    if (Math.abs(cross(A.d, B.d)) < EPS) continue
    if (A.kind !== B.kind) { extendAcross(A, B, out[(i - 1 + n) % n]!, out[i]!); continue }
    const x = lineIntersect(add(A.a, scale(A.n, A.thickness)), A.d, add(B.a, scale(B.n, B.thickness)), B.d)
    if (!x) continue
    const maxT = Math.max(A.thickness, B.thickness)
    const p = B.a
    if (Math.hypot(x[0] - p[0], x[1] - p[1]) > MAX_MITER_FACTOR * maxT + EPS) continue
    out[(i - 1 + n) % n]!.outerEnd = x
    out[i]!.outerStart = x
  }
  return out
}

/**
 * Coin entre une FAÇADE et une CLOISON. Mitrer les deux vers un point commun laisse, entre les
 * deux façades des pièces voisines, un triangle que seules les pointes des cloisons remplissent
 * — et la scène 3D ABAISSE les cloisons à 1,05 m, donc le triangle se creuse au-dessus.
 *
 * La façade passe donc **devant** : son bout, perpendiculaire à elle, avance de l'épaisseur de
 * la cloison, c'est-à-dire jusqu'au milieu de l'écart entre les deux pièces, là où la façade
 * voisine arrive en reculant de sa propre demi-épaisseur. Les deux plans coïncident (l'écart
 * VAUT la somme des deux demi-épaisseurs, cf. `MIRROR_TOL`). La cloison, elle, s'arrête net à la
 * face intérieure de la façade au lieu de la traverser.
 */
function extendAcross(A: WallSegment, B: WallSegment, cornersA: SegmentCorners, cornersB: SegmentCorners): void {
  if (A.kind === 'exterior') {
    cornersA.outerEnd = add(add(A.b, scale(A.d, B.thickness)), scale(A.n, A.thickness))
    cornersA.endExt = B.thickness
  } else {
    cornersB.outerStart = add(sub(B.a, scale(B.d, A.thickness)), scale(B.n, B.thickness))
    cornersB.startExt = A.thickness
  }
}

/** Trous de l'arête : ses ouvertures + celles des pièces en vis-à-vis (miroir), fusionnées. */
export function collectHoles(
  room: Room, seg: WallSegment, roomsOnLevel: readonly Room[], level: Level, defaults: HouseDefaults,
): Hole[] {
  const H = wallHeight(room, level, defaults, seg.kind)
  const holes: Hole[] = []
  for (const o of room.openings) {
    if (o.segment !== seg.index) continue
    const z0 = openingSill(o, defaults)
    holes.push({ u0: o.offset, u1: o.offset + o.width, z0, z1: Math.min(H, z0 + o.height), openingId: o.id, mirrored: false })
  }
  if (seg.kind !== 'none') {
    for (const other of roomsOnLevel) {
      if (other.id === room.id || !isWalled(other) || other.openings.length === 0) continue
      const oSegs = classifySegments(other, roomsOnLevel, defaults)
      for (const o of other.openings) {
        const os = oSegs[o.segment]
        if (!os || os.kind === 'none') continue
        if (dot(seg.d, os.d) > -0.99) continue                                   // pas antiparallèle
        const gap = dot(sub(os.a, seg.a), seg.n)                                  // distance entre faces intérieures
        if (Math.abs(gap - (seg.thickness + os.thickness)) > MIRROR_TOL) continue // pas en vis-à-vis direct
        const P1 = add(os.a, scale(os.d, o.offset)), P2 = add(os.a, scale(os.d, o.offset + o.width))
        const u1 = dot(sub(P1, seg.a), seg.d), u2 = dot(sub(P2, seg.a), seg.d)
        const lo = Math.max(0, Math.min(u1, u2)), hi = Math.min(seg.L, Math.max(u1, u2))
        if (hi - lo < 1e-3) continue
        const z0 = openingSill(o, defaults)
        holes.push({ u0: lo, u1: hi, z0, z1: Math.min(H, z0 + o.height), openingId: o.id, mirrored: true })
      }
    }
  }
  return mergeHoles(holes)
}

/** Fusionne les trous qui se chevauchent en u (union en u et en z). */
export function mergeHoles(holes: Hole[]): Hole[] {
  const sorted = [...holes].sort((a, b) => a.u0 - b.u0)
  const out: Hole[] = []
  for (const h of sorted) {
    const last = out[out.length - 1]
    if (last && h.u0 < last.u1 - EPS) {
      last.u1 = Math.max(last.u1, h.u1)
      last.z0 = Math.min(last.z0, h.z0)
      last.z1 = Math.max(last.z1, h.z1)
      if (!h.mirrored && last.mirrored) { last.openingId = h.openingId; last.mirrored = false }
    } else out.push({ ...h })
  }
  return out
}

export interface WallPiece { u0: number; u1: number; z0: number; z1: number; openingId?: string }

/** Découpe [0, L] × [0, H] autour des trous en morceaux pleins, allèges et linteaux. */
export function splitWall(L: number, H: number, holes: readonly Hole[]): WallPiece[] {
  const pieces: WallPiece[] = []
  let cursor = 0
  for (const h of holes) {
    const u0 = Math.max(0, h.u0), u1 = Math.min(L, h.u1)
    if (u1 <= u0 + EPS) continue
    if (u0 > cursor + EPS) pieces.push({ u0: cursor, u1: u0, z0: 0, z1: H })
    if (h.z0 > EPS) pieces.push({ u0, u1, z0: 0, z1: Math.min(h.z0, H), openingId: h.openingId })
    if (h.z1 < H - EPS) pieces.push({ u0, u1, z0: Math.max(h.z1, 0), z1: H, openingId: h.openingId })
    cursor = Math.max(cursor, u1)
  }
  if (cursor < L - EPS) pieces.push({ u0: cursor, u1: L, z0: 0, z1: H })
  return pieces
}

export function pieceFootprint(seg: WallSegment, corners: SegmentCorners, u0: number, u1: number): [Vec2, Vec2, Vec2, Vec2] {
  const P = (u: number): Vec2 => add(seg.a, scale(seg.d, u))
  const Q = (u: number): Vec2 => u <= EPS ? corners.outerStart : u >= seg.L - EPS ? corners.outerEnd : add(P(u), scale(seg.n, seg.thickness))
  return [P(u0), Q(u0), Q(u1), P(u1)]
}

/** Une arête de pièce prête à être extrudée, avec la portion `u` qui lui reste après arbitrage. */
interface SegmentPlan {
  room: Room
  seg: WallSegment
  kind: WallPrism['kind']
  corners: SegmentCorners
  height: number
  u0: number
  u1: number
}

interface TrimCandidate { plan: SegmentPlan; u0: number; u1: number; lost: number }

const planFootprint = (p: SegmentPlan, u0 = p.u0, u1 = p.u1) => pieceFootprint(p.seg, p.corners, u0, u1)

/**
 * Bout à retirer de `p` pour libérer `other`, ou null s'il n'y a rien à retirer, si l'autre
 * mur est plus BAS (on découvrirait un cran), si le recouvrement tombe au MILIEU de l'arête
 * (un rognage en bout n'y peut rien) ou si `other` ne reprend pas toute la part retirée en
 * plan (on ouvrirait une fente).
 */
function trimCandidate(p: SegmentPlan, other: readonly Vec2[], otherHeight: number): TrimCandidate | null {
  if (otherHeight < p.height - 1e-3) return null
  const inter = clipConvex(planFootprint(p), other)
  if (inter.length < 3) return null
  let lo = Infinity, hi = -Infinity
  for (const v of inter) {
    const u = dot(sub(v, p.seg.a), p.seg.d)
    if (u < lo) lo = u
    if (u > hi) hi = u
  }
  lo = Math.max(lo, p.u0); hi = Math.min(hi, p.u1)
  if (hi - lo < TRIM_EPS) return null
  let u0 = p.u0, u1 = p.u1
  if (hi >= p.u1 - TRIM_EPS) u1 = lo
  else if (lo <= p.u0 + TRIM_EPS) u0 = hi
  else return null
  if (u1 - u0 < TRIM_EPS) return null
  const lost = u0 > p.u0 ? planFootprint(p, p.u0, u0) : planFootprint(p, u1, p.u1)
  const lostArea = Math.abs(signedArea(lost))
  const covered = Math.abs(signedArea(clipConvex(lost, other)))
  if (lostArea - covered > 1e-6) return null
  return { plan: p, u0, u1, lost: lostArea }
}

/**
 * Chaque pièce écrit ses propres murs : à un ANGLE DE BÂTIMENT, deux pièces voisines
 * portent les deux faces perpendiculaires et leurs prismes se traversent — faces
 * coplanaires (z-fighting) et lame qui dépasse, bien visibles en plongée. Le mitre de
 * `miterCorners` ne joue qu'à l'intérieur d'une pièce ; ici on arbitre entre pièces.
 *
 * Règle : on rogne en bout celui des deux dont la part retirée est INTÉGRALEMENT reprise
 * par l'autre mur. Impossible d'ouvrir une fente par construction, et quand aucun des deux
 * ne couvre l'autre on garde le recouvrement (moins laid qu'un trou).
 */
function trimCrossRoomOverlaps(plans: readonly SegmentPlan[]): void {
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      const A = plans[i]!, B = plans[j]!
      if (A.room.id === B.room.id) continue
      if (Math.abs(cross(A.seg.d, B.seg.d)) < 0.05) continue  // quasi parallèles : c'est un vis-à-vis, pas un angle
      const fa = planFootprint(A), fb = planFootprint(B)
      if (!isConvex(fa) || !isConvex(fb)) continue
      if (Math.abs(signedArea(clipConvex(fa, fb))) < OVERLAP_MIN_AREA) continue
      const a = trimCandidate(A, fb, B.height), b = trimCandidate(B, fa, A.height)
      const pick = a && b ? (a.lost <= b.lost ? a : b) : a ?? b
      if (!pick) continue
      pick.plan.u0 = pick.u0
      pick.plan.u1 = pick.u1
    }
  }
}

export interface WallsResult { prisms: WallPrism[]; openings: OpeningRect[] }

/** Murs et rectangles d'ouverture d'un niveau (z locaux au niveau). */
export function computeWalls(level: Level, roomsOnLevel: readonly Room[], defaults: HouseDefaults): WallsResult {
  const prisms: WallPrism[] = []
  const openings: OpeningRect[] = []
  const plans: SegmentPlan[] = []
  for (const room of roomsOnLevel) {
    if (!isWalled(room)) continue
    const segs = classifySegments(room, roomsOnLevel, defaults)
    const corners = miterCorners(segs)
    for (const seg of segs) {
      if (seg.kind === 'none') continue
      const c = corners[seg.index]!
      const height = wallHeight(room, level, defaults, seg.kind)
      plans.push({ room, seg, kind: seg.kind, corners: c, height, u0: -c.startExt, u1: seg.L + c.endExt })
    }
  }
  trimCrossRoomOverlaps(plans)
  for (const plan of plans) {
    const { room, seg, kind, corners, height: H } = plan
    const holes = collectHoles(room, seg, roomsOnLevel, level, defaults)
    for (const piece of splitWall(seg.L, H, holes)) {
      // le morceau de bout prend la borne du plan (débord de façade, ou rognage d'angle)
      const u0 = piece.u0 <= EPS ? plan.u0 : Math.max(piece.u0, plan.u0)
      const u1 = piece.u1 >= seg.L - EPS ? plan.u1 : Math.min(piece.u1, plan.u1)
      if (u1 - u0 < TRIM_EPS) continue
      prisms.push({
        roomId: room.id, levelId: level.id, segment: seg.index, kind,
        footprint: pieceFootprint(seg, corners, u0, u1),
        z0: piece.z0, z1: piece.z1,
        ...(piece.openingId ? { openingId: piece.openingId } : {}),
      })
    }
    for (const o of room.openings) {
      if (o.segment !== seg.index) continue
      const p = add(seg.a, scale(seg.d, o.offset))
      openings.push({
        openingId: o.id, roomId: room.id, levelId: level.id, type: o.type,
        origin: [p[0], p[1], openingSill(o, defaults)], u: seg.d, normal: seg.n,
        width: o.width, height: o.height, depth: seg.thickness, leaves: openingLeaves(o),
        ...(o.material ? { material: o.material } : {}),
        ...(o.color ? { color: o.color } : {}),
      })
    }
  }
  return { prisms, openings }
}
