import type { HouseDefaults } from '../defaults'
import type { Level, Opening, Room, WallKind } from '../schema'
import type { OpeningRect, Vec3, WallPrism } from './types'
import { add, clipConvex, cross, dot, isConvex, lineIntersect, normalize, perpRight, pointInPolygon, scale, signedArea, sub, type Vec2 } from './vec2'

// Walls: each room carries its own walls toward the OUTSIDE of its inner face.
// Two adjacent rooms are written with a gap = t + t'; each side fills its half.
// No CSG or Shape with holes: each wall is cut along its length around the
// openings into convex quads (mitered at the corners), extruded upward. Robust and fast.

const EPS = 1e-6
const MIRROR_TOL = 0.02          // tolerance (m) on the gap t + t' between facing faces
const PROBE_MARGIN = 0.05
const MAX_MITER_FACTOR = 3
const OVERLAP_MIN_AREA = 1e-4    // m² of overlap below which nothing shows
const TRIM_EPS = 1e-4

export interface WallSegment {
  index: number
  a: Vec2
  b: Vec2
  d: Vec2          // unit direction a → b
  n: Vec2          // unit outward normal
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
 * Height of a WALL, which is not that of the room. `room.height` describes the CEILING: it is
 * what `autoplace` uses to hang a ceiling light, what `validate` compares to an
 * opening. No wall follows it downward. A FACADE belongs to the building envelope,
 * otherwise the exterior wall steps from one room to the next; a PARTITION is ONE wall of which each room
 * carries a half, and the neighbor raises its own to the level — the lower half left a 40 cm step
 * at the top of the wall, seen from above (survey of the shed at 2.20 m in a level at 2.60 m).
 *
 * `max` and not the level height: a room taller than its level keeps its walls high.
 */
export function wallHeight(room: Room, level: Level, defaults: HouseDefaults): number {
  return Math.max(roomHeight(room, level, defaults), level.height ?? defaults.levelHeight)
}

export function openingSill(o: Opening, defaults: HouseDefaults): number {
  return o.sill ?? (o.type === 'window' ? defaults.windowSill : 0)
}

/** Leaf width (m) beyond which a bay takes one more: a sliding door. */
const BAY_LEAF_W = 1.6
const BAY_LEAVES_AUTO_MAX = 3

/**
 * EFFECTIVE number of leaves: the file's, otherwise the one that is deduced. Only the glazed
 * bay deduces more than one — three meters of glass in one piece look like nothing, and nobody
 * is going to fill in that number on a survey for the scene to be right.
 *
 * Here and not in `openings.ts`: `computeWalls` needs it, and `openings.ts` already imports this
 * module — placing it there would make a cycle.
 */
export function openingLeaves(o: Opening): number {
  if (o.leaves !== undefined) return o.leaves
  if (o.type === 'bay') return Math.min(BAY_LEAVES_AUTO_MAX, Math.max(2, Math.round(o.width / BAY_LEAF_W)))
  return 1
}

/** Classifies each edge of the room (interior / exterior / none) and sets its thickness. */
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
  /** Overhang (m) beyond `u = 0`: a facade goes IN FRONT OF the partition that joins it. */
  startExt: number
  /** Overhang (m) beyond `u = L`, same reason. */
  endExt: number
}

/**
 * Exterior points at the two ends of each edge: intersection of the offset lines of the
 * neighboring edges (miter). Straight end if the neighbor is `none`, collinear or the angle too sharp.
 *
 * Exception to the facade / partition T (`extendAcross`): the FACADE goes in front, the partition stops.
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
 * Corner between a FACADE and a PARTITION. Mitering both toward a common point leaves, between the
 * two facades of the neighboring rooms, a triangle that only the tips of the partitions fill
 * — and the 3D scene LOWERS the partitions to 1.05 m, so the triangle opens up above.
 *
 * The facade therefore goes **in front**: its end, perpendicular to it, advances by the thickness of
 * the partition, that is to the middle of the gap between the two rooms, where the neighboring
 * facade arrives backing off by its own half-thickness. The two planes coincide (the gap
 * EQUALS the sum of the two half-thicknesses, cf. `MIRROR_TOL`). The partition, for its part, stops dead at the
 * inner face of the facade instead of crossing it.
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

/** Holes of the edge: its openings + those of the rooms facing it (mirror), merged. */
export function collectHoles(
  room: Room, seg: WallSegment, roomsOnLevel: readonly Room[], level: Level, defaults: HouseDefaults,
  H = wallHeight(room, level, defaults),
): Hole[] {
  const holes: Hole[] = []
  for (const o of room.openings) {
    if (o.segment === undefined || o.offset === undefined || o.segment !== seg.index) continue
    const z0 = openingSill(o, defaults)
    holes.push({ u0: o.offset, u1: o.offset + o.width, z0, z1: Math.min(H, z0 + o.height), openingId: o.id, mirrored: false })
  }
  if (seg.kind !== 'none') {
    for (const other of roomsOnLevel) {
      if (other.id === room.id || !isWalled(other) || other.openings.length === 0) continue
      const oSegs = classifySegments(other, roomsOnLevel, defaults)
      for (const o of other.openings) {
        if (o.segment === undefined || o.offset === undefined) continue
        const os = oSegs[o.segment]
        if (!os || os.kind === 'none') continue
        if (dot(seg.d, os.d) > -0.99) continue                                   // not antiparallel
        const gap = dot(sub(os.a, seg.a), seg.n)                                  // distance between inner faces
        if (Math.abs(gap - (seg.thickness + os.thickness)) > MIRROR_TOL) continue // not directly facing
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

/** Merges the holes that overlap in u (union in u and in z). */
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

/** Cuts [0, L] × [0, H] around the holes into solid pieces, sills and lintels. */
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

/** A room edge ready to be extruded, with the portion `u` left to it after arbitration. */
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
 * End to remove from `p` to free `other`, or null if there is nothing to remove, if the other
 * wall is LOWER (a step would be uncovered), if the overlap falls in the MIDDLE of the edge
 * (trimming at the end cannot help) or if `other` does not take over the whole part removed in
 * plan (a gap would be opened).
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
 * Each room writes its own walls: at a BUILDING CORNER, two neighboring rooms
 * carry the two perpendicular faces and their prisms cross each other — coplanar
 * faces (z-fighting) and a blade that sticks out, clearly visible from above. The miter of
 * `miterCorners` only works inside a room; here we arbitrate between rooms.
 *
 * Rule: we trim at the end the one of the two whose removed part is ENTIRELY taken over
 * by the other wall. Impossible to open a gap by construction, and when neither
 * covers the other we keep the overlap (less ugly than a hole).
 */
function trimCrossRoomOverlaps(plans: readonly SegmentPlan[]): void {
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      const A = plans[i]!, B = plans[j]!
      if (A.room.id === B.room.id) continue
      if (Math.abs(cross(A.seg.d, B.seg.d)) < 0.05) continue  // nearly parallel: it is a facing pair, not a corner
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

/**
 * The CENTER of an opening rectangle (local z to the level, like the origin). It is the anchor point
 * of everything that dresses the opening — the apron of a shutter, the pill of its marker — rather than
 * the `position` of the JSON: an opening refined after the fact would leave the device off to the side (measured at
 * 2.11 m on `cover.volet-bureau`), whereas what is drawn already hugs the bay.
 *
 * For a surface (floor / roof), the center is at the middle of the rectangle, at mid-thickness of the carrier.
 */
/**
 * Length SEEN FROM THE SKY of a surface opening: its length (`height`, along the heading) is measured
 * along the slope — the true size of a Velux — and shortens by cos(slope) in plan.
 */
export const planLength = (height: number, slopeDeg = 0): number => height * Math.cos((slopeDeg * Math.PI) / 180)

export function openingCentre(o: OpeningRect): Vec3 {
  if (o.host === 'wall') {
    return [o.origin[0] + (o.u[0] * o.width) / 2, o.origin[1] + (o.u[1] * o.width) / 2, o.origin[2] + o.height / 2]
  }
  // surface: origin is the "bottom-left" corner; the center in plan follows u × width and the perpendicular
  // direction (heading direction) × height; z at mid-thickness
  const { fwd } = (() => {
    const yaw = o.yaw ?? 0
    const a = (yaw * Math.PI) / 180
    return { fwd: [-Math.sin(a), Math.cos(a)] as const }
  })()
  const along = planLength(o.height, o.slope)
  return [
    o.origin[0] + (o.u[0] * o.width) / 2 + (fwd[0] * along) / 2,
    o.origin[1] + (o.u[1] * o.width) / 2 + (fwd[1] * along) / 2,
    o.origin[2] + o.depth / 2,
  ]
}

export interface WallsResult { prisms: WallPrism[]; openings: OpeningRect[] }

/**
 * Walls and opening rectangles of a level (level-local z).
 *
 * `eaves`: per room, the eaves height of the roof that covers it, when that roof writes one — its
 * walls stop there instead of at the level. A PARTITION rises with the higher of its two rooms: it
 * is one wall, and above the lower roof it is the facade of the higher volume.
 */
export function computeWalls(
  level: Level, roomsOnLevel: readonly Room[], defaults: HouseDefaults, eaves?: ReadonlyMap<string, number>,
): WallsResult {
  const prisms: WallPrism[] = []
  const openings: OpeningRect[] = []
  const plans: SegmentPlan[] = []
  const own = (room: Room) => eaves?.get(room.id) ?? wallHeight(room, level, defaults)
  const walled = roomsOnLevel.filter(isWalled)
  for (const room of walled) {
    const segs = classifySegments(room, roomsOnLevel, defaults)
    const corners = miterCorners(segs)
    for (const seg of segs) {
      if (seg.kind === 'none') continue
      const c = corners[seg.index]!
      let height = own(room)
      if (seg.kind === 'interior' && eaves?.size) {
        const probe = add(add(seg.a, scale(seg.d, seg.L / 2)), scale(seg.n, 2 * defaults.interiorWallThickness + PROBE_MARGIN))
        const other = walled.find((r) => r.id !== room.id && pointInPolygon(probe, r.polygon))
        if (other) height = Math.max(height, own(other))
      }
      plans.push({ room, seg, kind: seg.kind, corners: c, height, u0: -c.startExt, u1: seg.L + c.endExt })
    }
  }
  trimCrossRoomOverlaps(plans)
  for (const plan of plans) {
    const { room, seg, kind, corners, height: H } = plan
    const holes = collectHoles(room, seg, roomsOnLevel, level, defaults, H)
    for (const piece of splitWall(seg.L, H, holes)) {
      // the end piece takes the plan bound (facade overhang, or corner trimming)
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
      if (o.segment === undefined || o.offset === undefined || o.segment !== seg.index) continue
      const p = add(seg.a, scale(seg.d, o.offset))
      openings.push({
        openingId: o.id, roomId: room.id, levelId: level.id, type: o.type, host: 'wall',
        origin: [p[0], p[1], openingSill(o, defaults)], u: seg.d, normal: seg.n,
        width: o.width, height: o.height, depth: seg.thickness, leaves: openingLeaves(o),
        ...(o.material ? { material: o.material } : {}),
        ...(o.color ? { color: o.color } : {}),
      })
    }
  }
  return { prisms, openings }
}
