import type { Relief } from '../schema'
import { offsetPolygon, pointInPolygon, type Vec2 } from './vec2'
import type { TerrainDescriptor } from './types'

// Terrain relief: a grid of heights (`site.relief`) read as a smooth surface, clipped
// below the floors and flattened around the basins. Pure, without Three: the scene uses it for its mesh, `deviceFloorZ` to
// place a garden device, the editor for its handles.

/** The parsed grid: `cm[j * cols + i]`, row 0 at the south (y = origin[1]), column 0 at the west. */
export interface ReliefGrid {
  step: number
  origin: Vec2
  cols: number
  rows: number
  cm: number[]
}

/**
 * A BASIN sits on a flat ground: under it and over `PAD_FLAT` meters around it the relief does not
 * count, it then comes back gently over `PAD_BLEND` meters — otherwise the coping would float or
 * be buried. The landing also means the mesh, cut out around the basin, shows no
 * gap there: everything there is at the same height.
 *
 * The HOUSE, for its part, flattens nothing: the terrain can rise against its walls (an embankment that comes
 * to touch the terrace), and nodes UNDER it serve to shape its surroundings. It is only
 * clipped below each floor (`Footprint`), so that no bump pierces a floor.
 */
export const PAD_FLAT = 1
export const PAD_BLEND = 2

export function parseRelief(relief: Relief | undefined): ReliefGrid | null {
  if (!relief) return null
  const rows = relief.rows.map((row) => row.split(' ').map(Number))
  return { step: relief.step, origin: [relief.origin[0], relief.origin[1]], cols: rows[0]!.length, rows: rows.length, cm: rows.flat() }
}

export function serializeRelief(grid: ReliefGrid): Relief {
  const rows: string[] = []
  for (let j = 0; j < grid.rows; j++) rows.push(grid.cm.slice(j * grid.cols, (j + 1) * grid.cols).map((v) => Math.round(v)).join(' '))
  return { step: grid.step, origin: [grid.origin[0], grid.origin[1]], rows }
}

export const isFlatRelief = (grid: ReliefGrid): boolean => grid.cm.every((v) => Math.round(v) === 0)

/**
 * A zero grid that covers `polygon` with a margin of one cell, aligned on multiples of the step:
 * two grids made at the same step have the same nodes, whatever the outline.
 */
export function emptyReliefGrid(polygon: readonly Vec2[], step: number): ReliefGrid {
  const xs = polygon.map((p) => p[0]), ys = polygon.map((p) => p[1])
  const i0 = Math.floor(Math.min(...xs) / step) - 1, i1 = Math.ceil(Math.max(...xs) / step) + 1
  const j0 = Math.floor(Math.min(...ys) / step) - 1, j1 = Math.ceil(Math.max(...ys) / step) + 1
  const cols = i1 - i0 + 1, rows = j1 - j0 + 1
  return { step, origin: [i0 * step, j0 * step], cols, rows, cm: new Array<number>(cols * rows).fill(0) }
}

/**
 * The grid enlarged, if needed, to cover `polygon` with a margin of one cell (an outline that
 * has just been extended). The existing nodes keep their place and height; the new ones take
 * that of the nearest edge — what was already read there, since outside the grid the height
 * is that of the edge: the terrain does not move. Returns the SAME grid when it already covers everything.
 */
export function extendReliefGrid(grid: ReliefGrid, polygon: readonly Vec2[]): ReliefGrid {
  const xs = polygon.map((p) => p[0]), ys = polygon.map((p) => p[1])
  const s = grid.step
  const left = Math.max(0, Math.ceil((grid.origin[0] - (Math.min(...xs) - s)) / s - 1e-9))
  const bottom = Math.max(0, Math.ceil((grid.origin[1] - (Math.min(...ys) - s)) / s - 1e-9))
  const right = Math.max(0, Math.ceil((Math.max(...xs) + s - (grid.origin[0] + (grid.cols - 1) * s)) / s - 1e-9))
  const top = Math.max(0, Math.ceil((Math.max(...ys) + s - (grid.origin[1] + (grid.rows - 1) * s)) / s - 1e-9))
  if (!left && !bottom && !right && !top) return grid
  const cols = grid.cols + left + right, rows = grid.rows + bottom + top
  const cm = new Array<number>(cols * rows)
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cm[j * cols + i] = node(grid, i - left, j - bottom)
  return { step: s, origin: [grid.origin[0] - left * s, grid.origin[1] - bottom * s], cols, rows, cm }
}

/** Position of a node in the house reference frame. */
export const reliefNodeXY = (grid: ReliefGrid, i: number, j: number): Vec2 => [grid.origin[0] + i * grid.step, grid.origin[1] + j * grid.step]

const node = (g: ReliefGrid, i: number, j: number): number => {
  const ci = i < 0 ? 0 : i >= g.cols ? g.cols - 1 : i
  const cj = j < 0 ? 0 : j >= g.rows ? g.rows - 1 : j
  return g.cm[cj * g.cols + ci]!
}

/**
 * MONOTONE cubic (Fritsch–Butland) on [p1, p2]: passes THROUGH the nodes (the handle one pulls is
 * indeed at the displayed height) and NEVER leaves [p1, p2] between them. Catmull-Rom overshot: a
 * plateau followed by a drop gained a bump before the descent, and a dip at the foot of the slope.
 * The slope at a node is the HARMONIC mean of the two neighboring slopes, zero when they change
 * sign (a peak, a bottom, a plateau edge stay flat): that is what bounds the curve.
 */
function monotone(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const slope = (a: number, b: number) => (a * b <= 0 ? 0 : (2 * a * b) / (a + b))
  const d0 = p1 - p0, d1 = p2 - p1, d2 = p3 - p2
  const m1 = slope(d0, d1), m2 = slope(d1, d2)
  const t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2
}

/** Height offset (m) of the grid at (x, y), monotone bicubic; edge extended outside the grid. */
export function reliefDelta(grid: ReliefGrid, x: number, y: number): number {
  const u = (x - grid.origin[0]) / grid.step, v = (y - grid.origin[1]) / grid.step
  const i = Math.floor(u), j = Math.floor(v), tu = u - i, tv = v - j
  const row = (jj: number) => monotone(node(grid, i - 1, jj), node(grid, i, jj), node(grid, i + 1, jj), node(grid, i + 2, jj), tu)
  return monotone(row(j - 1), row(j), row(j + 1), row(j + 2), tv) / 100
}

/** Lowest and highest offset of the grid (m) — the smoothed surface does not leave it. */
export function reliefRange(grid: ReliefGrid | null): [number, number] {
  if (!grid) return [0, 0]
  let lo = 0, hi = 0
  for (const v of grid.cm) { if (v < lo) lo = v; if (v > hi) hi = v }
  return [lo / 100, hi / 100]
}

/** Flattened footprints: the basins. */
export function terrainPads(house: { site: { zones: readonly { kind: string; polygon: Vec2[] }[] } }): Vec2[][] {
  return house.site.zones.filter((z) => z.kind === 'pool').map((z) => z.polygon)
}

/** Footprint of a room seen from the terrain: under it, the ground does not exceed `ceiling` (absolute z). */
export interface Footprint { polygon: Vec2[]; ceiling: number }

/**
 * One footprint per room, widened by HALF the exterior wall (which sits outside, against the
 * outline of the room): the transition from free terrain to clipped terrain falls within the thickness of the
 * wall, invisible, and the ground touches the outer face at its true height. The ceiling is the underside
 * of the level's slab — never below the terrain elevation, which stays the ground of a flat house.
 *
 * The level outlines (`outline`) are not part of it: they are approximate footprints (those
 * of the real house are rectangles larger, or smaller, than the rooms).
 */
export function terrainFootprints(
  house: { rooms: readonly { polygon: Vec2[]; levelId: string }[]; levels: readonly { id: string; elevation: number }[]; site: { elevation: number } },
  defaults: { slabThickness: number; exteriorWallThickness: number },
): Footprint[] {
  const elevation = new Map(house.levels.map((l) => [l.id, l.elevation]))
  return house.rooms.map((r) => ({
    polygon: offsetPolygon(r.polygon, defaults.exteriorWallThickness / 2),
    ceiling: Math.max(house.site.elevation, (elevation.get(r.levelId) ?? 0) - defaults.slabThickness),
  }))
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

const smoothstep = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

interface PadSet { polys: Vec2[][]; min: Vec2; max: Vec2 }
const padSets = new WeakMap<Vec2[][], PadSet>()
function padSet(pads: Vec2[][]): PadSet {
  let set = padSets.get(pads)
  if (!set) {
    const pts = pads.flat()
    const reach = PAD_FLAT + PAD_BLEND
    set = pts.length
      ? { polys: pads, min: [Math.min(...pts.map((p) => p[0])) - reach, Math.min(...pts.map((p) => p[1])) - reach], max: [Math.max(...pts.map((p) => p[0])) + reach, Math.max(...pts.map((p) => p[1])) + reach] }
      : { polys: [], min: [0, 0], max: [-1, -1] }
    padSets.set(pads, set)
  }
  return set
}

/** Share of the relief that applies at (x, y): 0 on the building and its landing, 1 beyond the blend. */
export function padWeight(pads: Vec2[][], x: number, y: number): number {
  const set = padSet(pads)
  if (x < set.min[0] || y < set.min[1] || x > set.max[0] || y > set.max[1]) return 1
  const p: Vec2 = [x, y]
  let d = Infinity
  for (const poly of set.polys) {
    if (pointInPolygon(p, poly)) return 0
    for (let k = 0; k < poly.length; k++) d = Math.min(d, segmentDistance(p, poly[k]!, poly[(k + 1) % poly.length]!))
  }
  return smoothstep((d - PAD_FLAT) / PAD_BLEND)
}

interface FootprintBox { f: Footprint; x0: number; y0: number; x1: number; y1: number }
const footprintBoxes = new WeakMap<Footprint[], FootprintBox[]>()

/** The lowest of the ceilings of the footprints that cover (x, y); `Infinity` outside the house. */
export function footprintCeiling(footprints: Footprint[], x: number, y: number): number {
  let boxes = footprintBoxes.get(footprints)
  if (!boxes) {
    boxes = footprints.map((f) => {
      const xs = f.polygon.map((p) => p[0]), ys = f.polygon.map((p) => p[1])
      return { f, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
    })
    footprintBoxes.set(footprints, boxes)
  }
  let c = Infinity
  for (const b of boxes) {
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1 || b.f.ceiling >= c) continue
    if (pointInPolygon([x, y], b.f.polygon)) c = b.f.ceiling
  }
  return c
}

/**
 * The FREE surface of the relief at (x, y), before clipping below the floors: it is where a node
 * one pulls is, even under the house, where the drawn terrain stays below the floor.
 */
export function reliefSurface(terrain: TerrainDescriptor, x: number, y: number): number {
  if (!terrain.relief) return terrain.z
  const w = padWeight(terrain.pads, x, y)
  return w === 0 ? terrain.z : terrain.z + w * reliefDelta(terrain.relief, x, y)
}

/** ABSOLUTE height of the terrain at (x, y). Without relief, it is `terrain.z` everywhere, as before. */
export function terrainHeight(terrain: TerrainDescriptor, x: number, y: number): number {
  if (!terrain.relief) return terrain.z
  return Math.min(reliefSurface(terrain, x, y), footprintCeiling(terrain.footprints, x, y))
}
