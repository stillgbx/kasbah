import { geoDistance } from '@kasbah/shared'

// Recherche d'adresse pour poser le point 0 d'une propriété neuve, sans compte ni clé :
//   - le géocodage de l'IGN (Géoplateforme) : la Base Adresse Nationale, le plus précis en France ;
//   - Photon (komoot, données OpenStreetMap) : le monde entier.
// Les deux partent ensemble ; l'IGN passe devant, Photon complète, un même lieu n'apparaît qu'une fois.
// Lancée par l'utilisateur seulement (bouton ou Entrée), jamais à chaque frappe.

export interface GeoResult { label: string; lat: number; lon: number; /** Pays (ISO 3166-1, Photon seulement). */ countryCode?: string }

const LIMIT = 6
/** Deux résultats plus proches que ça sont le même lieu (m). */
const SAME_PLACE_M = 30

interface Feature<P> { geometry: { coordinates: [number, number] }; properties: P }
interface PhotonProps { name?: string; housenumber?: string; street?: string; postcode?: string; city?: string; state?: string; country?: string; countrycode?: string }

/** Le libellé d'un résultat Photon : « 10 Downing Street, SW1A 2AA London, Royaume-Uni ». */
export function photonLabel(p: PhotonProps): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  const town = [p.postcode, p.city].filter(Boolean).join(' ')
  const parts = [p.name && p.name !== p.street ? p.name : '', street, town, p.country].filter(Boolean)
  return [...new Set(parts)].join(', ')
}

/**
 * L'IGN d'abord, puis Photon ; au plus `LIMIT`. Quand l'IGN répond, il fait foi pour la France : les
 * résultats français de Photon sont écartés (une grande place n'a pas le même point dans les deux
 * services, la distance ne suffit pas à les reconnaître). Ailleurs, un lieu déjà donné à moins de
 * `SAME_PLACE_M` n'est pas répété.
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

/** Cherche une adresse ; un service qui ne répond pas laisse simplement la place à l'autre. */
export async function searchAddress(q: string, lang: string): Promise<GeoResult[]> {
  const [a, b] = await Promise.allSettled([ign(q), photon(q, lang)])
  return mergeResults(a.status === 'fulfilled' ? a.value : [], b.status === 'fulfilled' ? b.value : [])
}
