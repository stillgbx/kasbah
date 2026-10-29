import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { HouseValidationError, lintHouse, parseHouse, safeParseHouse } from './validate'
import { computeHouseGeometry } from './geometry'
import { roomBounds, buildingBounds } from './geometry/bounds'
import { resolveDefaults } from './defaults'
import { indexHouse, deviceFloorZ } from './lookup'
import { geoDistance, geoToLocal, localToGeo, shiftOrigin, sitePosition, turnOrigin } from './geo'
import { panelArrayDevices, panelOf, withPanelArrays } from './panels'
import { PANEL_PEAK_W, panelArraySchema } from './schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = (): any => JSON.parse(JSON.stringify(demo))

describe('house schema & validation', () => {
  it('parses the demo house', () => {
    const house = parseHouse(demo)
    expect(house.levels).toHaveLength(3)
    expect(house.rooms).toHaveLength(7)
    expect(house.devices.length).toBeGreaterThan(10)
    expect(house.rooms[0]!.kind).toBe('corridor')
  })
  it('still loads a house file written before scenes were removed, and drops them', () => {
    const h = clone()
    h.scenes = [{ id: 'leave', name: 'Départ', actions: [{ deviceId: 'mock:light-living', command: { type: 'light.set', on: false } }] }]
    const house = parseHouse(h)
    expect(house).not.toHaveProperty('scenes')
  })
  it('rejects a clockwise polygon', () => {
    const h = clone()
    h.rooms[1]!.polygon.reverse()
    const r = safeParseHouse(h)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.issues.some((i) => /counter-clockwise/.test(i.message))).toBe(true)
  })
  it('rejects an opening overflowing its segment', () => {
    const h = clone()
    h.rooms[1]!.openings[0]!.width = 20
    expect(() => parseHouse(h)).toThrow(HouseValidationError)
  })
  it('rejects a device whose room is on another level', () => {
    const h = clone()
    h.devices[0]!.levelId = 'etage'
    const r = safeParseHouse(h)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.issues[0]!.path).toMatch(/devices\[0\]\.levelId/)
  })
  it('rejects an opening on a `none` segment and duplicate ids', () => {
    const h = clone()
    h.rooms[1]!.openings.push({ id: 'bad', type: 'door', segment: 2, offset: 0.5, width: 0.8, height: 2 })
    expect(safeParseHouse(h).success).toBe(false)
    const h2 = clone()
    h2.rooms[1]!.id = 'entree'
    expect(safeParseHouse(h2).success).toBe(false)
  })
  it('lint flags unbound and unknown device bindings', () => {
    const house = parseHouse(demo)
    const warnings = lintHouse(house, new Set(['mock:light-living']))
    expect(warnings.some((w) => w.code === 'DEVICE_UNKNOWN')).toBe(true)
    expect(warnings.some((w) => w.code === 'LEVEL_AT_TERRAIN')).toBe(false)
  })
})

describe('panel arrays', () => {
  const array = (over: Record<string, unknown> = {}) => panelArraySchema.parse({
    id: 'pv', levelId: 'toit', origin: [10, 20, 0.1], rows: 2, cols: 3, gap: 0, panel: { width: 1, height: 2 },
    panels: ['mock:p1', null, 'mock:p3'], ...over,
  })

  it('derives one module per slot, centered, row by row, linked or not', () => {
    const devices = panelArrayDevices(array())
    expect(devices).toHaveLength(6)
    expect(devices[0]).toMatchObject({ id: 'pv.r0c0', deviceId: 'mock:p1', kind: 'sensor', levelId: 'toit', position: [10.5, 21, 0.1] })
    expect(devices[1]!.deviceId).toBeUndefined()                     // slot without a tracked inverter: a module all the same
    expect(devices[2]).toMatchObject({ id: 'pv.r0c2', deviceId: 'mock:p3', position: [12.5, 21, 0.1] })
    expect(devices[5]!.position).toEqual([12.5, 23, 0.1])            // row 1: +height
    expect(panelOf(devices[0]!)).toMatchObject({ arrayId: 'pv', row: 0, col: 0, width: 1, height: 2, tilt: 0 })
  })

  it('gives the module the peak power of its array, and a current value to whoever does not say it', () => {
    // it is the color scale of a module: its slab in 3D, the gauge of its line in the Energy view
    expect(panelOf(panelArrayDevices(array())[0]!)!.peakW).toBe(PANEL_PEAK_W)
    const wp = array({ panel: { width: 1, height: 2, peakW: 500 } })
    expect(panelOf(panelArrayDevices(wp)[0]!)!.peakW).toBe(500)
  })

  it('rotates the array around its origin (yaw) and makes it climb along the rows (slope)', () => {
    const [d] = panelArrayDevices(array({ rows: 1, cols: 1, yaw: 90, panels: ['mock:p1'] }))
    // columns toward +y, rows toward -x: the center (0.5, 1) becomes (-1, 0.5)
    expect(d!.position![0]).toBeCloseTo(9)
    expect(d!.position![1]).toBeCloseTo(20.5)
    const [t] = panelArrayDevices(array({ rows: 1, cols: 1, slope: 30, panels: ['mock:p1'] }))
    expect(t!.position![1]).toBeCloseTo(20 + Math.cos(Math.PI / 6))   // ground projection of the row
    expect(t!.position![2]).toBeCloseTo(0.1 - Math.sin(Math.PI / 6))  // and its DESCENT toward the azimuth
  })

  it('tilts the modules WITHOUT moving them: on a flat roof, the frame only tilts the glass', () => {
    const flat = panelArrayDevices(array({ rows: 2, cols: 1, tilt: 20, panels: ['mock:p1', 'mock:p3'] }))
    expect(flat[0]!.position![2]).toBe(0.1)                           // two rows, a single height
    expect(flat[1]!.position![2]).toBe(0.1)
    expect(flat[1]!.position![1]).toBeCloseTo(23)                     // the row pitch does not change
    expect(panelOf(flat[0]!)!.tilt).toBe(20)                         // but the glass itself is tilted
    // the two angles add up, on the same side: a sloping terrace with frames
    const both = panelArrayDevices(array({ rows: 1, cols: 1, slope: 30, tilt: 20, panels: ['mock:p1'] }))
    expect(panelOf(both[0]!)!.tilt).toBe(50)
    expect(both[0]!.position![2]).toBeCloseTo(0.1 - Math.sin(Math.PI / 6))   // the descent follows ONLY the slope
    // a negative frame tilts the glass backward without moving anything either
    const back = panelArrayDevices(array({ rows: 1, cols: 1, tilt: -15, panels: ['mock:p1'] }))
    expect(panelOf(back[0]!)!.tilt).toBe(-15)
    expect(back[0]!.position![2]).toBe(0.1)
  })

  it('the demo house carries its two arrays on the roof level, and withPanelArrays adds them to the devices', () => {
    const house = parseHouse(demo)
    expect(house.arrays.map((a) => a.id)).toEqual(['pv-sud', 'pv-nord'])
    const full = withPanelArrays(house)
    expect(full.devices.length).toBe(house.devices.length + 20)
    expect(indexHouse(full).devicesByLevel.get('toit')).toHaveLength(20)
    const bare = { ...house, arrays: [] }
    expect(withPanelArrays(bare)).toBe(bare)                        // without an array: the same reference, nothing to recompute
  })

  it('refuses an array on an unknown level, too many modules, or an inverter linked twice', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = (patch: (h: any) => void) => { const h = clone(); patch(h); const r = safeParseHouse(h); return r.success ? [] : r.issues.map((i) => i.path) }
    expect(bad((h) => { h.arrays[0].levelId = 'grenier' })).toContainEqual('arrays[0].levelId')
    expect(bad((h) => { h.arrays[0].panels.push('mock:extra') })).toContainEqual('arrays[0].panels')
    expect(bad((h) => { h.arrays[1].panels[0] = 'mock:panel-s01' })).toContainEqual('arrays[1].panels[0]')
    // panel-s01 is the LAST of the list: the origin of an array is its top corner, and the grid
    // goes toward the azimuth (module 1 of the plan is therefore at the bottom of the array)
    expect(bad((h) => { h.devices[0].deviceId = 'mock:panel-s01' })).toContainEqual('arrays[0].panels[9]')
  })
})

describe('geometry of the demo house', () => {
  const house = parseHouse(demo)
  const geom = computeHouseGeometry(house)
  it('levels are sorted and populated', () => {
    expect(geom.levels.map((l) => l.levelId)).toEqual(['rdc', 'etage', 'toit'])
    expect(geom.levels[2]!.walls).toHaveLength(0)                  // the roof is a level without a room: neither wall nor floor
    expect(geom.levels[0]!.floors).toHaveLength(3)
    expect(geom.levels[0]!.walls.length).toBeGreaterThan(10)
    expect(geom.levels[0]!.openings.map((o) => o.openingId)).toContain('baie')
  })
  it('exterior face is continuous across entree and salon (y = -0.3)', () => {
    const south = geom.levels[0]!.walls.filter((w) => w.kind === 'exterior' && w.footprint.every((p) => p[1] <= 0.01))
    const ys = south.flatMap((w) => w.footprint.map((p) => p[1]))
    expect(Math.min(...ys)).toBeCloseTo(-0.3)
  })
  it('roof is a gable above the top level', () => {
    expect(geom.roofs[0]?.type).toBe('gable')
    expect(geom.roofs[0]!.zBase).toBeCloseTo(3.05 + 2.5)
    expect(geom.roofs[0]!.zRidge).toBeGreaterThan(geom.roofs[0]!.zBase)
    expect(geom.roofs[0]!.faces).toHaveLength(4)
  })
  it('bounds contain terrain and roof', () => {
    expect(geom.bounds.min[0]).toBe(-6)
    expect(geom.bounds.max[2]).toBeCloseTo(geom.roofs[0]!.zRidge)
    const rb = roomBounds(house, 'salon', resolveDefaults(house.defaults))!
    expect(rb.min[2]).toBe(0.2)
    expect(rb.max[2]).toBeCloseTo(2.8)
    const bb = buildingBounds(house, resolveDefaults(house.defaults), geom.roofs)
    expect(bb.min[0]).toBeGreaterThan(-1)
  })
})

describe('lookup & geo', () => {
  const house = parseHouse(demo)
  const idx = indexHouse(house)
  it('orders levels top-down, and rooms by `roomOrder` then by name', () => {
    expect(idx.levelsSorted.map((l) => l.id)).toEqual(['toit', 'etage', 'rdc'])
    expect(idx.roomsByLevel.get('etage')!.map((r) => r.id)).toEqual(['chambre1', 'chambre2', 'palier', 'sdb'])
    const h = clone()
    h.levels.find((l: { id: string }) => l.id === 'etage').roomOrder = ['sdb', 'palier']
    const custom = indexHouse(parseHouse(h))
    expect(custom.roomsByLevel.get('etage')!.map((r) => r.id)).toEqual(['sdb', 'palier', 'chambre1', 'chambre2'])
  })
  it('indexes rooms by level and devices by room', () => {
    expect(idx.roomsByLevel.get('etage')!.map((r) => r.id)).toContain('sdb')
    expect(idx.devicesByRoom.get('salon')!.length).toBe(3)
    expect(idx.outdoorDevices.map((d) => d.id)).toContain('mower.pelouse')
    expect(idx.devicesByBinding.get('mock:energy-site')!.id).toBe('energy.site')
    expect(deviceFloorZ(house, idx.devicesById.get('light.chambre1')!, idx)).toBe(3.05)
    expect(deviceFloorZ(house, idx.devicesById.get('mower.pelouse')!, idx)).toBe(0)
  })
  it('local ↔ geo round-trip with heading', () => {
    const p: [number, number, number] = [12.5, -7.25, 1]
    const g = localToGeo(house.origin, p)
    const back = geoToLocal(house.origin, g)
    expect(back[0]).toBeCloseTo(p[0], 3)
    expect(back[1]).toBeCloseTo(p[1], 3)
    expect(back[2]).toBeCloseTo(p[2], 6)
    expect(geoDistance(house.origin, g)).toBeCloseTo(Math.hypot(12.5, 7.25), 1)
  })
  it('a GPS position is placed on the terrain, and NOTHING outside the terrain', () => {
    // the center of the house necessarily falls inside its own terrain
    const here = localToGeo(house.origin, [0, 0, 0])
    const at = sitePosition(house, here)
    expect(at).not.toBeNull()
    expect(at![0]).toBeCloseTo(0, 3)
    expect(at![1]).toBeCloseTo(0, 3)
    expect(at![2]).toBe(0)                       // set on the terrain
    // one kilometer further: the car is elsewhere, it has no business appearing in the garden
    expect(sitePosition(house, localToGeo(house.origin, [1000, 1000, 0]))).toBeNull()
  })
  it('a correction offset shifts the computed place, in meters of the house reference frame', () => {
    const here = localToGeo(house.origin, [0, 0, 0])
    const at = sitePosition(house, here, [3, -2])
    expect(at![0]).toBeCloseTo(3, 3)
    expect(at![1]).toBeCloseTo(-2, 3)
  })
  it('heading rotates the local frame', () => {
    const north = localToGeo({ lat: 45, lon: 5, alt: 0, heading: 0 }, [0, 100, 0])
    const east = localToGeo({ lat: 45, lon: 5, alt: 0, heading: 90 }, [0, 100, 0])
    expect(north.lat).toBeGreaterThan(45)
    expect(Math.abs(north.lon - 5)).toBeLessThan(1e-9)
    expect(east.lon).toBeGreaterThan(5)
    expect(Math.abs(east.lat - 45)).toBeLessThan(1e-9)
  })
  it("the alignment slides the origin in world meters, and rotates it around a point that does not move", () => {
    const o = { lat: 45, lon: 5, alt: 0, heading: 6 }
    // 3 m east, 2 m south: the house's 0;0 ends up there on the photo
    const moved = shiftOrigin(o, 3, -2)
    const at = geoToLocal({ ...o, heading: 0 }, moved)
    expect(at[0]).toBeCloseTo(3, 3)
    expect(at[1]).toBeCloseTo(-2, 3)
    expect(moved.heading).toBe(6)
    // rotate by 18° around the center of the house: the center stays in place, the corner moves
    const centre: [number, number] = [5, 7]
    const turned = turnOrigin(o, 24, centre)
    expect(turned.heading).toBe(24)
    const before = localToGeo(o, [5, 7, 0]), after = localToGeo(turned, [5, 7, 0])
    expect(geoDistance(before, after)).toBeLessThan(0.001)
    expect(geoDistance(o, turned)).toBeGreaterThan(2)
  })
})
