import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import { geoDistance, geoToLocal, localToGeo } from '@kasbah/shared'

// The vehicle map: what is decided WITHOUT the rendering engine (testable), the component
// `VehicleMap.vue` only applying. Assembly entirely free, no account or key:
//   - MapLibre GL JS engine (WebGL vector rendering, continuous zoom, tilt, 3D buildings);
//   - plan: OpenFreeMap (OpenStreetMap vector tiles, worldwide, free, no key);
//   - satellite: IGN orthophotos through the Géoplateforme (20 cm per pixel over all of France,
//     open license, no key). France only: outside France, the satellite view is empty and the
//     plan remains the natural fallback — no worldwide fallback for now (user's choice).
// Google Maps is ruled out: since March 2025 the key requires a credit card, even without exceeding
// the free tier.

export type MapMode = 'plan' | 'satellite'
export const MAP_MODES: readonly MapMode[] = ['plan', 'satellite']

/** OpenFreeMap styles: `liberty` (light, complete) and `dark`, following the app's theme. */
export function planStyleUrl(dark: boolean): string {
  return `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'liberty'}`
}

/**
 * IGN orthophotos as WMTS, Web Mercator grid (`PM`): the same pyramid as the plan, so the
 * zoom levels coincide. The `HR.ORTHOIMAGERY.ORTHOPHOTOS` layer is the high resolution
 * (20 cm); level 19 is the finest served everywhere.
 */
export const IGN_ORTHO_TILE_URL =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=HR.ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal'
  + '&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
export const IGN_ATTRIBUTION = '© IGN — Géoplateforme'
export const IGN_MAX_ZOOM = 19

/**
 * BARE "satellite" style: the photo alone. Serves as a fallback when the labels cannot be
 * loaded — a photo without names is better than an empty map.
 */
export function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      ign: { type: 'raster', tiles: [IGN_ORTHO_TILE_URL], tileSize: 256, maxzoom: IGN_MAX_ZOOM, attribution: IGN_ATTRIBUTION },
    },
    layers: [{ id: 'ign', type: 'raster', source: 'ign' }],
  }
}

/**
 * COMPLETE "satellite" style: the IGN photo topped with the plan's LABELS (cities, streets).
 * An orthophoto does not say where we are; without the names, recognizing one's street takes effort.
 *
 * We take the plan's vector style and keep only the `symbol` layers: these are
 * exactly the labels, and nothing of their geometry will mask the photo. The plan's `sources`,
 * `glyphs` and `sprite` follow — they are what carry the fonts and icons.
 */
export function satelliteStyleWithLabels(plan: StyleSpecification): StyleSpecification {
  const labels = (plan.layers ?? []).filter((l) => l.type === 'symbol').map(labelOverImagery)
  return {
    ...plan,
    sources: {
      ...plan.sources,
      ign: { type: 'raster', tiles: [IGN_ORTHO_TILE_URL], tileSize: 256, maxzoom: IGN_MAX_ZOOM, attribution: IGN_ATTRIBUTION },
    },
    layers: [{ id: 'ign', type: 'raster', source: 'ign' }, ...labels],
  }
}

/**
 * A label readable ON A PHOTO. The plan's colors are computed for a plain light
 * (or plain dark) background; on an orthophoto — fields, roofs, trees, shadows — they
 * drown. We therefore impose the same treatment everywhere, independent of the theme: white text, solid
 * black outline. The rest of the layer (font, size, placement, filters) comes from the plan, intact.
 */
function labelOverImagery(layer: LayerSpecification): LayerSpecification {
  if (layer.type !== 'symbol') return layer
  return {
    ...layer,
    paint: {
      ...layer.paint,
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0, 0, 0, 0.85)',
      'text-halo-width': 1.6,
      'text-halo-blur': 0.4,
    },
  }
}

export type LatLon = { lat: number; lon: number }
export type MapView =
  | { kind: 'center'; center: LatLon; zoom: number }
  | { kind: 'bounds'; sw: LatLon; ne: LatLon }
  | { kind: 'none' }

/** Zoom of a lone car: the neighborhood, enough to read the street. */
export const CAR_ZOOM = 16
/** Beyond this distance, showing the house AND the car teaches nothing more: we frame the car. */
export const BOTH_MAX_M = 3000

/**
 * Initial framing. Car near the house (parked in front, in the neighborhood): both in
 * the frame, we see where it is RELATIVE to home. Far: the car alone, at the
 * neighborhood zoom. Without a car position: the house, for lack of better. Without anything: nothing.
 */
export function initialView(car: LatLon | undefined, home: LatLon | undefined): MapView {
  if (car && home && geoDistance(car, home) <= BOTH_MAX_M) {
    return {
      kind: 'bounds',
      sw: { lat: Math.min(car.lat, home.lat), lon: Math.min(car.lon, home.lon) },
      ne: { lat: Math.max(car.lat, home.lat), lon: Math.max(car.lon, home.lon) },
    }
  }
  if (car) return { kind: 'center', center: car, zoom: CAR_ZOOM }
  if (home) return { kind: 'center', center: home, zoom: CAR_ZOOM }
  return { kind: 'none' }
}

/**
 * Consumed share of a quota, as an integer percentage capped at 100: what the card's bottom gauge
 * fills. An exceeded quota (the plugin counted more than its limit) stays full, it does not overflow.
 */
export function quotaPercent(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)))
}

/** Beyond that, the gauge turns to the alert tint: the day's quota is nearing its end. */
export const QUOTA_TENSE_PCT = 80

/**
 * The GPS point of a device CORRECTED by the offset set in the house (`gpsOffset`, in meters in the
 * house frame, hence rotated by its heading). The 3D scene already applies it (`sitePosition`); the
 * map must show the same place, otherwise one is adjusted while looking at the other.
 */
export function offsetLocation(origin: { lat: number; lon: number; alt: number; heading: number }, p: LatLon, offset: [number, number]): LatLon {
  const [x, y] = geoToLocal(origin, p)
  const g = localToGeo(origin, [x + offset[0], y + offset[1], 0])
  return { lat: g.lat, lon: g.lon }
}

/** Heading normalized in [0, 360[; Tesla gives 0 = north, clockwise, like MapLibre. */
export function normalizeHeading(deg: number): number {
  return ((deg % 360) + 360) % 360
}
