import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { SPECIES } from './species'
import { DEFAULT_HEDGE_WIDTH } from '@kasbah/shared'
import { autoHedgeSpacing, hedgeShape } from './hedgeShape'

const boxOf = (shape: ReturnType<typeof hedgeShape>) => {
  const box = new Box3()
  for (const { geometry } of shape.parts) { geometry.computeBoundingBox(); box.union(geometry.boundingBox!) }
  return box
}

describe('hedge', () => {
  it('a row has its length and width in meters, height 1', () => {
    for (const L of [1, 3, 12]) {
      const box = boxOf(hedgeShape(L, 'summer'))
      expect(box.max.x - box.min.x, `${L} m`).toBeGreaterThan(L - 0.25)
      expect(box.max.x - box.min.x, `${L} m`).toBeLessThan(L + 0.25)
      expect(box.max.y - box.min.y).toBeLessThan(DEFAULT_HEDGE_WIDTH * 1.2)
      expect(box.min.z).toBeGreaterThanOrEqual(-0.01)   // the foot of a leaning stem dips barely below the ground
      expect(box.max.z).toBeLessThanOrEqual(1.05)
    }
    for (const W of [0.4, 1.5, 3]) {
      const box = boxOf(hedgeShape(4, 'summer', undefined, false, W))
      expect(box.max.y - box.min.y, `${W} m`).toBeGreaterThan(W * 0.85)
      expect(box.max.y - box.min.y, `${W} m`).toBeLessThan(W * 1.15)
    }
  })

  it('individual plants: the top is cut out from one plant to the next, and stems at the foot', () => {
    const shape = hedgeShape(8, 'summer')
    const pos = shape.parts.find((p) => p.part === 'leaf')!.geometry.getAttribute('position')
    // top of each 50 cm slice: not a straight line
    const tops = new Map<number, number>()
    for (let i = 0; i < pos.count; i++) {
      const bin = Math.floor((pos.getX(i) + 4) / 0.5)
      tops.set(bin, Math.max(tops.get(bin) ?? 0, pos.getZ(i)))
    }
    const t = [...tops.values()]
    expect(Math.max(...t) - Math.min(...t)).toBeGreaterThan(0.03)
    expect(shape.parts.some((p) => p.part === 'bark')).toBe(true)
  })

  it('the set spacing fixes the foot-to-foot distance; absent, it stays tight', () => {
    // the stems: two per plant, so the number of bark vertices counts the plants
    const stems = (spacing?: number) => hedgeShape(6, 'summer', undefined, false, 0.7, 1.8, spacing).parts.find((p) => p.part === 'bark')!.geometry.getAttribute('position').count
    // 6 m − 2 × 0.32 m of inset = 5.36 m of row: 2 plants at 5 m, 4 at 1.5 m
    const perPlant = stems(5) / 2
    expect(stems(1.5) / perPlant).toBe(4)
    expect(stems() / perPlant).toBeGreaterThan(stems(1.5) / perPlant)
    expect(stems(autoHedgeSpacing(0.7)) / perPlant).toBeGreaterThan(10)
  })

  it('another seed draws other plants, at equal dimensions', () => {
    const pos = (seed: number) => Array.from(hedgeShape(4, 'summer', undefined, false, 0.7, 1.8, undefined, seed).parts[0]!.geometry.getAttribute('position').array)
    expect(pos(1)).toEqual(pos(1))
    expect(pos(1)).not.toEqual(pos(2))
  })

  it('the facets keep their size: a hedge twice as long has twice as many faces', () => {
    const faces = (L: number) => hedgeShape(L, 'summer').parts[0]!.geometry.getAttribute('position').count
    expect(faces(8) / faces(4)).toBeGreaterThan(1.6)
  })

  it('carries its species\' seasonal colors, and its flowers in proportion to the length', () => {
    const laurel = SPECIES.find((s) => s.id === 'cherry-laurel')!
    expect(laurel.kind).toBe('hedge')
    const spring = hedgeShape(6, 'spring', laurel)
    const flowers = (L: number) => hedgeShape(L, 'spring', laurel).parts.find((p) => p.part === 'accent')!.geometry.getAttribute('position').count
    expect(flowers(6)).toBeGreaterThan(flowers(3) * 1.5)
    expect(hedgeShape(6, 'summer', laurel).parts.some((p) => p.part === 'accent')).toBe(false)
    const c = spring.parts[0]!.geometry.getAttribute('color')
    expect(c.getY(0)).toBeGreaterThan(c.getX(0))            // the species' green
    const styled = hedgeShape(6, 'spring', laurel, true).parts[0]!.geometry.getAttribute('color')
    expect(styled.getX(0)).toBeCloseTo(styled.getY(0), 5)    // under a style: gray shading, the instance's tint
  })
})
