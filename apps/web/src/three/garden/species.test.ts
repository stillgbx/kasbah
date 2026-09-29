import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { SPECIES, speciesOf, speciesSchema } from './species'
import { speciesShape } from './speciesShape'
import { SEASONS, seasonAt } from './season'

const files = import.meta.glob<{ default: unknown }>('./species/*.json', { eager: true })

describe('espèces du jardin', () => {
  it('chaque recette est valide (le catalogue écarterait sinon le fichier en silence)', () => {
    for (const [path, mod] of Object.entries(files)) {
      const parsed = speciesSchema.safeParse(mod.default)
      expect(parsed.success, `${path} : ${parsed.error?.issues[0]?.message}`).toBe(true)
    }
    expect(SPECIES.length).toBe(Object.keys(files).length)
  })

  it('chaque saison construit un arbre de hauteur 1, nu quand le feuillage tombe à zéro', () => {
    for (const s of SPECIES) {
      for (const season of SEASONS) {
        const shape = speciesShape(s, 0, season)
        const box = new Box3()
        for (const { geometry } of shape.parts) box.union(geometry.boundingBox!)
        expect(box.max.z, `${s.id} ${season}`).toBeLessThanOrEqual(1 + 1e-6)
        expect(box.min.z).toBeGreaterThanOrEqual(-0.01)   // le pied d'un fût incliné mord à peine sous le sol
        const bare = s.seasons?.[season]?.foliage === 0
        expect(shape.parts.some((p) => p.part === 'leaf'), `${s.id} ${season}`).toBe(!bare)
      }
    }
  })

  it('sous la palette d\'un style, une espèce perd ses couleurs mais garde sa silhouette', () => {
    const cherry = SPECIES.find((s) => s.id === 'cherry')!
    const leaf = speciesShape(cherry, 0, 'summer', { foliage: 1 }).parts.find((p) => p.part === 'leaf')!
    const c = leaf.geometry.getAttribute('color')
    expect(c.getX(0)).toBeCloseTo(c.getY(0), 5)              // gris : la teinte viendra de l'instance
    expect(c.getY(0)).toBeCloseTo(c.getZ(0), 5)
    const natural = speciesShape(cherry, 0, 'summer').parts.find((p) => p.part === 'leaf')!.geometry.getAttribute('color')
    expect(natural.getY(0)).toBeGreaterThan(natural.getX(0))  // vert de l'espèce
    // un style qui dégarnit fait apparaître la ramure étagée, même l'été
    const bark = (style?: { foliage: number }) => speciesShape(cherry, 0, 'summer', style).parts.find((p) => p.part === 'bark')!.geometry.getAttribute('position').count
    expect(bark({ foliage: 0.45 })).toBeGreaterThan(bark())
  })

  it('forkAt fait partir les charpentières du bas du fût, et monter l\'écorce dans le houppier', () => {
    const cherry = SPECIES.find((s) => s.id === 'cherry')!
    const at = (forkAt?: number, season: 'summer' | 'winter' = 'summer') => speciesShape({ ...cherry, trunk: { ...cherry.trunk, forkAt } }, 0, season)
      .parts.find((p) => p.part === 'bark')!.geometry.getAttribute('position')
    // sommets d'écorce près du sol : le pied du fût seul sans forkAt, plus le pied de chaque charpentière avec
    const low = (pos: ReturnType<typeof at>) => {
      let n = 0
      for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < 0.1) n++
      return n
    }
    const topZ = (pos: ReturnType<typeof at>) => Math.max(...Array.from({ length: pos.count }, (_, i) => pos.getZ(i)))
    expect(topZ(at(0.02))).toBeGreaterThan(topZ(at()))   // l'été, tiges et fût central entrent dans le feuillage
    for (const season of ['summer', 'winter'] as const) expect(low(at(0.02, season)), season).toBeGreaterThan(low(at(undefined, season)) * 2)
  })

  it('spread écarte les pieds des charpentières au lieu d\'un seul point', () => {
    const fig = SPECIES.find((s) => s.id === 'fig')!
    const bark = (spread?: number) => speciesShape({ ...fig, trunk: { ...fig.trunk, forkAt: 0.02, spread } }, 0, 'summer')
      .parts.find((p) => p.part === 'bark')!.geometry.getAttribute('position')
    // écart horizontal maximal des sommets au pied (z < 0,05), loin de l'axe quand les chaumes sont écartés
    const foot = (pos: ReturnType<typeof bark>) => {
      let d = 0
      for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < 0.05) d = Math.max(d, Math.hypot(pos.getX(i), pos.getY(i)))
      return d
    }
    expect(foot(bark(0.1))).toBeGreaterThan(foot(bark()) * 1.5)
  })

  it('tiered pose des plateaux plats, étagés et de plus en plus étroits', () => {
    const cherry = SPECIES.find((s) => s.id === 'cherry')!
    const recipe = { ...cherry, trunk: { ...cherry.trunk, height: 0.3 }, crown: { ...cherry.crown, shape: 'tiered' as const, width: 1.2, tiers: 3 } }
    const leaf = speciesShape(recipe, 0, 'summer').parts.find((p) => p.part === 'leaf')!.geometry
    leaf.computeBoundingBox()
    const box = leaf.boundingBox!
    expect(box.max.x - box.min.x).toBeGreaterThan(box.max.z - box.min.z)   // plus large que haut
    // tranche basse plus large que tranche haute
    const pos = leaf.getAttribute('position')
    const span = (lo: number, hi: number) => {
      let d = 0
      for (let i = 0; i < pos.count; i++) if (pos.getZ(i) >= lo && pos.getZ(i) < hi) d = Math.max(d, Math.hypot(pos.getX(i), pos.getY(i)))
      return d
    }
    const mid = (box.min.z + box.max.z) / 2
    expect(span(box.min.z, mid)).toBeGreaterThan(span(mid, box.max.z))
  })

  it('une espèce d\'une autre famille est ignorée', () => {
    expect(speciesOf({ kind: 'fruit', species: 'cherry' })?.id).toBe('cherry')
    expect(speciesOf({ kind: 'palm', species: 'cherry' })).toBeUndefined()
  })

  it('les saisons suivent l\'hémisphère', () => {
    expect(seasonAt(new Date(2026, 3, 15), 45)).toBe('spring')
    expect(seasonAt(new Date(2026, 0, 15), 45)).toBe('winter')
    expect(seasonAt(new Date(2026, 0, 15), -22)).toBe('summer')
  })
})
