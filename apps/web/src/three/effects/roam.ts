import { CatmullRomCurve3, Vector3 } from 'three'

// A COURSE over the whole terrain, for what moves around the house (`parade.ts`, `bats.ts`):
// a smooth loop drawn at random, which goes through a few points picked anywhere in the terrain,
// and which SKIRTS the house and the pool (unless it is not given them — the ghosts go through
// walls). The GARDEN (trees, bushes, hedges, rocks: `statics`) is planned too: a
// segment that cuts an element is diverted, and among the candidate loops we keep the one that touches
// the fewest. Only what MOVES — cars, mower (`around`) — is avoided on the way, read again at every
// position: the mower drives, a car arrives or leaves.
//
// Avoidance on the way first served for everything, garden included: on the real house (122 discs),
// the groves merged step by step into giant discs and the swerve sent the
// characters tens of meters away, out of the terrain (measured on 2026-10-01).
//
// A function of TIME, and not a state being integrated: `fly` reads the trajectory a little before and a little
// after to set the nose, the bike's trail reads back where it was. The loop is traveled at
// constant speed (arc length) and starts over at the end of a lap.
//
// Construction: waypoints drawn in the terrain (away from the edge, outside the footprints), in
// any order; a segment that would cut a footprint is diverted through its corners; then a
// centripetal Catmull-Rom smooths it all. The finished curve is SAMPLED and rejected if it
// bites into a footprint or leaves the terrain — we redraw, and as a last resort we circle around.

type XY = readonly [number, number]

export interface Box { min: XY; max: XY }

/** A small round obstacle, steered clear of on the way. */
export interface Circle { x: number; y: number; r: number }

/**
 * The small obstacles of the moment: the course's owner (`Parade`, `Bats`) replaces `list` at
 * every step, the course reads it again at every position.
 */
export interface Obstacles { list: readonly Circle[] }

export interface RoamArea {
  /** The terrain polygon, house local reference frame. */
  terrain: readonly XY[]
  /** The footprints to skirt (the house, the pool); empty to go through. */
  avoid: readonly Box[]
  /** The FIXED obstacles (the garden), skirted from the path onward. Absent = none. */
  statics?: readonly Circle[]
  /** The obstacles that MOVE (cars, mower), avoided on the way. Absent = none. */
  around?: Obstacles
}

export interface RoamOptions {
  /** Distance (m) kept from the footprints. */
  margin?: number
  /** Distance (m) kept from the edge of the terrain. */
  edge?: number
  /** Number of waypoints. */
  points?: number
  rnd?: () => number
}

/** A trajectory: the position at time `t` (z = 0, each sets its own height), written into `out`. */
export type Path = (t: number, out: Vector3) => Vector3

interface Rect { x0: number; y0: number; x1: number; y1: number }

export function roam(area: RoamArea, speed: number, opts: RoamOptions = {}): Path {
  const { margin = 2, edge = 1.5, points = 8, rnd = Math.random } = opts
  const poly = area.terrain
  // two footprints that touch once enlarged (the pool attached to the house) make only one:
  // the corner of one would fall inside the other, and no detour would get through
  const boxes = merge(area.avoid.map((b) => grow({ x0: b.min[0], y0: b.min[1], x1: b.max[0], y1: b.max[1] }, margin)))
  const hit = (x: number, y: number, m: number) => boxes.some((r) => inRect(grow(r, m), x, y))
  const ok = (x: number, y: number, slack: number) =>
    inside(poly, x, y) && edgeDistance(poly, x, y) >= edge * slack && !hit(x, y, -margin * (1 - slack))
  const garden = new CircleGrid(area.statics ?? [])

  // Several candidate loops. The terrain and the footprints are rules; the garden, a
  // preference: we keep the one that touches the fewest elements, then the most FLOWING (the one whose
  // tightest bend is the widest). A garden that is too dense thus lets one brush a bush
  // rather than go round in circles around the house.
  let best: CatmullRomCurve3 | null = null, bestTouch = Infinity, bestRadius = -1, clean = 0, valid = 0
  for (let attempt = 0; attempt < 30 && clean < CANDIDATES && valid < MAX_VALID; attempt++) {
    const way = waypoints(poly, points, (x, y) => ok(x, y, 1) && !hit(x, y, margin * 0.5) && !garden.hit(x, y, 2 * STATIC_MARGIN), rnd)
    if (way.length < 3) break
    const order = tour(way)
    const free = (x: number, y: number) => ok(x, y, 1)
    const loop = detour(order, boxes, margin, garden, free)
    const bare = detour(order, boxes, margin, NO_GARDEN, free)
    // rounded corners first; if they bite into a footprint, sharp corners; and if the garden's
    // detours lead out of the terrain, the loop that ignores it (it will touch it, but it stays inside)
    for (const pts of [spaced(chaikin(chaikin(loop))), spaced(loop), spaced(chaikin(chaikin(bare))), spaced(bare)]) {
      if (pts.length < 3) continue
      const curve = new CatmullRomCurve3(pts.map(([x, y]) => new Vector3(x, y, 0)), true, 'centripetal')
      curve.arcLengthDivisions = Math.max(200, 16 * pts.length, Math.ceil(curve.getLength() / 0.5))   // the table is in parameter steps: fine enough on short segments
      curve.updateArcLengths()
      // the smooth curve can overshoot between two points: we check it for real, with a little slack
      const samples = curve.getSpacedPoints(Math.min(600, Math.ceil(curve.getLength() / 0.5)))
      if (!samples.every((p) => ok(p.x, p.y, 0.5))) continue
      const touch = samples.reduce((n, p) => n + (garden.hit(p.x, p.y, STATIC_MARGIN * 0.5) ? 1 : 0), 0)
      valid++
      if (touch === 0) clean++
      const r = tightestTurn(samples)
      if (touch < bestTouch || (touch === bestTouch && r > bestRadius)) { best = curve; bestTouch = touch; bestRadius = r }
      break
    }
  }
  const base = best ? along(best, speed) : circle(area.terrain, boxes, speed)
  return area.around ? swerve(base, speed, area.around, (x, y) => hit(x, y, -margin * 0.5)) : base
}

/** Number of loops that touch nothing compared before choosing. */
const CANDIDATES = 6
/**
 * Valid loops at most: a dense garden leaves none without contact, and each one costs
 * (~3 ms on the real house) — we then compare those, instead of going through all 30 draws.
 */
const MAX_VALID = 10
/** Distance (m) kept from the garden elements. */
const STATIC_MARGIN = 0.6

/**
 * The garden discs sorted into 4 m cells: the real house has 122, and every
 * sample of every candidate loop is tested against them.
 */
class CircleGrid {
  private readonly cells = new Map<string, Circle[]>()
  private readonly reach: number
  constructor(readonly all: readonly Circle[]) {
    this.reach = Math.max(0, ...all.map((c) => c.r))
    for (const c of all) {
      const k = `${Math.floor(c.x / CELL)},${Math.floor(c.y / CELL)}`
      const cell = this.cells.get(k)
      if (cell) cell.push(c)
      else this.cells.set(k, [c])
    }
  }

  /** The first disc within `m` (m) of its edge, or `null`. */
  near(x: number, y: number, m: number): Circle | null {
    if (!this.all.length) return null
    const span = Math.ceil((this.reach + m) / CELL)
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL)
    for (let i = cx - span; i <= cx + span; i++) {
      for (let j = cy - span; j <= cy + span; j++) {
        for (const c of this.cells.get(`${i},${j}`) ?? []) if (Math.hypot(x - c.x, y - c.y) < c.r + m) return c
      }
    }
    return null
  }

  hit(x: number, y: number, m: number): boolean {
    return this.near(x, y, m) !== null
  }

  /** The disc that segment `a`-`b` cuts (within `m`) the earliest, or `null`. */
  crossing(a: XY, b: XY, m: number): Circle | null {
    let best: Circle | null = null, bestT = Infinity
    for (const c of this.all) {
      const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1
      const t = Math.max(0, Math.min(1, ((c.x - a[0]) * vx + (c.y - a[1]) * vy) / l2))
      if (Math.hypot(a[0] + t * vx - c.x, a[1] + t * vy - c.y) < c.r + m && t < bestT) { best = c; bestT = t }
    }
    return best
  }
}
const CELL = 4
const NO_GARDEN = new CircleGrid([])

/**
 * The radius (m) of the tightest bend of a loop sampled at a regular step: the angle by which the
 * heading turns over a window of a few meters, relative to its length.
 */
function tightestTurn(samples: readonly Vector3[]): number {
  const n = samples.length - 1                           // the last point repeats the first
  const step = samples[0]!.distanceTo(samples[1]!) || 1e-6
  const w = Math.max(1, Math.round(1 / step))            // ~1 m window: a 20 cm knot shows up in it
  const heading = (i: number) => {
    const a = samples[((i % n) + n) % n]!, b = samples[(((i + 1) % n) + n) % n]!
    return Math.atan2(b.y - a.y, b.x - a.x)
  }
  let min = Infinity
  for (let i = 0; i < n; i++) {
    let turn = Math.abs(heading(i + w) - heading(i))
    if (turn > Math.PI) turn = 2 * Math.PI - turn
    min = Math.min(min, turn > 1e-6 ? (w * step) / turn : Infinity)
  }
  return min
}

/**
 * A visiting order without crossings: nearest neighbor, then 2-opt (two segments are uncrossed
 * as long as that shortens the loop). A random order made figure eights and U-turns.
 */
function tour(way: readonly XY[]): XY[] {
  const left = [...way], out: XY[] = [left.shift()!]
  while (left.length) {
    const last = out[out.length - 1]!
    let k = 0
    for (let i = 1; i < left.length; i++) if (dist(last, left[i]!) < dist(last, left[k]!)) k = i
    out.push(left.splice(k, 1)[0]!)
  }
  for (let improved = true, pass = 0; improved && pass < 20; pass++) {
    improved = false
    for (let i = 0; i < out.length - 1; i++) {
      for (let j = i + 2; j < out.length - (i === 0 ? 1 : 0); j++) {
        const a = out[i]!, b = out[i + 1]!, c = out[j]!, d = out[(j + 1) % out.length]!
        if (dist(a, c) + dist(b, d) < dist(a, b) + dist(c, d) - 1e-9) {
          out.splice(i + 1, j - i, ...out.slice(i + 1, j + 1).reverse())
          improved = true
        }
      }
    }
  }
  return out
}

/** Minimum gap (m) between two control points: closer, the Catmull-Rom makes a tight knot there. */
const MIN_GAP = 1.5

/** Removes the control points too close to the previous kept one (closed loop: the last one from the first too). */
function spaced(loop: readonly XY[]): XY[] {
  const out: XY[] = []
  for (const p of loop) if (!out.length || dist(out[out.length - 1]!, p) >= MIN_GAP) out.push(p)
  while (out.length > 1 && dist(out[out.length - 1]!, out[0]!) < MIN_GAP) out.pop()
  return out
}

/** One Chaikin pass on a closed loop: each corner is replaced by two points at 1/4 and 3/4. */
function chaikin(loop: readonly XY[]): XY[] {
  const out: XY[] = []
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!, b = loop[(i + 1) % loop.length]!
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]])
  }
  return out
}

/**
 * Margin (m) added to the radius of a moving obstacle. Below `STATIC_MARGIN`: a parked car, already
 * skirted by the path, does not trigger an extra swerve.
 */
const SWERVE_MARGIN = 0.5
/** Below this (m), an obstacle is "on" the path: its side is no longer decided by the sign. */
const SIDE_DEADBAND = 0.05
/** Share of the half window where the swerve is full. */
const PLATEAU = 0.35
/** Distance (m) to an obstacle's edge below which the safeguard moves the point out. */
const GUARD = 0.15

const clusters = new WeakMap<readonly Circle[], readonly Circle[]>()
/** Radius (m) beyond which two moving obstacles no longer merge (two cars, yes; a parking lot, no). */
const MAX_CLUSTER = 6

/**
 * The obstacles too close to pass between them (two cars parked side by side, a grove)
 * merged into a single disc that contains them: avoiding one pushed onto the other, and the two swerves
 * fought each other (measured: characters inside a car, 15 cm bends). Computed once per list
 * (the owner replaces it at every step), not at every position.
 */
function clustered(list: readonly Circle[]): readonly Circle[] {
  let out = clusters.get(list)
  if (out) return out
  const cs = list.map((c) => ({ ...c }))
  for (let merged = true; merged;) {
    merged = false
    for (let i = 0; i < cs.length && !merged; i++) {
      for (let j = i + 1; j < cs.length && !merged; j++) {
        const a = cs[i]!, b = cs[j]!, d = Math.hypot(b.x - a.x, b.y - a.y)
        if (d >= a.r + b.r + 2 * SWERVE_MARGIN) continue
        // the smallest disc that contains both; capped: beyond it, we keep both
        const r = Math.max(a.r, b.r, (d + a.r + b.r) / 2)
        if (r > MAX_CLUSTER) continue
        const k = d > 1e-9 && r > a.r ? (r - a.r) / d : 0
        cs[i] = r === b.r && b.r >= a.r + d ? b : { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, r }
        cs.splice(j, 1)
        merged = true
      }
    }
  }
  out = cs
  clusters.set(list, out)
  return out
}

/**
 * STEERS CLEAR of the small obstacles, by ENCOUNTER: for each nearby obstacle, we look for where the
 * base course passes closest (over a time window around `t`), we choose the side
 * once for the whole encounter — opposite the obstacle, or the other side if that one goes
 * into a footprint — and we offset across the heading TAKEN AT THAT PASS, by as much as needed to
 * pass at `R`, with a bell centered on the closest pass.
 *
 * A first attempt pushed the point RADIALLY from the obstacle's center: when the
 * course went through that center, the push reversed all at once and the character jumped
 * to the other side (measured: bend radius 0 on two skeletons). Here, nothing depends on `t` except
 * through continuous functions, and the closest pass is refined (not taken on the
 * sample grid, which moves with `t`).
 */
function swerve(base: Path, speed: number, obstacles: Obstacles, blocked: (x: number, y: number) => boolean): Path {
  const q = new Vector3(), a = new Vector3(), b = new Vector3()
  const grid = new Float64Array(21)
  const away = (tt: number, o: Circle) => { base(tt, q); return Math.hypot(q.x - o.x, q.y - o.y) }
  /** The unit heading of the base course at time `tt`. */
  const heading = (tt: number): [number, number] => {
    base(tt - 0.05, a); base(tt + 0.05, b)
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return [(b.x - a.x) / l, (b.y - a.y) / l]
  }
  return (t, out) => {
    base(t, out)
    const x0 = out.x, y0 = out.y
    let dx = 0, dy = 0
    for (const o of clustered(obstacles.list)) {
      const R = o.r + SWERVE_MARGIN
      const W = (2 * R) / speed + 0.5                    // we start swerving ~2 R before
      if (Math.hypot(x0 - o.x, y0 - o.y) > R + speed * W) continue
      // each closest pass — each LOCAL MINIMUM of the distance over the window — is a separate
      // encounter. Taking only the global minimum flipped from one pass to the other when
      // the course goes around the obstacle (two nearby passes), and the side with it: the character
      // jumped from one edge to the other. A local minimum keeps its instant as long as it is in the window.
      // the grid overflows by two steps on each side: a minimum entering the window is seen
      // beforehand, while its bell is still zero (otherwise it would appear all at once, already raised)
      const N = 16, h = (2 * W) / N, t0 = t - W - 2 * h
      for (let k = 0; k <= N + 4; k++) grid[k] = away(t0 + k * h, o)
      for (let k = 1; k < N + 4; k++) {
        // strict on one side: a plateau of two equal values only counts once
        if (grid[k]! >= grid[k - 1]! || grid[k]! > grid[k + 1]! || grid[k]! >= R + h * speed) continue
        // refined by ternary search between the two neighbors: the instant no longer depends on the grid
        let lo = t0 + (k - 1) * h, hi = t0 + (k + 1) * h
        for (let it = 0; it < 12; it++) {
          const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3
          if (away(m1, o) < away(m2, o)) hi = m2
          else lo = m1
        }
        const tc = (lo + hi) / 2
        if (away(tc, o) >= R) continue
        const qx = q.x, qy = q.y
        const [cx, cy] = heading(tc)
        const s0 = (o.x - qx) * -cy + (o.y - qy) * cx    // > 0: the obstacle is to the left of the path
        // the opposite side, the shortest. An obstacle RIGHT ON the path (|s0| ~ 0) is always passed on the
        // right: its sign wobbles by a millimeter from one instant to the next, and the side with it —
        // each flip made the character jump by 2 R
        const left = s0 < -SIDE_DEADBAND
        let shift = left ? s0 + R : s0 - R
        if (blocked(qx - cy * shift, qy + cx * shift)) shift = left ? s0 - R : s0 + R
        // a PLATEAU bell: full swerve over the central third of the window (a large obstacle is
        // followed along), then a cosine down to zero — zero slope at both joins, the heading does not break
        const u = Math.max(0, (Math.abs(t - tc) / W - PLATEAU) / (1 - PLATEAU))
        const bump = 0.5 * (1 + Math.cos(Math.PI * Math.min(1, u)))
        // across the heading AT THE closest PASS, a fixed vector over the whole encounter: the normal
        // of the moment turned with a course already going around the obstacle, and the swerve went into it
        dx += -cy * shift * bump
        dy += cx * shift * bump
      }
    }
    out.x = x0 + dx
    out.y = y0 + dy
    // safeguard: the bell is an approximation (a course that turns during the encounter); what
    // remains within `GUARD` of an obstacle is moved out onto its edge — a touch-up of a few
    // centimeters, far from the center, hence without a jump
    for (const o of clustered(obstacles.list)) {
      const ex = out.x - o.x, ey = out.y - o.y, d = Math.hypot(ex, ey), r = o.r + GUARD
      if (d < r && d > 1e-6) { out.x = o.x + (ex / d) * r; out.y = o.y + (ey / d) * r }
    }
    return out
  }
}

/** Travels `curve` at `speed` m/s, in a loop. */
function along(curve: CatmullRomCurve3, speed: number): Path {
  const length = curve.getLength()
  return (t, out) => {
    const u = (((t * speed) / length) % 1 + 1) % 1
    return curve.getPointAt(u, out)
  }
}

/** The last resort: a circle around all the footprints (or the terrain), without checking anything. */
function circle(terrain: readonly XY[], boxes: readonly Rect[], speed: number): Path {
  const t = bbox(terrain)
  const b = boxes.length ? merge([boxes.reduce(union)])[0]! : { x0: t.min[0], y0: t.min[1], x1: t.max[0], y1: t.max[1] }
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
  const r = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2
  const w = speed / Math.max(r, 1)
  return (t, out) => out.set(cx + Math.cos(w * t) * r, cy + Math.sin(w * t) * r, 0)
}

function waypoints(poly: readonly XY[], n: number, ok: (x: number, y: number) => boolean, rnd: () => number): XY[] {
  const b = bbox(poly)
  const out: XY[] = []
  for (let tries = 0; out.length < n && tries < n * 200; tries++) {
    const x = b.min[0] + rnd() * (b.max[0] - b.min[0]), y = b.min[1] + rnd() * (b.max[1] - b.min[1])
    if (ok(x, y)) out.push([x, y])
  }
  return out
}

/**
 * Inserts, between two points whose segment would cut a footprint, the corners to go around: those
 * of a slightly larger rectangle, the shorter of the two directions of rotation. The detour pieces
 * are rechecked against the OTHER footprints (the pool next to the house), to a bounded depth.
 */
function detour(way: readonly XY[], boxes: readonly Rect[], margin: number, garden: CircleGrid, free: (x: number, y: number) => boolean): XY[] {
  const out: XY[] = []
  for (let i = 0; i < way.length; i++) {
    const a = way[i]!, b = way[(i + 1) % way.length]!
    out.push(a, ...between(a, b, boxes, margin, garden, free, 0))
  }
  return out
}

/**
 * The points to pass through between `a` and `b` (excluded) so as to cut no footprint, nor any garden
 * element: a footprint is skirted by its corners, an element by a point placed beside it, on the
 * side where the segment already passed.
 */
function between(a: XY, b: XY, boxes: readonly Rect[], margin: number, garden: CircleGrid, free: (x: number, y: number) => boolean, depth: number): XY[] {
  if (depth > 4) return []
  const box = boxes.find((r) => crosses(r, a, b))
  if (box && depth > 3) return []                        // beyond that, the corners nest into knots
  let route: XY[] | null = box ? around(box, a, b, margin) : null
  if (!box) {
    const c = garden.crossing(a, b, STATIC_MARGIN)
    if (!c) return []
    const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1
    const t = Math.max(0, Math.min(1, ((c.x - a[0]) * vx + (c.y - a[1]) * vy) / l2))
    let nx = a[0] + t * vx - c.x, ny = a[1] + t * vy - c.y
    const l = Math.hypot(nx, ny)
    if (l > 1e-6) { nx /= l; ny /= l } else { const lv = Math.sqrt(l2); nx = -vy / lv; ny = vx / lv }
    const off = c.r + 2 * STATIC_MARGIN + 0.5
    const x = c.x + nx * off, y = c.y + ny * off
    // a detour that would leave the terrain or enter a footprint: we will brush the element
    if (!free(x, y)) return []
    route = [[x, y]]
  }
  if (!route) return []
  const pts = [a, ...route, b]
  const out: XY[] = []
  for (let k = 0; k < pts.length - 1; k++) {
    if (k > 0) out.push(pts[k]!)
    out.push(...between(pts[k]!, pts[k + 1]!, boxes, margin, garden, free, depth + 1))
  }
  return out
}

/** From `a` to `b` around `box`, through the corners of a rectangle enlarged by `margin`. */
function around(box: Rect, a: XY, b: XY, margin: number): XY[] | null {
  const c = grow(box, margin)
  const corners: XY[] = [[c.x0, c.y0], [c.x1, c.y0], [c.x1, c.y1], [c.x0, c.y1]]
  let best: XY[] | null = null, bestLen = Infinity
  for (let s = 0; s < 4; s++) {
    if (crosses(box, a, corners[s]!)) continue
    for (const dir of [1, 3]) {
      // from corner to corner in one direction, up to the first one from which `b` is visible
      const route: XY[] = [corners[s]!]
      for (let k = s; crosses(box, route[route.length - 1]!, b) && route.length < 4;) {
        k = (k + dir) % 4
        route.push(corners[k]!)
      }
      let len = dist(a, route[0]!) + dist(route[route.length - 1]!, b)
      for (let k = 1; k < route.length; k++) len += dist(route[k - 1]!, route[k]!)
      if (len < bestLen) { best = route; bestLen = len }
    }
  }
  return best
}

// ---- plane geometry -----------------------------------------------------------------------------

const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m })
const inRect = (r: Rect, x: number, y: number) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1
const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1])
const union = (a: Rect, b: Rect): Rect => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })
const overlap = (a: Rect, b: Rect) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1

/** Merges the overlapping boxes into a single one, until none touches another. */
function merge(boxes: readonly Rect[]): Rect[] {
  const out = [...boxes]
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (!overlap(out[i]!, out[j]!)) continue
      out[i] = union(out[i]!, out[j]!)
      out.splice(j, 1)
      j = i                                              // the box grew: recheck everything
    }
  }
  return out
}

function bbox(poly: readonly XY[]): Box {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1])
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] }
}

/** Does segment `a`-`b` cross the interior of the rectangle? (Liang-Barsky.) */
function crosses(r: Rect, a: XY, b: XY): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  let t0 = 0, t1 = 1
  for (const [p, q] of [[-dx, a[0] - r.x0], [dx, r.x1 - a[0]], [-dy, a[1] - r.y0], [dy, r.y1 - a[1]]] as const) {
    if (p === 0) { if (q <= 0) return false; continue }
    const t = q / p
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t }
    else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return t1 - t0 > 1e-9
}

function inside(poly: readonly XY[], x: number, y: number): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

function edgeDistance(poly: readonly XY[], x: number, y: number): number {
  let d = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j]!, [bx, by] = poly[i]!
    const vx = bx - ax, vy = by - ay
    const k = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)))
    d = Math.min(d, Math.hypot(x - ax - k * vx, y - ay - k * vy))
  }
  return d
}
