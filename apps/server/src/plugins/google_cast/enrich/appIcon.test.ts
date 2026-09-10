import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { CAST_REGISTRY_NETFLIX } from '../__fixtures__/network'
import { AppIconResolver, parseRegistry, registryAppId, type RegistryFetch } from './appIcon'

const logger = pino({ level: 'silent' })

describe('cast app icon (registry)', () => {
  it('names the registry id: a Cast app by its appId, a native app by its display name, nothing otherwise', () => {
    expect(registryAppId({ appId: 'CC32E753', displayName: 'Spotify' })).toBe('CC32E753')
    expect(registryAppId({ appId: 'Netflix', displayName: 'Netflix' })).toBe('CA5E8412')
    expect(registryAppId({ appId: 'AndroidNativeApp', displayName: 'Crunchyroll' })).toBeUndefined()
  })

  it('strips the anti-hijacking guard and picks the first icon (real Netflix capture)', () => {
    expect(parseRegistry(CAST_REGISTRY_NETFLIX)).toBe('https://lh3.googleusercontent.com/anonymised-netflix-icon')
    expect(parseRegistry(')]}\'\n{"display_name":"X","promo_assets":[{"description":"no icon"}]}')).toBeNull()
  })

  it('caches hits a day and misses an hour, one request in flight per id', async () => {
    const clock = new ManualClock(0)
    const fetchImpl: RegistryFetch = vi.fn(async (url) => (url.endsWith('CA5E8412') ? { ok: true, status: 200, text: async () => CAST_REGISTRY_NETFLIX } : { ok: false, status: 404, text: async () => '' }))
    const icons = new AppIconResolver({ fetchImpl, clock, logger, signal: new AbortController().signal })
    expect(icons.cached('CA5E8412')).toBeUndefined()
    const [a, b] = await Promise.all([icons.lookup('CA5E8412'), icons.lookup('CA5E8412')])
    expect(a).toBe('https://lh3.googleusercontent.com/anonymised-netflix-icon')
    expect(b).toBe(a)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(icons.cached('CA5E8412')).toBe(a)
    expect(await icons.lookup('00000000')).toBeNull()
    expect(icons.cached('00000000')).toBeNull()
    clock.advance(3_600_001)
    expect(icons.cached('00000000')).toBeUndefined()                      // l'échec est oublié, on réessaiera
    expect(icons.cached('CA5E8412')).toBe(a)                              // le logo reste connu
  })
})
