import { describe, expect, it } from 'vitest'
import { Mesh } from 'three'
import { terrainHeight, type TerrainDescriptor } from '@kasbah/shared'
import { buildGroundOverlay, ribbonGeometry } from './groundOverlay'

// Les formes peintes épousent le terrain : chaque sommet est posé au-dessus de la surface, et rien ne
// prend un tap. Terrain plat à 120 m, sans relief ni emprise : la hauteur attendue se lit directement.

const TERRAIN = { polygon: [[-50, -50], [50, -50], [50, 50], [-50, 50]], z: 120, pads: [], footprints: [] } as unknown as TerrainDescriptor

describe('groundOverlay', () => {
  it('un trait suit le terrain, échantillonné tous les 50 cm, juste au-dessus', () => {
    const g = ribbonGeometry([[0, 0], [10, 0]], false, 0.2, TERRAIN)
    const pos = g.getAttribute('position')
    expect(pos.count).toBe(2 * 21)
    for (let i = 0; i < pos.count; i++) expect(pos.getZ(i)).toBeCloseTo(terrainHeight(TERRAIN, pos.getX(i), pos.getY(i)) + 0.05, 5)
    expect(Math.abs(pos.getY(0) - pos.getY(1))).toBeCloseTo(0.2, 5)
  })

  it('un polygone : un aplat drapé et son contour ; une ligne : son trait seul ; aucun ne se touche', () => {
    const group = buildGroundOverlay([
      { points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true, fill: { color: '#43a047', opacity: 0.2 }, line: { color: '#66bb6a', opacity: 0.9, widthM: 0.15 } },
      { points: [[0, 0], [5, 5]], closed: false, line: { color: '#42a5f5', opacity: 1, widthM: 0.15 } },
      { points: [[0, 0], [1, 1]], closed: true, fill: { color: '#000', opacity: 1 } },
    ], TERRAIN)
    const meshes = group.children.filter((c): c is Mesh => c instanceof Mesh)
    expect(meshes).toHaveLength(3)
    const fill = meshes[0]!.geometry.getAttribute('position')
    for (let i = 0; i < fill.count; i++) expect(fill.getZ(i)).toBeCloseTo(120.03, 5)
    const hits: unknown[] = []
    for (const m of meshes) m.raycast({} as never, hits as never)
    expect(hits).toHaveLength(0)
  })
})
