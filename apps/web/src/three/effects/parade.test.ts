import { Box3, Group, Raycaster, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { ParadeKind } from '../styles/types'
import { Parade, type ParadeArea } from './parade'

const AREA: ParadeArea = {
  building: { min: [10, 8], max: [20, 16] },
  roofZ: 8,
  groundZ: (x) => x * 0.05,                              // un terrain en pente
}
const KINDS: ParadeKind[] = ['noel', 'halloween', 'tatooine']

describe('Parade', () => {
  it.each(KINDS)('%s : les personnages bougent et restent finis', (kind) => {
    const p = new Parade(kind, AREA)
    const before = p.object.children.map((c) => c.position.clone())
    p.step(0.1); p.step(0.1); p.step(0.1)
    const moved = p.object.children.filter((c, i) => c.position.distanceTo(before[i]!) > 1e-3)
    expect(moved.length).toBeGreaterThan(0)
    p.object.updateMatrixWorld(true)
    const box = new Box3().setFromObject(p.object)
    for (const v of [box.min, box.max]) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true)
    p.dispose()
  })

  it('le traîneau et les X-wings passent au-dessus du toit', () => {
    for (const kind of ['noel', 'tatooine'] as const) {
      const p = new Parade(kind, AREA)
      p.step(0.5)
      const flyer = p.object.children[0]!
      expect(flyer.position.z).toBeGreaterThan(AREA.roofZ)
      p.dispose()
    }
  })

  it("les squelettes marchent sur le relief, hors de l'emprise bâtie", () => {
    const p = new Parade('halloween', AREA)
    p.step(1)
    // les 5 premiers enfants sont les fantômes, les suivants les squelettes
    const walkers = p.object.children.slice(5)
    expect(walkers).toHaveLength(4)
    for (const w of walkers) {
      const { x, y, z } = w.position
      expect(x < 10 || x > 20 || y < 8 || y > 16).toBe(true)
      expect(Math.abs(z - x * 0.05)).toBeLessThan(0.1)
    }
    p.dispose()
  })

  it('ne prend aucun clic, et se détache au dispose', () => {
    const root = new Group()
    for (const kind of KINDS) {
      const p = new Parade(kind, AREA)
      root.add(p.object)
      p.object.updateMatrixWorld(true)
      const ray = new Raycaster(new Vector3(15, 12, 50), new Vector3(0, 0, -1))
      expect(ray.intersectObject(p.object, true)).toHaveLength(0)
      p.dispose()
    }
    expect(root.children).toHaveLength(0)
  })
})
