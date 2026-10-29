import { describe, expect, it } from 'vitest'
import demo from '../__fixtures__/demo-house.json'
import { resolveDefaults } from '../defaults'
import type { House } from '../schema'
import { parseHouse, safeParseHouse } from '../validate'
import { computeHouseGeometry } from './index'
import { computeRoofs, roofsOf } from './roof'
import { defaultRoofYaw, roofAtPoint, roofUnder } from './surface'
import type { RoofDescriptor } from './types'
import { bbox, type Vec2 } from './vec2'

// Several roofs, one per volume: a house and its lower garage on the same level (10 cm partitions,
// so a 20 cm gap between the two rooms), one slope, two, four.

const TAN30 = Math.tan(Math.PI / 6)
const room = (id: string, polygon: Vec2[], kind?: string) => ({ id, levelId: 'rdc', name: id, polygon, openings: [], ...(kind ? { kind } : {}) })
const HOUSE = room('maison', [[0, 0], [6, 0], [6, 8], [0, 8]])
const GARAGE = room('garage', [[6.2, 0], [9.2, 0], [9.2, 6], [6.2, 6]], 'garage')

function make(roofs: unknown[], rooms: unknown[] = [HOUSE, GARAGE]): House {
  const { roof: _roof, ...rest } = demo
  return parseHouse({
    ...rest, roofs, rooms, devices: [], arrays: [],
    levels: [{ id: 'rdc', name: 'RDC', elevation: 0.2, height: 2.6 }],
    site: { ...demo.site, parkings: [] },
  })
}
const roofsOfHouse = (h: House) => computeRoofs(h, resolveDefaults(h.defaults))
const extent = (r: RoofDescriptor) => bbox(r.outline)
/** Top of the walls of a room's edge (the highest piece: the ones beside an opening stop lower). */
const wallTop = (h: House, roomId: string, segment: number) =>
  Math.max(...computeHouseGeometry(h).levels[0]!.walls.filter((w) => w.roomId === roomId && w.segment === segment).map((w) => w.z1))

describe('one slope (shed)', () => {
  it('descends toward its yaw from the opposite side, with its gables and its high wall', () => {
    const [roof] = roofsOfHouse(make([{ type: 'shed', rooms: ['maison'], yaw: 180, overhang: 0 }], [HOUSE]))
    expect(roof!.zBase).toBeCloseTo(2.8)
    expect(roof!.zRidge).toBeCloseTo(2.8 + 8.6 * TAN30)              // 8 m + two exterior walls of 30 cm
    expect(roof!.faces).toHaveLength(4)                                 // slope, two gables, high wall
    expect(roofAtPoint(roof!, 3, 4)!.slope).toBeCloseTo(30)
    expect(defaultRoofYaw(roof!, 3, 4)).toBe(180)
  })

  it('turned: yaw 270 descends toward +x', () => {
    const [roof] = roofsOfHouse(make([{ type: 'shed', rooms: ['maison'], yaw: 270 }], [HOUSE]))
    expect(defaultRoofYaw(roof!, 3, 4)).toBe(270)
    expect(roof!.zRidge).toBeCloseTo(2.8 + 7.2 * TAN30)              // 6.6 m of walls + two overhangs of 30 cm
  })
})

describe('four slopes (hip)', () => {
  it('a rectangle: ridge along the long side, each slope descends toward its own side', () => {
    const [roof] = roofsOfHouse(make([{ type: 'hip', rooms: ['maison'], overhang: 0 }], [HOUSE]))
    expect(roof!.faces).toHaveLength(4)
    expect(roof!.zRidge).toBeCloseTo(2.8 + 3.3 * TAN30)
    const ridge = roof!.faces.flat().filter((p) => Math.abs(p[2] - roof!.zRidge) < 1e-9)
    expect(Math.min(...ridge.map((p) => p[1]))).toBeCloseTo(3)        // −0.3 + 3.3
    expect(Math.max(...ridge.map((p) => p[1]))).toBeCloseTo(5)        // 8.3 − 3.3
    for (const [x, y, yaw] of [[-0.2, 4, 90], [6.2, 4, 270], [3, -0.2, 180], [3, 8.2, 0]] as const) {
      expect(roofAtPoint(roof!, x, y)!.slope).toBeCloseTo(30)
      expect(defaultRoofYaw(roof!, x, y)).toBe(yaw)
    }
  })

  it('a square: four triangles to a point', () => {
    const square = room('maison', [[0, 0], [6, 0], [6, 6], [0, 6]])
    const [roof] = roofsOfHouse(make([{ type: 'hip', rooms: ['maison'] }], [square]))
    expect(roof!.faces.map((f) => f.length)).toEqual([3, 3, 3, 3])
    const apex = roof!.faces[0]![2]!
    expect(apex[0]).toBeCloseTo(3)
    expect(apex[1]).toBeCloseTo(3)
    expect(apex[2]).toBeCloseTo(2.8 + 3.6 * TAN30)
  })
})

describe('a lower garage against the house', () => {
  const both = make([
    { id: 'toit-maison', type: 'gable', rooms: ['maison'] },
    { id: 'toit-garage', type: 'shed', rooms: ['garage'], eaves: 2.4, yaw: 270 },
  ])

  it('its walls stop at its eaves, the party wall rises with the house', () => {
    expect(wallTop(both, 'garage', 0)).toBeCloseTo(2.4)                 // garage facade
    expect(wallTop(both, 'garage', 3)).toBeCloseTo(2.6)                 // its half of the party wall
    expect(wallTop(both, 'maison', 1)).toBeCloseTo(2.6)                 // the house's half
    expect(wallTop(both, 'maison', 0)).toBeCloseTo(2.6)                 // house facade
  })

  it('its roof stops against the house wall, the house roof overhangs it', () => {
    const [house, garage] = roofsOfHouse(both)
    expect(garage!.zBase).toBeCloseTo(2.6)
    expect(garage!.rooms).toEqual(['garage'])
    expect(extent(garage!).min[0]).toBeCloseTo(6.2)                     // no wall, no overhang on that side
    expect(extent(garage!).max[0]).toBeCloseTo(9.8)
    expect(extent(house!).max[0]).toBeCloseTo(6.6)
  })

  it('at the same height, both roofs stop at the party wall', () => {
    const [house, garage] = roofsOfHouse(make([
      { type: 'gable', rooms: ['maison'] },
      { type: 'flat', rooms: ['garage'] },
    ]))
    expect(extent(house!).max[0]).toBeCloseTo(6)
    expect(extent(garage!).min[0]).toBeCloseTo(6.2)
  })

  it('a roof window takes the HIGHER roof where two overlap in plan', () => {
    const roofs = roofsOfHouse(make([
      { id: 'toit-maison', type: 'gable', rooms: ['maison'] },
      { id: 'toit-garage', type: 'flat', rooms: ['garage'], eaves: 2.4 },
    ]))
    expect(roofUnder(roofs, 6.4, 3)?.id).toBe('toit-maison')                // the house eaves, above the garage slab
    expect(roofUnder(roofs, 8, 3)?.id).toBe('toit-garage')
    expect(roofUnder(roofs, 20, 3)).toBeUndefined()
  })
})

describe('the file', () => {
  it('the former single `roof` is still read', () => {
    const h = parseHouse(demo)
    expect(h.roofs).toEqual([])
    expect(roofsOf(h)).toEqual([h.roof])
    expect(computeHouseGeometry(h).roofs).toHaveLength(1)
  })

  it('refuses `roof` and `roofs` together, and a roof over an unknown or unwalled room', () => {
    const issues = (json: unknown) => { const r = safeParseHouse(json); return r.success ? [] : r.issues.map((i) => i.message) }
    expect(issues({ ...demo, roofs: [{ type: 'flat' }] })).toContain('write `roofs` or the former `roof`, not both')
    const { roof: _roof, ...rest } = demo
    const terrace = room('deck', [[0, 9], [4, 9], [4, 12], [0, 12]], 'terrace')
    const msgs = issues({
      ...rest, devices: [], arrays: [], site: { ...demo.site, parkings: [] },
      levels: [{ id: 'rdc', name: 'RDC', elevation: 0.2 }], rooms: [HOUSE, terrace],
      roofs: [{ type: 'flat', rooms: ['nulle-part', 'deck'] }],
    })
    expect(msgs).toEqual(['unknown room "nulle-part"', 'room "deck" has no walls'])
  })
})
