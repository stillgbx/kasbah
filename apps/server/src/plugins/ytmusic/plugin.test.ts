import Fastify from 'fastify'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { DeviceDescriptor } from '@kasbah/shared'
import { PluginError, type PluginContext } from '../../core/plugin'
import { createCookieFile } from './cookie'
import { type InnertubeLike } from './catalog'
import { createYtmusicPlugin } from './index'
import type { SpawnFn } from './stream'

const COOKIE = '__Secure-3PAPISID=test; other=1'

function fakeCtx(config: Record<string, unknown>): PluginContext {
  const clock = new ManualClock(1_700_000_000_000)
  return {
    pluginId: 'ytmusic',
    config,
    logger: pino({ level: 'silent' }),
    clock,
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

function fakeMusic(tracks = [{ id: 'vid1', title: 'Song', artists: [{ name: 'A' }], duration: { seconds: 10 }, thumbnails: [{ url: 'https://i.ytimg.com/a.jpg', width: 120 }] }]): InnertubeLike {
  return {
    music: {
      async search() { return { songs: { contents: tracks } } },
      async getPlaylist() { return { items: tracks } },
      async getLibrary() {
        return {
          contents: [{ contents: [{ id: 'PL1', title: 'Mix', thumbnails: [{ url: 'https://i.ytimg.com/p.jpg', width: 60 }], item_count: '3' }] }],
          async applyFilter() {
            return { contents: [{ contents: [{ id: 'PL1', title: 'Mix', thumbnails: [{ url: 'https://i.ytimg.com/p.jpg', width: 60 }], item_count: '3' }] }] }
          },
        }
      },
    },
  }
}

async function boot(extra: {
  fetchImpl?: typeof fetch
  playUrl?: (id: string, url: string) => Promise<void>
  getDevice?: (id: string) => { descriptor: DeviceDescriptor } | undefined
  spawnImpl?: ReturnType<typeof fakeSpawn>['spawnImpl']
} = {}) {
  const store = createCookieFile('')
  const plugin = createYtmusicPlugin({
    cookieStore: store,
    createSession: async () => fakeMusic(),
    fetchImpl: extra.fetchImpl ?? (async () => new Response('ok', { status: 200 })) as typeof fetch,
    ...(extra.playUrl ? { playUrl: extra.playUrl } : {}),
    ...(extra.getDevice ? { getDevice: extra.getDevice } : {}),
    ...(extra.spawnImpl ? { spawnImpl: extra.spawnImpl } : {}),
  })
  const config = plugin.configSchema.parse({
    YTM_COOKIE_FILE: '',
    YTM_PUBLISH_BASE: 'http://192.168.1.10:8787',
    YTM_YTDLP_PATH: 'yt-dlp',
    YTM_PO_TOKEN_URL: 'http://127.0.0.1:4416',
    FFMPEG_PATH: 'ffmpeg',
  })
  const ctx = fakeCtx(config)
  await plugin.init(ctx)
  await plugin.start()
  const app = Fastify()
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => { done(null, body) })
  const routes = plugin.registerRoutes
  expect(routes).toBeTypeOf('function')
  await app.register(async (sub) => routes!.call(plugin, sub), { prefix: '/api/plugins/ytmusic' })
  await app.ready()
  return { plugin, app, store, ctx }
}

function fakeSpawn() {
  const procs: Array<EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }> = []
  const spawnImpl = vi.fn((_cmd: string, args: readonly string[]) => {
    // yt-dlp -J : rendre un JSON audio
    if (args.includes('-J')) {
      const proc = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn>; stdin: null }
      proc.stdout = new PassThrough()
      proc.stderr = new PassThrough()
      proc.kill = vi.fn()
      proc.stdin = null
      queueMicrotask(() => {
        proc.stdout.end(JSON.stringify({
          formats: [{ url: 'https://googlevideo.example/a.m4a', format_id: '140', ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none' }],
        }))
        proc.emit('close', 0)
      })
      procs.push(proc as never)
      return proc as never
    }
    // ffmpeg
    const proc = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }
    proc.stdout = new PassThrough()
    proc.stderr = new PassThrough()
    proc.kill = vi.fn()
    procs.push(proc)
    queueMicrotask(() => { proc.stdout.write('ID3'); proc.stdout.end(); proc.emit('close', 0) })
    return proc as never
  })
  return { spawnImpl: spawnImpl as unknown as SpawnFn, procs }
}

const player: DeviceDescriptor = {
  id: 'google_cast:mini',
  pluginId: 'google_cast',
  externalId: 'mini',
  kind: 'media_player',
  name: 'Cuisine',
  capabilities: ['playback', 'play_url', 'volume'],
  meta: {},
}

afterEach(() => { vi.restoreAllMocks() })

describe('ytmusic plugin', () => {
  it('reports needs_pairing without cookie', async () => {
    const { plugin, app } = await boot()
    expect(plugin.health!().status).toBe('needs_pairing')
    expect((await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/status' })).json()).toMatchObject({
      linked: false, unofficial: true, poTokenOk: true,
    })
    await app.close()
    await plugin.stop()
  })

  it('saves and clears cookie without echoing it', async () => {
    const { plugin, app } = await boot()
    const put = await app.inject({
      method: 'PUT', url: '/api/plugins/ytmusic/cookie',
      headers: { 'content-type': 'application/json' },
      payload: { cookie: COOKIE },
    })
    expect(put.statusCode).toBe(200)
    expect(JSON.stringify(put.json())).not.toContain('test')
    expect(put.json()).toMatchObject({ linked: true })
    expect(plugin.health!().status).toBe('ok')

    const del = await app.inject({ method: 'DELETE', url: '/api/plugins/ytmusic/cookie' })
    expect(del.json()).toMatchObject({ linked: false })
    expect(plugin.health!().status).toBe('needs_pairing')
    await app.close()
    await plugin.stop()
  })

  it('rejects cookie without __Secure-3PAPISID', async () => {
    const { plugin, app } = await boot()
    const r = await app.inject({
      method: 'PUT', url: '/api/plugins/ytmusic/cookie',
      payload: { cookie: 'VISITOR=1' },
    })
    expect(r.statusCode).toBe(400)
    await app.close()
    await plugin.stop()
  })

  it('searches and lists library via injected catalog', async () => {
    const { plugin, app } = await boot()
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })
    const search = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/search?q=terra' })
    expect(search.json().tracks[0]).toMatchObject({ videoId: 'vid1', title: 'Song', artists: ['A'] })

    const liked = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/library/liked' })
    expect(liked.json().tracks).toHaveLength(1)

    const pls = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/library/playlists' })
    expect(pls.json().playlists[0]).toMatchObject({ id: 'PL1', title: 'Mix' })

    const pl = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/playlists/PL1' })
    expect(pl.json().tracks[0].videoId).toBe('vid1')
    await app.close()
    await plugin.stop()
  })

  it('refuses catalog without cookie', async () => {
    const { plugin, app } = await boot()
    const r = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/search?q=x' })
    expect(r.statusCode).toBe(409)
    await app.close()
    await plugin.stop()
  })

  it('plays via play_url after yt-dlp resolve', async () => {
    const played: { id: string; url: string; meta?: { title?: string; artist?: string; artUrl?: string } }[] = []
    const ff = fakeSpawn()
    const { plugin, app } = await boot({
      spawnImpl: ff.spawnImpl,
      getDevice: (id) => id === player.id ? { descriptor: player } : undefined,
      playUrl: async (id, url, meta) => { played.push({ id, url, meta }) },
    })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })
    const r = await app.inject({
      method: 'POST', url: '/api/plugins/ytmusic/play',
      payload: {
        videoId: 'vid1',
        deviceId: player.id,
        title: 'Song',
        artist: 'A',
        artUrl: 'https://i.ytimg.com/a.jpg',
      },
    })
    expect(r.statusCode).toBe(200)
    expect(played).toHaveLength(1)
    expect(played[0]!.id).toBe(player.id)
    expect(played[0]!.url).toMatch(/^http:\/\/192\.168\.1\.10:8787\/api\/plugins\/ytmusic\/stream\/[a-f0-9]+$/)
    expect(played[0]!.meta).toEqual({ title: 'Song', artist: 'A', artUrl: 'https://i.ytimg.com/a.jpg' })
    await app.close()
    await plugin.stop()
  })

  it('execute always refuses', async () => {
    const { plugin, app } = await boot()
    await expect(plugin.execute('x', { type: 'media_player.play' })).rejects.toBeInstanceOf(PluginError)
    await app.close()
    await plugin.stop()
  })
})
