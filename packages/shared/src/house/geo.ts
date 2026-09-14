import type { GeoOrigin, Site } from './schema'
import { pointInPolygon } from './geometry/vec2'
import type { Vec3 } from './geometry/types'

// Conversion repère local (mètres, x est, y nord, tourné du cap `heading`) ↔ WGS84.
// Approximation équirectangulaire : largement suffisante à l'échelle d'une parcelle.

const R = 6378137
const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

export interface GeoPoint { lat: number; lon: number; alt: number }

export function localToGeo(origin: GeoOrigin, [x, y, z]: Vec3): GeoPoint {
  const h = toRad(origin.heading)
  // l'axe local +y pointe au cap `heading` (horaire depuis le nord)
  const east = x * Math.cos(h) + y * Math.sin(h)
  const north = -x * Math.sin(h) + y * Math.cos(h)
  const lat = origin.lat + toDeg(north / R)
  const lon = origin.lon + toDeg(east / (R * Math.cos(toRad(origin.lat))))
  return { lat, lon, alt: origin.alt + z }
}

export function geoToLocal(origin: GeoOrigin, p: { lat: number; lon: number; alt?: number }): Vec3 {
  const h = toRad(origin.heading)
  const north = toRad(p.lat - origin.lat) * R
  const east = toRad(p.lon - origin.lon) * R * Math.cos(toRad(origin.lat))
  const x = east * Math.cos(h) - north * Math.sin(h)
  const y = east * Math.sin(h) + north * Math.cos(h)
  return [x, y, (p.alt ?? origin.alt) - origin.alt]
}

/** Distance au sol (m) entre deux points WGS84 (haversine). */
export function geoDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Place d'un point GPS dans la scène, **ou `null` s'il tombe hors du terrain de la maison**.
 *
 * C'est ainsi qu'un véhicule prend sa place en 3D : il n'a pas de `position` dans `house.json` (voir
 * `schema.ts`), elle se CALCULE à chaque relevé. Le terrain fait office de test d'appartenance — une
 * voiture au bureau ou en vadrouille n'a rien à faire dans le jardin, et ne doit donc pas y
 * apparaître, fût-ce au bord.
 *
 * `z = 0` : posé sur le terrain, comme tout marqueur d'extérieur.
 */
export function sitePosition(house: { origin: GeoOrigin; site: Site }, p: { lat: number; lon: number }): Vec3 | null {
  const [x, y] = geoToLocal(house.origin, p)
  return pointInPolygon([x, y], house.site.terrain) ? [x, y, 0] : null
}
