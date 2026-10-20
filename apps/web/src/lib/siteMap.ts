import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { geoToLocal, localToGeo, type GeoOrigin, type SiteMap, type SiteMapShapeKind, type StateFor, type Vec2 } from '@kasbah/shared'
import type { GroundShape } from '../three/builders/groundOverlay'
import { offsetLocation, type LatLon } from './map'

// A mower's terrain map (`GET /api/devices/:id/map`) placed on the world.
//
// The vendor publishes it in the robot's frame (meters, x east, y north, arbitrary origin) and does not
// say where it is: only its STATION ties it to the terrain. We therefore make the map's station coincide with
// the robot's base placed in the house (`site.parkings[]`) — the real place, surveyed by
// hand —, and failing that with the robot's position when it is at the station (its GPS corrected by the
// set offset, good to within two meters). Robot roaming and no base: nothing to place.

export interface SiteMapFeatureProps {
  kind: SiteMapShapeKind
  /** The shape's identifier at the vendor: it is how a zone is hidden in the scene. */
  id: string
  name: string
  /** Exclusion zone: enabled (the robot does not enter it); true for any other shape. */
  enabled: boolean
  /** Tint of a drawn work zone (the same as its pill in the Zones panel); empty otherwise. */
  color: string
}

/**
 * The LAYERS that are shown or hidden on the map: the surveyed terrain (and its obstacles), the drawn
 * work zones, the exclusion zones, the rewilding ones, the guide cables with the
 * paths and the station.
 */
export const SITE_MAP_LAYERS = ['lawn', 'work_areas', 'stay_out', 'rewilding', 'guides'] as const
export type SiteMapLayer = (typeof SITE_MAP_LAYERS)[number]
export function layerOf(kind: SiteMapShapeKind): SiteMapLayer {
  switch (kind) {
    case 'lawn': case 'obstacle': return 'lawn'
    case 'work_area': return 'work_areas'
    case 'stay_out': return 'stay_out'
    case 'rewilding': return 'rewilding'
    default: return 'guides'
  }
}

/** A rewilding zone: the yellow of the bee that marks it in the vendor's app. */
export const REWILDING_COLOR = '#ffd54f'
/** The whole terrain: the green of the vendor's app. */
export const LAWN_COLOR = '#43a047'
/**
 * The DRAWN work zones, one tint each, in the order the robot lists them: none is
 * close to the colors already taken on the map (terrain green, red, cable blue, yellow).
 */
export const WORK_AREA_COLORS = ['#26c6da', '#ab47bc', '#ff9800', '#ec407a', '#8d6e63', '#e0e0e0'] as const

type WorkAreas = StateFor<'mower'>['workAreas']
/**
 * The tint of a work zone: the terrain's for zone `0` (the whole terrain), otherwise its
 * rank among the drawn zones. It is what links the panel's pill to the shape on the map.
 */
export function workAreaColor(workAreas: WorkAreas, id: number): string {
  if (id === 0) return LAWN_COLOR
  const i = tracedAreas(workAreas).findIndex((a) => a.id === id)
  return paletteAt(i < 0 ? tracedAreas(workAreas).length : i)
}
const tracedAreas = (workAreas: WorkAreas) => (workAreas ?? []).filter((a) => a.id !== 0)
const paletteAt = (i: number) => WORK_AREA_COLORS[i % WORK_AREA_COLORS.length]!
const isClosed = (kind: SiteMapShapeKind) => kind === 'lawn' || kind === 'work_area' || kind === 'obstacle' || kind === 'stay_out' || kind === 'rewilding'

/**
 * The tint of each DRAWN work zone of the map, by its shape's id. Linked to `workAreas`
 * by its NAME (the only link Husqvarna gives); a zone the list does not know yet (not
 * re-read) takes the next tint.
 */
function workAreaShapeColors(map: SiteMap, workAreas: WorkAreas): Map<string, string> {
  const out = new Map<string, string>()
  let unmatched = 0
  for (const s of map.shapes) {
    if (s.kind !== 'work_area') continue
    const area = workAreas?.find((a) => a.id !== 0 && a.name === (s.name ?? ''))
    out.set(s.id, area ? workAreaColor(workAreas, area.id) : paletteAt(tracedAreas(workAreas).length + unmatched++))
  }
  return out
}

/**
 * The GPS point where to place the map's station: the robot's base in the house if it is placed,
 * otherwise the robot itself while it is at the station. `offset` (m, house frame: the `mapOffset`
 * set in the house) then realigns the whole map on the photo. `undefined` = it is not placed.
 */
export function siteMapAnchor(o: { origin: GeoOrigin | undefined; dock: Vec2 | undefined; location: LatLon | undefined; atStation: boolean; offset?: Vec2 | undefined }): LatLon | undefined {
  const [dx, dy] = o.offset ?? [0, 0]
  if (o.origin && o.dock) {
    const g = localToGeo(o.origin, [o.dock[0] + dx, o.dock[1] + dy, 0])
    return { lat: g.lat, lon: g.lon }
  }
  if (!o.atStation || !o.location) return undefined
  return o.origin && (dx || dy) ? offsetLocation(o.origin, o.location, [dx, dy]) : o.location
}

/**
 * The map's shapes as GeoJSON, the map's station placed on `anchor`. Exclusion zones
 * take their state (enabled or not) from the robot's state, by their identifier; a shape with no
 * match is said to be enabled. A drawn work zone takes its tint by its NAME (the only
 * link Husqvarna gives between the map and `workAreas`); a zone the list does not know (not
 * yet re-read) takes the next tint. Map without a station: nothing.
 */
export function siteMapFeatures(map: SiteMap, anchor: LatLon, stayOutZones: StateFor<'mower'>['stayOutZones'], workAreas?: WorkAreas): FeatureCollection<Geometry, SiteMapFeatureProps> {
  const station = map.station
  if (!station) return { type: 'FeatureCollection', features: [] }
  const origin: GeoOrigin = { lat: anchor.lat, lon: anchor.lon, alt: 0, heading: 0 }
  const lonLat = ([x, y]: [number, number]): [number, number] => {
    const g = localToGeo(origin, [x - station[0], y - station[1], 0])
    return [g.lon, g.lat]
  }
  const features: Feature<Geometry, SiteMapFeatureProps>[] = []
  const colors = workAreaShapeColors(map, workAreas)
  for (const s of map.shapes) {
    const coords = s.points.map(lonLat)
    const closed = isClosed(s.kind)
    if (closed && coords.length < 3) continue
    // the robot's state prevails (it follows a toggle made here); failing that the map's, the only one to say rewilding
    const enabled = s.kind === 'stay_out' ? stayOutZones?.find((z) => z.id === s.id)?.enabled ?? s.enabled ?? true : s.enabled ?? true
    features.push({
      type: 'Feature',
      properties: { kind: s.kind, id: s.id, name: s.name ?? '', enabled, color: colors.get(s.id) ?? '' },
      geometry: closed ? { type: 'Polygon', coordinates: [[...coords, coords[0]!]] } : { type: 'LineString', coordinates: coords },
    })
  }
  return { type: 'FeatureCollection', features }
}

// ---- The map painted in the 3D scene ----------------------------------------------------------

/**
 * What is shown or hidden ONE BY ONE in the scene: the terrain (with its obstacles), each
 * drawn zone (work, exclusion, rewilding) by its shape's id, the cables with the paths
 * and the station.
 */
export function sceneEntryKey(kind: SiteMapShapeKind, id: string): string {
  if (kind === 'lawn' || kind === 'obstacle') return 'lawn'
  if (kind === 'guide' || kind === 'transport' || kind === 'station') return 'guides'
  return id
}

/** The map's other tints (those of the satellite map). */
export const STAY_OUT_COLOR = '#e53935'
export const GUIDE_COLOR = '#42a5f5'
const STATION_COLOR = '#fdd835'

/**
 * The shapes to paint on the terrain, in the HOUSE frame (meters): the map placed on the
 * world (`siteMapFeatures`), brought back by the house's origin; hidden elements are removed.
 * Same reading as on the satellite map: light fill, solid outline, disabled zone almost
 * transparent.
 */
export function sceneGroundShapes(fc: FeatureCollection<Geometry, SiteMapFeatureProps>, origin: GeoOrigin, hidden: ReadonlySet<string>): GroundShape[] {
  const out: GroundShape[] = []
  for (const f of fc.features) {
    const p = f.properties
    if (hidden.has(sceneEntryKey(p.kind, p.id))) continue
    const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0]!.slice(0, -1) : f.geometry.type === 'LineString' ? f.geometry.coordinates : []
    const points = ring.map(([lon, lat]) => { const [x, y] = geoToLocal(origin, { lat: lat!, lon: lon! }); return [x, y] as Vec2 })
    const toggled = p.kind === 'stay_out' || p.kind === 'rewilding'
    const dim = toggled && !p.enabled
    switch (p.kind) {
      case 'lawn': out.push({ points, closed: true, fill: { color: LAWN_COLOR, opacity: 0.16 }, line: { color: '#66bb6a', opacity: 0.9, widthM: 0.15 } }); break
      case 'work_area': out.push({ points, closed: true, fill: { color: p.color, opacity: 0.32 }, line: { color: p.color, opacity: 0.95, widthM: 0.25 } }); break
      case 'obstacle': out.push({ points, closed: true, fill: { color: STAY_OUT_COLOR, opacity: 0.3 }, line: { color: '#ef5350', opacity: 0.9, widthM: 0.12 } }); break
      case 'stay_out': case 'rewilding': {
        const color = p.kind === 'stay_out' ? STAY_OUT_COLOR : REWILDING_COLOR
        out.push({ points, closed: true, fill: { color, opacity: dim ? 0.06 : 0.42 }, line: { color, opacity: dim ? 0.5 : 0.95, widthM: 0.2 } })
        break
      }
      case 'station': out.push({ points, closed: false, line: { color: STATION_COLOR, opacity: 1, widthM: 0.4 } }); break
      default: out.push({ points, closed: false, line: { color: GUIDE_COLOR, opacity: 0.95, widthM: p.kind === 'transport' ? 0.3 : 0.15 } })
    }
  }
  return out
}

// ---- The panel's zone list ---------------------------------------------------------------

/**
 * A line of the zones panel: what the ROBOT allows (mow the zone, toggle the exclusion) and
 * what the MAP allows (show or hide it in the scene, `sceneKey`). The two sources
 * meet by name (work zones) or id (exclusions); a zone known to only one
 * source gets a line anyway, with what that source allows.
 */
export interface ZoneRow {
  key: string
  group: 'base' | 'work' | 'stayOut'
  /** Name of the zone; failing that, i18n key (`labelKey`). A work zone is named by `workAreaId`. */
  label?: string
  labelKey?: string
  color: string
  /** Shown/hidden in the scene (`sceneEntryKey`); absent = not on the map. */
  sceneKey?: string
  /** Can be mowed: the robot's work zone. */
  workAreaId?: number
  workAreaEnabled?: boolean
  /** Can be toggled: the robot's exclusion zone. */
  stayOut?: { id: string; enabled: boolean }
  /** Rewilding zone: on the map only, the API does not toggle it. */
  rewilding?: boolean
}

/**
 * The lines, in the panel's order: first the terrain (the whole terrain, to mow) and the cables,
 * then the work zones in the robot's order, finally the exclusion and rewilding zones.
 */
export function zoneRows(state: Pick<StateFor<'mower'>, 'workAreas' | 'stayOutZones'>, map: SiteMap | undefined): ZoneRow[] {
  const shapes = map?.shapes ?? []
  const has = (...kinds: SiteMapShapeKind[]) => shapes.some((s) => kinds.includes(s.kind))
  const areas = state.workAreas ?? []
  const whole = areas.find((a) => a.id === 0)
  const rows: ZoneRow[] = []
  if (whole || has('lawn', 'obstacle')) {
    rows.push({
      key: 'lawn', group: 'base', labelKey: whole ? 'mower.wholeLawn' : 'vehicle.map.layerLawn', color: LAWN_COLOR,
      ...(has('lawn', 'obstacle') ? { sceneKey: 'lawn' } : {}),
      ...(whole ? { workAreaId: 0, workAreaEnabled: whole.enabled } : {}),
    })
  }
  if (has('guide', 'transport', 'station')) rows.push({ key: 'guides', group: 'base', labelKey: 'vehicle.map.layerGuides', color: GUIDE_COLOR, sceneKey: 'guides' })

  const colors = map ? workAreaShapeColors(map, state.workAreas) : new Map<string, string>()
  const traced = shapes.filter((s) => s.kind === 'work_area')
  const used = new Set<string>()
  for (const a of areas) {
    if (a.id === 0) continue
    const shape = traced.find((s) => !used.has(s.id) && (s.name ?? '') === a.name)
    if (shape) used.add(shape.id)
    rows.push({ key: `area:${a.id}`, group: 'work', color: workAreaColor(state.workAreas, a.id), workAreaId: a.id, workAreaEnabled: a.enabled, ...(shape ? { sceneKey: shape.id } : {}) })
  }
  for (const s of traced) if (!used.has(s.id)) rows.push({ key: `shape:${s.id}`, group: 'work', label: s.name || s.id, color: colors.get(s.id) ?? WORK_AREA_COLORS[0], sceneKey: s.id })

  const stayOutShapes = new Set(shapes.filter((s) => s.kind === 'stay_out').map((s) => s.id))
  for (const z of state.stayOutZones ?? []) {
    rows.push({ key: `stay:${z.id}`, group: 'stayOut', label: z.name || z.id, color: STAY_OUT_COLOR, stayOut: { id: z.id, enabled: z.enabled }, ...(stayOutShapes.has(z.id) ? { sceneKey: z.id } : {}) })
    stayOutShapes.delete(z.id)
  }
  for (const s of shapes) {
    if (s.kind === 'stay_out' && stayOutShapes.has(s.id)) rows.push({ key: `shape:${s.id}`, group: 'stayOut', label: s.name || s.id, color: STAY_OUT_COLOR, sceneKey: s.id })
    if (s.kind === 'rewilding') rows.push({ key: `shape:${s.id}`, group: 'stayOut', label: s.name || s.id, color: REWILDING_COLOR, sceneKey: s.id, rewilding: true })
  }
  return rows
}
