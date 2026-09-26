import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BufferGeometry } from 'three'
import { computeHouseGeometry, parseHouse, type Vec3 } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { planarFaces, planarFacesWithHoles } from './shapes'

/** Aire d'un polygone plan en 3D (Newell). */
const polygonArea = (p: readonly Vec3[]): number => {
  let x = 0, y = 0, z = 0
  for (let i = 0; i < p.length; i++) {
    const [ax, ay, az] = p[i]!, [bx, by, bz] = p[(i + 1) % p.length]!
    x += (ay - by) * (az + bz); y += (az - bz) * (ax + bx); z += (ax - bx) * (ay + by)
  }
  return Math.hypot(x, y, z) / 2
}

/** Aire des triangles d'une géométrie, indexée ou non. */
const meshArea = (g: BufferGeometry): number => {
  const pos = g.getAttribute('position'), idx = g.getIndex()
  const n = idx ? idx.count : pos.count
  const at = (k: number) => (idx ? idx.getX(k) : k)
  let a = 0
  for (let k = 0; k < n; k += 3) {
    a += polygonArea([at(k), at(k + 1), at(k + 2)].map((i) => [pos.getX(i), pos.getY(i), pos.getZ(i)] as Vec3))
  }
  return a
}

afterEach(() => { vi.restoreAllMocks() })

describe('planarFacesWithHoles', () => {
  it('le toit à pentes de la démo, percé de ses Velux, fusionne toutes ses faces', () => {
    const roof = computeHouseGeometry(parseHouse(demo)).roof
    if (roof?.type !== 'gable') throw new Error('la démo a un toit à pentes')
    const holes = (roof.holes ?? []).filter((h) => h.faceIndex !== undefined && h.corners)
    expect(holes.length).toBeGreaterThan(0)
    expect(roof.faces.length).toBeGreaterThan(1)

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const g = planarFacesWithHoles(roof.faces, holes)
    expect(error).not.toHaveBeenCalled()

    // toutes les faces, moins exactement les trous : ni face perdue, ni trou rebouché
    const faces = roof.faces.reduce((s, f) => s + polygonArea(f), 0)
    const cut = holes.reduce((s, h) => s + polygonArea(h.corners!), 0)
    expect(meshArea(g)).toBeCloseTo(faces - cut, 3)
    expect(meshArea(g)).toBeLessThan(meshArea(planarFaces(roof.faces)) - 0.1)
  })

  it('pose des UV en mètres dans le plan de chaque versant : u le long de l’égout, v qui monte', () => {
    const roof = computeHouseGeometry(parseHouse(demo)).roof
    if (roof?.type !== 'gable') throw new Error('la démo a un toit à pentes')
    const holes = (roof.holes ?? []).filter((h) => h.faceIndex !== undefined && h.corners)
    for (const g of [planarFaces(roof.faces), planarFacesWithHoles(roof.faces, holes)]) {
      const pos = g.getAttribute('position'), uv = g.getAttribute('uv')
      expect(uv?.count).toBe(pos.count)
      // chaque triangle garde ses longueurs : la texture n'est ni étirée ni écrasée par la pente
      for (let k = 0; k < pos.count; k += 3) {
        for (const [i, j] of [[k, k + 1], [k + 1, k + 2]] as const) {
          const d3 = Math.hypot(pos.getX(j) - pos.getX(i), pos.getY(j) - pos.getY(i), pos.getZ(j) - pos.getZ(i))
          expect(Math.hypot(uv!.getX(j) - uv!.getX(i), uv!.getY(j) - uv!.getY(i))).toBeCloseTo(d3, 5)
        }
        // v monte avec z (les rangées de tuiles restent horizontales, et vont vers le faîtage)
        const dz = pos.getZ(k + 1) - pos.getZ(k), dv = uv!.getY(k + 1) - uv!.getY(k)
        if (Math.abs(dz) > 1e-6) expect(Math.sign(dv)).toBe(Math.sign(dz))
      }
    }
  })
})
