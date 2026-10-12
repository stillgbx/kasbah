import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { geoToLocal, localToGeo, type GeoOrigin, type SiteMap, type SiteMapShapeKind, type StateFor, type Vec2 } from '@kasbah/shared'
import type { GroundShape } from '../three/builders/groundOverlay'
import { offsetLocation, type LatLon } from './map'

// La carte du terrain d'une tondeuse (`GET /api/devices/:id/map`) posée sur le monde.
//
// Le fabricant la publie dans le repère du robot (mètres, x est, y nord, origine quelconque) et ne
// dit pas où elle est : seule sa STATION la rattache au terrain. On fait donc coïncider la station de
// la carte avec la base du robot posée dans la maison (`site.parkings[]`) — la vraie place, relevée à
// la main —, et à défaut avec la position du robot quand il est à la station (son GPS corrigé du
// décalage réglé, bon à deux mètres près). Robot en vadrouille et pas de base : rien à poser.

export interface SiteMapFeatureProps {
  kind: SiteMapShapeKind
  /** L'identifiant de la forme chez le fabricant : c'est par lui qu'on masque une zone dans la scène. */
  id: string
  name: string
  /** Zone d'exclusion : activée (le robot n'y entre pas) ; vrai pour toute autre forme. */
  enabled: boolean
  /** Teinte d'une zone de travail tracée (la même que sa pastille dans le panneau Zones) ; vide sinon. */
  color: string
}

/**
 * Les CALQUES qu'on montre ou masque sur la carte : le terrain relevé (et ses obstacles), les zones de
 * travail tracées, les zones d'exclusion, celles de réensauvagement, les câbles guides avec les
 * chemins et la station.
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

/** Une zone de réensauvagement : le jaune de l'abeille qui la signale dans l'appli du fabricant. */
export const REWILDING_COLOR = '#ffd54f'
/** Le terrain entier : le vert de l'appli du fabricant. */
export const LAWN_COLOR = '#43a047'
/**
 * Les zones de travail TRACÉES, une teinte chacune, dans l'ordre où le robot les liste : aucune n'est
 * proche des couleurs déjà prises sur la carte (vert du terrain, rouge, bleu des câbles, jaune).
 */
export const WORK_AREA_COLORS = ['#26c6da', '#ab47bc', '#ff9800', '#ec407a', '#8d6e63', '#e0e0e0'] as const

type WorkAreas = StateFor<'mower'>['workAreas']
/**
 * La teinte d'une zone de travail : celle du terrain pour la zone `0` (tout le terrain), sinon son
 * rang parmi les zones tracées. C'est ce qui relie la pastille du panneau à la forme sur la carte.
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
 * La teinte de chaque zone de travail TRACÉE de la carte, par l'id de sa forme. Reliée à `workAreas`
 * par son NOM (le seul lien que Husqvarna donne) ; une zone que la liste ne connaît pas encore (pas
 * relue) prend la teinte suivante.
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
 * Le point GPS où poser la station de la carte : la base du robot dans la maison si elle est posée,
 * sinon le robot lui-même tant qu'il est à la station. `offset` (m, repère maison : le `mapOffset`
 * réglé dans la maison) recale ensuite la carte entière sur la photo. `undefined` = elle ne se pose pas.
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
 * Les formes de la carte en GeoJSON, la station de la carte posée sur `anchor`. Les zones d'exclusion
 * prennent leur état (activée ou non) dans l'état du robot, par leur identifiant ; une forme sans
 * correspondance est dite activée. Une zone de travail tracée prend sa teinte par son NOM (le seul
 * lien que Husqvarna donne entre la carte et `workAreas`) ; une zone que la liste ne connaît pas (pas
 * encore relue) prend la teinte suivante. Carte sans station : rien.
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
    // l'état du robot prime (il suit une bascule faite ici) ; à défaut celui de la carte, seul à dire le réensauvagement
    const enabled = s.kind === 'stay_out' ? stayOutZones?.find((z) => z.id === s.id)?.enabled ?? s.enabled ?? true : s.enabled ?? true
    features.push({
      type: 'Feature',
      properties: { kind: s.kind, id: s.id, name: s.name ?? '', enabled, color: colors.get(s.id) ?? '' },
      geometry: closed ? { type: 'Polygon', coordinates: [[...coords, coords[0]!]] } : { type: 'LineString', coordinates: coords },
    })
  }
  return { type: 'FeatureCollection', features }
}

// ---- La carte peinte dans la scène 3D ----------------------------------------------------------

/**
 * Ce qui se montre ou se masque UN PAR UN dans la scène : le terrain (avec ses obstacles), chaque
 * zone tracée (travail, exclusion, réensauvagement) par l'id de sa forme, les câbles avec les chemins
 * et la station.
 */
export function sceneEntryKey(kind: SiteMapShapeKind, id: string): string {
  if (kind === 'lawn' || kind === 'obstacle') return 'lawn'
  if (kind === 'guide' || kind === 'transport' || kind === 'station') return 'guides'
  return id
}

/** Les autres teintes de la carte (celles de la carte satellite). */
export const STAY_OUT_COLOR = '#e53935'
export const GUIDE_COLOR = '#42a5f5'
const STATION_COLOR = '#fdd835'

/**
 * Les formes à peindre sur le terrain, dans le repère de la MAISON (mètres) : la carte posée sur le
 * monde (`siteMapFeatures`), ramenée par l'origine de la maison ; les éléments masqués sont retirés.
 * Même lecture que sur la carte satellite : aplat léger, contour franc, zone désactivée presque
 * transparente.
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

// ---- La liste des zones du panneau ---------------------------------------------------------------

/**
 * Une ligne du panneau des zones : ce que le ROBOT permet (tondre la zone, basculer l'exclusion) et
 * ce que la CARTE permet (la montrer ou la masquer dans la scène, `sceneKey`). Les deux sources se
 * rejoignent par le nom (zones de travail) ou l'id (exclusions) ; une zone connue d'une seule
 * source a une ligne quand même, avec ce que cette source permet.
 */
export interface ZoneRow {
  key: string
  group: 'base' | 'work' | 'stayOut'
  /** Nom de la zone ; à défaut, clé i18n (`labelKey`). Une zone de travail se nomme par `workAreaId`. */
  label?: string
  labelKey?: string
  color: string
  /** Se montre/masque dans la scène (`sceneEntryKey`) ; absent = pas sur la carte. */
  sceneKey?: string
  /** Se tond : la zone de travail du robot. */
  workAreaId?: number
  workAreaEnabled?: boolean
  /** Se bascule : la zone d'exclusion du robot. */
  stayOut?: { id: string; enabled: boolean }
  /** Zone de réensauvagement : sur la carte seulement, l'API ne la bascule pas. */
  rewilding?: boolean
}

/**
 * Les lignes, dans l'ordre du panneau : d'abord le terrain (tout le terrain, à tondre) et les câbles,
 * puis les zones de travail dans l'ordre du robot, enfin les zones d'exclusion et de réensauvagement.
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
