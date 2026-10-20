import type { HouseDefaults } from './defaults'
import { dist, pointInPolygon, type Vec2 } from './geometry/vec2'
import { classifySegments, isWalled, type WallSegment } from './geometry/walls'
import { fitParkingGap, parkingGaps, type ParkingSide } from './parking'
import { isSurfaceOpening, type Opening, type OpeningType, type Room } from './schema'

export type { ParkingSide as SurfaceSide }
export { PARKING_SIDES as SURFACE_SIDES } from './parking'

// Where an opening has the RIGHT to be placed on the outline of its room, and what becomes of a point
// grabbed with the mouse. The rule is that of `validate.ts` — wall segment (never "none"), fitting
// in its length, without overlapping a neighbor — but taken at the place: the validation REFUSES,
// here we BRING BACK to the closest admissible location. A drag must never produce
// a house that the server rejects; it must stop short.

/**
 * Smallest dimension of an opening (m). A zero opening would vanish from the scene without anyone
 * knowing why; it is the same safeguard as the size bounds of a cover placed outside.
 */
export const MIN_OPENING_DIM = 0.3

/**
 * Rounded to the centimeter. What the adjustment functions return goes into house.json: a sill
 * of `0.2999999999999998` would stay there, unreadable for whoever rereads their survey. The centimeter is the
 * precision of a tape measure, hence that of the file.
 */
const cm = (v: number) => Math.round(v * 100) / 100

/** Place of an opening on the outline: the edge that carries it, and the distance from its corner. */
export interface OpeningSlot { segment: number; offset: number }

/** Place of a SURFACE opening: center in plan and heading. */
export interface SurfaceSlot { x: number; y: number; yaw: number }

/**
 * Axes of a surface opening (same convention as the places: 0 = facing +y).
 * `fwd` = direction of the heading (height of the rectangle), `right` = across (width).
 */
export function surfaceAxes(yaw: number): { fwd: Vec2; right: Vec2 } {
  const a = (yaw * Math.PI) / 180
  const s = Math.sin(a), c = Math.cos(a)
  return { fwd: [-s, c], right: [c, s] }
}

/** The four corners of the surface rectangle, CCW from the front-right. */
export function surfaceCorners(center: Vec2, yaw: number, width: number, height: number): [Vec2, Vec2, Vec2, Vec2] {
  const { fwd, right } = surfaceAxes(yaw)
  const at = (u: number, v: number): Vec2 => [
    center[0] + fwd[0] * u + right[0] * v,
    center[1] + fwd[1] * u + right[1] * v,
  ]
  return [at(height / 2, width / 2), at(height / 2, -width / 2), at(-height / 2, -width / 2), at(-height / 2, width / 2)]
}

/** Are all the corners of the rectangle inside the polygon? */
export function surfaceFitsInPolygon(center: Vec2, yaw: number, width: number, height: number, poly: readonly Vec2[]): boolean {
  return surfaceCorners(center, yaw, width, height).every((p) => pointInPolygon(p, poly))
}

/**
 * Point → admissible location for a SURFACE opening in the room. We keep the tapped
 * center if it passes, otherwise we bring it toward the centroid until the rectangle fits (or we
 * give up).
 */
export function slotFromSurfacePoint(
  room: Room, point: Vec2, yaw: number, width: number, height: number,
): SurfaceSlot | null {
  const poly = room.polygon
  if (surfaceFitsInPolygon(point, yaw, width, height, poly)) {
    return { x: cm(point[0]), y: cm(point[1]), yaw: cm(yaw) }
  }
  // bring toward the center of the room: a series of steps along the segment [point → centroid]
  let cx = 0, cy = 0
  for (const [x, y] of poly) { cx += x; cy += y }
  cx /= poly.length
  cy /= poly.length
  for (let t = 0.1; t <= 1; t += 0.1) {
    const p: Vec2 = [point[0] + (cx - point[0]) * t, point[1] + (cy - point[1]) * t]
    if (surfaceFitsInPolygon(p, yaw, width, height, poly)) {
      return { x: cm(p[0]), y: cm(p[1]), yaw: cm(yaw) }
    }
  }
  return null
}

/** Do two surface rectangles overlap (plan AABB, quick approximation)? */
export function surfaceRectsOverlap(
  a: { x: number; y: number; yaw: number; width: number; height: number },
  b: { x: number; y: number; yaw: number; width: number; height: number },
): boolean {
  // separating axis test (SAT) on the two orientations
  const ca = surfaceCorners([a.x, a.y], a.yaw, a.width, a.height)
  const cb = surfaceCorners([b.x, b.y], b.yaw, b.width, b.height)
  const axes = [surfaceAxes(a.yaw).fwd, surfaceAxes(a.yaw).right, surfaceAxes(b.yaw).fwd, surfaceAxes(b.yaw).right]
  for (const axis of axes) {
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity
    for (const p of ca) {
      const t = p[0] * axis[0] + p[1] * axis[1]
      if (t < minA) minA = t
      if (t > maxA) maxA = t
    }
    for (const p of cb) {
      const t = p[0] * axis[0] + p[1] * axis[1]
      if (t < minB) minB = t
      if (t > maxB) maxB = t
    }
    if (maxA < minB - 1e-6 || maxB < minA - 1e-6) return false
  }
  return true
}

/** Admissible `offset` interval: an opening of width `width` can start between min and max. */
interface Range { min: number; max: number }

/**
 * Free intervals of a segment, once the openings already placed on it are removed.
 * `taken` is given in curvilinear abscissae [start, end] on the segment.
 */
function freeRanges(L: number, width: number, taken: readonly [number, number][]): Range[] {
  const sorted = [...taken].sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  let cursor = 0
  for (const [u0, u1] of sorted) {
    if (u0 - cursor >= width) out.push({ min: cursor, max: u0 - width })
    cursor = Math.max(cursor, u1)
  }
  if (L - cursor >= width) out.push({ min: cursor, max: L - width })
  return out
}

/** The openings of a segment, except the one being moved. */
function neighbours(room: Room, segment: number, exceptId: string): [number, number][] {
  return room.openings
    .filter((o) => o.id !== exceptId && o.segment === segment && o.offset !== undefined)
    .map((o) => [o.offset!, o.offset! + o.width] as [number, number])
}

/**
 * Segments able to carry an opening of width `width`: those that are a wall (a terrace
 * has none, a "none" segment is a ground-level opening) and where there is room left.
 */
export function hostSegments(
  room: Room, roomsOnLevel: readonly Room[], defaults: HouseDefaults, width: number, exceptId: string,
): { seg: WallSegment; ranges: Range[] }[] {
  if (!isWalled(room)) return []
  return classifySegments(room, roomsOnLevel, defaults)
    .filter((seg) => seg.kind !== 'none')
    .map((seg) => ({ seg, ranges: freeRanges(seg.L, width, neighbours(room, seg.index, exceptId)) }))
    .filter((c) => c.ranges.length > 0)
}

/** The free interval that CONTAINS `offset`, or, failing that, the closest. */
function rangeAt(ranges: readonly Range[], offset: number): Range | null {
  let best: Range | null = null
  for (const r of ranges) {
    if (offset >= r.min - 1e-6 && offset <= r.max + 1e-6) return r
    const d = Math.min(Math.abs(offset - r.min), Math.abs(offset - r.max))
    if (!best || d < Math.min(Math.abs(offset - best.min), Math.abs(offset - best.max))) best = r
  }
  return best
}

/** Brings `offset` into the closest free interval; `null` if the segment cannot carry anything. */
function snapIntoRanges(ranges: readonly Range[], offset: number): number | null {
  let best: number | null = null
  for (const r of ranges) {
    const v = Math.min(r.max, Math.max(r.min, offset))
    if (best === null || Math.abs(v - offset) < Math.abs(best - offset)) best = v
  }
  return best
}

/** Distance (m) from the point to the segment itself (projection brought between its two ends). */
function distToSegment(p: Vec2, seg: WallSegment): number {
  const t = Math.min(seg.L, Math.max(0, (p[0] - seg.a[0]) * seg.d[0] + (p[1] - seg.a[1]) * seg.d[1]))
  return dist(p, [seg.a[0] + seg.d[0] * t, seg.a[1] + seg.d[1] * t])
}

/**
 * House reference frame point → admissible location on the room's OUTLINE. Two questions, in
 * this order, because that is how the gesture is read:
 *
 * 1. **Which wall?** The closest to the finger, among those that can receive it. It is what makes
 *    corners work: one drags toward the next wall, the opening goes there.
 * 2. **Where on this wall?** The finger projected, brought into a free interval.
 *
 * `from` = the place the opening occupies right now. When given, it makes the gesture CONTINUOUS: on its
 * own wall, the opening stays in the free interval where it is, so it STOPS against its
 * neighbor instead of teleporting to the other side as soon as the finger passes the middle. To go
 * past a neighbor, one goes around the room — that is what "running along the walls" means,
 * and it is what makes the gesture predictable. Without `from`, the closest wins.
 */
export function slotFromPoint(
  room: Room, roomsOnLevel: readonly Room[], defaults: HouseDefaults,
  point: Vec2, width: number, exceptId: string, from?: OpeningSlot,
): OpeningSlot | null {
  const hosts = hostSegments(room, roomsOnLevel, defaults, width, exceptId)
  let nearest: { seg: WallSegment; ranges: Range[] } | null = null
  let best = Infinity
  for (const host of hosts) {
    const d = distToSegment(point, host.seg)
    if (d < best) { best = d; nearest = host }
  }
  if (!nearest) return null
  const t = (point[0] - nearest.seg.a[0]) * nearest.seg.d[0] + (point[1] - nearest.seg.a[1]) * nearest.seg.d[1]
  const here = from && from.segment === nearest.seg.index ? rangeAt(nearest.ranges, from.offset) : null
  const offset = snapIntoRanges(here ? [here] : nearest.ranges, t - width / 2)
  return offset === null ? null : { segment: nearest.seg.index, offset }
}

/** Length (m) of the edge that carries `segment`, or 0 if it does not exist. */
function segmentLength(room: Room, segment: number): number {
  const n = room.polygon.length
  const a = room.polygon[segment]
  const b = room.polygon[(segment + 1) % n]
  return a && b ? dist(a, b) : 0
}

/**
 * What is displayed to DESIGNATE an opening: its name if one was given to it, otherwise its
 * survey identifier. A single rule, so that the panel, the room list and the label
 * of the scene never say three different things about the same window.
 */
export const openingLabel = (o: Opening): string => o.name ?? o.id

/**
 * The two dimensions that matter when placing an opening: what separates it from each end of its
 * wall. It is how a house is surveyed with a tape measure — from the corners, not from a file
 * origin — and it is what the scene annotates during the move.
 *
 * **Left and right are told FROM INSIDE the room**, because that is where one measures from. The
 * file only knows `offset`, the distance to the corner `polygon[segment]`; the convention is
 * therefore set HERE, once, rather than left to each screen that displays the two numbers — a silent
 * inversion has already happened, and it only shows when standing in the room.
 *
 * The mapping does not depend on the room: `ccwPolygonSchema` imposes the counterclockwise direction,
 * so the inside is ALWAYS to the left of the edge `polygon[i] → polygon[i+1]`. An observer
 * standing inside and turned toward the wall therefore has `polygon[segment]` — the origin of `offset` — on their RIGHT.
 */
export function openingGaps(room: Room, opening: Opening): { left: number; right: number } {
  if (isSurfaceOpening(opening.type) || opening.segment === undefined || opening.offset === undefined) {
    return { left: 0, right: 0 }
  }
  const right = opening.offset
  const left = Math.max(0, segmentLength(room, opening.segment) - opening.offset - opening.width)
  return { left, right }
}

/**
 * The four dimensions of a SURFACE opening in its room — front / back / left / right
 * in the direction of the heading (`yaw`), like a parking spot. Absent or outside the room: `null`.
 * A Velux on a slope is measured on its FOOTPRINT (`surfaceFootprint`): it is up to the caller to
 * pass it (heading of the descent, shortened length), so that the dimensions start from the edge of its hole.
 */
export function surfaceGaps(room: Room, opening: Opening): Record<ParkingSide, number | null> {
  if (!isSurfaceOpening(opening.type) || opening.x === undefined || opening.y === undefined || opening.yaw === undefined) {
    return { front: null, back: null, left: null, right: null }
  }
  return parkingGaps(room.polygon, {
    id: opening.id,
    center: [opening.x, opening.y],
    size: [opening.width, opening.height],
    yaw: opening.yaw,
    accepts: 'vehicle',
  })
}

/**
 * Wanted dimension on one side → new center (the opening SLIDES). Same rule as `fitParkingGap`.
 */
export function fitSurfaceGap(
  room: Room, opening: Opening, side: ParkingSide, wanted: number,
): { x: number; y: number } | null {
  if (opening.x === undefined || opening.y === undefined || opening.yaw === undefined) return null
  const next = fitParkingGap(room.polygon, {
    id: opening.id,
    center: [opening.x, opening.y],
    size: [opening.width, opening.height],
    yaw: opening.yaw,
    accepts: 'vehicle',
  }, side, wanted)
  return next ? { x: next[0], y: next[1] } : null
}

/**
 * The void where the opening is PLACED: the free interval of its wall that contains it, neighbors
 * removed, in curvilinear abscissae from the corner `polygon[segment]`.
 *
 * It is the place actually available, and not what is left to the right of the opening: widening a
 * window that has one meter free on its left and ten centimeters on its right must be able to take
 * both, even if it means sliding it.
 */
export function freeSpan(
  room: Room, roomsOnLevel: readonly Room[], defaults: HouseDefaults, opening: Opening,
): { u0: number; u1: number } | null {
  if (isSurfaceOpening(opening.type) || opening.segment === undefined || opening.offset === undefined) return null
  if (!isWalled(room)) return null
  const seg = classifySegments(room, roomsOnLevel, defaults)[opening.segment]
  if (!seg || seg.kind === 'none') return null
  let u0 = 0
  let u1 = seg.L
  for (const [a, b] of neighbours(room, opening.segment, opening.id)) {
    if (b <= opening.offset + 1e-6) u0 = Math.max(u0, b)          // neighbor on the left
    else if (a >= opening.offset + opening.width - 1e-6) u1 = Math.min(u1, a)   // on the right
    else return null                                              // overlap already written: we decide nothing
  }
  return u1 > u0 ? { u0, u1 } : null
}

/**
 * Wanted width → retained width and the place where it FITS. The opening only moves if it has to:
 * we keep its left edge as long as there is room on the right, and we slide it to the left
 * when there is none.
 *
 * It is the difference from a simple clamp: typing 3 m in a window that has 3 m of free wall
 * but only 1 m to its right gave 1 m, without saying why. Now it is 3 m and has
 * moved — which the two dimensions of the panel show, since they changed with it.
 */
export function fitWidth(
  room: Room, roomsOnLevel: readonly Room[], defaults: HouseDefaults, opening: Opening, wanted: number,
): { width: number; offset: number } | null {
  if (opening.offset === undefined) return null
  const span = freeSpan(room, roomsOnLevel, defaults, opening)
  if (!span) return null
  const width = cm(Math.min(Math.max(wanted, MIN_OPENING_DIM), span.u1 - span.u0))
  return { width, offset: cm(Math.min(Math.max(opening.offset, span.u0), span.u1 - width)) }
}

/**
 * Wanted height → retained height and the sill where it FITS. Same rule, the other way around: a
 * height that no longer fits under the ceiling LOWERS the sill instead of being trimmed. It only
 * lowers by what is needed, and never below the floor.
 */
export function fitHeight(sill: number, height: number, ceiling: number, wanted: number): { height: number; sill: number } {
  const h = cm(Math.min(Math.max(wanted, MIN_OPENING_DIM), Math.max(MIN_OPENING_DIM, ceiling)))
  return { height: h, sill: cm(Math.min(Math.max(0, sill), Math.max(0, ceiling - h))) }
}

/**
 * Wanted place, given by one of the TWO dimensions of the panel → retained `offset`. The sides are told from
 * the INSIDE of the room, as for `openingGaps`: one enters the dimension measured with a tape
 * measure from a corner, the other follows.
 */
export function fitGap(
  room: Room, roomsOnLevel: readonly Room[], defaults: HouseDefaults, opening: Opening,
  side: 'left' | 'right', wanted: number,
): number | null {
  if (opening.segment === undefined || opening.offset === undefined) return null
  const span = freeSpan(room, roomsOnLevel, defaults, opening)
  if (!span) return null
  const L = segmentLength(room, opening.segment)
  const target = side === 'right' ? wanted : L - opening.width - wanted
  return cm(Math.min(Math.max(target, span.u0), span.u1 - opening.width))
}

/**
 * Admissible dimensions of an opening. The width is bounded by the VOID where it is placed, not by what
 * is left to its right: it can be widened until it fills its interval, it will slide to
 * fit (`fitWidth`). The height is bounded by the ceiling, not by what is left above
 * the sill: it is the sill that goes down (`fitHeight`). The sill, for its part, is bounded by the height.
 */
export function openingLimits(
  room: Room, roomsOnLevel: readonly Room[], defaults: HouseDefaults, opening: Opening, ceiling: number,
): { maxWidth: number; maxHeight: number; maxSill: number } {
  const span = freeSpan(room, roomsOnLevel, defaults, opening)
  return {
    maxWidth: Math.max(MIN_OPENING_DIM, span ? span.u1 - span.u0 : opening.width),
    maxHeight: Math.max(MIN_OPENING_DIM, ceiling),
    maxSill: Math.max(0, ceiling - opening.height),
  }
}

/**
 * Dimensions of an opening that has just been placed, by kind. These are CATALOG values — a
 * door is 90 cm, a bay 2.40 m — that the survey will correct to the centimeter in the panel: they
 * do not have to be right, they have to be plausible so that one recognizes what has just been
 * placed in the scene.
 *
 * The height comes from the house (`doorHeight`) for everything that goes down to the floor, the sill too
 * (`windowSill`): setting these defaults once must apply to what is placed next. A window
 * of 1.20 m on a sill of 0.90 m arrives exactly at the height of a door — it is what one sees on
 * a facade, and it is why the two numbers go together.
 */
export function newOpeningDims(type: OpeningType, defaults: HouseDefaults): { width: number; height: number; sill: number } {
  if (isSurfaceOpening(type)) return { width: 1.2, height: 1.2, sill: 0 }
  if (type === 'window') return { width: 1.2, height: 1.2, sill: defaults.windowSill }
  const width = type === 'garage' || type === 'bay' ? 2.4 : 0.9
  return { width, height: defaults.doorHeight, sill: 0 }
}
