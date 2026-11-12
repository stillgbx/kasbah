import { describe, expect, it } from 'vitest'
import { dropTexel, LensWater, LensWaterSim, streakTexel } from './lensWater'

/** A seeded generator: the same glass at every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const run = (sim: LensWaterSim, seconds: number, onStep?: () => void) => {
  for (let t = 0; t < seconds; t += 0.05) { sim.step(0.05); onStep?.() }
}

describe('water on the lens', () => {
  it('rain wets the glass, drops run down and leave a trail', () => {
    const sim = new LensWaterSim(1600, 900, 'rain', 0.8, seeded(1))
    let ran = false
    let maxTrails = 0
    const before = new Map<object, number>()
    run(sim, 60, () => {
      for (const d of sim.drops) {
        if (d.sliding) {
          ran = true
          const y = before.get(d)
          if (y !== undefined) expect(d.y).toBeGreaterThanOrEqual(y)
          before.set(d, d.y)
        }
      }
      maxTrails = Math.max(maxTrails, sim.drops.filter((d) => d.trail).length)
    })
    expect(sim.drops.length).toBeGreaterThan(50)
    expect(ran).toBe(true)
    expect(maxTrails).toBeGreaterThan(10)
  })

  it('a drop that gives way accelerates: gravity, not a constant glide', () => {
    const sim = new LensWaterSim(1600, 900, 'rain', 0, seeded(6))
    sim.drops.push({ x: 800, y: 100, r: 14, sx: 1, sy: 1, life: 30, sliding: true, v: 0, vTarget: 0, vx: 0, retarget: 10, trailRun: 0, trail: false, flake: false, blobs: [], age: 0, grip: 0.5, angle: 0 })
    const drop = sim.drops[0]!
    const ys: number[] = []
    for (let i = 0; i < 12; i++) { sim.step(0.05); ys.push(drop.y) }
    const firstSteps = ys[2]! - ys[0]!, lastSteps = ys[11]! - ys[9]!
    expect(lastSteps).toBeGreaterThan(firstSteps * 2)
    // its trail follows the whole way, without holes wider than a few steps
    const trail = sim.drops.filter((d) => d.trail).map((d) => d.y).sort((a, b) => a - b)
    for (let i = 1; i < trail.length; i++) expect(trail[i]! - trail[i - 1]!).toBeLessThan(6)
  })

  it('the glass steers a running drop: its path winds instead of a straight line', () => {
    const sim = new LensWaterSim(1600, 2000, 'rain', 0, seeded(7))
    sim.drops.push({ x: 800, y: 50, r: 16, sx: 1, sy: 1, life: 30, sliding: true, v: 0, vTarget: 0, vx: 0, retarget: 10, trailRun: 0, trail: false, flake: false, blobs: [], age: 0, grip: 0.5, angle: 0 })
    const drop = sim.drops[0]!
    const xs: number[] = []
    for (let i = 0; i < 80 && drop.sliding; i++) { sim.step(0.05); xs.push(drop.x) }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(8)
    // and it does not run off sideways: still a fall
    expect(drop.y - 50).toBeGreaterThan(Math.abs(drop.x - 800) * 2)
  })

  it('when it stops, the glass dries and the effect is done', () => {
    const sim = new LensWaterSim(1600, 900, 'rain', 1, seeded(2))
    run(sim, 20)
    sim.setParams(null, 0)
    expect(sim.done).toBe(false)
    run(sim, 60)
    expect(sim.drops).toHaveLength(0)
    expect(sim.done).toBe(true)
  })

  it('snow sticks as flakes, which never run, then melt into water', () => {
    const sim = new LensWaterSim(1600, 900, 'snow', 0.8, seeded(3))
    let melted = 0
    run(sim, 30, () => {
      expect(sim.drops.some((d) => d.sliding && d.flake)).toBe(false)
      melted = Math.max(melted, sim.drops.filter((d) => !d.flake).length)
    })
    expect(sim.drops.some((d) => d.flake)).toBe(true)
    expect(melted).toBeGreaterThan(0)
  })

  it('the count stays bounded under a long downpour', () => {
    const sim = new LensWaterSim(1920, 1080, 'rain', 1, seeded(4))
    run(sim, 60)
    expect(sim.drops.length).toBeLessThanOrEqual(1400)
  })

  it('runs without a 2D context (no texture), as in the tests', () => {
    const lens = new LensWater(800, 600, 'rain', 0.8, seeded(5))
    expect(lens.texture).toBeNull()
    lens.step(0.05)
    lens.resize(400, 300)
    expect(lens.sim.width).toBe(400)
  })

  it('a drop is a lens: flat in the middle, its normal pointing out at the rim, green pointing UP', () => {
    expect(dropTexel(0, 0).slice(0, 2)).toEqual([128, 128])
    expect(dropTexel(0.9, 0)[0]).toBeGreaterThan(200)     // right rim: normal to the right
    expect(dropTexel(0, -0.9)[1]).toBeGreaterThan(200)    // top of the sprite (canvas y down): normal up
    expect(dropTexel(0.8, 0.8)[3]).toBe(0)                // outside the disc
    expect(dropTexel(0.3, 0.2)[3]).toBe(255)
  })

  it('a rivulet bends the image across only', () => {
    const [r, g] = streakTexel(0.8, 0.3)
    expect(r).toBeGreaterThan(200)
    expect(g).toBe(128)
    expect(streakTexel(0, 0.99)[3]).toBeLessThan(10)      // its ends fade into the next piece
  })
})
