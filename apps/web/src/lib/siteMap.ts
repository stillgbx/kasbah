import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { localToGeo, type GeoOrigin, type SiteMap, type SiteMapShapeKind, type StateFor, type Vec2 } from '@kasbah/shared'
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
  let unmatched = 0
  for (const s of map.shapes) {
    const coords = s.points.map(lonLat)
    const closed = s.kind === 'lawn' || s.kind === 'work_area' || s.kind === 'obstacle' || s.kind === 'stay_out' || s.kind === 'rewilding'
    if (closed && coords.length < 3) continue
    // l'état du robot prime (il suit une bascule faite ici) ; à défaut celui de la carte, seul à dire le réensauvagement
    const enabled = s.kind === 'stay_out' ? stayOutZones?.find((z) => z.id === s.id)?.enabled ?? s.enabled ?? true : s.enabled ?? true
    const area = s.kind === 'work_area' ? workAreas?.find((a) => a.id !== 0 && a.name === (s.name ?? '')) : undefined
    const color = s.kind !== 'work_area' ? '' : area ? workAreaColor(workAreas, area.id) : paletteAt(tracedAreas(workAreas).length + unmatched++)
    features.push({
      type: 'Feature',
      properties: { kind: s.kind, name: s.name ?? '', enabled, color },
      geometry: closed ? { type: 'Polygon', coordinates: [[...coords, coords[0]!]] } : { type: 'LineString', coordinates: coords },
    })
  }
  return { type: 'FeatureCollection', features }
}
