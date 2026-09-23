import Fastify from 'fastify'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { Command, DeviceDescriptor } from '@kasbah/shared'
import { PluginError, type PluginContext } from '../../core/plugin'
import { describeError, sendError } from '../../http/errors'
import { createMusicPlayer } from '../../music/player'
import type { SpawnFn } from '../../music/proxy'
import { getMusicSource } from '../../music/sources'
import { createMixcloudApi, followingUploads, KEY_RE, toMix, type MixcloudApi, type MixcloudMix } from './api'
import { buildHome } from './home'
import { createMixcloudPlugin } from './index'
import { resolveMixcloud } from './resolve'
import { memoryMixcloud, noteProgress, resumePoint } from './store'

// Formes relevées sur api.mixcloud.com et yt-dlp 2026.08.19 le 2026-09-23 (raccourcies).
const RAW_CLOUDCAST = {
  key: '/NTSRadio/btwn-earthsky-lara-sarkissian-23rd-september-2026/',
  name: 'Btwn Earth+Sky: Lara Sarkissian - 23rd September 2026',
  tags: [{ name: 'Experimental', key: '/genres/experimental/' }, { name: 'Persian Pop', key: '/genres/persian-pop/' }],
  created_time: '2026-09-23T10:02:35Z',
  pictures: { small: 'https://thumbnailer.mixcloud.com/unsafe/25x25/x', large: 'https://thumbnailer.mixcloud.com/unsafe/300x300/x', '1024wx1024h': 'https://thumbnailer.mixcloud.com/unsafe/1024x1024/x' },
  user: { username: 'NTSRadio', name: 'Mixcloud NTS Radio' },
  audio_length: 5288,
}
const YTDLP_JSON = {
  duration: 5786,
  formats: [
    { format_id: 'http', ext: 'm4a', protocol: 'https', url: 'https://dl.mixcloud.stream/secure/c/m4a/64/a.m4a?sig=x' },
    { format_id: 'hls-64', ext: 'mp4', protocol: 'm3u8_native', acodec: 'mp4a.40.2', abr: 64.003, url: 'https://aod.mixcloud.stream/secure/hls/a.m4a/stream' },
    { format_id: 'dash-a1-x3', ext: 'm4a', protocol: 'http_dash_segments', acodec: 'mp4a.40.2', abr: 64.003, url: 'https://aod.mixcloud.stream/secure/dash2/a.m4a/manifest.mpd' },
  ],
}
const SIZE = 47_292_648

function fakeYtdlp(json: unknown = YTDLP_JSON) {
  const calls: string[][] = []
  const spawnImpl = vi.fn((_cmd: string, args: readonly string[]) => {
    calls.push([...args])
    const proc = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void }
    proc.stdout = new PassThrough()
    proc.stderr = new PassThrough()
    proc.kill = () => {}
    queueMicrotask(() => { proc.stdout.end(JSON.stringify(json)); proc.emit('close', 0) })
    return proc as never
  })
  return { spawnImpl: spawnImpl as unknown as SpawnFn, calls }
}
/** Le HEAD sur le m4a : sa taille et ses plages. */
const headOk = (async (_url: string, init?: RequestInit) => {
  expect(init?.method).toBe('HEAD')
  return new Response(null, { status: 200, headers: { 'content-length': String(SIZE), 'accept-ranges': 'bytes', 'content-type': 'audio/mpeg' } })
}) as unknown as typeof fetch

function fakeCtx(): PluginContext {
  return {
    pluginId: 'mixcloud',
    config: {},
    logger: pino({ level: 'silent' }),
    clock: new ManualClock(1_700_000_000_000),
    signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {},
    site: { lat: 0, lon: 0, alt: 0 },
  }
}

const MIX: MixcloudMix = toMix({ ...RAW_CLOUDCAST })

function fakeApi(over: Partial<MixcloudApi> = {}): MixcloudApi {
  const page = { items: [MIX], next: null }
  return {
    user: vi.fn(async (u: string) => (u === 'nobody' ? null : { username: u, name: u, artUrl: null })),
    cloudcasts: vi.fn(async () => page),
    favorites: vi.fn(async () => page),
    listens: vi.fn(async () => page),
    playlists: vi.fn(async () => [{ key: '/someone/playlists/jazz/', name: 'Jazz' }]),
    playlist: vi.fn(async () => page),
    following: vi.fn(async () => []),
    search: vi.fn(async () => page),
    popular: vi.fn(async () => page),
    ...over,
  }
}

const speaker: DeviceDescriptor = {
  id: 'sonos:garage', pluginId: 'sonos', externalId: 'garage', kind: 'media_player', name: 'Garage',
  capabilities: ['playback', 'play_url', 'seek'], meta: {},
}

async function boot(opts: { api?: MixcloudApi; username?: string | null; execute?: (id: string, c: Command) => Promise<void> } = {}) {
  const store = memoryMixcloud({ username: opts.username === undefined ? 'kasbahfan' : opts.username })
  const yt = fakeYtdlp()
  const plugin = createMixcloudPlugin({ api: opts.api ?? fakeApi(), store, spawnImpl: yt.spawnImpl, fetchImpl: headOk })
  const ctx = fakeCtx()
  await plugin.init(ctx)
  await plugin.start()
  const execute = vi.fn(opts.execute ?? (async () => {}))
  const music = createMusicPlayer({
    config: { MUSIC_PUBLISH_BASE: 'http://192.168.1.10:8787' },
    logger: pino({ level: 'silent' }),
    now: () => ctx.clock.now(),
    source: getMusicSource,
    execute,
    getDevice: (id) => (id === speaker.id ? { descriptor: speaker } : undefined),
    onState: () => () => {},
  })
  const app = Fastify()
  // le gestionnaire d'erreurs du vrai serveur (`http/routes.ts`) : une PluginError y devient 4xx/5xx
  app.setErrorHandler((err, _req, reply) => { const d = describeError(err); return sendError(reply, d.status, d.code, d.message) })
  await app.register(async (sub) => plugin.registerRoutes!.call(plugin, sub), { prefix: '/api/plugins/mixcloud' })
  await app.register(async (sub) => music.registerRoutes(sub), { prefix: '/api/music' })
  await app.ready()
  return { plugin, app, store, execute, music, ctx, yt }
}

describe('mixcloud api', () => {
  it('keeps the largest square picture, the author and the duration', () => {
    expect(MIX).toEqual({
      key: RAW_CLOUDCAST.key,
      name: RAW_CLOUDCAST.name,
      user: { username: 'NTSRadio', name: 'Mixcloud NTS Radio' },
      artUrl: 'https://thumbnailer.mixcloud.com/unsafe/1024x1024/x',
      durationS: 5288,
      createdAt: '2026-09-23T10:02:35Z',
      tags: ['Experimental', 'Persian Pop'],
      genres: [{ slug: 'experimental', name: 'Experimental' }, { slug: 'persian-pop', name: 'Persian Pop' }],
    })
    expect(KEY_RE.test(MIX.key)).toBe(true)
    expect(KEY_RE.test('/NTSRadio/../../etc/')).toBe(false)
    expect(KEY_RE.test('https://evil.example/x/')).toBe(false)
  })

  it('reads a page and only follows cursors that point back to the API', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [RAW_CLOUDCAST, { broken: true }], paging: { next: 'https://api.mixcloud.com/kasbahfan/favorites/?until=x' } })))
    const api = createMixcloudApi('https://api.mixcloud.com', fetchImpl as unknown as typeof fetch)
    const page = await api.favorites('kasbahfan')
    expect(page.items.map((m) => m.key)).toEqual([RAW_CLOUDCAST.key])
    expect(page.next).toBe('https://api.mixcloud.com/kasbahfan/favorites/?until=x')
    await api.favorites('kasbahfan', page.next!)
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toBe(page.next)
    await expect(api.favorites('kasbahfan', 'https://evil.example/steal')).rejects.toBeInstanceOf(PluginError)
    await expect(api.favorites('../admin')).rejects.toBeInstanceOf(PluginError)
  })

  it('rebuilds the following feed newest first, skipping an account that fails', async () => {
    const mix = (user: string, day: string): MixcloudMix => ({ ...MIX, key: `/${user}/${day}/`, user: { username: user, name: user }, createdAt: `2026-09-${day}T00:00:00Z` })
    const api = fakeApi({
      following: vi.fn(async () => ['a', 'b', 'c'].map((u) => ({ username: u, name: u, artUrl: null }))),
      cloudcasts: vi.fn(async (u: string) => {
        if (u === 'b') throw new PluginError('UPSTREAM_ERROR', 'down')
        return { items: u === 'a' ? [mix('a', '20'), mix('a', '10')] : [mix('c', '22')], next: null }
      }),
    })
    const feed = await followingUploads(api, 'kasbahfan', { perUser: 2 })
    expect(feed.map((m) => m.key)).toEqual(['/c/22/', '/a/20/', '/a/10/'])
  })
})

describe('mixcloud home', () => {
  // la répartition relevée sur le compte de l'utilisateur le 2026-09-23 : The Boat Pod puis Worldwide FM,
  // jazz puis soul ; `worldwide-fm` est aussi un genre chez Mixcloud, mais c'est déjà une rangée « Plus de »
  const listen = (user: string, i: number, genres: string[]): MixcloudMix => ({
    ...MIX, key: `/${user}/mix-${i}/`, user: { username: user, name: user === 'worldwidefm' ? 'Worldwide FM' : user },
    genres: genres.map((g) => ({ slug: g, name: g[0]!.toUpperCase() + g.slice(1) })),
  })
  const listens = [
    ...[0, 1, 2].map((i) => listen('TheBoAtPod', i, ['jazz', 'soul'])),
    ...[0, 1].map((i) => listen('worldwidefm', i, ['worldwide-fm', 'jazz'])),
    listen('WeAreOneJazz', 0, ['jazz', 'acoustic-jazz']),
    listen('TheBoAtPod', 0, ['jazz', 'soul']),                // réécouté : une seule fois dans « Réécouter »
  ]

  it('builds the sections from what the account listens to', async () => {
    const api = fakeApi({
      listens: vi.fn(async () => ({ items: listens, next: null })),
      cloudcasts: vi.fn(async (u: string) => ({ items: [listen(u, 9, [])], next: null })),
      popular: vi.fn(async (g: string) => ({ items: g === 'acoustic-jazz' ? [] : [listen('someone', 1, [g])], next: null })),
    })
    const feed = [listen('followed', 1, [])]
    const home = await buildHome(api, 'un_auditeur', async () => feed, { moreFrom: 2, genres: 3 })
    expect(api.listens).toHaveBeenCalledWith('un_auditeur', undefined, 100)
    expect(home.map((s) => s.id)).toEqual(['topCreators', 'following', 'listenAgain', 'moreFrom', 'moreFrom', 'popular', 'popular'])
    const top = home[0]!
    expect(top.kind === 'users' && top.users.map((u) => u.username)).toEqual(['TheBoAtPod', 'worldwidefm', 'WeAreOneJazz'])
    expect(home.filter((s) => s.id === 'moreFrom').map((s) => s.kind === 'mixes' && 'user' in s && s.user.username)).toEqual(['TheBoAtPod', 'worldwidefm'])
    expect(home.filter((s) => s.id === 'popular').map((s) => 'genre' in s && s.genre.slug)).toEqual(['jazz', 'soul'])
    expect(api.popular).not.toHaveBeenCalledWith('worldwide-fm')
    const again = home.find((s) => s.id === 'listenAgain')!
    expect(again.kind === 'mixes' && again.items.map((m) => m.key)).toEqual(['/TheBoAtPod/mix-0/', '/TheBoAtPod/mix-1/', '/TheBoAtPod/mix-2/', '/worldwidefm/mix-0/', '/worldwidefm/mix-1/', '/WeAreOneJazz/mix-0/'])
  })

  it('keeps the other rows when one call fails', async () => {
    const api = fakeApi({
      listens: vi.fn(async () => ({ items: listens, next: null })),
      cloudcasts: vi.fn(async () => { throw new PluginError('RATE_LIMITED', 'Mixcloud answered 429') }),
    })
    const home = await buildHome(api, 'un_auditeur', async () => { throw new Error('down') })
    expect(home.map((s) => s.id)).toEqual(['topCreators', 'listenAgain', 'popular', 'popular', 'popular'])
  })
})

describe('mixcloud stream resolution', () => {
  it('picks the direct m4a (not HLS nor DASH) and reads its size by HEAD', async () => {
    const yt = fakeYtdlp()
    const r = await resolveMixcloud({ key: MIX.key, ytdlpPath: 'yt-dlp', spawnImpl: yt.spawnImpl, fetchImpl: headOk })
    expect(r).toEqual({ url: YTDLP_JSON.formats[0]!.url, formatId: 'http', ext: 'm4a', abrKbps: 64, sizeBytes: SIZE, durationS: 5786 })
    expect(yt.calls[0]!.at(-1)).toBe(`https://www.mixcloud.com${MIX.key}`)
  })

  it('leaves the size unknown when the file does not accept byte ranges', async () => {
    const noRanges = (async () => new Response(null, { status: 200, headers: { 'content-length': String(SIZE) } })) as unknown as typeof fetch
    const r = await resolveMixcloud({ key: MIX.key, ytdlpPath: 'yt-dlp', spawnImpl: fakeYtdlp().spawnImpl, fetchImpl: noRanges })
    expect(r.sizeBytes).toBeNull()
  })
})

describe('mixcloud resume', () => {
  it('remembers a position past the first minute, forgets a finished mix, keeps the most recent', () => {
    let resume = noteProgress({}, '/a/b/', 30, 3600, false, 1)
    expect(resumePoint(resume['/a/b/'])).toBeNull()                       // trop tôt pour valoir une reprise
    resume = noteProgress(resume, '/a/b/', 1234.6, 3600, false, 2)
    expect(resumePoint(resume['/a/b/'])).toBe(1234)
    resume = noteProgress(resume, '/a/b/', 3550, 3600, false, 3)          // dans la dernière minute et demie
    expect(resume['/a/b/']).toBeUndefined()
    resume = noteProgress({ '/a/b/': { positionS: 500, durationS: 3600, at: 1 } }, '/a/b/', 3600, 3600, true, 4)
    expect(resume).toEqual({})
  })
})

describe('mixcloud plugin', () => {
  it('links an account by its username, refusing one Mixcloud does not know', async () => {
    const { app, store, plugin } = await boot({ username: null })
    expect(plugin.health!().status).toBe('needs_pairing')
    expect((await app.inject({ method: 'GET', url: '/api/plugins/mixcloud/library/favorites' })).statusCode).toBeGreaterThanOrEqual(400)
    expect((await app.inject({ method: 'PUT', url: '/api/plugins/mixcloud/account', payload: { username: 'nobody' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PUT', url: '/api/plugins/mixcloud/account', payload: { username: 'bad name' } })).statusCode).toBe(400)
    const ok = await app.inject({ method: 'PUT', url: '/api/plugins/mixcloud/account', payload: { username: 'kasbahfan' } })
    expect(ok.json()).toMatchObject({ username: 'kasbahfan' })
    expect((await store.load()).username).toBe('kasbahfan')
    expect(plugin.health!().status).toBe('ok')
  })

  it('serves the lists with each mix resume point, and caches the following feed', async () => {
    const api = fakeApi({ following: vi.fn(async () => [{ username: 'NTSRadio', name: 'NTS', artUrl: null }]) })
    const { app, plugin, ctx } = await boot({ api })
    getMusicSource('mixcloud')!.onProgress!(MIX.key, 1800, 5288, false)
    const fav = (await app.inject({ method: 'GET', url: '/api/plugins/mixcloud/library/favorites' })).json()
    expect(fav.items[0]).toMatchObject({ key: MIX.key, resumeS: 1800 })
    await app.inject({ method: 'GET', url: '/api/plugins/mixcloud/library/feed' })
    await app.inject({ method: 'GET', url: '/api/plugins/mixcloud/library/feed' })
    expect(api.following).toHaveBeenCalledTimes(1)
    ;(ctx.clock as ManualClock).advance(31 * 60_000)
    await app.inject({ method: 'GET', url: '/api/plugins/mixcloud/library/feed' })
    expect(api.following).toHaveBeenCalledTimes(2)
    expect((await app.inject({ method: 'GET', url: '/api/plugins/mixcloud/library/nope' })).statusCode).toBe(404)
    // repartir du début
    await app.inject({ method: 'DELETE', url: `/api/plugins/mixcloud/resume?key=${encodeURIComponent(MIX.key)}` })
    expect((await app.inject({ method: 'GET', url: '/api/plugins/mixcloud/library/favorites' })).json().items[0].resumeS).toBeUndefined()
    await plugin.stop()
  })

  it('plays a mix through the common player: relayed m4a, then a seek to the resume point', async () => {
    const { app, execute, plugin } = await boot()
    const res = await app.inject({
      method: 'POST', url: '/api/music/play',
      payload: { source: 'mixcloud', id: MIX.key, deviceId: speaker.id, title: MIX.name, artist: MIX.user.name, artUrl: MIX.artUrl, durationS: 5288, startS: 1800 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().streamUrl).toMatch(/^http:\/\/192\.168\.1\.10:8787\/api\/music\/raw\/[0-9a-f]+\.m4a$/)
    const sent = execute.mock.calls.map((c) => c[1] as Command)
    expect(sent[0]).toMatchObject({ type: 'media_player.play_url', title: MIX.name, artist: 'Mixcloud NTS Radio' })
    expect(sent[1]).toEqual({ type: 'media_player.seek', positionS: 1800 })
    const sessions = (await app.inject({ method: 'GET', url: '/api/music/sessions' })).json().sessions
    expect(sessions[0]).toMatchObject({ source: 'mixcloud', id: MIX.key, durationS: 5786, quality: { mime: 'audio/mp4', lengthBytes: SIZE } })
    // une clé qui n'est pas celle d'un mix ne part pas à yt-dlp
    const bad = await app.inject({ method: 'POST', url: '/api/music/play', payload: { source: 'mixcloud', id: 'https://evil.example/', deviceId: speaker.id } })
    expect(bad.statusCode).toBeGreaterThanOrEqual(400)
    await plugin.stop()
    // plugin coupé : la source n'est plus là
    const off = await app.inject({ method: 'POST', url: '/api/music/play', payload: { source: 'mixcloud', id: MIX.key, deviceId: speaker.id } })
    expect(off.statusCode).toBe(400)
  })
})
