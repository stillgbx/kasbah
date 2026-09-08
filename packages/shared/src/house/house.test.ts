import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { HouseValidationError, lintHouse, parseHouse, safeParseHouse } from './validate'
import { computeHouseGeometry } from './geometry'
import { roomBounds, buildingBounds } from './geometry/bounds'
import { resolveDefaults } from './defaults'
import { indexHouse, deviceFloorZ } from './lookup'
import { geoDistance, geoToLocal, localToGeo } from './geo'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = (): any => JSON.parse(JSON.stringify(demo))

describe('house schema & validation', () => {
  it('parses the demo house', () => {
    const house = parseHouse(demo)
    expect(house.levels).toHaveLength(2)
    expect(house.rooms).toHaveLength(7)
    expect(house.devices.length).toBeGreaterThan(10)
    expect(house.rooms[0]!.kind).toBe('corridor')
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

describe('geometry of the demo house', () => {
  const house = parseHouse(demo)
  const geom = computeHouseGeometry(house)
  it('levels are sorted and populated', () => {
    expect(geom.levels.map((l) => l.levelId)).toEqual(['rdc', 'etage'])
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
    expect(geom.roof?.type).toBe('gable')
    expect(geom.roof!.zBase).toBeCloseTo(3.05 + 2.5)
    expect(geom.roof!.zRidge).toBeGreaterThan(geom.roof!.zBase)
    expect(geom.roof!.faces).toHaveLength(4)
  })
  it('bounds contain terrain and roof', () => {
    expect(geom.bounds.min[0]).toBe(-6)
    expect(geom.bounds.max[2]).toBeCloseTo(geom.roof!.zRidge)
    const rb = roomBounds(house, 'salon', resolveDefaults(house.defaults))!
    expect(rb.min[2]).toBe(0.2)
    expect(rb.max[2]).toBeCloseTo(2.8)
    const bb = buildingBounds(house, resolveDefaults(house.defaults), geom.roof)
    expect(bb.min[0]).toBeGreaterThan(-1)
  })
})

describe('lookup & geo', () => {
  const house = parseHouse(demo)
  const idx = indexHouse(house)
  it('orders levels top-down, and rooms by `roomOrder` then by name', () => {
    expect(idx.levelsSorted.map((l) => l.id)).toEqual(['etage', 'rdc'])
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
  it('heading rotates the local frame', () => {
    const north = localToGeo({ lat: 45, lon: 5, alt: 0, heading: 0 }, [0, 100, 0])
    const east = localToGeo({ lat: 45, lon: 5, alt: 0, heading: 90 }, [0, 100, 0])
    expect(north.lat).toBeGreaterThan(45)
    expect(Math.abs(north.lon - 5)).toBeLessThan(1e-9)
    expect(east.lon).toBeGreaterThan(5)
    expect(Math.abs(east.lat - 45)).toBeLessThan(1e-9)
  })
})
