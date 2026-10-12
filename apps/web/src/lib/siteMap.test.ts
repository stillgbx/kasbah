import { describe, expect, it } from 'vitest'
import { geoToLocal, type SiteMap } from '@kasbah/shared'
import { GUIDE_COLOR, LAWN_COLOR, REWILDING_COLOR, STAY_OUT_COLOR, WORK_AREA_COLORS, layerOf, zoneRows, sceneEntryKey, sceneGroundShapes, siteMapAnchor, siteMapFeatures, workAreaColor } from './siteMap'

// La carte du robot n'a pas de coordonnées GPS : elle se pose par sa STATION. Ces tests tiennent
// l'ancrage (base posée d'abord, robot à la station ensuite) et la pose (mètres est/nord autour de
// la station, zones d'exclusion teintées selon l'état du robot).

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
  it('la base posée dans la maison prime, convertie par l’origine (cap compris)', () => {
    const a = siteMapAnchor({ origin: ORIGIN, dock: [4, 6], location: ANCHOR, atStation: true })!
    const [x, y] = geoToLocal(ORIGIN, a)
    expect(x).toBeCloseTo(4, 6)
    expect(y).toBeCloseTo(6, 6)
  })
  it('le décalage de la carte (repère maison) s’ajoute à la base, ou au robot à la station', () => {
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

  it('sans base : le robot, seulement s’il est à la station', () => {
    expect(siteMapAnchor({ origin: ORIGIN, dock: undefined, location: ANCHOR, atStation: true })).toEqual(ANCHOR)
    expect(siteMapAnchor({ origin: ORIGIN, dock: undefined, location: ANCHOR, atStation: false })).toBeUndefined()
  })
})

describe('siteMapFeatures', () => {
  const fc = siteMapFeatures(MAP, ANCHOR, [{ id: 'massif', name: 'Massif', enabled: false }])
  const local = (lonLat: number[]) => geoToLocal({ ...ANCHOR, alt: 0, heading: 0 }, { lat: lonLat[1]!, lon: lonLat[0]! })

  it('la station de la carte tombe sur l’ancrage ; un point à 10 m à l’est de la station, 10 m à l’est de l’ancrage', () => {
    const ring = (fc.features[0]!.geometry as { coordinates: number[][][] }).coordinates[0]!
    expect(local(ring[0]!)[0]).toBeCloseTo(0, 6)
    expect(local(ring[1]!)[0]).toBeCloseTo(10, 6)
    expect(local(ring[2]!)[1]).toBeCloseTo(10, 6)
    // anneau fermé
    expect(ring.at(-1)).toEqual(ring[0])
  })

  it('polygones pour les zones, ligne pour les câbles ; un polygone de deux points est sauté', () => {
    expect(fc.features.map((f) => [f.properties.kind, f.geometry.type])).toEqual([
      ['work_area', 'Polygon'], ['stay_out', 'Polygon'], ['guide', 'LineString'],
    ])
  })

  it('une zone d’exclusion prend son état du robot ; sans correspondance, elle est dite activée', () => {
    expect(fc.features[1]!.properties).toEqual({ kind: 'stay_out', id: 'massif', name: 'Massif', enabled: false, color: '' })
    expect(siteMapFeatures(MAP, ANCHOR, undefined).features[1]!.properties.enabled).toBe(true)
  })

  it('l’état de la CARTE vaut quand le robot ne connaît pas la zone (réensauvagement) ; le sien prime sinon', () => {
    const map: SiteMap = { ...MAP, shapes: [
      { kind: 'rewilding', id: 'prairie', name: 'Prairie', enabled: false, points: [[0, 0], [3, 0], [3, 3]] },
      { kind: 'stay_out', id: 'massif', name: 'Massif', enabled: false, points: [[0, 10], [3, 10], [3, 13]] },
    ] }
    const fc2 = siteMapFeatures(map, ANCHOR, [{ id: 'massif', name: 'Massif', enabled: true }])
    expect(fc2.features.map((f) => [f.properties.kind, f.properties.enabled])).toEqual([['rewilding', false], ['stay_out', true]])
  })

  it('une carte sans station ne se pose pas', () => {
    expect(siteMapFeatures({ ...MAP, station: null }, ANCHOR, []).features).toEqual([])
  })
})

describe('teintes des zones de travail', () => {
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

  it('la zone 0 (tout le terrain) a le vert du terrain ; les zones tracées, une teinte chacune dans l’ordre du robot', () => {
    expect(workAreaColor(AREAS, 0)).toBe(LAWN_COLOR)
    expect(workAreaColor(AREAS, 757)).toBe(WORK_AREA_COLORS[0])
    expect(workAreaColor(AREAS, 812)).toBe(WORK_AREA_COLORS[1])
  })

  it('sur la carte, une zone prend sa teinte par son NOM (celle de sa pastille) ; une inconnue prend la suivante ; le terrain n’en a pas', () => {
    const colors = siteMapFeatures(MAP2, ANCHOR, undefined, AREAS).features.map((f) => [f.properties.kind, f.properties.color])
    expect(colors).toEqual([
      ['lawn', ''],
      ['work_area', WORK_AREA_COLORS[1]],
      ['work_area', WORK_AREA_COLORS[0]],
      ['work_area', WORK_AREA_COLORS[2]],
    ])
  })
})

describe('calques', () => {
  it('chaque forme a son calque : terrain et obstacles, zones de travail, zones d’exclusion, câbles chemins et station', () => {
    expect((['lawn', 'obstacle', 'work_area', 'stay_out', 'rewilding', 'guide', 'transport', 'station'] as const).map(layerOf))
      .toEqual(['lawn', 'lawn', 'work_areas', 'stay_out', 'rewilding', 'guides', 'guides', 'guides'])
  })
})

describe('la carte peinte dans la scène', () => {
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

  it('une liste, dans l’ordre du panneau : tout le terrain et les câbles, les zones de travail, puis exclusions et réensauvagement', () => {
    const state = { workAreas: AREAS, stayOutZones: [{ id: 'massif', name: 'Massif', enabled: false }] }
    const rows = zoneRows(state, MAP3)
    expect(rows.map((r) => [r.key, r.group, r.sceneKey, r.color])).toEqual([
      ['lawn', 'base', 'lawn', LAWN_COLOR],
      ['guides', 'base', 'guides', GUIDE_COLOR],
      ['area:758', 'work', 'uuid-fond', WORK_AREA_COLORS[0]],
      ['stay:massif', 'stayOut', 'massif', STAY_OUT_COLOR],
      ['shape:prairie', 'stayOut', 'prairie', REWILDING_COLOR],
    ])
    // tout le terrain se tond (zone 0), l'exclusion se bascule, le réensauvagement se montre seulement
    expect(rows[0]).toMatchObject({ labelKey: 'mower.wholeLawn', workAreaId: 0 })
    expect(rows[3]!.stayOut).toEqual({ id: 'massif', enabled: false })
    expect(rows[4]).toMatchObject({ rewilding: true, label: 'Prairie' })
    expect(rows[4]!.stayOut).toBeUndefined()
    expect(sceneEntryKey('obstacle', 'island_1')).toBe('lawn')
    expect(sceneEntryKey('station', 'lona_cs')).toBe('guides')
  })

  it('sans carte (vue Robots) : les zones du robot seules, sans rien à peindre ; une zone tracée pas encore relue a sa ligne', () => {
    const rows = zoneRows({ workAreas: AREAS, stayOutZones: [] }, undefined)
    expect(rows.map((r) => [r.key, r.sceneKey])).toEqual([['lawn', undefined], ['area:758', undefined]])
    const unknown = zoneRows({ workAreas: [AREAS[0]!] }, MAP3).find((r) => r.group === 'work')!
    expect(unknown).toMatchObject({ key: 'shape:uuid-fond', label: 'Fond', sceneKey: 'uuid-fond' })
    expect(unknown.workAreaId).toBeUndefined()
  })

  it('les formes reviennent dans le repère de la MAISON (cap compris) ; un élément masqué disparaît, le terrain emporte ses obstacles', () => {
    const origin = { lat: 47.3, lon: 5.05, alt: 200, heading: 30 }
    // la base posée en (4, 6) dans la maison : la station de la carte y tombe
    const anchor = siteMapAnchor({ origin, dock: [4, 6], location: undefined, atStation: false })!
    const fc = siteMapFeatures(MAP3, anchor, undefined, AREAS)
    const all = sceneGroundShapes(fc, origin, new Set())
    expect(all).toHaveLength(7)
    const station = all.find((s) => !s.closed && s.line?.widthM === 0.4)!
    expect(station.points[0]![0]).toBeCloseTo(4, 4)
    expect(station.points[0]![1]).toBeCloseTo(6, 4)
    // anneau sans son point de fermeture GeoJSON
    expect(all.find((s) => s.fill?.color === LAWN_COLOR)!.points).toHaveLength(4)
    // la zone d'exclusion désactivée : presque transparente
    expect(all.find((s) => s.fill?.color === STAY_OUT_COLOR && s.points.length === 3 && s.fill.opacity < 0.1)).toBeTruthy()
    const some = sceneGroundShapes(fc, origin, new Set(['lawn', 'massif']))
    expect(some).toHaveLength(4)
  })
})
