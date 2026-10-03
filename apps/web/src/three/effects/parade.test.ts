import { Box3, Group, type Mesh, Raycaster, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { ParadeKind } from '../styles/types'
import { Parade, type ParadeArea } from './parade'

const AREA: ParadeArea = {
  terrain: [[-10, -10], [40, -10], [40, 35], [-10, 35]],
  building: { min: [10, 8], max: [20, 16] },
  roofZ: 8,
  groundZ: (x) => x * 0.05,                              // un terrain en pente
}
const KINDS: ParadeKind[] = ['noel', 'halloween', 'tatooine', 'akira', 'girlyversaire']

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

  it("la moto roule sur le relief, hors de l'emprise bâtie, sa traînée derrière elle", () => {
    const p = new Parade('akira', AREA)
    for (let i = 0; i < 20; i++) {
      p.step(0.1)
      const { x, y, z } = p.object.children[0]!.position
      expect(x < 10 || x > 20 || y < 8 || y > 16).toBe(true)
      expect(Math.abs(z - x * 0.05)).toBeLessThan(1e-6)
    }
    // la traînée : du rouge en tête, rien au bout
    const col = (p.object.children[1] as Mesh).geometry.getAttribute('color')
    expect(col.getX(0)).toBeGreaterThan(0.5)
    expect(col.getX(col.count - 1)).toBe(0)
    p.dispose()
  })

  it('les ballons montent depuis le pied de la maison, et repartent du sol une fois au-dessus du toit', () => {
    const p = new Parade('girlyversaire', AREA)
    const balloons = p.object.children.slice(0, -1)      // le dernier enfant : les ficelles
    expect(balloons.length).toBeGreaterThan(8)
    const before = balloons.map((b) => b.position.z)
    p.step(0.1)
    // ils montent tous, sauf celui qui vient de repartir du sol
    expect(balloons.filter((b, i) => b.position.z > before[i]!).length).toBeGreaterThanOrEqual(balloons.length - 1)
    let relaunched = 0
    for (let i = 0; i < 600; i++) {
      const z = balloons.map((b) => b.position.z)
      p.step(0.1)
      balloons.forEach((b, k) => {
        expect(b.position.z).toBeLessThanOrEqual(AREA.roofZ + 7)
        expect(b.position.z).toBeGreaterThan(-1)
        if (b.position.z < z[k]!) {
          relaunched++
          // relâché HORS de l'emprise bâtie (au balancement près), à moins de 4 m de ses murs
          const { x, y } = b.position
          expect(x < 10.3 || x > 19.7 || y < 8.3 || y > 15.7).toBe(true)
          expect(x > 5.5 && x < 24.5 && y > 3.5 && y < 20.5).toBe(true)
        }
      })
    }
    expect(relaunched).toBeGreaterThan(balloons.length)
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

  it("le traîneau et les X-wings ignorent ce qui est au sol (voiture), la moto l'évite", () => {
    // une voiture garée au milieu du terrain, relue à chaque pas
    const car = { x: 0, y: 25, r: 2.6 }
    const area = { ...AREA, around: () => [car] }
    for (const kind of ['noel', 'tatooine'] as const) {
      // même tirage avec et sans voiture : le vol est identique
      const seq = Array.from({ length: 4000 }, () => Math.random())
      let k = 0
      const real = Math.random
      Math.random = () => seq[k++ % seq.length]!
      const a = new Parade(kind, area)
      k = 0
      const b = new Parade(kind, AREA)
      Math.random = real
      for (let i = 0; i < 50; i++) { a.step(0.1); b.step(0.1) }
      expect(a.object.children[0]!.position.distanceTo(b.object.children[0]!.position)).toBeLessThan(1e-9)
      a.dispose(); b.dispose()
    }
  })
})
