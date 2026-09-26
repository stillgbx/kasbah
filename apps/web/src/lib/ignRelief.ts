import { emptyReliefGrid, footprintCeiling, localToGeo, reliefNodeXY, resolveDefaults, serializeRelief, terrainFootprints, type House, type Relief } from '@kasbah/shared'

// Relief RÉEL de la parcelle, lu au service d'altimétrie de l'IGN (Géoplateforme, ouvert, sans clé,
// CORS ouvert — appelé depuis la tablette comme la météo). Un point par nœud de la grille.
//
// Deux sources, de la plus fine à la plus sûre : le MNT LiDAR HD (50 cm) là où il est produit, le
// RGE ALTI (1 m, France entière) ailleurs. Le LiDAR répond -99999 sur une zone pas encore couverte :
// ces points-là seuls sont redemandés au RGE ALTI.
//
// Les hauteurs de la maison sont LOCALES : le zéro est l'altitude médiane SOUS le bâti (là où le
// terrain est écrêté de toute façon), pas l'altitude de `origin.alt`, que rien ne garantit exacte.

const ENDPOINT = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json'
const LIDAR = 'ign_lidar_hd_mnt_mono_wld'
const RGE = 'ign_rge_alti_wld'
/** Points par requête : l'URL reste sous 4 Ko, et 1 000 points se lisent en ~1,5 s. */
const CHUNK = 150

export type IgnSource = 'lidar' | 'rge' | 'mixed'

async function altitudes(points: readonly { lon: number; lat: number }[], resource: string, fetchImpl: typeof fetch): Promise<(number | null)[]> {
  const out: (number | null)[] = []
  for (let k = 0; k < points.length; k += CHUNK) {
    const part = points.slice(k, k + CHUNK)
    const url = `${ENDPOINT}?resource=${resource}&delimiter=|&zonly=true`
      + `&lon=${part.map((p) => p.lon.toFixed(7)).join('|')}&lat=${part.map((p) => p.lat.toFixed(7)).join('|')}`
    const res = await fetchImpl(url)
    if (!res.ok) throw new Error(`IGN ${res.status}`)
    const body = await res.json() as { elevations: unknown[] }
    // une altitude absente se dit par un très grand négatif (-9999, -99999 selon la ressource)
    for (const z of body.elevations) out.push(typeof z === 'number' && z > -1000 ? z : null)
  }
  return out
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}

/** Le relief IGN de la parcelle, au pas `step` (m), prêt à poser comme brouillon de l'éditeur. */
export async function fetchIgnRelief(house: House, step: number, fetchImpl: typeof fetch = fetch): Promise<{ relief: Relief; source: IgnSource }> {
  const grid = emptyReliefGrid(house.site.terrain, step)
  const nodes: [number, number][] = []
  for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) nodes.push(reliefNodeXY(grid, i, j))
  const geo = nodes.map(([x, y]) => localToGeo(house.origin, [x, y, 0]))
  const z = await altitudes(geo, LIDAR, fetchImpl)
  const missing = z.flatMap((v, k) => (v === null ? [k] : []))
  if (missing.length) {
    const fill = await altitudes(missing.map((k) => geo[k]!), RGE, fetchImpl)
    missing.forEach((k, n) => { z[k] = fill[n] ?? null })
  }
  const known = z.filter((v): v is number => v !== null)
  if (!known.length) throw new Error('IGN: no altitude for this site')
  const footprints = terrainFootprints(house, resolveDefaults(house.defaults))
  const under = nodes.flatMap(([x, y], k) => (footprintCeiling(footprints, x, y) !== Infinity && z[k] !== null ? [z[k]!] : []))
  const zero = median(under.length ? under : known)
  grid.cm = z.map((v) => (v === null ? 0 : Math.round((v - zero) * 100)))
  const source: IgnSource = missing.length === 0 ? 'lidar' : missing.length === nodes.length ? 'rge' : 'mixed'
  return { relief: serializeRelief(grid), source }
}
