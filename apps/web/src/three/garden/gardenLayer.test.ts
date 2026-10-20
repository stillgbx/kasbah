import { describe, expect, it } from 'vitest'
import type { GardenItem } from '@kasbah/shared'
import { GardenLayer } from './gardenLayer'

describe('GardenLayer.footprints', () => {
  const items: GardenItem[] = [
    { id: 'chene', kind: 'broadleaf', center: [0, 0], height: 8 },
    { id: 'buis', kind: 'shrub', center: [10, 0], height: 1 },
    { id: 'haie', kind: 'hedge', center: [0, 10], height: 1.5, length: 6, width: 1, yaw: 90 },
  ]
  const layer = new GardenLayer()
  layer.build(items, () => 0, 'summer')
  const fp = layer.footprints()

  it('a tree blocks only half of its crown, at most 2.5 m; a bush its whole volume', () => {
    const tree = fp.find((c) => c.x === 0 && c.y === 0)!
    expect(tree.r).toBeGreaterThan(0)
    expect(tree.r).toBeLessThanOrEqual(2.5)
    const shrub = fp.find((c) => c.x === 10)!
    expect(shrub.r).toBeGreaterThan(0.2)
  })

  it('a hedge becomes a string of discs along its axis', () => {
    const hedge = fp.filter((c) => c.y > 6)
    expect(hedge.length).toBeGreaterThanOrEqual(3)
    for (const c of hedge) {
      expect(Math.abs(c.x)).toBeLessThan(1e-9)            // turned 90°: along y
      expect(Math.abs(c.y - 10)).toBeLessThanOrEqual(3)
      expect(c.r).toBe(0.5)
    }
  })
})
