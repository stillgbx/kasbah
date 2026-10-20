import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { Command, DeviceDescriptor } from '@kasbah/shared'
import { PluginError, type PluginContext } from '../../core/plugin'
import { createRadioDirectory, foldName, searchWords, toStation, type RadioDirectory, type Station } from './directory'
import { memoryFavorites } from './favorites'
import { createRadioPlugin } from './index'

// Entry as radio-browser returns it (captured on 2026-09-23, useless fields removed).
const RAW_FRANCEINFO = {
  stationuuid: '9617a958-0601-11e8-ae97-52543be04c81',
  name: 'franceinfo:',
  url: 'http://icecast.radiofrance.fr/franceinfo-hifi.aac',
  url_resolved: 'http://icecast.radiofrance.fr/franceinfo-hifi.aac',
  favicon: 'https://www.radiofrance.fr/favicon.png',
  country: 'France',
  countrycode: 'FR',
  tags: 'news,information,public radio',
  codec: 'AAC',
  bitrate: 192,
  hls: 0,
  lastcheckok: 1,
}
const FRANCEINFO: Station = toStation({ ...RAW_FRANCEINFO })!

function fakeCtx(config: Record<string, unknown>): PluginContext {
  return {
    pluginId: 'radio',
    config,
    logger: pino({ level: 'silent' }),
    clock: new ManualClock(1_700_000_000_000),
    signal: new AbortController().signal,
    emitState: vi.fn(),
    setAvailable: vi.fn(),
    emitDevices: vi.fn(),
    emitScenes: vi.fn(),
    emitSceneState: vi.fn(),
    emitEvent: vi.fn(),
    parts: {},
    site: { lat: 0, lon: 0, alt: 0 },
  }
}

const speaker = { descriptor: { kind: 'media_player', capabilities: ['playback', 'play_url'] } as unknown as DeviceDescriptor }
const tv = { descriptor: { kind: 'media_player', capabilities: ['playback'] } as unknown as DeviceDescriptor }

function fakeDirectory(over: Partial<RadioDirectory> = {}): RadioDirectory {
  return {
    search: vi.fn(async () => [FRANCEINFO]),
    top: vi.fn(async () => [FRANCEINFO]),
    byId: vi.fn(async (id: string) => (id === FRANCEINFO.id ? FRANCEINFO : null)),
    click: vi.fn(async () => {}),
    ...over,
  }
}

async function boot(opts: { directory?: RadioDirectory; favorites?: Station[] } = {}) {
  const execute = vi.fn(async (_id: string, _c: Command) => {})
  const favorites = memoryFavorites(opts.favorites)
  const directory = opts.directory ?? fakeDirectory()
  const plugin = createRadioPlugin({
    directory,
    favorites,
    execute,
    getDevice: (id) => (id === 'sonos:bureau' ? speaker : id === 'cast:tv' ? tv : undefined),
  })
  await plugin.init(fakeCtx(plugin.configSchema.parse({})))
  await plugin.start()
  const app = Fastify()
  await app.register(async (sub) => plugin.registerRoutes!.call(plugin, sub), { prefix: '/api/plugins/radio' })
  await app.ready()
  return { plugin, app, execute, favorites, directory }
}

describe('radio directory mapping', () => {
  it('keeps the resolved stream, drops an unknown codec and a non-http favicon', () => {
    expect(FRANCEINFO).toEqual({
      id: RAW_FRANCEINFO.stationuuid,
      name: 'franceinfo:',
      url: 'http://icecast.radiofrance.fr/franceinfo-hifi.aac',
      favicon: 'https://www.radiofrance.fr/favicon.png',
      country: 'France',
      countryCode: 'FR',
      tags: ['news', 'information', 'public radio'],
      codec: 'AAC',
      bitrateKbps: 192,
    })
    const odd = toStation({ ...RAW_FRANCEINFO, codec: 'UNKNOWN', bitrate: 0, favicon: 'data:x', url_resolved: '' })
    expect(odd).toMatchObject({ url: RAW_FRANCEINFO.url })
    expect(odd).not.toHaveProperty('codec')
    expect(odd).not.toHaveProperty('favicon')
    expect(odd).not.toHaveProperty('bitrateKbps')
    expect(toStation({ ...RAW_FRANCEINFO, url: 'rtsp://x', url_resolved: '' })).toBeNull()
  })

  it('names the app, ranks by listens and skips stations that failed their last check', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([RAW_FRANCEINFO, { ...RAW_FRANCEINFO, stationuuid: 'dead', lastcheckok: 0 }])))
    const dir = createRadioDirectory('https://de1.api.radio-browser.info/', fetchImpl as unknown as typeof fetch)
    const found = await dir.search('franceinfo')
    expect(found.map((s) => s.id)).toEqual([RAW_FRANCEINFO.stationuuid])
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/^https:\/\/de1\.api\.radio-browser\.info\/json\/stations\/search\?/)
    expect(new URL(url).searchParams.get('name')).toBe('franceinfo')
    expect(new URL(url).searchParams.get('order')).toBe('clickcount')
    expect((init.headers as Record<string, string>)['user-agent']).toMatch(/^Kasbah/)
  })

  it('finds a station whatever the word order, the accents or the decoration of its name', async () => {
    expect(foldName('★ Radio Dijon Campus')).toBe('radio dijon campus')
    expect(foldName('Chérie FM')).toBe('cherie fm')
    expect(searchWords('Campus  Dijon 92.2')).toEqual({ words: ['campus', 'dijon', '92.2'], probe: 'campus' })
    const dijon = { ...RAW_FRANCEINFO, stationuuid: 'dijon', name: '★ Radio Dijon Campus' }
    const lille = { ...RAW_FRANCEINFO, stationuuid: 'lille', name: 'Radio Campus Lille' }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([lille, dijon])))
    const dir = createRadioDirectory('https://x', fetchImpl as unknown as typeof fetch)
    expect((await dir.search('campus dijon')).map((s) => s.id)).toEqual(['dijon'])
    // the directory only receives one word, the longest: it can only search for an exact sequence
    expect(new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]).searchParams.get('name')).toBe('campus')
  })

  it('turns a network failure into DEVICE_UNAVAILABLE and never fails a click', async () => {
    const dir = createRadioDirectory('https://x', (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch)
    await expect(dir.top('FR')).rejects.toBeInstanceOf(PluginError)
    await expect(dir.click('id')).resolves.toBeUndefined()
  })
})

describe('radio plugin', () => {
  it('plays a station as a LIVE stream on the chosen speaker, and counts the listen', async () => {
    const { app, execute, directory } = await boot()
    const res = await app.inject({ method: 'POST', url: '/api/plugins/radio/play', payload: { deviceId: 'sonos:bureau', stationId: FRANCEINFO.id } })
    expect(res.statusCode).toBe(200)
    expect(execute).toHaveBeenCalledWith('sonos:bureau', {
      type: 'media_player.play_url',
      url: 'http://icecast.radiofrance.fr/franceinfo-hifi.aac',
      title: 'franceinfo:',
      artist: 'France',
      artUrl: 'https://www.radiofrance.fr/favicon.png',
      live: true,
    })
    expect(directory.click).toHaveBeenCalledWith(FRANCEINFO.id)
  })

  it('remembers the station each player was given, for its quality', async () => {
    const { app } = await boot()
    expect((await app.inject({ method: 'GET', url: '/api/plugins/radio/playing' })).json()).toEqual({ playing: [] })
    await app.inject({ method: 'POST', url: '/api/plugins/radio/play', payload: { deviceId: 'sonos:bureau', stationId: FRANCEINFO.id } })
    const res = await app.inject({ method: 'GET', url: '/api/plugins/radio/playing' })
    expect(res.json()).toEqual({ playing: [{ deviceId: 'sonos:bureau', station: expect.objectContaining({ id: FRANCEINFO.id, name: 'franceinfo:' }) }] })
  })

  it('refuses a player without play_url and an unknown station', async () => {
    const { app, execute } = await boot()
    const tvRes = await app.inject({ method: 'POST', url: '/api/plugins/radio/play', payload: { deviceId: 'cast:tv', stationId: FRANCEINFO.id } })
    expect(tvRes.statusCode).toBe(400)
    const unknown = await app.inject({ method: 'POST', url: '/api/plugins/radio/play', payload: { deviceId: 'sonos:bureau', stationId: 'nope' } })
    expect(unknown.statusCode).toBe(404)
    expect(execute).not.toHaveBeenCalled()
  })

  it('keeps favorites for the house, and plays one even when the directory is down', async () => {
    const down = fakeDirectory({ byId: vi.fn(async () => { throw new PluginError('DEVICE_UNAVAILABLE', 'radio directory answered 503') }) })
    const { app, execute, favorites, plugin } = await boot({ directory: down })
    const put = await app.inject({ method: 'PUT', url: `/api/plugins/radio/favorites/${FRANCEINFO.id}`, payload: FRANCEINFO })
    expect(put.json().stations).toHaveLength(1)
    await app.inject({ method: 'PUT', url: `/api/plugins/radio/favorites/${FRANCEINFO.id}`, payload: FRANCEINFO })
    expect(await favorites.load()).toHaveLength(1)                 // no duplicate
    const play = await app.inject({ method: 'POST', url: '/api/plugins/radio/play', payload: { deviceId: 'sonos:bureau', stationId: FRANCEINFO.id } })
    expect(play.statusCode).toBe(200)
    expect(down.byId).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledOnce()
    const del = await app.inject({ method: 'DELETE', url: `/api/plugins/radio/favorites/${FRANCEINFO.id}` })
    expect(del.json().stations).toEqual([])
    expect(plugin.health!().status).toBe('ok')
  })

  it('adds a station by its stream url, once, and plays it without telling the directory', async () => {
    const { app, execute, directory } = await boot()
    const body = { name: 'Radio Dijon Campus', url: 'https://radiodijoncampus.com/proxy_streaming.php' }
    const first = await app.inject({ method: 'POST', url: '/api/plugins/radio/favorites/custom', payload: body })
    expect(first.statusCode).toBe(200)
    const again = await app.inject({ method: 'POST', url: '/api/plugins/radio/favorites/custom', payload: { ...body, name: 'Campus 92.2' } })
    const stations = again.json().stations as Station[]
    expect(stations).toHaveLength(1)                              // same stream = same station, renamed
    expect(stations[0]).toMatchObject({ name: 'Campus 92.2', url: body.url, tags: [] })
    expect(stations[0]!.id).toMatch(/^custom-[0-9a-f]{12}$/)
    await app.inject({ method: 'POST', url: '/api/plugins/radio/play', payload: { deviceId: 'sonos:bureau', stationId: stations[0]!.id } })
    expect(execute).toHaveBeenCalledWith('sonos:bureau', { type: 'media_player.play_url', url: body.url, title: 'Campus 92.2', live: true })
    expect(directory.click).not.toHaveBeenCalled()
    const bad = await app.inject({ method: 'POST', url: '/api/plugins/radio/favorites/custom', payload: { name: 'x', url: 'rtsp://cam' } })
    expect(bad.statusCode).toBe(400)
  })

  it('rejects a favorite whose body does not match the path', async () => {
    const { app } = await boot()
    const res = await app.inject({ method: 'PUT', url: '/api/plugins/radio/favorites/other', payload: FRANCEINFO })
    expect(res.statusCode).toBe(400)
  })

  it('reports a failing directory as degraded, and recovers on the next good answer', async () => {
    let fail = true
    const flaky = fakeDirectory({ search: vi.fn(async () => { if (fail) throw new PluginError('DEVICE_UNAVAILABLE', 'radio directory answered 503'); return [FRANCEINFO] }) })
    const { app, plugin } = await boot({ directory: flaky })
    const bad = await app.inject({ method: 'GET', url: '/api/plugins/radio/search?q=fip' })
    expect(bad.statusCode).toBeGreaterThanOrEqual(500)
    expect(plugin.health!().status).toBe('degraded')
    fail = false
    const ok = await app.inject({ method: 'GET', url: '/api/plugins/radio/search?q=fip' })
    expect(ok.json().stations).toHaveLength(1)
    expect(plugin.health!().status).toBe('ok')
  })
})
