import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { SPECIES } from './species'
import { DEFAULT_HEDGE_WIDTH } from '@kasbah/shared'
import { hedgeShape } from './hedgeShape'

const boxOf = (shape: ReturnType<typeof hedgeShape>) => {
  const box = new Box3()
  for (const { geometry } of shape.parts) { geometry.computeBoundingBox(); box.union(geometry.boundingBox!) }
  return box
}

describe('haie', () => {
  it('un bloc continu à sa longueur et sa largeur en mètres, de hauteur 1', () => {
    for (const L of [1, 3, 12]) {
      const box = boxOf(hedgeShape(L, 'summer'))
      expect(box.max.x - box.min.x, `${L} m`).toBeGreaterThan(L * 0.9)
      expect(box.max.x - box.min.x, `${L} m`).toBeLessThan(L * 1.1)
      expect(box.max.y - box.min.y).toBeLessThan(DEFAULT_HEDGE_WIDTH * 1.2)
      expect(box.min.z).toBeCloseTo(0, 5)
      expect(box.max.z).toBeLessThanOrEqual(1.05)
    }
    for (const W of [0.4, 1.5, 3]) {
      const box = boxOf(hedgeShape(4, 'summer', undefined, false, W))
      expect(box.max.y - box.min.y, `${W} m`).toBeGreaterThan(W * 0.85)
      expect(box.max.y - box.min.y, `${W} m`).toBeLessThan(W * 1.15)
    }
  })

  it('les facettes gardent leur taille : une haie deux fois plus longue a deux fois plus de faces', () => {
    const faces = (L: number) => hedgeShape(L, 'summer').parts[0]!.geometry.getAttribute('position').count
    expect(faces(8) / faces(4)).toBeGreaterThan(1.6)
  })

  it('porte les couleurs de saison de son espèce, et ses fleurs au prorata de la longueur', () => {
    const laurel = SPECIES.find((s) => s.id === 'cherry-laurel')!
    expect(laurel.kind).toBe('hedge')
    const spring = hedgeShape(6, 'spring', laurel)
    const flowers = (L: number) => hedgeShape(L, 'spring', laurel).parts.find((p) => p.part === 'accent')!.geometry.getAttribute('position').count
    expect(flowers(6)).toBeGreaterThan(flowers(3) * 1.5)
    expect(hedgeShape(6, 'summer', laurel).parts.some((p) => p.part === 'accent')).toBe(false)
    const c = spring.parts[0]!.geometry.getAttribute('color')
    expect(c.getY(0)).toBeGreaterThan(c.getX(0))            // vert de l'espèce
    const styled = hedgeShape(6, 'spring', laurel, true).parts[0]!.geometry.getAttribute('color')
    expect(styled.getX(0)).toBeCloseTo(styled.getY(0), 5)    // sous un style : ombrage gris, teinte de l'instance
  })
})
