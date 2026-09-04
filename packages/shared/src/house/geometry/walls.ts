import type { HouseDefaults } from '../defaults'
import type { Level, Opening, Room, WallKind } from '../schema'
import type { OpeningRect, WallPrism } from './types'
import { add, cross, dot, lineIntersect, normalize, perpRight, pointInPolygon, scale, sub, type Vec2 } from './vec2'

// Murs : chaque pièce porte ses propres murs vers l'EXTÉRIEUR de sa face intérieure.
// Deux pièces adjacentes s'écrivent avec un écart = t + t' ; chaque côté remplit sa moitié.
// Pas de CSG ni de Shape à trous : on découpe chaque mur le long de sa longueur autour des
// ouvertures en quads convexes (mitrés aux coins), extrudés vers le haut. Robuste et rapide.

const EPS = 1e-6
const MIRROR_TOL = 0.02          // tolérance (m) sur l'écart t + t' entre faces en vis-à-vis
const PROBE_MARGIN = 0.05
const MAX_MITER_FACTOR = 3

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

export function openingSill(o: Opening, defaults: HouseDefaults): number {
  return o.sill ?? (o.type === 'window' ? defaults.windowSill : 0)
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

export interface SegmentCorners { outerStart: Vec2; outerEnd: Vec2 }

/**
 * Points extérieurs aux deux bouts de chaque arête : intersection des lignes décalées des
 * arêtes voisines (miter). Bout droit si voisin `none`, colinéaire ou angle trop aigu.
 */
export function miterCorners(segs: readonly WallSegment[]): SegmentCorners[] {
  const n = segs.length
  const butt = (s: WallSegment, at: 'start' | 'end'): Vec2 =>
    add(at === 'start' ? s.a : s.b, scale(s.n, s.thickness))
  const out: SegmentCorners[] = segs.map((s) => ({ outerStart: butt(s, 'start'), outerEnd: butt(s, 'end') }))
  for (let i = 0; i < n; i++) {
    const A = segs[(i - 1 + n) % n]!, B = segs[i]!
    if (A.kind === 'none' || B.kind === 'none') continue
    if (Math.abs(cross(A.d, B.d)) < EPS) continue
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

/** Trous de l'arête : ses ouvertures + celles des pièces en vis-à-vis (miroir), fusionnées. */
export function collectHoles(
  room: Room, seg: WallSegment, roomsOnLevel: readonly Room[], level: Level, defaults: HouseDefaults,
): Hole[] {
  const H = roomHeight(room, level, defaults)
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

export interface WallsResult { prisms: WallPrism[]; openings: OpeningRect[] }

/** Murs et rectangles d'ouverture d'un niveau (z locaux au niveau). */
export function computeWalls(level: Level, roomsOnLevel: readonly Room[], defaults: HouseDefaults): WallsResult {
  const prisms: WallPrism[] = []
  const openings: OpeningRect[] = []
  for (const room of roomsOnLevel) {
    if (!isWalled(room)) continue
    const H = roomHeight(room, level, defaults)
    const segs = classifySegments(room, roomsOnLevel, defaults)
    const corners = miterCorners(segs)
    for (const seg of segs) {
      if (seg.kind === 'none') continue
      const holes = collectHoles(room, seg, roomsOnLevel, level, defaults)
      for (const piece of splitWall(seg.L, H, holes)) {
        prisms.push({
          roomId: room.id, levelId: level.id, segment: seg.index, kind: seg.kind,
          footprint: pieceFootprint(seg, corners[seg.index]!, piece.u0, piece.u1),
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
          width: o.width, height: o.height, depth: seg.thickness,
        })
      }
    }
  }
  return { prisms, openings }
}
