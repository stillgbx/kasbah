import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { parseHouse, safeParseHouse } from './validate'
import { applyHouseEditToJson } from './edit'
import { rectRoomAt, roomAgainstWall } from './shape'
import { PlacementError } from './place'
import type { Vec2 } from './geometry/vec2'

// Structure in an editing session: rooms and levels that are born or disappear, name and type.

type Room = { id: string; levelId: string; name: string; kind?: string; polygon: Vec2[]; walls?: { segment: number; kind?: string }[] }
type Level = { id: string; name: string; elevation: number; height?: number; roomOrder?: string[] }
type Device = { id: string; roomId?: string; levelId?: string; openingId?: string; position?: number[] }
type Doc = { rooms: Room[]; levels: Level[]; devices: Device[]; roof?: { levelId?: string }; roofs?: { levelId?: string; rooms?: string[] }[]; meta?: { survey?: unknown } }
const as = (d: unknown) => d as Doc
const room = (d: unknown, id: string) => as(d).rooms.find((r) => r.id === id)
const level = (d: unknown, id: string) => as(d).levels.find((l) => l.id === id)

describe('a room that is born', () => {
  it('against the south wall of the living room: same survey line, a shared partition, valid house', () => {
    const shape = roomAgainstWall(demo as never, 'salon', 0)
    expect(shape).toEqual([[1000, 0], [310, 0], [310, -300], [1000, -300]])   // 310: the living room | entrance partition
    const { doc, blocking } = applyHouseEditToJson(demo, {
      newRooms: [{ id: 'bureau', levelId: 'rdc' }],
      shapes: { bureau: shape },
      rooms: { bureau: { name: 'Bureau' } },
    })
    expect(blocking).toEqual([])
    const bureau = room(doc, 'bureau')!
    expect(bureau.name).toBe('Bureau')
    expect(bureau.kind).toBeUndefined()                    // "room": the default is not written
    expect(Math.max(...bureau.polygon.map((p) => p[1]))).toBeCloseTo(-0.1, 4)   // partition = two interior walls of 10 cm
    expect(Math.min(...room(doc, 'salon')!.polygon.map((p) => p[1]))).toBeCloseTo(0.1, 4)
    expect(room(doc, 'salon')!.walls?.some((w) => w.segment === 0 && w.kind === 'interior')).toBe(true)
    expect(() => parseHouse(doc)).not.toThrow()
  })

  it('on tap: a 4 m square centered to the nearest decimeter', () => {
    expect(rectRoomAt(demo as never, 'rdc', [14.03, 2.96])).toEqual([[1200, 100], [1600, 100], [1600, 500], [1200, 500]])
  })

  it('that overlaps a neighbor blocks the session', () => {
    const { blocking } = applyHouseEditToJson(demo, { newRooms: [{ id: 'x', levelId: 'rdc' }], shapes: { x: [[500, 100], [700, 100], [700, 300], [500, 300]] } })
    expect(blocking.some((b) => b.includes('chevauchent'))).toBe(true)
  })

  it('without measurements, or on an unknown level, is refused', () => {
    expect(() => applyHouseEditToJson(demo, { newRooms: [{ id: 'x', levelId: 'rdc' }] })).toThrow(PlacementError)
    expect(() => applyHouseEditToJson(demo, { newRooms: [{ id: 'x', levelId: 'nope' }], shapes: { x: [[0, 0], [1, 0], [1, 1]] } })).toThrow(PlacementError)
    expect(() => applyHouseEditToJson(demo, { newRooms: [{ id: 'salon', levelId: 'rdc' }], shapes: { salon: [[0, 0], [1, 0], [1, 1]] } })).toThrow(PlacementError)
  })

  it('born then removed in the same session: nothing changes', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, {
      newRooms: [{ id: 'x', levelId: 'rdc' }], shapes: { x: [[1200, 0], [1500, 0], [1500, 300], [1200, 300]] },
      rooms: { x: { name: 'X' } }, removeRooms: ['x'],
    })
    expect(blocking).toEqual([])
    expect(room(doc, 'x')).toBeUndefined()
  })
})

describe('a level that is born', () => {
  it('above: set on the last inhabited floor, the roof level goes up by as much', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, { newLevels: [{ id: 'combles', name: 'Combles', side: 'above' }] })
    expect(blocking).toEqual([])
    expect(level(doc, 'combles')).toMatchObject({ elevation: 5.8, height: 2.6 })   // 3,05 + 2,5 + dalle 0,25
    expect(level(doc, 'toit')!.elevation).toBeCloseTo(8.4, 4)
    expect(as(doc).roof?.levelId).toBe('etage')             // empty: it does not take the roof yet
    expect(() => parseHouse(doc)).not.toThrow()
  })

  it('two floors in a row stack up', () => {
    const { doc } = applyHouseEditToJson(demo, { newLevels: [{ id: 'a', name: 'A', side: 'above' }, { id: 'b', name: 'B', side: 'above' }] })
    expect(level(doc, 'b')!.elevation).toBeCloseTo(5.8 + 2.6 + 0.25, 4)
  })

  it('born then removed in the session: the roof level does not move', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, { newLevels: [{ id: 'a', name: 'A', side: 'above' }], removeLevels: ['a'] })
    expect(blocking).toEqual([])
    expect(level(doc, 'a')).toBeUndefined()
    expect(level(doc, 'toit')!.elevation).toBe(5.55)
  })

  it('below: a basement under the lowest', () => {
    const { doc } = applyHouseEditToJson(demo, { newLevels: [{ id: 'ss', name: 'Sous-sol', side: 'below' }] })
    expect(level(doc, 'ss')!.elevation).toBeCloseTo(0.2 - 0.25 - 2.6, 4)
    expect(as(doc).levels[0]!.id).toBe('ss')
  })

  it('a room on it: the roof goes over it (a roof window left below flags it)', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, {
      newLevels: [{ id: 'combles', name: 'Combles', side: 'above' }],
      newRooms: [{ id: 'grenier', levelId: 'combles' }],
      shapes: { grenier: rectRoomAt(demo as never, 'combles', [5, 4], 10, 8) },
    })
    expect(blocking).toEqual([])
    expect(as(doc).roof?.levelId).toBe('combles')
    const parsed = safeParseHouse(doc)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.issues.map((i) => i.message).join()).toContain('roof-window')
  })
})

describe('removing', () => {
  it('a room: its devices stay known without a place, the neighbor regains its half-partition', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, { removeRooms: ['salon'] })
    expect(blocking).toEqual([])
    expect(room(doc, 'salon')).toBeUndefined()
    const light = as(doc).devices.find((d) => d.id === 'light.salon')!
    expect(light.position).toBeUndefined()
    expect(light.roomId).toBeUndefined()
    expect(as(doc).devices.find((d) => d.id === 'cover.baie')!.openingId).toBeUndefined()
    expect(as(doc).devices.find((d) => d.id === 'cover.cuisine')!.openingId).toBe('fen-cuisine')
    expect(() => parseHouse(doc)).not.toThrow()
  })

  it('a room: its place in the display order leaves with it', () => {
    const ordered = { ...demo, levels: demo.levels.map((l) => (l.id === 'rdc' ? { ...l, roomOrder: ['salon', 'entree', 'cuisine'] } : l)) }
    const { doc } = applyHouseEditToJson(ordered, { removeRooms: ['salon'] })
    expect(level(doc, 'rdc')!.roomOrder).toEqual(['entree', 'cuisine'])
  })

  it('an empty level yes; a level that carries rooms, or panels, no', () => {
    expect(level(applyHouseEditToJson({ ...demo, arrays: [] }, { removeLevels: ['toit'] }).doc, 'toit')).toBeUndefined()
    expect(applyHouseEditToJson(demo, { removeLevels: ['toit'] }).blocking).toEqual(['toit : niveau non vide'])
    const { doc, blocking } = applyHouseEditToJson(demo, { removeLevels: ['etage'] })
    expect(blocking).toEqual(['etage : niveau non vide'])
    expect(level(doc, 'etage')).toBeDefined()
  })

  it('the emptied floor then removed in the session: the roof comes back down, the level leaves', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, {
      removeRooms: ['chambre1', 'chambre2', 'sdb', 'palier'], removeLevels: ['etage'],
    })
    expect(blocking).toEqual([])
    expect(level(doc, 'etage')).toBeUndefined()
    expect(as(doc).roof?.levelId).toBe('rdc')
  })

  it('roofs: one that names its rooms keeps the others and goes with the last; one without follows the floor', () => {
    const { roof, ...rest } = demo
    const twoRoofs = { ...rest, roofs: [{ ...roof, levelId: 'etage' }, { id: 'toit-cuisine', type: 'shed', rooms: ['cuisine', 'salon'], eaves: 2.4 }] }
    const kept = applyHouseEditToJson(twoRoofs, { removeRooms: ['salon'] })
    expect(kept.blocking).toEqual([])
    expect(as(kept.doc).roofs![1]!.rooms).toEqual(['cuisine'])
    expect(() => parseHouse(kept.doc)).not.toThrow()
    const { doc, blocking } = applyHouseEditToJson(twoRoofs, {
      removeRooms: ['chambre1', 'chambre2', 'sdb', 'palier', 'cuisine', 'salon'], removeLevels: ['etage'],
    })
    expect(blocking).toEqual([])
    expect(as(doc).roofs).toEqual([{ ...roof, levelId: 'rdc' }])
    expect(() => parseHouse(doc)).not.toThrow()
  })
})

describe('name and type', () => {
  it('renaming alone does not convert the house into a survey', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, { rooms: { salon: { name: 'Séjour' } } })
    expect(blocking).toEqual([])
    expect(room(doc, 'salon')!.name).toBe('Séjour')
    expect(as(doc).meta?.survey).toBeUndefined()
  })

  it('the living room turned terrace: without a wall, it leaves the whole thickness to its neighbors', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, { rooms: { salon: { kind: 'terrace' } } })
    expect(blocking).toEqual([])
    expect(room(doc, 'salon')!.kind).toBe('terrace')
    expect(room(doc, 'salon')!.walls?.filter((w) => w.kind === 'interior')).toEqual([])   // the open passage remains
  })

  it('the name of the property, and the short name of a level (empty = removed, the tab takes the name back)', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, {
      propertyName: 'Maison du lac',
      levels: { etage: { name: 'Premier étage', shortName: 'R+1' }, rdc: { shortName: '' } },
    })
    expect(blocking).toEqual([])
    expect((doc as { name: string }).name).toBe('Maison du lac')
    expect(level(doc, 'etage')).toMatchObject({ name: 'Premier étage', shortName: 'R+1' })
    expect('shortName' in level(doc, 'rdc')!).toBe(false)
    expect(as(doc).meta?.survey).toBeUndefined()              // renaming converts nothing
    expect(() => parseHouse(doc)).not.toThrow()
    expect(() => applyHouseEditToJson(demo, { levels: { nope: { name: 'X' } } })).toThrow(PlacementError)
  })

  it('a level born in the session can be renamed too', () => {
    const { doc } = applyHouseEditToJson(demo, { newLevels: [{ id: 'n', name: 'Étage 2', side: 'above' }], levels: { n: { name: 'Combles' } } })
    expect(level(doc, 'n')!.name).toBe('Combles')
  })

  it('an unknown room is refused', () => {
    expect(() => applyHouseEditToJson(demo, { rooms: { nope: { name: 'X' } } })).toThrow(PlacementError)
  })
})
