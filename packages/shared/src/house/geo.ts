import type { GeoOrigin, Site } from './schema'
import { pointInPolygon, type Vec2 } from './geometry/vec2'
import type { Vec3 } from './geometry/types'

// Conversion of local reference frame (meters, x east, y north, rotated by the `heading`) ↔ WGS84.
// Equirectangular approximation: largely sufficient at the scale of a plot.

const R = 6378137
const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

export interface GeoPoint { lat: number; lon: number; alt: number }

export function localToGeo(origin: GeoOrigin, [x, y, z]: Vec3): GeoPoint {
  const h = toRad(origin.heading)
  // the local +y axis points at heading `heading` (clockwise from north)
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

/**
 * "At home" radius around the origin, in meters. More tolerant than the terrain polygon
 * (`sitePosition`, a DRAWING test): a car parked in the street in front of the house is home.
 * Shared by the server (car ↔ charger coordination) and the web views (`VehiclesView`, `VehicleCard`,
 * `HouseScene`): a single value.
 */
export const HOME_RADIUS_M = 120

/** Ground distance (m) between two WGS84 points (haversine). */
export function geoDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Place of a GPS point in the scene, **or `null` if it falls outside the terrain of the house**.
 *
 * This is how a vehicle takes its place in 3D: it has no `position` in `house.json` (see
 * `schema.ts`), it is COMPUTED at each reading. The terrain serves as a membership test — a
 * car at the office or out and about has no business in the garden, and must therefore not
 * appear there, even at the edge.
 *
 * `offset` (meters, house reference frame) corrects a CONSTANT shift between the survey and reality: the
 * GPS of a vehicle has its bias, the origin of the house its approximation, and the two add up.
 * It is applied BEFORE the terrain test — the corrected place is the true one.
 *
 * `z = 0`: set on the terrain, like any outdoor marker.
 */
export function sitePosition(
  house: { origin: GeoOrigin; site: Site },
  p: { lat: number; lon: number },
  offset?: Vec2,
): Vec3 | null {
  const [x0, y0] = geoToLocal(house.origin, p)
  const x = x0 + (offset?.[0] ?? 0), y = y0 + (offset?.[1] ?? 0)
  return pointInPolygon([x, y], house.site.terrain) ? [x, y, 0] : null
}

/**
 * The origin slid by `east`, `north` meters on the terrain (WORLD reference frame, not the house's):
 * the whole house slides by as much on the photo. It is the gesture of the alignment, north/south/east/west arrows.
 */
export function shiftOrigin(origin: GeoOrigin, east: number, north: number): GeoOrigin {
  return { ...origin, lat: origin.lat + toDeg(north / R), lon: origin.lon + toDeg(east / (R * Math.cos(toRad(origin.lat)))) }
}

/**
 * The origin rotated to heading `heading` AROUND `pivot` (house reference frame): that point stays where it is on
 * the photo, the house turns on itself. Rotating around 0;0, a corner, would make the other
 * end of the house slide by several meters per degree.
 */
export function turnOrigin(origin: GeoOrigin, heading: number, pivot: Vec2): GeoOrigin {
  const before = localToGeo(origin, [pivot[0], pivot[1], 0])
  const after = localToGeo({ ...origin, heading }, [pivot[0], pivot[1], 0])
  return { ...origin, heading, lat: origin.lat + before.lat - after.lat, lon: origin.lon + before.lon - after.lon }
}
