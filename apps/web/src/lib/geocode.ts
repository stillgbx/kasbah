import { geoDistance } from '@kasbah/shared'

// Address search to place point 0 of a new property, without an account or key:
//   - the IGN geocoding (Géoplateforme): the Base Adresse Nationale, the most precise in France;
//   - Photon (komoot, OpenStreetMap data): the whole world.
// Both start together; IGN comes first, Photon completes, a same place only appears once.
// Launched by the user only (button or Enter), never at each keystroke.

export interface GeoResult { label: string; lat: number; lon: number; /** Country (ISO 3166-1, Photon only). */ countryCode?: string }

const LIMIT = 6
/** Two results closer than that are the same place (m). */
const SAME_PLACE_M = 30

interface Feature<P> { geometry: { coordinates: [number, number] }; properties: P }
interface PhotonProps { name?: string; housenumber?: string; street?: string; postcode?: string; city?: string; state?: string; country?: string; countrycode?: string }

/** The label of a Photon result: "10 Downing Street, SW1A 2AA London, United Kingdom". */
export function photonLabel(p: PhotonProps): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  const town = [p.postcode, p.city].filter(Boolean).join(' ')
  const parts = [p.name && p.name !== p.street ? p.name : '', street, town, p.country].filter(Boolean)
  return [...new Set(parts)].join(', ')
}

/**
 * IGN first, then Photon; at most `LIMIT`. When IGN answers, it is authoritative for France: Photon's
 * French results are discarded (a large square does not have the same point in the two
 * services, distance is not enough to recognize them). Elsewhere, a place already given within
 * `SAME_PLACE_M` is not repeated.
 */
export function mergeResults(ign: GeoResult[], photon: GeoResult[]): GeoResult[] {
  const out = [...ign]
  for (const r of photon) {
    if (ign.length && r.countryCode?.toUpperCase() === 'FR') continue
    if (!out.some((o) => geoDistance(o, r) < SAME_PLACE_M)) out.push(r)
  }
  return out.slice(0, LIMIT)
}

async function ign(q: string): Promise<GeoResult[]> {
  const r = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=5`)
  const j = await r.json() as { features?: Feature<{ label: string }>[] }
  return (j.features ?? []).map((f) => ({ label: f.properties.label, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
}

async function photon(q: string, lang: string): Promise<GeoResult[]> {
  const l = ['fr', 'en', 'de'].includes(lang) ? lang : 'default'
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=${l}`)
  const j = await r.json() as { features?: Feature<PhotonProps>[] }
  return (j.features ?? []).map((f) => ({
    label: photonLabel(f.properties), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    ...(f.properties.countrycode ? { countryCode: f.properties.countrycode } : {}),
  }))
}

/** Searches an address; a service that does not answer simply leaves room for the other. */
export async function searchAddress(q: string, lang: string): Promise<GeoResult[]> {
  const [a, b] = await Promise.allSettled([ign(q), photon(q, lang)])
  return mergeResults(a.status === 'fulfilled' ? a.value : [], b.status === 'fulfilled' ? b.value : [])
}
