import { describe, expect, it } from 'vitest'
import '../textures/prebake' // cuit les matières à l'import, hors du délai du premier test
import { type BufferAttribute, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, ShapeGeometry, Vector3 } from 'three'
import { computeHouseGeometry, emptyReliefGrid, footprintCeiling, offsetPolygon, padWeight, parseHouse, parseRelief, pointInPolygon, reliefNodeXY, resolveDefaults, serializeRelief, signedArea, terrainFootprints, terrainHeight, terrainPads, type House } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { buildHouse, shapeTerrain } from './buildHouse'
import { createMaterials } from './materials'
import { defaultLook, defaultSceneTheme } from '../styles'
import { applyTerrainHeights, drapeGeometry } from './terrain'

const flat = parseHouse(demo)

/** La maison de démo avec une bosse de 80 cm sur un nœud libre du jardin (hors palier du bâti). */
function withBump(): { house: House; at: [number, number] } {
  const grid = emptyReliefGrid(flat.site.terrain, 2)
  const pads = terrainPads(flat)
  const footprints = terrainFootprints(flat, resolveDefaults(flat.defaults))
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const at = reliefNodeXY(grid, i, j)
      if (!pointInPolygon(at, flat.site.terrain) || padWeight(pads, at[0], at[1]) < 1 || footprintCeiling(footprints, at[0], at[1]) !== Infinity) continue
      grid.cm[j * grid.cols + i] = 80
      return { house: parseHouse({ ...demo, site: { ...demo.site, relief: serializeRelief(grid) } }), at }
    }
  }
  throw new Error('no free node in the demo garden')
}

const area = (g: { getIndex(): BufferAttribute | null; getAttribute(n: string): unknown }): number => {
  const pos = g.getAttribute('position') as BufferAttribute, idx = g.getIndex()!
  let a = 0
  for (let k = 0; k < idx.count; k += 3) {
    const [p, q, r] = [idx.getX(k), idx.getX(k + 1), idx.getX(k + 2)]
    a += ((pos.getX(q) - pos.getX(p)) * (pos.getY(r) - pos.getY(p)) - (pos.getY(q) - pos.getY(p)) * (pos.getX(r) - pos.getX(p))) / 2
  }
  return a
}

describe('terrain en relief', () => {
  it('un terrain sans relief garde le chemin d’avant : polygone plat, pas de jupe', () => {
    const nodes = buildHouse(computeHouseGeometry(flat), createMaterials(defaultSceneTheme(), defaultLook()))
    expect(nodes.terrain.geometry).toBeInstanceOf(ShapeGeometry)
    expect(nodes.skirt).toBeNull()
  })

  it('le maillage couvre exactement la parcelle, bassins retirés, et regarde vers le haut', () => {
    const pool = [[0, 0], [4, 0], [4, 3], [0, 3]] as [number, number][]
    const outer = [[-7.3, -5.1], [9.2, -4.4], [11, 8.7], [-6, 10.2]] as [number, number][]
    const g = drapeGeometry(outer, [pool])
    expect(area(g)).toBeCloseTo(signedArea(outer) - 12, 4)   // aire > 0 : toutes les faces vers +z
  })

  it('affiné le long d’un mur, le maillage couvre toujours la parcelle, sans fente avec les mailles voisines', () => {
    const outer = [[-7.3, -5.1], [9.2, -4.4], [11, 8.7], [-6, 10.2]] as [number, number][]
    const room = [[0.1, 0.2], [4.3, 0.2], [4.3, 3.1], [0.1, 3.1]] as [number, number][]
    const plain = drapeGeometry(outer, [])
    const g = drapeGeometry(outer, [], 0.5, [{ polygon: room, ceiling: 0 }])
    expect(area(g)).toBeCloseTo(signedArea(outer), 4)
    expect(g.getAttribute('position').count).toBeGreaterThan(plain.getAttribute('position').count)
    // chaque arête de bord du maillage est une arête du CONTOUR : une fente se verrait comme un bord intérieur
    const pos = g.getAttribute('position') as BufferAttribute, idx = g.getIndex()!
    const edges = new Map<string, number>()
    for (let k = 0; k < idx.count; k += 3) {
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
        const u = idx.getX(k + a), v = idx.getX(k + b)
        const key = u < v ? `${u},${v}` : `${v},${u}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
    const onOuter = (i: number) => outer.some((a, k) => {
      const b = outer[(k + 1) % outer.length]!
      const cross = (b[0] - a[0]) * (pos.getY(i) - a[1]) - (b[1] - a[1]) * (pos.getX(i) - a[0])
      return Math.abs(cross) / Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-3
    })
    for (const [key, n] of edges) {
      if (n !== 1) continue
      const [u, v] = key.split(',').map(Number)
      expect(onOuter(u!) && onOuter(v!)).toBe(true)
    }
  })

  it('sous un étage en porte-à-faux, la façade du RDC est affinée : le terrain dessiné touche le mur à sa hauteur', () => {
    // RDC 4 × 4 enterré dans une pente, étage qui déborde de 2 m tout autour (cas de la maison réelle)
    const rdc = { polygon: offsetPolygon([[0, 0], [4, 0], [4, 4], [0, 4]], 0.15), ceiling: -0.15 }
    const etage = { polygon: offsetPolygon([[-2, -2], [6, -2], [6, 6], [-2, 6]], 0.15), ceiling: 2.6 }
    const relief = parseRelief({ step: 2, origin: [-10, -10], rows: Array.from({ length: 11 }, () => Array.from({ length: 11 }, (_, i) => String(i * 25)).join(' ')) })!
    const outer = [[-10, -10], [10, -10], [10, 10], [-10, 10]] as [number, number][]
    const terrain = { polygon: outer, z: -0.15, relief, pads: [], footprints: [rdc, etage] }
    const g = drapeGeometry(outer, [], 0.5, terrain.footprints)
    applyTerrainHeights(g, terrain)
    const mesh = new Mesh(g, new MeshBasicMaterial({ side: DoubleSide }))
    const ray = new Raycaster()
    // juste devant la face extérieure du mur (contour + 0,30 m), le long des quatre façades
    for (const [x, y] of [[-0.33, 1.3], [-0.33, 2.7], [1.7, -0.33], [3.1, 4.33], [4.33, 0.6]] as const) {
      ray.set(new Vector3(x, y, 50), new Vector3(0, 0, -1))
      const hit = ray.intersectObject(mesh, false)[0]!
      expect(hit.point.z).toBeCloseTo(terrainHeight(terrain, x, y), 3)
    }
  })

  it('le terrain suit le relief, s’écrête sous le bâti, et la jupe le borde', () => {
    const { house, at } = withBump()
    const geometry = computeHouseGeometry(house)
    const nodes = buildHouse(geometry, createMaterials(defaultSceneTheme(), defaultLook()))
    expect(nodes.skirt).not.toBeNull()
    const pos = nodes.terrain.geometry.getAttribute('position') as BufferAttribute
    let top = -Infinity
    for (let i = 0; i < pos.count; i++) {
      top = Math.max(top, pos.getZ(i))
      expect(pos.getZ(i)).toBeCloseTo(terrainHeight(geometry.terrain, pos.getX(i), pos.getY(i)), 5)
    }
    expect(top).toBeCloseTo(geometry.terrain.z + 0.8, 1)
    expect(terrainHeight(geometry.terrain, at[0], at[1])).toBeCloseTo(geometry.terrain.z + 0.8, 6)
    const room = house.rooms[0]!.polygon
    const c = room.reduce((s, p) => [s[0] + p[0] / room.length, s[1] + p[1] / room.length], [0, 0])
    expect(terrainHeight(geometry.terrain, c[0], c[1])).toBeLessThanOrEqual(geometry.terrain.z)
  })

  it('revenir à un terrain plat rend le polygone plat et retire la jupe', () => {
    const { house } = withBump()
    const mats = createMaterials(defaultSceneTheme(), defaultLook())
    const nodes = buildHouse(computeHouseGeometry(house), mats)
    shapeTerrain(nodes, computeHouseGeometry(flat), mats)
    expect(nodes.terrain.geometry).toBeInstanceOf(ShapeGeometry)
    expect(nodes.skirt).toBeNull()
  })
})
