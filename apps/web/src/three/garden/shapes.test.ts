import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { GARDEN_KINDS } from '@kasbah/shared'
import { GARDEN_VARIANTS, gardenSeed, gardenShape } from './shapes'

describe('formes du jardin', () => {
  it('chaque forme mesure exactement 1 de haut, pied à zéro (pierre enterrée)', () => {
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

  it('la graine vient de l\'élément, sinon de son id, toujours la même', () => {
    expect(gardenSeed({ id: 'a', seed: 42 })).toBe(42)
    expect(gardenSeed({ id: 'garden.conifer-1' })).toBe(gardenSeed({ id: 'garden.conifer-1' }))
    expect(gardenSeed({ id: 'garden.conifer-1' })).not.toBe(gardenSeed({ id: 'garden.conifer-2' }))
  })
})
