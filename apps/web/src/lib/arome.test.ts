import { describe, expect, it } from 'vitest'
import { aromeFileUrl, aromeFrames, aromeSourceUrl, type AromeMeta } from './arome'

// `latest.json` tel que capturé le 2026-09-16 (run de 10:00Z, 25 échéances de 15 min).
const META: AromeMeta = {
  completed: true,
  reference_time: '2026-09-16T10:00:00Z',
  valid_times: Array.from({ length: 25 }, (_, i) => new Date(Date.UTC(2026, 8, 16, 10, 0) + i * 15 * 60_000).toISOString().replace(':00.000Z', 'Z')),
  variables: ['cape', 'cloud_cover_low', 'precipitation', 'relative_humidity_2m', 'snowfall_water_equivalent', 'temperature_2m', 'wind_gusts_10m'],
}

describe('AROME 15 min', () => {
  it('bâtit le chemin exact du fichier, minutes comprises', () => {
    expect(aromeFileUrl(new Date('2026-09-16T10:00:00Z'), new Date('2026-09-16T10:15:00Z')))
      .toBe('https://openmeteo.s3.amazonaws.com/data_spatial/meteofrance_arome_france_hd_15min/2026/09/16/1000Z/2026-09-16T1015.om')
  })

  it('ne garde que les échéances après maintenant, dans l’horizon', () => {
    const now = Date.UTC(2026, 8, 16, 11, 50)
    const frames = aromeFrames(META, now)
    expect(frames[0]!.time).toBe(Date.UTC(2026, 8, 16, 12, 0) / 1000)       // 12:00, pas 11:45
    expect(frames.at(-1)!.time).toBe(Date.UTC(2026, 8, 16, 16, 0) / 1000)   // la fin du run
    expect(frames).toHaveLength(17)
    expect(aromeFrames(META, now, 60)).toHaveLength(4)                       // horizon d'une heure : 12:00 → 12:45
    expect(aromeFrames(META, Date.UTC(2026, 8, 16, 17, 0))).toEqual([])      // run dépassé : le radar reste seul
  })

  it('renonce si le run ne porte pas la variable', () => {
    expect(aromeFrames({ ...META, variables: ['temperature_2m'] }, 0)).toEqual([])
  })

  it('demande la palette sombre au protocole quand le thème l’est', () => {
    const f = aromeFrames(META, Date.UTC(2026, 8, 16, 11, 50))[0]!
    expect(aromeSourceUrl(f, false)).toBe(`om://${f.url}?variable=precipitation`)
    expect(aromeSourceUrl(f, true)).toMatch(/&dark=true$/)
  })
})
