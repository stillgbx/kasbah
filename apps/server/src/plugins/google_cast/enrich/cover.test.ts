import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { DEEZER_SEARCH_BOUNDARY, ITUNES_SEARCH_BOUNDARY, ITUNES_SEARCH_NOT_A_TRACK } from '../__fixtures__/network'
import { CoverFinder, matches, normArtist, normTitle, type CoverFetch } from './cover'

const logger = pino({ level: 'silent' })
const BOUNDARY = { title: 'Horizon', artist: 'Northwind et Lumen' }
const PIANO_SET = { title: 'SLOW RIVERS - Live Performance (Piano Set)', artist: 'SLOW RIVERS' }

/** Réponses des catalogues, choisies par l'hôte de l'URL ; `null` = ne connaît pas. */
function fakeCatalogs(itunes: unknown | null, deezer: unknown | null) {
  const calls: string[] = []
  const fetchImpl: CoverFetch = vi.fn(async (url) => {
    calls.push(url)
    const body = url.includes('itunes.apple.com') ? itunes : deezer
    return body === null ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => body }
  })
  return { fetchImpl, calls }
}

const finder = (fetchImpl: CoverFetch, clock = new ManualClock(0)) =>
  new CoverFinder({ fetchImpl, clock, logger, signal: new AbortController().signal })

describe('cover lookup (iTunes then Deezer)', () => {
  it('compares titles and artists apart from accents, brackets and joining words', () => {
    expect(normTitle('Thaïs: Meditation (Andante Religioso)')).toBe('thais meditation')
    expect(normArtist('Northwind et Lumen')).toBe('northwind lumen')
    expect(normArtist('Northwind & Lumen')).toBe('northwind lumen')
    expect(normArtist('Björk feat. Robyn')).toBe('bjork robyn')
  })

  it('accepts a result only when it really is the track playing', () => {
    // relevé réel : l'appareil dit « et », iTunes « & », Deezer ne nomme que le premier artiste
    expect(matches(BOUNDARY, { title: 'Horizon', artist: 'Northwind & Lumen' })).toBe(true)
    expect(matches(BOUNDARY, { title: 'Horizon', artist: 'Northwind' })).toBe(true)
    // même artiste, autre morceau du même album : non
    expect(matches(BOUNDARY, { title: 'Black', artist: 'Northwind' })).toBe(false)
    // ce que iTunes propose sur un titre qui n'est pas un morceau : non
    expect(matches(PIANO_SET, { title: "Highway Don't Care (feat. Taylor Swift & Keith Urban)", artist: 'Tim McGraw' })).toBe(false)
    expect(matches(BOUNDARY, { title: 'Horizon', artist: null })).toBe(false)
  })

  it('takes the iTunes cover, upgraded to 600 px, without asking Deezer', async () => {
    const { fetchImpl, calls } = fakeCatalogs(ITUNES_SEARCH_BOUNDARY, DEEZER_SEARCH_BOUNDARY)
    const f = finder(fetchImpl)
    expect(await f.lookup(BOUNDARY)).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/anonymised/199502092474_cover.jpg/600x600bb.jpg')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('entity=song')
    // en cache : plus aucune requête, et la réponse est immédiate
    expect(f.cached(BOUNDARY)).toContain('600x600bb')
    expect(await f.lookup({ title: 'horizon', artist: 'NORTHWIND ET LUMEN' })).toContain('600x600bb')
    expect(calls).toHaveLength(1)
  })

  it('falls back to Deezer when iTunes has nothing that matches', async () => {
    const { fetchImpl, calls } = fakeCatalogs(ITUNES_SEARCH_NOT_A_TRACK, DEEZER_SEARCH_BOUNDARY)
    expect(await finder(fetchImpl).lookup(BOUNDARY)).toBe('https://cdn-images.dzcdn.net/images/cover/anonymised/1000x1000-000000-80-0-0.jpg')
    expect(calls).toHaveLength(2)
  })

  it('finds nothing on a video that is not a track, and remembers the failure', async () => {
    // le vrai piège : iTunes répond des morceaux sans rapport, Deezer une liste vide
    const { fetchImpl, calls } = fakeCatalogs(ITUNES_SEARCH_NOT_A_TRACK, { data: [] })
    const clock = new ManualClock(0)
    const f = finder(fetchImpl, clock)
    expect(await f.lookup(PIANO_SET)).toBeNull()
    expect(f.cached(PIANO_SET)).toBeNull()                     // échec mémorisé
    await f.lookup(PIANO_SET)
    expect(calls).toHaveLength(2)                              // le plugin republie toutes les 10 s : une seule recherche
    clock.advance(7 * 3_600_000)                               // au-delà du délai d'oubli d'un échec
    expect(f.cached(PIANO_SET)).toBeUndefined()
  })

  it('never lets a catalogue failure remonter', async () => {
    const fetchImpl: CoverFetch = vi.fn(async () => { throw new Error('réseau coupé') })
    expect(await finder(fetchImpl).lookup(BOUNDARY)).toBeNull()
  })
})
