import { Box3, Group, type Mesh, Raycaster, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { ParadeKind } from '../styles/types'
import { Parade, type ParadeArea } from './parade'

const AREA: ParadeArea = {
  terrain: [[-10, -10], [40, -10], [40, 35], [-10, 35]],
  building: { min: [10, 8], max: [20, 16] },
  roofZ: 8,
  groundZ: (x) => x * 0.05,                              // a sloping terrain
}
const KINDS: ParadeKind[] = ['noel', 'halloween', 'tatooine', 'akira', 'girlyversaire']

describe('Parade', () => {
  it.each(KINDS)('%s: the characters move and stay finite', (kind) => {
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

  it('the sleigh and the X-wings pass above the roof', () => {
    for (const kind of ['noel', 'tatooine'] as const) {
      const p = new Parade(kind, AREA)
      p.step(0.5)
      const flyer = p.object.children[0]!
      expect(flyer.position.z).toBeGreaterThan(AREA.roofZ)
      p.dispose()
    }
  })

  it('the skeletons walk on the relief, outside the building footprint', () => {
    const p = new Parade('halloween', AREA)
    p.step(1)
    // the first 5 children are the ghosts, the following ones the skeletons
    const walkers = p.object.children.slice(5)
    expect(walkers).toHaveLength(4)
    for (const w of walkers) {
      const { x, y, z } = w.position
      expect(x < 10 || x > 20 || y < 8 || y > 16).toBe(true)
      expect(Math.abs(z - x * 0.05)).toBeLessThan(0.1)
    }
    p.dispose()
  })

  it('the motorbike rides on the relief, outside the building footprint, its trail behind it', () => {
    const p = new Parade('akira', AREA)
    for (let i = 0; i < 20; i++) {
      p.step(0.1)
      const { x, y, z } = p.object.children[0]!.position
      expect(x < 10 || x > 20 || y < 8 || y > 16).toBe(true)
      expect(Math.abs(z - x * 0.05)).toBeLessThan(1e-6)
    }
    // the trail: red at the head, nothing at the end
    const col = (p.object.children[1] as Mesh).geometry.getAttribute('color')
    expect(col.getX(0)).toBeGreaterThan(0.5)
    expect(col.getX(col.count - 1)).toBe(0)
    p.dispose()
  })

  it('the balloons rise from the foot of the house, and start again from the ground once above the roof', () => {
    const p = new Parade('girlyversaire', AREA)
    const balloons = p.object.children.slice(0, -1)      // the last child: the strings
    expect(balloons.length).toBeGreaterThan(8)
    const before = balloons.map((b) => b.position.z)
    p.step(0.1)
    // they all rise, except the one that just started again from the ground
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
          // released OUTSIDE the building footprint (give or take the sway), within 4 m of its walls
          const { x, y } = b.position
          expect(x < 10.3 || x > 19.7 || y < 8.3 || y > 15.7).toBe(true)
          expect(x > 5.5 && x < 24.5 && y > 3.5 && y < 20.5).toBe(true)
        }
      })
    }
    expect(relaunched).toBeGreaterThan(balloons.length)
    p.dispose()
  })

  it('takes no click, and detaches on dispose', () => {
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

  it('the sleigh and the X-wings ignore what is on the ground (car), the motorbike avoids it', () => {
    // a car parked in the middle of the terrain, read again at every step
    const car = { x: 0, y: 25, r: 2.6 }
    const area = { ...AREA, around: () => [car] }
    for (const kind of ['noel', 'tatooine'] as const) {
      // same draw with and without the car: the flight is identical
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
