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
