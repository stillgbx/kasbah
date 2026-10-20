import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { parseHouse } from './validate'
import { applyAppearanceToJson, mergeAppearancePatch } from './appearance'
import { PlacementError } from './place'
import { computeHouseGeometry } from './geometry'
import { finishesFor, FINISHES } from './finishes'

type Doc = Record<string, unknown> & { rooms: { id: string; style?: Record<string, unknown> }[]; style?: Record<string, unknown> }
const room = (doc: Doc, id: string) => doc.rooms.find((r) => r.id === id)!

describe('applyAppearanceToJson', () => {
  it('sets the finishes of several rooms and of the facade in a single patch', () => {
    const out = applyAppearanceToJson(demo as Doc, {
      rooms: { salon: { floor: { id: 'walnut' }, walls: { id: 'matte-paint', tint: '#336699' } }, sdb: { walls: { id: 'subway-tile' } } },
      facade: { id: 'red-brick' },
    })
    expect(room(out, 'salon').style).toEqual({ floor: 'wood', floorFinish: { id: 'walnut' }, wallFinish: { id: 'matte-paint', tint: '#336699' } })
    expect(room(out, 'sdb').style).toEqual({ floor: 'tile', wallFinish: { id: 'subway-tile' } })
    expect(out.style).toEqual({ facade: { id: 'red-brick' } })
    // the unnamed rooms stay the SAME objects: nothing else is rewritten
    expect(room(out, 'cuisine')).toBe(room(demo as Doc, 'cuisine'))
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('null removes the finish, and a style that became empty disappears from the file', () => {
    const set = applyAppearanceToJson(demo as Doc, { rooms: { chambre2: { floor: { id: 'oak' } } }, facade: { id: 'ashlar' } })
    const out = applyAppearanceToJson(set, { rooms: { chambre2: { floor: null } }, facade: null })
    expect('style' in room(out, 'chambre2')).toBe(false)
    expect('style' in out).toBe(false)
  })

  it('refuses an unknown room', () => {
    expect(() => applyAppearanceToJson(demo as Doc, { rooms: { nope: { floor: { id: 'oak' } } } })).toThrow(PlacementError)
  })

  it('parseHouse refuses a finish outside its surface, and a tint on a photo material', () => {
    expect(() => parseHouse(applyAppearanceToJson(demo as Doc, { facade: { id: 'beige-carpet' } as never }))).toThrow()
    expect(() => parseHouse(applyAppearanceToJson(demo as Doc, { rooms: { salon: { floor: { id: 'oak', tint: '#ff0000' } } } }))).toThrow()
  })
})

describe('mergeAppearancePatch', () => {
  it('the following gesture takes precedence, surface by surface', () => {
    const a = { rooms: { salon: { floor: { id: 'oak' as const }, walls: { id: 'matte-paint' as const } } }, facade: { id: 'ashlar' as const } }
    const b = { rooms: { salon: { floor: null }, sdb: { walls: { id: 'subway-tile' as const } } } }
    expect(mergeAppearancePatch(a, b)).toEqual({
      rooms: { salon: { floor: null, walls: { id: 'matte-paint' } }, sdb: { walls: { id: 'subway-tile' } } },
      facade: { id: 'ashlar' },
    })
  })
})

describe('finishes in the geometry', () => {
  it('the floor, the walls of a room and the facade reach the descriptors', () => {
    const house = parseHouse(applyAppearanceToJson(demo as Doc, {
      rooms: { salon: { floor: { id: 'walnut' }, walls: { id: 'red-brick' } } }, facade: { id: 'white-brick' },
    }))
    const g = computeHouseGeometry(house)
    const level = g.levels.find((l) => l.floors.some((f) => f.roomId === 'salon'))!
    expect(level.floors.find((f) => f.roomId === 'salon')!.finish).toEqual({ id: 'walnut' })
    expect(level.wallFinishes).toEqual({ salon: { id: 'red-brick' } })
    expect(g.facade).toEqual({ id: 'white-brick' })
  })

  it('a house without finishes keeps descriptors with no extra field', () => {
    const g = computeHouseGeometry(parseHouse(demo))
    expect(g.levels.every((l) => !('wallFinishes' in l))).toBe(true)
    expect('facade' in g).toBe(false)
  })

  it('the catalog offers each surface, and only paints can be tinted', () => {
    expect(finishesFor('floor').length).toBeGreaterThan(10)
    expect(finishesFor('facade')).toContain('red-brick')
    expect(finishesFor('facade')).not.toContain('beige-carpet')
    for (const spec of Object.values(FINISHES)) expect('tintable' in spec).toBe(spec.family === 'paint')
  })
})
