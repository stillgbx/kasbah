import { describe, expect, it } from 'vitest'
import type { FetchLike } from '../../core/sse'
import { VigilanceClient, vigilanceFor, type MeteoAlarmFeed } from './vigilance'

// Le flux MeteoAlarm tel que Météo-France le remplit (forme relevée le 2026-10-01) : plusieurs
// messages par département et par phénomène, des mises à jour, des retours au vert (niveau 1), et
// chaque message en deux langues.

const NOW = Date.parse('2026-10-01T20:15:00+02:00')

function msg(o: { area?: string; type: number; level: number; onset: string; expires: string; sent: string; msgType?: string }) {
  const info = (language: string) => ({
    language, onset: o.onset, expires: o.expires,
    parameter: [{ valueName: 'awareness_level', value: `${o.level}; x; y` }, { valueName: 'awareness_type', value: `${o.type}; Whatever` }],
    area: [{ areaDesc: 'Aube' }, { areaDesc: o.area ?? "Côte-d'Or" }],
  })
  return { alert: { msgType: o.msgType ?? 'Alert', sent: o.sent, info: [info('fr-FR'), info('en-GB')] } }
}
const feed = (...warnings: ReturnType<typeof msg>[]): MeteoAlarmFeed => ({ warnings })

describe('vigilanceFor', () => {
  it('garde le message le plus récent qui couvre l’instant, et ignore le vert', () => {
    const f = feed(
      msg({ type: 3, level: 2, onset: '2026-10-01T00:00:00+02:00', expires: '2026-10-02T00:00:00+02:00', sent: '2026-09-30T16:04:20+02:00' }),
      // passé : vert de la veille
      msg({ type: 3, level: 1, onset: '2026-09-30T06:00:00+02:00', expires: '2026-09-30T23:00:00+02:00', sent: '2026-09-30T06:05:09+02:00' }),
      // un autre département
      msg({ area: 'Hérault', type: 12, level: 4, onset: '2026-10-01T00:00:00+02:00', expires: '2026-10-02T00:00:00+02:00', sent: '2026-10-01T06:00:00+02:00' }),
    )
    expect(vigilanceFor(f, "COTE D'OR", NOW)).toEqual([
      { type: 'thunderstorm', level: 'yellow', onset: Date.parse('2026-10-01T00:00:00+02:00'), expires: Date.parse('2026-10-02T00:00:00+02:00') },
    ])
  })

  it('une mise à jour au vert plus récente lève la vigilance', () => {
    const f = feed(
      msg({ type: 3, level: 2, onset: '2026-10-01T00:00:00+02:00', expires: '2026-10-02T00:00:00+02:00', sent: '2026-09-30T16:00:00+02:00' }),
      msg({ type: 3, level: 1, onset: '2026-10-01T16:00:00+02:00', expires: '2026-10-02T00:00:00+02:00', sent: '2026-10-01T16:00:00+02:00', msgType: 'Update' }),
    )
    expect(vigilanceFor(f, "Côte-d'Or", NOW)).toEqual([])
  })

  it('un message annulé ramène au vert', () => {
    const f = feed(
      msg({ type: 1, level: 3, onset: '2026-10-01T00:00:00+02:00', expires: '2026-10-02T00:00:00+02:00', sent: '2026-09-30T16:00:00+02:00' }),
      msg({ type: 1, level: 3, onset: '2026-10-01T00:00:00+02:00', expires: '2026-10-02T00:00:00+02:00', sent: '2026-10-01T10:00:00+02:00', msgType: 'Cancel' }),
    )
    expect(vigilanceFor(f, "Côte-d'Or", NOW)).toEqual([])
  })

  it('fond deux fenêtres contiguës au même niveau, garde l’à-venir d’un autre niveau à part', () => {
    const f = feed(
      msg({ type: 3, level: 2, onset: '2026-10-01T00:00:00+02:00', expires: '2026-10-02T00:00:00+02:00', sent: '2026-09-30T16:00:00+02:00' }),
      msg({ type: 3, level: 2, onset: '2026-10-02T00:00:00+02:00', expires: '2026-10-03T00:00:00+02:00', sent: '2026-10-01T16:00:00+02:00' }),
      msg({ type: 1, level: 3, onset: '2026-10-02T06:00:00+02:00', expires: '2026-10-02T18:00:00+02:00', sent: '2026-10-01T16:00:00+02:00' }),
    )
    expect(vigilanceFor(f, "Côte-d'Or", NOW)).toEqual([
      { type: 'thunderstorm', level: 'yellow', onset: Date.parse('2026-10-01T00:00:00+02:00'), expires: Date.parse('2026-10-03T00:00:00+02:00') },
      { type: 'wind', level: 'orange', onset: Date.parse('2026-10-02T06:00:00+02:00'), expires: Date.parse('2026-10-02T18:00:00+02:00') },
    ])
  })

  it('en cours d’abord, la plus forte en tête', () => {
    const day = { onset: '2026-10-01T00:00:00+02:00', expires: '2026-10-02T00:00:00+02:00', sent: '2026-10-01T06:00:00+02:00' }
    const f = feed(msg({ type: 3, level: 2, ...day }), msg({ type: 12, level: 4, ...day }), msg({ type: 13, level: 3, ...day }))
    expect(vigilanceFor(f, "Côte-d'Or", NOW).map((w) => `${w.type}/${w.level}`)).toEqual(['flood/red', 'rain_flood/orange', 'thunderstorm/yellow'])
  })
})

describe('VigilanceClient', () => {
  function fake(departement: { code: string; nom: string } | null) {
    const calls: string[] = []
    const body = feed(msg({ type: 3, level: 2, onset: '2026-10-01T00:00:00+02:00', expires: '2026-10-02T00:00:00+02:00', sent: '2026-10-01T06:00:00+02:00' }))
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url)
      const json = url.includes('geo.api.gouv.fr') ? (departement ? [{ nom: 'X', departement }] : []) : body
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) } as Awaited<ReturnType<FetchLike>>
    }
    return { fetchImpl, calls }
  }
  const signal = new AbortController().signal

  it('position → département → vigilance ; flux et département en cache', async () => {
    const { fetchImpl, calls } = fake({ code: '21', nom: "Côte-d'Or" })
    let now = NOW
    const c = new VigilanceClient({ fetchImpl, ttlMs: 600_000, now: () => now })
    const r = await c.at(47.31, 5.04, signal)
    expect(r.area).toBe("Côte-d'Or")
    expect(r.warnings.map((w) => w.level)).toEqual(['yellow'])
    await c.at(47.311, 5.041, signal)
    expect(calls).toHaveLength(2)
    now += 600_000
    await c.at(47.31, 5.04, signal)
    expect(calls.filter((u) => u.includes('meteoalarm'))).toHaveLength(2)
  })

  it('hors de France, et outre-mer : rien à lire, le flux n’est pas demandé', async () => {
    for (const d of [null, { code: '971', nom: 'Guadeloupe' }]) {
      const { fetchImpl, calls } = fake(d)
      const c = new VigilanceClient({ fetchImpl, ttlMs: 600_000, now: () => NOW })
      expect(await c.at(16.24, -61.53, signal)).toEqual({ area: null, warnings: [] })
      expect(calls.some((u) => u.includes('meteoalarm'))).toBe(false)
    }
  })
})
