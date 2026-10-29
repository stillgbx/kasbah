import { describe, expect, it } from 'vitest'
import { parseHouse } from './validate'
import { computeHouseGeometry } from './geometry'
import { FIRST_ROOM, newHouseJson, propertyIdFor } from './newHouse'

// The house of a new installation: valid, drawable, point 0 at the corner of the first room.

const input = { name: 'Maison du lac', kind: 'house' as const, origin: { lat: 45, lon: 5, heading: 20 }, terrain: { width: 30, depth: 20 }, levelName: 'RDC', roomName: 'Séjour' }

describe('newHouseJson', () => {
  it('a house: valid, one room at point 0, centered terrain, flat roof, no plugin', () => {
    const h = parseHouse(newHouseJson('lac', input))
    expect(h.rooms[0]!.polygon).toEqual(FIRST_ROOM)
    expect(h.site.terrain).toEqual([[-12.5, -8], [17.5, -8], [17.5, 12], [-12.5, 12]])
    expect(h.roofs).toMatchObject([{ type: 'flat', levelId: 'rdc' }])
    expect(h.plugins).toEqual({})
    expect(() => computeHouseGeometry(h)).not.toThrow()
  })

  it('an apartment: no roof, a 2 m margin around the room, its type retained', () => {
    const raw = newHouseJson('apt', { ...input, kind: 'apartment', terrain: undefined })
    const h = parseHouse(raw)
    expect(h.roofs).toEqual([])
    expect(h.site.terrain).toEqual([[-2, -2], [7, -2], [7, 6], [-2, 6]])
    expect(h.meta).toEqual({ kind: 'apartment' })
  })
})

describe('propertyIdFor', () => {
  it('draws a readable id from the name, unique', () => {
    expect(propertyIdFor('Maison du Lac', [])).toBe('maison-du-lac')
    expect(propertyIdFor('Été à l’Île', [])).toBe('ete-a-l-ile')
    expect(propertyIdFor('Maison du lac', ['maison-du-lac', 'maison-du-lac-2'])).toBe('maison-du-lac-3')
    expect(propertyIdFor('!!!', [])).toBe('propriete')
  })
})
