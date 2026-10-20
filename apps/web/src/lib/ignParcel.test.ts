import { describe, expect, it } from 'vitest'
import { localToGeo, signedArea, type House, type Vec2 } from '@kasbah/shared'
import { fetchIgnParcel, mergeParcels } from './ignParcel'

const origin = { lat: 47.309343, lon: 5.045591, alt: 180, heading: 15 }
const room = (polygon: Vec2[]) => ({ id: `r${polygon[0]![0]}`, levelId: 'rdc', polygon, openings: [] })
const house = (rooms: Vec2[][]) => ({ origin, rooms: rooms.map(room) }) as unknown as House

/** A GeoJSON parcel ([lon, lat], closed) made from an outline in house frame. */
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
  // same outline to the centimeter, whatever the starting vertex
  const k = a.findIndex((p) => Math.hypot(p[0] - b[0]![0], p[1] - b[0]![1]) < 0.02)
  expect(k).toBeGreaterThanOrEqual(0)
  b.forEach((p, i) => { const q = a[(k + i) % a.length]!; expect(Math.hypot(q[0] - p[0], q[1] - p[1])).toBeLessThan(0.02) })
}

describe('cadastral parcel import', () => {
  const plot: Vec2[] = [[-10, -10], [30, -10], [30, 25], [-10, 25]]
  const neighbour: Vec2[] = [[30, -10], [60, -10], [60, 25], [30, 25]]

  it('returns the parcel that carries the house, in house frame, and ignores the neighbor', async () => {
    const seen: string[] = []
    const r = await fetchIgnParcel(house([[[0, 0], [10, 0], [10, 8], [0, 8]]]), fakeFetch([feature('X0001', neighbour), feature('X0002', plot)], seen))
    close(r.polygon, plot)
    expect(r.parcels.map((p) => p.idu)).toEqual(['X0002'])
    expect(r.merged).toBe(true)
    expect(seen[0]).toContain('BBOX=')
  })

  it('merges two parcels under a house straddling them', async () => {
    const r = await fetchIgnParcel(house([[[20, 0], [28, 0], [28, 8], [20, 8]], [[32, 0], [40, 0], [40, 8], [32, 8]]]), fakeFetch([feature('X0001', plot), feature('X0002', neighbour)]))
    close(r.polygon, [[-10, -10], [60, -10], [60, 25], [-10, 25]])   // the vertices (30, ·) that became aligned are removed
    expect(r.parcels).toHaveLength(2)
  })

  it('removes almost-aligned vertices', async () => {
    const noisy: Vec2[] = [[-10, -10], [10, -10.02], [30, -10], [30, 25], [-10, 25]]
    const r = await fetchIgnParcel(house([[[0, 0], [10, 0], [10, 8], [0, 8]]]), fakeFetch([feature('X0002', noisy)]))
    expect(r.polygon).toHaveLength(4)
  })

  it('fails without a parcel under the house', async () => {
    await expect(fetchIgnParcel(house([[[0, 0], [10, 0], [10, 8], [0, 8]]]), fakeFetch([feature('X0001', neighbour)]))).rejects.toMatchObject({ code: 'none' })
  })
})

describe('mergeParcels', () => {
  it('returns null for two parcels that do not touch', () => {
    expect(mergeParcels([[[0, 0], [1, 0], [1, 1], [0, 1]], [[3, 0], [4, 0], [4, 1], [3, 1]]])).toBeNull()
  })
  it('keeps the total area of two neighboring squares', () => {
    const m = mergeParcels([[[0, 0], [1, 0], [1, 1], [0, 1]], [[1, 0], [2, 0], [2, 1], [1, 1]]])!
    expect(Math.abs(signedArea(m))).toBeCloseTo(2, 6)
  })
})
