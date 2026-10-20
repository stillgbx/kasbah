import { emptyReliefGrid, footprintCeiling, localToGeo, reliefNodeXY, resolveDefaults, serializeRelief, terrainFootprints, type House, type Relief } from '@kasbah/shared'

// REAL relief of the parcel, read from the IGN altimetry service (Géoplateforme, open, no key,
// CORS open — called from the browser like the weather). One point per grid node.
//
// Two sources, from the finest to the safest: the LiDAR HD DTM (50 cm) where it is produced, the
// RGE ALTI (1 m, all of France) elsewhere. The LiDAR answers -99999 on an area not yet covered:
// only those points are re-requested from the RGE ALTI.
//
// The house's heights are LOCAL: zero is the median altitude UNDER the building (where the
// terrain is clipped anyway), not the altitude of `origin.alt`, which nothing guarantees accurate.

const ENDPOINT = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json'
const LIDAR = 'ign_lidar_hd_mnt_mono_wld'
const RGE = 'ign_rge_alti_wld'
/** Points per request: the URL stays under 4 KB, and 1,000 points are read in ~1.5 s. */
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
    // a missing altitude is expressed by a very large negative (-9999, -99999 depending on the resource)
    for (const z of body.elevations) out.push(typeof z === 'number' && z > -1000 ? z : null)
  }
  return out
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}

/** The parcel's IGN relief, at step `step` (m), ready to place as the editor's draft. */
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
