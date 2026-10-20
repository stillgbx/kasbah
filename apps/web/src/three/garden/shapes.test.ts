import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { GARDEN_KINDS } from '@kasbah/shared'
import { GARDEN_VARIANTS, gardenSeed, gardenShape } from './shapes'

describe('garden shapes', () => {
  it('every shape is exactly 1 tall, foot at zero (buried stone)', () => {
    for (const kind of GARDEN_KINDS) {
      for (let v = 0; v < GARDEN_VARIANTS; v++) {
        const shape = gardenShape(kind, v)
        const box = new Box3()
        for (const { geometry } of shape.parts) box.union(geometry.boundingBox!)
        expect(box.max.z - box.min.z).toBeCloseTo(1, 5)
        expect(box.min.z).toBeCloseTo(kind === 'rock' ? -0.2 : 0, 5)
        expect(shape.width).toBeGreaterThan(0.2)
      }
    }
  })

  it('the seed comes from the element, otherwise from its id, always the same', () => {
    expect(gardenSeed({ id: 'a', seed: 42 })).toBe(42)
    expect(gardenSeed({ id: 'garden.conifer-1' })).toBe(gardenSeed({ id: 'garden.conifer-1' }))
    expect(gardenSeed({ id: 'garden.conifer-1' })).not.toBe(gardenSeed({ id: 'garden.conifer-2' }))
  })
})
