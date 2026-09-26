import { describe, expect, it } from 'vitest'
import { geoToLocal, parseHouse, parseRelief, reliefDelta, type House } from '@kasbah/shared'
import { fetchIgnRelief } from './ignRelief'

// Le service IGN est simulé : une pente qui monte de 1 cm par mètre vers l'est, et un LiDAR qui ne
// couvre que la moitié ouest de la parcelle.

const house: House = parseHouse({
  schemaVersion: 1, id: 'h', name: 'H',
  origin: { lat: 47.3, lon: 5.04, alt: 200, heading: 0 },
  levels: [{ id: 'rdc', name: 'RDC', elevation: 0.2 }],
  rooms: [{ id: 'sejour', name: 'Séjour', levelId: 'rdc', polygon: [[0, 0], [6, 0], [6, 6], [0, 6]] }],
  site: { terrain: [[-20, -20], [30, -20], [30, 30], [-20, 30]] },
  devices: [],
})

function fakeIgn(calls: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const resource = url.searchParams.get('resource')!
    calls.push(resource)
    const lons = url.searchParams.get('lon')!.split('|').map(Number)
    const lats = url.searchParams.get('lat')!.split('|').map(Number)
    const elevations = lons.map((lon, k) => {
      const [x] = geoToLocal(house.origin, { lat: lats[k]!, lon })
      if (resource === 'ign_lidar_hd_mnt_mono_wld' && x > 5) return -99999
      return 216 + x * 0.01
    })
    return new Response(JSON.stringify({ elevations }), { status: 200 })
  }) as typeof fetch
}

describe('relief IGN', () => {
  it('prend le LiDAR là où il existe, le RGE ALTI ailleurs, et met le zéro sous la maison', async () => {
    const calls: string[] = []
    const { relief, source } = await fetchIgnRelief(house, 2, fakeIgn(calls))
    expect(source).toBe('mixed')
    expect(calls).toContain('ign_lidar_hd_mnt_mono_wld')
    expect(calls).toContain('ign_rge_alti_wld')
    const g = parseRelief(relief)!
    // sous la maison (x ≈ 3) : zéro, à un centimètre d'arrondi près
    expect(Math.abs(reliefDelta(g, 3, 3))).toBeLessThanOrEqual(0.01)
    // 20 m plus à l'est : 20 cm plus haut
    expect(reliefDelta(g, 23, 3)).toBeCloseTo(0.2, 1)
    expect(reliefDelta(g, -17, 3)).toBeCloseTo(-0.2, 1)
  })

  it('dit l’erreur du service plutôt que de rendre un terrain plat', async () => {
    const failing = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch
    await expect(fetchIgnRelief(house, 2, failing)).rejects.toThrow('IGN 503')
  })
})
