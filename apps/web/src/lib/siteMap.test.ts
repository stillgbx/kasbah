import { describe, expect, it } from 'vitest'
import { geoToLocal, type SiteMap } from '@kasbah/shared'
import { GUIDE_COLOR, LAWN_COLOR, REWILDING_COLOR, STAY_OUT_COLOR, WORK_AREA_COLORS, layerOf, zoneRows, sceneEntryKey, sceneGroundShapes, siteMapAnchor, siteMapFeatures, workAreaColor } from './siteMap'

// The robot's map has no GPS coordinates: it is placed by its STATION. These tests hold
// the anchoring (base placed first, robot at the station next) and the pose (meters east/north around
// the station, exclusion zones tinted according to the robot's state).

const ORIGIN = { lat: 47.3, lon: 5.05, alt: 200, heading: 30 }
const ANCHOR = { lat: 47.3001, lon: 5.0502 }
const MAP: SiteMap = {
  deviceId: 'automower:x',
  station: [2, -0.5],
  shapes: [
    { kind: 'work_area', id: 'main_area_0', points: [[2, -0.5], [12, -0.5], [12, 9.5]] },
    { kind: 'stay_out', id: 'massif', name: 'Massif', points: [[0, 10], [3, 10], [3, 13]] },
    { kind: 'guide', id: 'guide_1', points: [[2, -0.5], [-15, -8]] },
    { kind: 'obstacle', id: 'flat', points: [[0, 0], [1, 1]] },
  ],
}

describe('siteMapAnchor', () => {
  it('the base placed in the house takes precedence, converted by the origin (heading included)', () => {
    const a = siteMapAnchor({ origin: ORIGIN, dock: [4, 6], location: ANCHOR, atStation: true })!
    const [x, y] = geoToLocal(ORIGIN, a)
    expect(x).toBeCloseTo(4, 6)
    expect(y).toBeCloseTo(6, 6)
  })
  it('the map\'s offset (house frame) is added to the base, or to the robot at the station', () => {
    const a = siteMapAnchor({ origin: ORIGIN, dock: [4, 6], location: ANCHOR, atStation: true, offset: [-1, 2] })!
    const [x, y] = geoToLocal(ORIGIN, a)
    expect(x).toBeCloseTo(3, 6)
    expect(y).toBeCloseTo(8, 6)
    const r = siteMapAnchor({ origin: ORIGIN, dock: undefined, location: ANCHOR, atStation: true, offset: [-1, 2] })!
    const [rx, ry] = geoToLocal(ORIGIN, r)
    const [ax, ay] = geoToLocal(ORIGIN, ANCHOR)
    expect(rx - ax).toBeCloseTo(-1, 6)
    expect(ry - ay).toBeCloseTo(2, 6)
  })

  it('without a base: the robot, only if it is at the station', () => {
    expect(siteMapAnchor({ origin: ORIGIN, dock: undefined, location: ANCHOR, atStation: true })).toEqual(ANCHOR)
    expect(siteMapAnchor({ origin: ORIGIN, dock: undefined, location: ANCHOR, atStation: false })).toBeUndefined()
  })
})

describe('siteMapFeatures', () => {
  const fc = siteMapFeatures(MAP, ANCHOR, [{ id: 'massif', name: 'Massif', enabled: false }])
  const local = (lonLat: number[]) => geoToLocal({ ...ANCHOR, alt: 0, heading: 0 }, { lat: lonLat[1]!, lon: lonLat[0]! })

  it('the map\'s station lands on the anchor; a point 10 m east of the station, 10 m east of the anchor', () => {
    const ring = (fc.features[0]!.geometry as { coordinates: number[][][] }).coordinates[0]!
    expect(local(ring[0]!)[0]).toBeCloseTo(0, 6)
    expect(local(ring[1]!)[0]).toBeCloseTo(10, 6)
    expect(local(ring[2]!)[1]).toBeCloseTo(10, 6)
    // closed ring
    expect(ring.at(-1)).toEqual(ring[0])
  })

  it('polygons for zones, line for cables; a two-point polygon is skipped', () => {
    expect(fc.features.map((f) => [f.properties.kind, f.geometry.type])).toEqual([
      ['work_area', 'Polygon'], ['stay_out', 'Polygon'], ['guide', 'LineString'],
    ])
  })

  it('an exclusion zone takes its state from the robot; without a match, it is said to be enabled', () => {
    expect(fc.features[1]!.properties).toEqual({ kind: 'stay_out', id: 'massif', name: 'Massif', enabled: false, color: '' })
    expect(siteMapFeatures(MAP, ANCHOR, undefined).features[1]!.properties.enabled).toBe(true)
  })

  it('the MAP\'s state applies when the robot does not know the zone (rewilding); its own prevails otherwise', () => {
    const map: SiteMap = { ...MAP, shapes: [
      { kind: 'rewilding', id: 'prairie', name: 'Prairie', enabled: false, points: [[0, 0], [3, 0], [3, 3]] },
      { kind: 'stay_out', id: 'massif', name: 'Massif', enabled: false, points: [[0, 10], [3, 10], [3, 13]] },
    ] }
    const fc2 = siteMapFeatures(map, ANCHOR, [{ id: 'massif', name: 'Massif', enabled: true }])
    expect(fc2.features.map((f) => [f.properties.kind, f.properties.enabled])).toEqual([['rewilding', false], ['stay_out', true]])
  })

  it('a map without a station is not placed', () => {
    expect(siteMapFeatures({ ...MAP, station: null }, ANCHOR, []).features).toEqual([])
  })
})

describe('work zone tints', () => {
  const AREAS = [{ id: 0, name: '', enabled: true }, { id: 757, name: 'Devant', enabled: true }, { id: 812, name: 'Fond', enabled: true }]
  const MAP2: SiteMap = {
    deviceId: 'automower:x', station: [0, 0],
    shapes: [
      { kind: 'lawn', id: 'main_area_0', points: [[0, 0], [30, 0], [30, 30]] },
      { kind: 'work_area', id: 'uuid-fond', name: 'Fond', points: [[0, 0], [5, 0], [5, 5]] },
      { kind: 'work_area', id: 'uuid-devant', name: 'Devant', points: [[10, 0], [15, 0], [15, 5]] },
      { kind: 'work_area', id: 'uuid-neuve', name: 'Pas encore relue', points: [[20, 0], [25, 0], [25, 5]] },
    ],
  }

  it('zone 0 (the whole terrain) has the terrain green; drawn zones, one tint each in the robot\'s order', () => {
    expect(workAreaColor(AREAS, 0)).toBe(LAWN_COLOR)
    expect(workAreaColor(AREAS, 757)).toBe(WORK_AREA_COLORS[0])
    expect(workAreaColor(AREAS, 812)).toBe(WORK_AREA_COLORS[1])
  })

  it('on the map, a zone takes its tint by its NAME (that of its pill); an unknown one takes the next; the terrain has none', () => {
    const colors = siteMapFeatures(MAP2, ANCHOR, undefined, AREAS).features.map((f) => [f.properties.kind, f.properties.color])
    expect(colors).toEqual([
      ['lawn', ''],
      ['work_area', WORK_AREA_COLORS[1]],
      ['work_area', WORK_AREA_COLORS[0]],
      ['work_area', WORK_AREA_COLORS[2]],
    ])
  })
})

describe('layers', () => {
  it('each shape has its layer: terrain and obstacles, work zones, exclusion zones, cables paths and station', () => {
    expect((['lawn', 'obstacle', 'work_area', 'stay_out', 'rewilding', 'guide', 'transport', 'station'] as const).map(layerOf))
      .toEqual(['lawn', 'lawn', 'work_areas', 'stay_out', 'rewilding', 'guides', 'guides', 'guides'])
  })
})

describe('the map painted in the scene', () => {
  const MAP3: SiteMap = {
    deviceId: 'automower:x', station: [0, 0],
    shapes: [
      { kind: 'station', id: 'lona_cs', points: [[0, 0], [1, 0]] },
      { kind: 'lawn', id: 'main_area_0', points: [[0, 0], [30, 0], [30, 30], [0, 30]] },
      { kind: 'obstacle', id: 'island_1', points: [[5, 5], [6, 5], [6, 6]] },
      { kind: 'work_area', id: 'uuid-fond', name: 'Fond', points: [[0, 0], [10, 0], [10, 10]] },
      { kind: 'stay_out', id: 'massif', name: 'Massif', enabled: false, points: [[0, 10], [3, 10], [3, 13]] },
      { kind: 'rewilding', id: 'prairie', name: 'Prairie', points: [[20, 0], [25, 0], [25, 5]] },
      { kind: 'guide', id: 'guide_1', points: [[0, 0], [-10, -5]] },
    ],
  }
  const AREAS = [{ id: 0, name: '', enabled: true }, { id: 758, name: 'Fond', enabled: true }]

  it('a list, in the panel\'s order: the whole terrain and the cables, work zones, then exclusions and rewilding', () => {
    const state = { workAreas: AREAS, stayOutZones: [{ id: 'massif', name: 'Massif', enabled: false }] }
    const rows = zoneRows(state, MAP3)
    expect(rows.map((r) => [r.key, r.group, r.sceneKey, r.color])).toEqual([
      ['lawn', 'base', 'lawn', LAWN_COLOR],
      ['guides', 'base', 'guides', GUIDE_COLOR],
      ['area:758', 'work', 'uuid-fond', WORK_AREA_COLORS[0]],
      ['stay:massif', 'stayOut', 'massif', STAY_OUT_COLOR],
      ['shape:prairie', 'stayOut', 'prairie', REWILDING_COLOR],
    ])
    // the whole terrain is mowed (zone 0), the exclusion is toggled, the rewilding is only shown
    expect(rows[0]).toMatchObject({ labelKey: 'mower.wholeLawn', workAreaId: 0 })
    expect(rows[3]!.stayOut).toEqual({ id: 'massif', enabled: false })
    expect(rows[4]).toMatchObject({ rewilding: true, label: 'Prairie' })
    expect(rows[4]!.stayOut).toBeUndefined()
    expect(sceneEntryKey('obstacle', 'island_1')).toBe('lawn')
    expect(sceneEntryKey('station', 'lona_cs')).toBe('guides')
  })

  it('without a map (Robots view): the robot\'s zones alone, nothing to paint; a drawn zone not yet re-read has its line', () => {
    const rows = zoneRows({ workAreas: AREAS, stayOutZones: [] }, undefined)
    expect(rows.map((r) => [r.key, r.sceneKey])).toEqual([['lawn', undefined], ['area:758', undefined]])
    const unknown = zoneRows({ workAreas: [AREAS[0]!] }, MAP3).find((r) => r.group === 'work')!
    expect(unknown).toMatchObject({ key: 'shape:uuid-fond', label: 'Fond', sceneKey: 'uuid-fond' })
    expect(unknown.workAreaId).toBeUndefined()
  })

  it('the shapes come back in the HOUSE frame (heading included); a hidden element disappears, the terrain takes its obstacles with it', () => {
    const origin = { lat: 47.3, lon: 5.05, alt: 200, heading: 30 }
    // the base placed at (4, 6) in the house: the map's station lands there
    const anchor = siteMapAnchor({ origin, dock: [4, 6], location: undefined, atStation: false })!
    const fc = siteMapFeatures(MAP3, anchor, undefined, AREAS)
    const all = sceneGroundShapes(fc, origin, new Set())
    expect(all).toHaveLength(7)
    const station = all.find((s) => !s.closed && s.line?.widthM === 0.4)!
    expect(station.points[0]![0]).toBeCloseTo(4, 4)
    expect(station.points[0]![1]).toBeCloseTo(6, 4)
    // ring without its GeoJSON closing point
    expect(all.find((s) => s.fill?.color === LAWN_COLOR)!.points).toHaveLength(4)
    // the exclusion zone disabled: almost transparent
    expect(all.find((s) => s.fill?.color === STAY_OUT_COLOR && s.points.length === 3 && s.fill.opacity < 0.1)).toBeTruthy()
    const some = sceneGroundShapes(fc, origin, new Set(['lawn', 'massif']))
    expect(some).toHaveLength(4)
  })
})
