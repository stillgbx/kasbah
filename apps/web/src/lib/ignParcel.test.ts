import { describe, expect, it } from 'vitest'
import { localToGeo, signedArea, type House, type Vec2 } from '@kasbah/shared'
import { fetchIgnParcel, mergeParcels } from './ignParcel'

const origin = { lat: 47.309343, lon: 5.045591, alt: 180, heading: 15 }
const room = (polygon: Vec2[]) => ({ id: `r${polygon[0]![0]}`, levelId: 'rdc', polygon, openings: [] })
const house = (rooms: Vec2[][]) => ({ origin, rooms: rooms.map(room) }) as unknown as House

/** Une parcelle GeoJSON ([lon, lat], fermée) faite d'un contour en repère maison. */
function feature(idu: string, ring: Vec2[]) {
  const coords = [...ring, ring[0]!].map(([x, y]) => { const g = localToGeo(origin, [x, y, 0]); return [g.lon, g.lat] })
  return { properties: { idu, section: 'CT', numero: idu.slice(-4), contenance: 1000 }, geometry: { type: 'MultiPolygon', coordinates: [[coords]] } }
}
const fakeFetch = (features: unknown[], seen: string[] = []) => (async (url: string) => {
  seen.push(url)
  return { ok: true, json: async () => ({ features }) }
}) as unknown as typeof fetch

const close = (a: Vec2[], b: Vec2[]) => {
  expect(a).toHaveLength(b.length)
  // même contour au centimètre, quel que soit le sommet de départ
  const k = a.findIndex((p) => Math.hypot(p[0] - b[0]![0], p[1] - b[0]![1]) < 0.02)
  expect(k).toBeGreaterThanOrEqual(0)
  b.forEach((p, i) => { const q = a[(k + i) % a.length]!; expect(Math.hypot(q[0] - p[0], q[1] - p[1])).toBeLessThan(0.02) })
}

describe('import de la parcelle cadastrale', () => {
  const plot: Vec2[] = [[-10, -10], [30, -10], [30, 25], [-10, 25]]
  const neighbour: Vec2[] = [[30, -10], [60, -10], [60, 25], [30, 25]]

  it('rend la parcelle qui porte la maison, en repère maison, et ignore la voisine', async () => {
    const seen: string[] = []
    const r = await fetchIgnParcel(house([[[0, 0], [10, 0], [10, 8], [0, 8]]]), fakeFetch([feature('X0001', neighbour), feature('X0002', plot)], seen))
    close(r.polygon, plot)
    expect(r.parcels.map((p) => p.idu)).toEqual(['X0002'])
    expect(r.merged).toBe(true)
    expect(seen[0]).toContain('BBOX=')
  })

  it('fusionne deux parcelles sous une maison à cheval', async () => {
    const r = await fetchIgnParcel(house([[[20, 0], [28, 0], [28, 8], [20, 8]], [[32, 0], [40, 0], [40, 8], [32, 8]]]), fakeFetch([feature('X0001', plot), feature('X0002', neighbour)]))
    close(r.polygon, [[-10, -10], [60, -10], [60, 25], [-10, 25]])   // les sommets (30, ·) devenus alignés sont retirés
    expect(r.parcels).toHaveLength(2)
  })

  it('retire les sommets presque alignés', async () => {
    const noisy: Vec2[] = [[-10, -10], [10, -10.02], [30, -10], [30, 25], [-10, 25]]
    const r = await fetchIgnParcel(house([[[0, 0], [10, 0], [10, 8], [0, 8]]]), fakeFetch([feature('X0002', noisy)]))
    expect(r.polygon).toHaveLength(4)
  })

  it('échoue sans parcelle sous la maison', async () => {
    await expect(fetchIgnParcel(house([[[0, 0], [10, 0], [10, 8], [0, 8]]]), fakeFetch([feature('X0001', neighbour)]))).rejects.toMatchObject({ code: 'none' })
  })
})

describe('mergeParcels', () => {
  it('rend null pour deux parcelles qui ne se touchent pas', () => {
    expect(mergeParcels([[[0, 0], [1, 0], [1, 1], [0, 1]], [[3, 0], [4, 0], [4, 1], [3, 1]]])).toBeNull()
  })
  it('garde l’aire totale de deux carrés voisins', () => {
    const m = mergeParcels([[[0, 0], [1, 0], [1, 1], [0, 1]], [[1, 0], [2, 0], [2, 1], [1, 1]]])!
    expect(Math.abs(signedArea(m))).toBeCloseTo(2, 6)
  })
})
