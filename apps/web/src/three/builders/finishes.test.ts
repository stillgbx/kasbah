import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import '../textures/prebake' // cuit les matières à l'import, hors du délai du premier test
import type { Mesh, MeshStandardMaterial } from 'three'
import { applyAppearanceToJson, computeHouseGeometry, FINISHES, parseHouse, pointInPolygon, type AppearancePatch } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { buildHouse, buildLevel } from './buildHouse'
import { applyLook, createMaterials, finishMaterial } from './materials'
import { defaultLook, defaultSceneTheme } from '../styles'
import { PHOTO_PACK } from '../textures/assets'

// Finitions de pièce et de façade : quelles faces de mur prennent quel matériau, et le catalogue
// d'images qui les porte.

const house = (patch: AppearancePatch) => parseHouse(applyAppearanceToJson(demo, patch))
const mats = () => createMaterials(defaultSceneTheme(), defaultLook())

/** Centres des triangles d'un maillage de murs, avec leur normale (repère du niveau). */
function faces(mesh: Mesh): { c: [number, number, number]; n: [number, number, number] }[] {
  const pos = mesh.geometry.getAttribute('position')
  const nor = mesh.geometry.getAttribute('normal')
  const out: { c: [number, number, number]; n: [number, number, number] }[] = []
  for (let i = 0; i < pos.count; i += 3) {
    const c: [number, number, number] = [0, 0, 0]
    for (let k = 0; k < 3; k++) { c[0] += pos.getX(i + k) / 3; c[1] += pos.getY(i + k) / 3; c[2] += pos.getZ(i + k) / 3 }
    out.push({ c, n: [nor.getX(i), nor.getY(i), nor.getZ(i)] })
  }
  return out
}

describe('murs par finition', () => {
  it('sans finition : les deux maillages d’avant, et un même nombre de triangles par prisme', () => {
    const g = computeHouseGeometry(parseHouse(demo))
    const level = g.levels[0]!
    const walls = buildLevel(level, mats()).walls.filter((m) => m.name.startsWith('walls:'))
    expect(walls.map((m) => m.name)).toEqual(['walls:exterior', 'walls:interior'])
    const tris = walls.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0)
    expect(tris).toBe(level.walls.length * 12)
  })

  it('les faces d’une pièce habillée regardent toutes DANS la pièce', () => {
    const h = house({ rooms: { salon: { walls: { id: 'red-brick' } } } })
    const g = computeHouseGeometry(h)
    const level = g.levels.find((l) => l.wallFinishes?.salon)!
    const mesh = buildLevel(level, mats()).walls.find((m) => m.name === 'walls:finish:red-brick')!
    expect(mesh).toBeDefined()
    const salon = h.rooms.find((r) => r.id === 'salon')!.polygon
    const fs = faces(mesh)
    expect(fs.length).toBeGreaterThan(0)
    for (const f of fs) {
      expect(Math.abs(f.n[2])).toBeLessThan(1e-6)                      // que des faces verticales
      expect(pointInPolygon([f.c[0] + f.n[0] * 0.05, f.c[1] + f.n[1] * 0.05], salon)).toBe(true)
    }
  })

  it('une façade habillée prend l’extérieur ; l’intérieur des façades passe aux cloisons', () => {
    const g = computeHouseGeometry(house({ facade: { id: 'red-brick' } }))
    const m = mats()
    const nodes = buildHouse(g, m)
    const walls = nodes.levels.get('rdc')!.walls
    const ext = walls.find((w) => w.name === 'walls:exterior')!
    expect(ext.material).toBe(finishMaterial(m, 'facade', { id: 'red-brick' }))
    expect(ext.material).not.toBe(m.wall)
    // aucune face de la façade ne regarde l'intérieur d'une pièce
    const rooms = g.levels[0]!.floors.map((f) => f.polygon)
    for (const f of faces(ext)) {
      if (Math.abs(f.n[2]) > 0.5) continue                             // dessus, dessous
      const probe: [number, number] = [f.c[0] + f.n[0] * 0.05, f.c[1] + f.n[1] * 0.05]
      if (rooms.some((r) => pointInPolygon(probe, r))) {
        // seuls les bouts de mur au droit d'une ouverture peuvent pointer vers une pièce voisine
        expect(Math.hypot(f.n[0], f.n[1])).toBeGreaterThan(0.99)
      }
    }
    expect(walls.find((w) => w.name === 'walls:interior')!.material).toBe(m.wallInterior)
  })

  it('le sol d’une pièce prend sa finition, et un style « costume » montre le sol déclaré', () => {
    const g = computeHouseGeometry(house({ rooms: { salon: { floor: { id: 'walnut' } } } }))
    const m = mats()
    const floor = buildHouse(g, m).levels.get('rdc')!.floors.get('salon')!
    const base = floor.userData.baseMaterial as MeshStandardMaterial
    expect(base).toBe(finishMaterial(m, 'floor', { id: 'walnut' }, 'wood'))
    // style sans pack (défaut) : la finition reprend le parquet du style
    expect(base.color.getHex()).toBe(m.floors.wood.color.getHex())
    // style qui les interprète, sans photo : la couleur moyenne du noyer
    m.finishMode = { honor: true }
    applyLook(m, defaultSceneTheme(), defaultLook())
    expect(base.color.getHexString()).not.toBe(m.floors.wood.color.getHexString())
  })
})

describe('catalogue d’images des finitions', () => {
  const root = resolve(import.meta.dirname, '../../../public/assets/textures')
  it('chaque finition a ses quatre images', () => {
    for (const [id, spec] of Object.entries(FINISHES)) {
      for (const f of ['color', 'normal', 'roughness', 'thumb']) {
        expect(existsSync(resolve(root, spec.dir, `${f}.jpg`)), `${id} : ${spec.dir}/${f}.jpg`).toBe(true)
      }
    }
  })

  it('une finition qui reprend une matière du pack a la même cote (le cache est partagé)', () => {
    for (const spec of Object.values(FINISHES)) {
      const m = /^photo\/(.+)$/.exec(spec.dir)
      if (!m) continue
      const role = m[1] as keyof typeof PHOTO_PACK.surfaces
      expect(PHOTO_PACK.surfaces[role]?.tileM, spec.dir).toBe(spec.tileM)
    }
  })
})
