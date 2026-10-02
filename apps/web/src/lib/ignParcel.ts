import { ensureCCW, geoToLocal, isSimplePolygon, localToGeo, pointInPolygon, signedArea, type House, type Vec2 } from '@kasbah/shared'

// Contour RÉEL de la parcelle, lu au cadastre de l'IGN (Parcellaire Express, WFS de la Géoplateforme,
// ouvert, sans clé, CORS ouvert — appelé depuis le navigateur comme le relief).
//
// Interrogé par EMPRISE (BBOX) autour du bâti : un filtre `INTERSECTS(geom, POINT(…))` ne rend rien
// sur ce service, dans un sens d'axes comme dans l'autre. On garde les parcelles qui portent la maison
// (le centre d'une de ses pièces) ; une maison à cheval sur deux parcelles les reçoit fusionnées.
//
// Le contour est posé dans le repère de la maison par `origin` : il est aussi juste que lui (le
// calage de `origin` sur la photo n'est pas fait, quelques mètres d'écart possibles).

const ENDPOINT = 'https://data.geopf.fr/wfs/ows'
const LAYER = 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle'
/** Un sommet à moins de ça (m) de la droite de ses voisins est retiré : moins de poignées, même contour. */
const COLLINEAR_M = 0.05

/** Échec qui se dit à l'utilisateur : aucune parcelle sous la maison (rue, domaine public, `origin` décalé), ou contour inutilisable. */
export class IgnParcelError extends Error {
  constructor(readonly code: 'none' | 'shape', message: string) { super(message); this.name = 'IgnParcelError' }
}

export interface IgnParcel { idu: string; section: string; numero: string; contenance: number | null }
interface Feature {
  properties: { idu?: string; section?: string; numero?: string; contenance?: number }
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] } | null
}

const round = (v: number) => Math.round(v * 100) / 100
const key = ([x, y]: Vec2) => `${Math.round(x * 100)},${Math.round(y * 100)}`

/** Retire le sommet de fermeture, les doublons et les sommets presque alignés avec leurs voisins. */
function tidy(ring: Vec2[]): Vec2[] {
  let p = ring.map(([x, y]): Vec2 => [round(x), round(y)])
  p = p.filter((v, k) => key(v) !== key(p[(k + 1) % p.length]!))
  for (let changed = true; changed && p.length > 3;) {
    changed = false
    for (let k = 0; k < p.length && p.length > 3; k++) {
      const a = p[(k + p.length - 1) % p.length]!, v = p[k]!, b = p[(k + 1) % p.length]!
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const d = len ? Math.abs((b[0] - a[0]) * (a[1] - v[1]) - (a[0] - v[0]) * (b[1] - a[1])) / len : 0
      if (d < COLLINEAR_M) { p.splice(k, 1); changed = true; k-- }
    }
  }
  return p
}

/**
 * Fusion de parcelles VOISINES par leurs côtés communs : chaque contour orienté dans le même sens,
 * un côté parcouru dans les deux sens est intérieur et disparaît, le reste se chaîne en une boucle.
 * Le cadastre partage les sommets entre voisines ; s'il ne le fait pas (ou si les parcelles ne se
 * touchent pas), la fusion ne fait pas UNE boucle et rend `null`.
 */
export function mergeParcels(rings: readonly Vec2[][]): Vec2[] | null {
  const edges = new Map<string, { from: Vec2; to: Vec2 }>()
  for (const ring of rings) {
    const r = ensureCCW(ring)
    for (let k = 0; k < r.length; k++) {
      const a = r[k]!, b = r[(k + 1) % r.length]!
      const back = `${key(b)}>${key(a)}`
      if (edges.has(back)) edges.delete(back)
      else edges.set(`${key(a)}>${key(b)}`, { from: a, to: b })
    }
  }
  const byStart = new Map<string, { from: Vec2; to: Vec2 }>()
  for (const e of edges.values()) {
    if (byStart.has(key(e.from))) return null                // deux départs du même sommet : pas une seule boucle
    byStart.set(key(e.from), e)
  }
  const first = byStart.values().next().value
  if (!first) return null
  const loop: Vec2[] = []
  for (let e = first; ;) {
    loop.push(e.from)
    const next = byStart.get(key(e.to))
    if (!next) return null
    if (next === first) break
    e = next
    if (loop.length > edges.size) return null
  }
  return loop.length === edges.size ? loop : null
}

/** Le contour cadastral sous la maison, en repère maison, prêt à poser comme brouillon de l'éditeur. */
export async function fetchIgnParcel(house: House, fetchImpl: typeof fetch = fetch): Promise<{ polygon: Vec2[]; parcels: IgnParcel[]; merged: boolean }> {
  const corners = house.rooms.flatMap((r) => r.polygon)
  const probes: Vec2[] = house.rooms.length
    ? house.rooms.map((r) => [r.polygon.reduce((s, p) => s + p[0], 0) / r.polygon.length, r.polygon.reduce((s, p) => s + p[1], 0) / r.polygon.length])
    : [[0, 0]]
  const pts = corners.length ? corners : probes
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const box = [[Math.min(...xs) - 1, Math.min(...ys) - 1], [Math.max(...xs) + 1, Math.min(...ys) - 1], [Math.max(...xs) + 1, Math.max(...ys) + 1], [Math.min(...xs) - 1, Math.max(...ys) + 1]]
    .map(([x, y]) => localToGeo(house.origin, [x!, y!, 0]))
  const lat0 = Math.min(...box.map((g) => g.lat)), lat1 = Math.max(...box.map((g) => g.lat))
  const lon0 = Math.min(...box.map((g) => g.lon)), lon1 = Math.max(...box.map((g) => g.lon))
  const url = `${ENDPOINT}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${LAYER}&outputFormat=application/json`
    + `&srsName=EPSG:4326&count=50&BBOX=${lat0.toFixed(7)},${lon0.toFixed(7)},${lat1.toFixed(7)},${lon1.toFixed(7)},urn:ogc:def:crs:EPSG::4326`
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`IGN ${res.status}`)
  const body = await res.json() as { features?: Feature[] }

  const kept: { ring: Vec2[]; parcel: IgnParcel; holds: number }[] = []
  for (const f of body.features ?? []) {
    const g = f.geometry
    if (!g) continue
    // GeoJSON : [lon, lat] ; chaque partie garde son contour extérieur (les trous d'une parcelle sont rares)
    const parts = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    for (const part of parts) {
      const outer = part[0]
      if (!outer) continue
      const ring = tidy(outer.map(([lon, lat]) => { const [x, y] = geoToLocal(house.origin, { lat: lat!, lon: lon! }); return [x, y] as Vec2 }))
      const holds = probes.filter((p) => pointInPolygon(p, ring)).length
      if (ring.length >= 3 && holds > 0) {
        kept.push({ ring, holds, parcel: { idu: f.properties.idu ?? '', section: f.properties.section ?? '', numero: f.properties.numero ?? '', contenance: f.properties.contenance ?? null } })
      }
    }
  }
  if (!kept.length) throw new IgnParcelError('none', 'no cadastral parcel under the house')
  const parcels = [...new Map(kept.map((k) => [k.parcel.idu, k.parcel])).values()]
  const merged = kept.length > 1 ? mergeParcels(kept.map((k) => k.ring)) : null
  // pas de fusion possible : la parcelle qui porte le plus la maison, la plus grande à égalité
  const best = [...kept].sort((a, b) => b.holds - a.holds || Math.abs(signedArea(b.ring)) - Math.abs(signedArea(a.ring)))[0]!
  const polygon = merged ? tidy(merged) : best.ring
  if (!isSimplePolygon(polygon)) throw new IgnParcelError('shape', 'cadastral outline is not a simple polygon')
  return { polygon, parcels: merged ? parcels : [best.parcel], merged: !!merged || kept.length === 1 }
}
