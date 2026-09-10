import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { CRUNCHYROLL_OBJECT_EPISODE, CRUNCHYROLL_OBJECT_SERIES, CRUNCHYROLL_TOKEN } from '../__fixtures__/network'
import { CrunchyrollEnricher, isCrunchyrollApp, type EnrichFetch } from './crunchyroll'

/** Fausse API Crunchyroll : jeton puis objet ; journalise les appels ; `fail` force une erreur HTTP sur l'objet. */
function fakeApi(opts: { fail?: number; objectData?: unknown; noSeries?: boolean } = {}) {
  const calls: string[] = []
  const fetchImpl = vi.fn<EnrichFetch>(async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url.replace('https://beta-api.crunchyroll.com', '')}`)
    if (url.endsWith('/auth/v1/token')) {
      expect(init?.headers?.authorization).toMatch(/^Basic /)
      expect(init?.body).toBe('grant_type=client_id')
      return { ok: true, status: 200, json: async () => CRUNCHYROLL_TOKEN }
    }
    if (opts.fail) return { ok: false, status: opts.fail, json: async () => ({}) }
    if (url.includes('/cms/series/')) return opts.noSeries ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => CRUNCHYROLL_OBJECT_SERIES }
    return { ok: true, status: 200, json: async () => opts.objectData ?? CRUNCHYROLL_OBJECT_EPISODE }
  })
  return { fetchImpl, calls }
}

function enricher(api: ReturnType<typeof fakeApi>, clock = new ManualClock(0)) {
  return { e: new CrunchyrollEnricher({ fetchImpl: api.fetchImpl, clock, logger: pino({ level: 'silent' }), signal: new AbortController().signal }), clock }
}

describe('crunchyroll enricher', () => {
  it('recognises the Crunchyroll app by name or Android package', () => {
    expect(isCrunchyrollApp({ displayName: 'Crunchyroll', statusText: '' })).toBe(true)
    expect(isCrunchyrollApp({ displayName: 'AndroidNativeApp', statusText: 'com.crunchyroll.crunchyroid.CrunchyrollApplication' })).toBe(true)
    expect(isCrunchyrollApp({ displayName: 'YouTube Music', statusText: '' })).toBe(false)
  })

  it('gets an anonymous token once, the episode, then the series poster (480 px portrait) as artwork', async () => {
    const api = fakeApi()
    const { e } = enricher(api)
    expect(await e.lookup('GE00000000DEMO')).toEqual({ title: 'Un épisode de démonstration', series: 'Les Chroniques de démo', seasonNumber: 1, episodeNumber: 10, artwork: expect.stringContaining('poster_tall/480x720') })
    expect(api.calls).toEqual(['POST /auth/v1/token', 'GET /content/v2/cms/objects/GE00000000DEMO?locale=fr-FR', 'GET /content/v2/cms/series/GT00000000?locale=fr-FR'])
    // second épisode de la même série : le jeton ET l'affiche sont réutilisés
    await e.lookup('GE00000000OTHER')
    expect(api.calls.filter((c) => c.startsWith('POST'))).toHaveLength(1)
    expect(api.calls.filter((c) => c.includes('/cms/series/'))).toHaveLength(1)
  })

  it('falls back on the episode thumbnail when the series sheet has no poster', async () => {
    const api = fakeApi({ noSeries: true })
    const { e } = enricher(api)
    expect(await e.lookup('GE00000000DEMO')).toMatchObject({ series: 'Les Chroniques de démo', artwork: expect.stringContaining('thumbnail/640x360') })
  })

  it('caches hits for a day and misses for ten minutes; one request in flight per content', async () => {
    const api = fakeApi()
    const { e, clock } = enricher(api)
    await Promise.all([e.lookup('GE1'), e.lookup('GE1')])
    expect(api.calls.filter((c) => c.includes('GE1'))).toHaveLength(1)
    expect(e.cached('GE1')).toMatchObject({ series: 'Les Chroniques de démo' })
    clock.advance(23 * 3_600_000)
    expect(e.cached('GE1')).toBeDefined()
    clock.advance(2 * 3_600_000)
    expect(e.cached('GE1')).toBeUndefined()

    const failing = fakeApi({ fail: 500 })
    const { e: e2, clock: c2 } = enricher(failing)
    expect(await e2.lookup('GE2')).toBeNull()
    expect(e2.cached('GE2')).toBeNull()                                      // échec mémorisé : pas de nouvelle requête tout de suite
    await e2.lookup('GE2')
    expect(failing.calls.filter((c) => c.includes('GE2'))).toHaveLength(1)
    c2.advance(11 * 60_000)
    expect(e2.cached('GE2')).toBeUndefined()
  })

  it('renews the token after a 401 and ignores content that is not an episode', async () => {
    let objectCalls = 0
    const fetchImpl = vi.fn<EnrichFetch>(async (url) => {
      if (url.endsWith('/auth/v1/token')) return { ok: true, status: 200, json: async () => CRUNCHYROLL_TOKEN }
      objectCalls += 1
      if (objectCalls === 1) return { ok: false, status: 401, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ data: [{ type: 'series', title: 'Une série' }] }) }
    })
    const e = new CrunchyrollEnricher({ fetchImpl, clock: new ManualClock(0), logger: pino({ level: 'silent' }), signal: new AbortController().signal })
    expect(await e.lookup('GE3')).toBeNull()                                 // 401 → échec mémorisé (le jeton est jeté)
    const clock = new ManualClock(11 * 60_000)
    const e3 = new CrunchyrollEnricher({ fetchImpl, clock, logger: pino({ level: 'silent' }), signal: new AbortController().signal })
    expect(await e3.lookup('GE4')).toBeNull()                                // pas un épisode : rien à enrichir
  })
})
