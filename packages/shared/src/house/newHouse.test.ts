import { describe, expect, it } from 'vitest'
import { parseHouse } from './validate'
import { computeHouseGeometry } from './geometry'
import { FIRST_ROOM, newHouseJson, propertyIdFor } from './newHouse'

// La maison d'une installation neuve : valide, dessinable, point 0 au coin de la première pièce.

const input = { name: 'Maison du lac', kind: 'house' as const, origin: { lat: 45, lon: 5, heading: 20 }, terrain: { width: 30, depth: 20 }, levelName: 'RDC', roomName: 'Séjour' }

describe('newHouseJson', () => {
  it('une maison : valide, une pièce au point 0, terrain centré, toit plat, aucun plugin', () => {
    const h = parseHouse(newHouseJson('lac', input))
    expect(h.rooms[0]!.polygon).toEqual(FIRST_ROOM)
    expect(h.site.terrain).toEqual([[-12.5, -8], [17.5, -8], [17.5, 12], [-12.5, 12]])
    expect(h.roof).toMatchObject({ type: 'flat', levelId: 'rdc' })
    expect(h.plugins).toEqual({})
    expect(() => computeHouseGeometry(h)).not.toThrow()
  })

  it('un appartement : pas de toit, une marge de 2 m autour de la pièce, son type retenu', () => {
    const raw = newHouseJson('apt', { ...input, kind: 'apartment', terrain: undefined })
    const h = parseHouse(raw)
    expect(h.roof).toBeUndefined()
    expect(h.site.terrain).toEqual([[-2, -2], [7, -2], [7, 6], [-2, 6]])
    expect(h.meta).toEqual({ kind: 'apartment' })
  })
})

describe('propertyIdFor', () => {
  it('tire un id lisible du nom, unique', () => {
    expect(propertyIdFor('Maison du Lac', [])).toBe('maison-du-lac')
    expect(propertyIdFor('Été à l’Île', [])).toBe('ete-a-l-ile')
    expect(propertyIdFor('Maison du lac', ['maison-du-lac', 'maison-du-lac-2'])).toBe('maison-du-lac-3')
    expect(propertyIdFor('!!!', [])).toBe('propriete')
  })
})
