import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { HouseValidationError, lintHouse, parseHouse, safeParseHouse } from './validate'
import { computeHouseGeometry } from './geometry'
import { roomBounds, buildingBounds } from './geometry/bounds'
import { resolveDefaults } from './defaults'
import { indexHouse, deviceFloorZ } from './lookup'
import { geoDistance, geoToLocal, localToGeo } from './geo'
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

describe('champs de panneaux', () => {
  const array = (over: Record<string, unknown> = {}) => panelArraySchema.parse({
    id: 'pv', levelId: 'toit', origin: [10, 20, 0.1], rows: 2, cols: 3, gap: 0, panel: { width: 1, height: 2 },
    panels: ['mock:p1', null, 'mock:p3'], ...over,
  })

  it('dérive un module par emplacement, centré, rangée par rangée, lié ou non', () => {
    const devices = panelArrayDevices(array())
    expect(devices).toHaveLength(6)
    expect(devices[0]).toMatchObject({ id: 'pv.r0c0', deviceId: 'mock:p1', kind: 'sensor', levelId: 'toit', position: [10.5, 21, 0.1] })
    expect(devices[1]!.deviceId).toBeUndefined()                     // emplacement sans onduleur suivi : module quand même
    expect(devices[2]).toMatchObject({ id: 'pv.r0c2', deviceId: 'mock:p3', position: [12.5, 21, 0.1] })
    expect(devices[5]!.position).toEqual([12.5, 23, 0.1])            // rangée 1 : +height
    expect(panelOf(devices[0]!)).toMatchObject({ arrayId: 'pv', row: 0, col: 0, width: 1, height: 2, tilt: 0 })
  })

  it('donne au module la puissance crête de son champ, et une valeur courante à qui ne la dit pas', () => {
    // c'est l'échelle de couleur d'un module : sa dalle en 3D, la jauge de sa ligne dans la vue Énergie
    expect(panelOf(panelArrayDevices(array())[0]!)!.peakW).toBe(PANEL_PEAK_W)
    const wp = array({ panel: { width: 1, height: 2, peakW: 500 } })
    expect(panelOf(panelArrayDevices(wp)[0]!)!.peakW).toBe(500)
  })

  it('tourne le champ autour de son origine (yaw) et le fait monter le long des rangées (slope)', () => {
    const [d] = panelArrayDevices(array({ rows: 1, cols: 1, yaw: 90, panels: ['mock:p1'] }))
    // colonnes vers +y, rangées vers -x : le centre (0,5 ; 1) devient (-1 ; 0,5)
    expect(d!.position[0]).toBeCloseTo(9)
    expect(d!.position[1]).toBeCloseTo(20.5)
    const [t] = panelArrayDevices(array({ rows: 1, cols: 1, slope: 30, panels: ['mock:p1'] }))
    expect(t!.position[1]).toBeCloseTo(20 + Math.cos(Math.PI / 6))   // projection au sol de la rangée
    expect(t!.position[2]).toBeCloseTo(0.1 - Math.sin(Math.PI / 6))  // et sa DESCENTE vers l'azimut
  })

  it('redresse les modules SANS les déplacer : sur un toit plat, le châssis n incline que le verre', () => {
    const flat = panelArrayDevices(array({ rows: 2, cols: 1, tilt: 20, panels: ['mock:p1', 'mock:p3'] }))
    expect(flat[0]!.position[2]).toBe(0.1)                           // deux rangées, une seule hauteur
    expect(flat[1]!.position[2]).toBe(0.1)
    expect(flat[1]!.position[1]).toBeCloseTo(23)                     // le pas des rangées ne change pas
    expect(panelOf(flat[0]!)!.tilt).toBe(20)                         // mais le verre, lui, est incliné
    // les deux angles s'ajoutent, du même côté : une terrasse en pente avec des châssis
    const both = panelArrayDevices(array({ rows: 1, cols: 1, slope: 30, tilt: 20, panels: ['mock:p1'] }))
    expect(panelOf(both[0]!)!.tilt).toBe(50)
    expect(both[0]!.position[2]).toBeCloseTo(0.1 - Math.sin(Math.PI / 6))   // la descente ne suit QUE la pente
    // un châssis négatif bascule le verre en arrière sans rien déplacer non plus
    const back = panelArrayDevices(array({ rows: 1, cols: 1, tilt: -15, panels: ['mock:p1'] }))
    expect(panelOf(back[0]!)!.tilt).toBe(-15)
    expect(back[0]!.position[2]).toBe(0.1)
  })

  it('la maison démo porte ses deux champs sur le niveau toit, et withPanelArrays les ajoute aux appareils', () => {
    const house = parseHouse(demo)
    expect(house.arrays.map((a) => a.id)).toEqual(['pv-sud', 'pv-nord'])
    const full = withPanelArrays(house)
    expect(full.devices.length).toBe(house.devices.length + 20)
    expect(indexHouse(full).devicesByLevel.get('toit')).toHaveLength(20)
    const bare = { ...house, arrays: [] }
    expect(withPanelArrays(bare)).toBe(bare)                        // sans champ : la même référence, rien à recalculer
  })

  it('refuse un champ sur un niveau inconnu, trop de modules, ou un onduleur lié deux fois', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = (patch: (h: any) => void) => { const h = clone(); patch(h); const r = safeParseHouse(h); return r.success ? [] : r.issues.map((i) => i.path) }
    expect(bad((h) => { h.arrays[0].levelId = 'grenier' })).toContainEqual('arrays[0].levelId')
    expect(bad((h) => { h.arrays[0].panels.push('mock:extra') })).toContainEqual('arrays[0].panels')
    expect(bad((h) => { h.arrays[1].panels[0] = 'mock:panel-s01' })).toContainEqual('arrays[1].panels[0]')
    // panel-s01 est le DERNIER de la liste : l'origine d'un champ est son coin haut, et la grille
    // s'en va vers l'azimut (le module 1 du plan est donc en bas du champ)
    expect(bad((h) => { h.devices[0].deviceId = 'mock:panel-s01' })).toContainEqual('arrays[0].panels[9]')
  })
})

describe('geometry of the demo house', () => {
  const house = parseHouse(demo)
  const geom = computeHouseGeometry(house)
  it('levels are sorted and populated', () => {
    expect(geom.levels.map((l) => l.levelId)).toEqual(['rdc', 'etage', 'toit'])
    expect(geom.levels[2]!.walls).toHaveLength(0)                  // le toit est un niveau sans pièce : ni mur ni sol
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
  it('heading rotates the local frame', () => {
    const north = localToGeo({ lat: 45, lon: 5, alt: 0, heading: 0 }, [0, 100, 0])
    const east = localToGeo({ lat: 45, lon: 5, alt: 0, heading: 90 }, [0, 100, 0])
    expect(north.lat).toBeGreaterThan(45)
    expect(Math.abs(north.lon - 5)).toBeLessThan(1e-9)
    expect(east.lon).toBeGreaterThan(5)
    expect(Math.abs(east.lat - 45)).toBeLessThan(1e-9)
  })
})
