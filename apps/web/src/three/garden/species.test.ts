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

  it('une espèce d\'une autre famille est ignorée', () => {
    expect(speciesOf({ kind: 'broadleaf', species: 'cherry' })?.id).toBe('cherry')
    expect(speciesOf({ kind: 'palm', species: 'cherry' })).toBeUndefined()
  })

  it('les saisons suivent l\'hémisphère', () => {
    expect(seasonAt(new Date(2026, 3, 15), 45)).toBe('spring')
    expect(seasonAt(new Date(2026, 0, 15), 45)).toBe('winter')
    expect(seasonAt(new Date(2026, 0, 15), -22)).toBe('summer')
  })
})
