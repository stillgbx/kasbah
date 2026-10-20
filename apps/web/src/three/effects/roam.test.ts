import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { type Obstacles, roam, type RoamArea } from './roam'

// an L-shaped terrain of 50 × 45 m, the house in the inner corner
const TERRAIN = [[0, 0], [50, 0], [50, 20], [25, 20], [25, 45], [0, 45]] as const
const HOUSE = { min: [10, 8], max: [20, 16] } as const
const SITE: RoamArea = { terrain: TERRAIN, avoid: [HOUSE] }

/** A replayable randomness (mulberry32), to draw several courses without depending on luck. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const inL = (x: number, y: number) => x > 0 && y > 0 && ((x < 50 && y < 20) || (x < 25 && y < 45))
const inHouse = (x: number, y: number, m = 0) => x > 10 - m && x < 20 + m && y > 8 - m && y < 16 + m

/** One full lap of the loop, finely sampled. */
function lap(path: ReturnType<typeof roam>, speed: number): Vector3[] {
  const out: Vector3[] = []
  const p0 = path(0, new Vector3())
  for (let t = 0.1; t < 2000 / speed; t += 0.1) {
    const p = path(t, new Vector3())
    out.push(p)
    if (out.length > 50 && p.distanceTo(p0) < speed * 0.1) break   // back at the start
  }
  return out
}

describe('roam', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('draw %i: stays in the terrain and out of the house, over a whole lap', (seed) => {
    const path = roam(SITE, 5, { rnd: seeded(seed) })
    for (const p of lap(path, 5)) {
      expect(inL(p.x, p.y)).toBe(true)
      expect(inHouse(p.x, p.y, 0.5)).toBe(false)
      expect(p.z).toBe(0)
    }
  })

  it('roams the terrain, and not only the surroundings of the house', () => {
    const path = roam(SITE, 5, { rnd: seeded(42) })
    const far = Math.max(...lap(path, 5).map((p) => Math.hypot(p.x - 15, p.y - 12)))
    expect(far).toBeGreaterThan(18)                      // the house is 10 × 8: we are well beyond
  })

  it('moves at constant speed', () => {
    const path = roam(SITE, 4, { rnd: seeded(7) })
    const a = new Vector3(), b = new Vector3()
    for (let t = 0; t < 30; t += 1.7) {
      const d = path(t + 0.05, b).distanceTo(path(t, a)) / 0.05
      expect(d).toBeGreaterThan(3.6)
      expect(d).toBeLessThan(4.4)                 // the arc-length table is approximate
    }
  })

  it('with no house to avoid, also goes through its footprint', () => {
    const hits = [1, 2, 3, 4, 5, 6].some((seed) => lap(roam({ terrain: TERRAIN, avoid: [] }, 5, { rnd: seeded(seed) }), 5).some((p) => inHouse(p.x, p.y)))
    expect(hits).toBe(true)
  })

  it('on a terrain too small to turn around, falls back to a finite circle', () => {
    const path = roam({ terrain: [[9, 7], [21, 7], [21, 17], [9, 17]], avoid: [HOUSE] }, 3, { rnd: seeded(1) })
    const p = path(12.5, new Vector3())
    expect(Number.isFinite(p.x + p.y)).toBe(true)
    expect(inHouse(p.x, p.y)).toBe(false)
  })

  it.each([1, 2, 3, 4])('draw %i: also skirts the pool attached to the house', (seed) => {
    const pool = { min: [20, 9], max: [24, 15] } as const
    for (const p of lap(roam({ terrain: TERRAIN, avoid: [HOUSE, pool] }, 5, { rnd: seeded(seed) }), 5)) {
      expect(inHouse(p.x, p.y, 0.5)).toBe(false)
      expect(p.x > 19.5 && p.x < 24.5 && p.y > 8.5 && p.y < 15.5).toBe(false)
    }
  })

  it.each([1, 2, 3, 4, 5, 6])('draw %i: skirts a tree placed ON the course and a mower crossing it, without ever jumping', (seed) => {
    const free = roam(SITE, 5, { rnd: seeded(seed) })
    const around: Obstacles = { list: [] }
    const path = roam({ ...SITE, around }, 5, { rnd: seeded(seed) })   // same draw: same base course
    const tree = free(7, new Vector3())                  // right in the middle of the way
    const prev = new Vector3(), out = new Vector3()
    for (let t = 0; t < 60; t += 0.05) {
      // the mower goes back and forth across the terrain, ~0.5 m/s (a real one does not teleport)
      const mower = { x: 25 + 20 * Math.sin(t * 0.025), y: 4 + 3 * Math.sin(t * 0.07), r: 0.6 }
      around.list = [{ x: tree.x, y: tree.y, r: 1.5 }, mower]
      path(t, out)
      for (const o of around.list) expect(Math.hypot(out.x - o.x, out.y - o.y)).toBeGreaterThan(o.r)
      if (t > 0) expect(out.distanceTo(prev)).toBeLessThan(5 * 0.05 * 3)   // never more than 3 times the step
      prev.copy(out)
    }
  })

  it.each([1, 2, 3, 4, 5, 6])('draw %i: no sharp U-turn, the tightest bend keeps a radius over 1 m', (seed) => {
    // measured on 2026-10-01: 0.6 to 0.7 m before the visiting order and the corner rounding, 1.2 to 2.9 m after
    const pts = lap(roam(SITE, 5, { rnd: seeded(seed) }), 5)
    // heading over two successive 2 m chords (4 steps of 0.5 m): radius ≈ 2 m / angle
    for (let i = 0; i + 8 < pts.length; i++) {
      const h1 = Math.atan2(pts[i + 4]!.y - pts[i]!.y, pts[i + 4]!.x - pts[i]!.x)
      const h2 = Math.atan2(pts[i + 8]!.y - pts[i + 4]!.y, pts[i + 8]!.x - pts[i + 4]!.x)
      let turn = Math.abs(h2 - h1)
      if (turn > Math.PI) turn = 2 * Math.PI - turn
      expect(2 / turn).toBeGreaterThan(1)
    }
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('draw %i: no tight knot at small scale either', (seed) => {
    // a 20 cm knot hid under the 2 m measurement: 0.5 m chords here
    const pts = lap(roam(SITE, 5, { rnd: seeded(seed) }), 5)
    for (let i = 0; i + 2 < pts.length; i++) {
      const h1 = Math.atan2(pts[i + 1]!.y - pts[i]!.y, pts[i + 1]!.x - pts[i]!.x)
      const h2 = Math.atan2(pts[i + 2]!.y - pts[i + 1]!.y, pts[i + 2]!.x - pts[i + 1]!.x)
      let turn = Math.abs(h2 - h1)
      if (turn > Math.PI) turn = 2 * Math.PI - turn
      expect(0.5 / turn).toBeGreaterThan(0.6)
    }
  })

  it.each([1, 2, 3, 4, 5, 6])('draw %i: two cars parked side by side, on the course: we skirt the whole', (seed) => {
    const free = roam(SITE, 5, { rnd: seeded(seed) })
    const at = free(9, new Vector3()), h = free(9.1, new Vector3()).sub(at).normalize()
    // side by side ACROSS the way, 5 m axis to axis: too tight to pass between the two
    const cars = [-2.5, 2.5].map((k) => ({ x: at.x - h.y * k, y: at.y + h.x * k, r: 2.6 }))
    const path = roam({ ...SITE, around: { list: cars } }, 5, { rnd: seeded(seed) })
    const out = new Vector3()
    for (let t = 0; t < 30; t += 0.05) {
      path(t, out)
      for (const c of cars) expect(Math.hypot(out.x - c.x, out.y - c.y)).toBeGreaterThan(c.r)
    }
  })

  it.each([1, 2, 3, 4, 5, 6])('draw %i: skirts the garden from the path onward (a sparse grove is not touched)', (seed) => {
    // a row of trees across the terrain, with 4 m gaps, and a few bushes
    const statics = [
      ...[2, 9, 16, 30, 37, 44].map((x) => ({ x, y: 4, r: 1.5 })),
      { x: 5, y: 30, r: 1 }, { x: 18, y: 38, r: 1 }, { x: 40, y: 15, r: 1.2 },
    ]
    const pts = lap(roam({ ...SITE, statics }, 5, { rnd: seeded(seed) }), 5)
    const touching = pts.filter((p) => statics.some((c) => Math.hypot(p.x - c.x, p.y - c.y) < c.r)).length
    expect(touching).toBe(0)
    for (const p of pts) expect(inL(p.x, p.y)).toBe(true)
  })

  it("a dense garden sends nobody out of the terrain: we brush past rather than leave", () => {
    // 150 tight discs over the whole terrain: no loop passes without contact
    const rnd = seeded(99)
    const statics = Array.from({ length: 150 }, () => ({ x: rnd() * 50, y: rnd() * 45, r: 0.5 + rnd() }))
    for (const seed of [1, 2, 3]) {
      for (const p of lap(roam({ ...SITE, statics }, 5, { rnd: seeded(seed) }), 5)) {
        expect(inL(p.x, p.y)).toBe(true)
        expect(inHouse(p.x, p.y, 0.5)).toBe(false)
      }
    }
  })
})
