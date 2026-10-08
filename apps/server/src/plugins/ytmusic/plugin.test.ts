import Fastify from 'fastify'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { Command, DeviceDescriptor } from '@kasbah/shared'
import { PluginError, type PluginContext } from '../../core/plugin'
import { createCookieFile } from './cookie'
import { type InnertubeLike } from './catalog'
import { createYtmusicPlugin } from './index'
import type { SpawnFn } from '../../music/proxy'
import { createMusicPlayer } from '../../music/player'
import { getMusicSource } from '../../music/sources'

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

function fakeMusic(tracks = [{ id: 'vid1', title: 'Song', artists: [{ name: 'A' }], duration: { seconds: 10 }, thumbnails: [{ url: 'https://i.ytimg.com/a.jpg', width: 120 }], item_type: 'song' }]): InnertubeLike {
  return {
    music: {
      async search(_query?: string, filters?: { type?: string }) {
        if (filters?.type === 'artist') {
          return {
            contents: [{
              contents: [
                { id: 'UCradiohead', item_type: 'artist', name: 'Radiohead', subscribers: '9M subscribers', thumbnail: [{ url: 'https://i.ytimg.com/rh.jpg', width: 60 }] },
                { id: 'UCyorke', item_type: 'artist', name: 'Thom Yorke', thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
              ],
            }],
          }
        }
        if (filters?.type === 'album') {
          return {
            contents: [{
              contents: [
                { id: 'MPREb_ok', item_type: 'album', title: 'OK Computer', artists: [{ name: 'Radiohead' }], year: '1997', subtitle: { text: 'Album · Radiohead · 1997' }, thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
                { id: 'MPREb_kid', item_type: 'album', title: 'Kid A', artists: [{ name: 'Radiohead' }], year: '2000', subtitle: { text: 'Album · Radiohead · 2000' }, thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
                { id: 'MPREb_sing', item_type: 'album', title: 'Creep', artists: [{ name: 'Radiohead' }], year: '1992', subtitle: { text: 'Single · Radiohead · 1992' }, thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
                { id: 'MPREb_comp', item_type: 'album', title: 'Best Of', artists: [{ name: 'Radiohead' }], subtitle: { text: 'Compilation · Radiohead' }, thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
              ],
            }],
          }
        }
        if (filters?.type === 'song') {
          return {
            contents: [{
              contents: tracks.map((t) => ({ ...t, badges: [{ icon_type: 'MUSIC_EXPLICIT_BADGE' }] })),
            }],
          }
        }
        return { contents: [] }
      },
      async getPlaylist() { return { items: tracks } },
      async getAlbum() { return { contents: tracks } },
      async getArtist() {
        return {
          sections: [{ contents: tracks }],
        }
      },
      async getLibrary() {
        return {
          contents: [{
            contents: [
              { id: 'PL1', item_type: 'playlist', title: { text: 'Mix' }, thumbnail: [{ url: 'https://i.ytimg.com/p.jpg', width: 60 }], item_count: '3' },
            ],
          }],
          async applyFilter() {
            return {
              contents: [{
                contents: [
                  { id: 'PL1', item_type: 'playlist', title: { text: 'Mix' }, thumbnail: [{ url: 'https://i.ytimg.com/p.jpg', width: 60 }], item_count: '3' },
                  { id: 'MPREb_album', item_type: 'album', title: { text: 'Not a playlist' }, thumbnail: [] },
                ],
              }],
            }
          },
        }
      },
    },
  }
}

/** Cas Jäde : browseId uniquement sur title.runs (pas on_tap), + homonyme faible en étagère. */
function fakeMusicJade(): InnertubeLike {
  return {
    music: {
      async search(_query?: string, filters?: { type?: string }) {
        if (filters?.type === 'artist') {
          return {
            contents: [{
              contents: [
                {
                  id: 'UCjade_real',
                  item_type: 'artist',
                  name: 'Jäde',
                  subscribers: '12.3K subscribers',
                  thumbnail: [{ url: 'https://i.ytimg.com/jade.jpg', width: 60 }],
                },
                {
                  id: 'UCjade_fake',
                  item_type: 'artist',
                  name: 'JÄDE',
                  subscribers: '10 subscribers',
                  thumbnail: [{ url: 'https://i.ytimg.com/fake.jpg', width: 60 }],
                },
              ],
            }],
          }
        }
        if (filters?.type === 'album') {
          return {
            contents: [{
              contents: [
                { id: 'MPREb_jade_ep_sexe', item_type: 'album', title: 'Sexe & the city', artists: [{ name: 'Jäde', channel_id: 'UCjade_real' }], year: '2025', subtitle: { text: 'EP · Jäde · 2025' }, thumbnail: [{ url: 'https://i.ytimg.com/ep.jpg', width: 60 }] },
                { id: 'MPREb_jade_romance', item_type: 'album', title: 'Romance', artists: [{ name: 'Jäde', channel_id: 'UCjade_real' }], year: '2021', subtitle: { text: 'Album · Jäde · 2021' }, thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
                { id: 'MPREb_jade_premiere', item_type: 'album', title: 'Première fois', artists: [{ name: 'Jäde', channel_id: 'UCjade_real' }], year: '2020', subtitle: { text: 'Album · Jäde · 2020' }, thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
                { id: 'MPREb_jade_ep', item_type: 'album', title: 'Comme des garçons', artists: [{ name: 'Jäde', channel_id: 'UCjade_real' }], year: '2025', subtitle: { text: 'Single · Jäde · 2025' }, thumbnail: [{ url: 'https://i.ytimg.com/ep.jpg', width: 60 }] },
                { id: 'MPREb_jade_dsl', item_type: 'album', title: 'Dsl', artists: [{ name: 'Jäde', channel_id: 'UCjade_real' }], year: '2025', subtitle: { text: 'Single · Jäde · 2025' }, thumbnail: [{ url: 'https://i.ytimg.com/ep.jpg', width: 60 }] },
                { id: 'MPREb_jade_sexe_album', item_type: 'album', title: 'Sexe & the city', artists: [{ name: 'Jäde', channel_id: 'UCjade_real' }], year: '2026', subtitle: { text: 'Album · Jäde · 2026' }, thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
                { id: 'MPREb_jade_diabolo', item_type: 'album', title: 'Diabolo Grenadine / Rivalise', artists: [{ name: 'Jäde', channel_id: 'UCjade_real' }], year: '2024', subtitle: { text: 'Single · Jäde · 2024' }, thumbnail: [{ url: 'https://i.ytimg.com/ep.jpg', width: 60 }] },
                { id: 'MPREb_jade_meteo', item_type: 'album', title: 'Météo', artists: [{ name: 'Jäde', channel_id: 'UCjade_real' }], year: '2022', subtitle: { text: 'Album · Jäde · 2022' }, thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
                { id: 'MPREb_jade_best', item_type: 'album', title: 'Best of Jäde', artists: [{ name: 'Jäde', channel_id: 'UCjade_real' }], year: '2023', subtitle: { text: 'Album · Jäde · 2023' }, thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }], badges: [{ icon_type: 'MUSIC_EXPLICIT_BADGE' }] },
              ],
            }],
          }
        }
        if (filters?.type === 'song') {
          return { contents: [{ contents: [] }] }
        }
        return { contents: [] }
      },
      async getPlaylist() { return { items: [] } },
      async getAlbum() { return { contents: [] } },
      async getArtist() { return { sections: [] } },
      async getLibrary() { return { contents: [] } },
    },
  }
}

async function boot(extra: {
  fetchImpl?: typeof fetch
  execute?: (id: string, command: Command) => Promise<void>
  getDevice?: (id: string) => { descriptor: DeviceDescriptor; state?: unknown } | undefined
  spawnImpl?: ReturnType<typeof fakeSpawn>['spawnImpl']
  createSession?: (cookie: string, lang?: string) => Promise<InnertubeLike>
  onState?: (cb: (deviceId: string, state: unknown) => void) => () => void
} = {}) {
  const store = createCookieFile('')
  const plugin = createYtmusicPlugin({
    cookieStore: store,
    createSession: extra.createSession ?? (async () => fakeMusic()),
    fetchImpl: extra.fetchImpl ?? (async () => new Response('ok', { status: 200 })) as typeof fetch,
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
  // ce que fait la porte à session sous l'adresse publique : le compte de la requête
  app.decorateRequest('sessionUser', null)
  app.addHook('onRequest', async (req) => {
    const u = req.headers['x-test-user']
    if (typeof u === 'string') req.sessionUser = u
  })
  const routes = plugin.registerRoutes
  expect(routes).toBeTypeOf('function')
  await app.register(async (sub) => routes!.call(plugin, sub), { prefix: '/api/plugins/ytmusic' })
  // la lecture est celle du lecteur COMMUN, auquel le plugin s'est inscrit comme source à `init`
  const music = createMusicPlayer({
    config: { YTM_PUBLISH_BASE: 'http://192.168.1.10:8787' },
    logger: pino({ level: 'silent' }),
    now: () => ctx.clock.now(),
    source: getMusicSource,
    ...(extra.fetchImpl ? { fetchImpl: extra.fetchImpl } : {}),
    ...(extra.execute ? { execute: extra.execute } : {}),
    ...(extra.getDevice ? { getDevice: extra.getDevice } : {}),
    ...(extra.spawnImpl ? { spawnImpl: extra.spawnImpl } : {}),
    ...(extra.onState ? { onState: extra.onState } : {}),
  })
  await app.register(async (sub) => music.registerRoutes(sub), { prefix: '/api/music' })
  await app.ready()
  return { plugin, app, store, ctx, music }
}

function fakeSpawn(format: { filesize?: number } = {}) {
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
          duration: 20,
          formats: [{ url: 'https://googlevideo.example/a.m4a', format_id: '140', ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none', ...format }],
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
    expect(search.json()).toMatchObject({
      artists: [
        { id: 'UCradiohead', name: 'Radiohead' },
        { id: 'UCyorke', name: 'Thom Yorke' },
      ],
      albums: [
        { id: 'MPREb_ok', title: 'OK Computer', releaseType: 'album' },
        { id: 'MPREb_kid', title: 'Kid A', releaseType: 'album' },
      ],
      singles: [{ id: 'MPREb_sing', title: 'Creep', releaseType: 'single' }],
      compilations: [{ id: 'MPREb_comp', title: 'Best Of', releaseType: 'compilation' }],
      tracks: [{ videoId: 'vid1', title: 'Song', artists: ['A'], explicit: true }],
    })
    expect(search.json().artists[0].name).toBe('Radiohead')

    const liked = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/library/liked' })
    expect(liked.json().tracks).toHaveLength(1)

    const pls = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/library/playlists' })
    expect(pls.json().playlists).toHaveLength(1)
    expect(pls.json().playlists[0]).toMatchObject({ id: 'PL1', title: 'Mix' })

    const pl = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/playlists/PL1' })
    expect(pl.json().tracks[0].videoId).toBe('vid1')

    const alb = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/albums/MPREb_ok' })
    expect(alb.json().tracks[0].videoId).toBe('vid1')

    const art = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/artists/UCradio' })
    expect(art.json().tracks[0].videoId).toBe('vid1')
    await app.close()
    await plugin.stop()
  })

  it('surfaces top MusicCardShelf artist even when browseId is only on title runs', async () => {
    const { plugin, app } = await boot({ createSession: async () => fakeMusicJade() })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })
    const search = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/search?q=jäde' })
    const body = search.json()
    const artists = body.artists as Array<{ id: string; name: string; subscribers?: string }>
    expect(artists[0]).toMatchObject({
      id: 'UCjade_real',
      name: 'Jäde',
      subscribers: '12.3K subscribers',
    })
    expect(artists.some((a) => a.id === 'UCjade_fake')).toBe(true)
    expect(body.albums.map((a: { title: string }) => a.title)).toEqual([
      'Romance',
      'Première fois',
      'Sexe & the city',
      'Météo',
    ])
    expect(body.singles.map((a: { title: string; releaseType: string }) => [a.title, a.releaseType])).toEqual([
      ['Sexe & the city', 'ep'],
      ['Comme des garçons', 'single'],
      ['Dsl', 'single'],
      ['Diabolo Grenadine / Rivalise', 'single'],
    ])
    expect(body.compilations[0]).toMatchObject({ title: 'Best of Jäde', explicit: true })
    await app.close()
    await plugin.stop()
  })

  it('fills albums from tracks + getAlbum when the album filter is empty (Samara Cyn)', async () => {
    const session: InnertubeLike = {
      music: {
        async search(_q?: string, filters?: { type?: string }) {
          if (filters?.type === 'artist') {
            return {
              contents: [{
                contents: [
                  { id: 'UCsamara', item_type: 'artist', name: 'Samara Cyn', thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
                ],
              }],
            }
          }
          if (filters?.type === 'album') {
            return {
              contents: [{ type: 'ItemSection', contents: [{ type: 'Message', text: 'No results' }] }],
            }
          }
          if (filters?.type === 'song') {
            return {
              contents: [{
                contents: [
                  {
                    id: 'vidFree', item_type: 'song', title: 'FREE',
                    artists: [{ name: 'Samara Cyn', channel_id: 'UCsamara' }],
                    album: { id: 'MPREb_detour', name: 'Detour' },
                    thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }],
                  },
                  {
                    id: 'vidNomad', item_type: 'song', title: 'Nomad',
                    artists: [{ name: 'Samara Cyn', channel_id: 'UCsamara' }],
                    album: { id: 'MPREb_detour', name: 'Detour' },
                    thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }],
                  },
                  {
                    id: 'vidChrome', item_type: 'song', title: 'Chrome',
                    artists: [{ name: 'Samara Cyn', channel_id: 'UCsamara' }],
                    album: { id: 'MPREb_chrome', name: 'Chrome' },
                    thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }],
                  },
                  {
                    id: 'vidX', item_type: 'song', title: 'oooshxt!',
                    artists: [{ name: 'Samara Cyn', channel_id: 'UCsamara' }],
                    album: { id: 'MPREb_detour', name: 'Detour' },
                    thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }],
                  },
                ],
              }],
            }
          }
          return { contents: [] }
        },
        async getPlaylist() { return { items: [] } },
        async getAlbum(id: string) {
          if (id === 'MPREb_detour') {
            return {
              header: {
                title: { text: 'Detour' },
                subtitle: { text: 'Album · 2026' },
                subtitle_badge: [{ icon_type: 'MUSIC_EXPLICIT_BADGE' }],
              },
              contents: [
                { id: 'vidFree', title: 'FREE' },
                { id: 'vidX', title: 'oooshxt!', badges: [{ icon_type: 'MUSIC_EXPLICIT_BADGE' }] },
                { id: 'vidNomad', title: 'Nomad' },
              ],
            }
          }
          if (id === 'MPREb_teeth') {
            return {
              header: { title: { text: 'brand new teeth' }, subtitle: { text: 'Single · 2025' } },
              contents: [{ id: 'vidTeeth' }],
            }
          }
          if (id === 'MPREb_chrome') {
            return {
              header: { title: { text: 'Chrome' }, subtitle: { text: 'Single · 2024' } },
              contents: [{ id: 'c1' }],
            }
          }
          if (id === 'MPREb_drive') {
            return {
              header: { title: { text: 'The Drive Home' }, subtitle: { text: 'Album · 2024' } },
              contents: Array.from({ length: 10 }, (_, i) => ({ id: `t${i}` })),
            }
          }
          if (id === 'MPREb_backroads') {
            return {
              header: { title: { text: 'backroads' }, subtitle: { text: 'EP · 2025' } },
              contents: Array.from({ length: 5 }, (_, i) => ({ id: `e${i}` })),
            }
          }
          return { contents: [] }
        },
        async getArtist(id: string) {
          expect(id).toBe('UCsamara')
          return {
            sections: [
              {
                type: 'MusicCarouselShelf',
                header: { title: { text: 'Albums' } },
                contents: [
                  { id: 'MPREb_drive', item_type: 'album', title: 'The Drive Home', year: '2024', subtitle: '2024', thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
                ],
              },
              {
                type: 'MusicCarouselShelf',
                header: { title: { text: 'Singles & EPs' } },
                contents: [
                  { id: 'MPREb_backroads', item_type: 'album', title: 'backroads', year: '2025', subtitle: 'EP · 2025', thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
                  { id: 'MPREb_teeth', item_type: 'album', title: 'brand new teeth', year: '2025', subtitle: 'Single · 2025', thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
                  { id: 'MPREb_chrome', item_type: 'album', title: 'Chrome', year: '2024', subtitle: 'Single · 2024', thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }] },
                ],
              },
            ],
          }
        },
        async getLibrary() { return { contents: [] } },
      },
    }
    const { plugin, app } = await boot({ createSession: async () => session })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })
    const body = (await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/search?q=samara%20cyn' })).json()
    const albumTitles = body.albums.map((a: { title: string }) => a.title)
    expect(albumTitles).toEqual(expect.arrayContaining(['Detour', 'The Drive Home']))
    const detour = body.albums.find((a: { title: string }) => a.title === 'Detour')
    expect(detour?.explicit).toBe(true)
    expect(body.tracks.find((t: { videoId: string }) => t.videoId === 'vidX')?.explicit).toBe(true)
    // Année reprise de l'album (absente sur les titres de recherche).
    expect(body.tracks.find((t: { videoId: string }) => t.videoId === 'vidFree')?.year).toBe('2026')
    expect(body.tracks.find((t: { videoId: string }) => t.videoId === 'vidFree')?.explicit).toBe(false)
    expect(body.singles.map((a: { title: string; releaseType: string }) => [a.title, a.releaseType])).toEqual(
      expect.arrayContaining([
        ['backroads', 'ep'],
        ['brand new teeth', 'single'],
        ['Chrome', 'single'],
      ]),
    )
    // FREE sans badge titre → pas explicit (même si Detour l'est).
    expect(body.tracks.find((t: { videoId: string }) => t.videoId === 'vidFree')?.explicit).toBe(false)
    await app.close()
    await plugin.stop()
  })

  /**
   * Une recherche YouTube Music remonte aussi ce que des PARTICULIERS ont mis en ligne : reprises
   * ralenties, concerts filmes au telephone, « type beats », pages de fans. Le catalogue officiel
   * credite ses artistes (page ARTIST), une chaine perso se credite elle-meme (page USER_CHANNEL) :
   * ces items-la ne doivent entrer ni dans les titres, ni dans la rangee Artistes.
   */
  it('keeps official videos and drops what personal channels posted', async () => {
    const credit = (text: string, browseId: string, pageType: string) => ({
      text,
      endpoint: {
        payload: {
          browseId,
          browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } },
        },
      },
    })
    const video = (id: string, title: string, by: ReturnType<typeof credit>) => ({
      id, item_type: 'video', title,
      thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }],
      flex_columns: [
        { title: { runs: [{ text: title }] } },
        { title: { runs: [by, { text: ' \u00b7 ' }, { text: '924K views' }] } },
      ],
    })
    const session: InnertubeLike = {
      music: {
        async search(_q?: string, filters?: { type?: string }) {
          if (filters?.type === 'video') {
            return {
              contents: [{
                contents: [
                  video('vidClip', 'see through (remix)', credit('Samara Cyn', 'UCsamara', 'MUSIC_PAGE_TYPE_ARTIST')),
                  video('vidSlowed', 'samara cyn - highest (slowed + reverb)', credit('velemxnts', 'UCvelem', 'MUSIC_PAGE_TYPE_USER_CHANNEL')),
                  video('vidFan', 'All Points East | Samara Cyn performs', credit('Samara Cyn Fan Page', 'UCfanpage', 'MUSIC_PAGE_TYPE_USER_CHANNEL')),
                ],
              }],
            }
          }
          return { contents: [] }
        },
        async getPlaylist() { return { items: [] } },
        async getLibrary() { return { contents: [] } },
      },
    }
    const { plugin, app } = await boot({ createSession: async () => session })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })
    const body = (await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/search?q=samara%20cyn' })).json()
    expect((body.tracks as Array<{ videoId: string }>).map((t) => t.videoId)).toEqual(['vidClip'])
    // la page de fans porte le nom de la requete : sans le type de page, elle passait pour l'artiste
    expect((body.artists as Array<{ id: string }>).map((a) => a.id)).not.toContain('UCfanpage')
    await app.close()
    await plugin.stop()
  })

  /**
   * RELAIS (le cas normal) : quand yt-dlp annonce un conteneur lisible par les enceintes ET sa
   * taille, la source EST déjà le « fichier » — on repasse ses octets, ffmpeg n'entre pas en jeu.
   */
  it('relays the source untouched when it announces a size, and passes byte ranges through', async () => {
    const SIZE = 4_373_288
    const ff = fakeSpawn({ filesize: SIZE })
    const player: DeviceDescriptor = {
      id: 'sonos:1', pluginId: 'sonos', externalId: '1', kind: 'media_player', name: 'Bureau',
      capabilities: ['playback', 'play_url', 'seek'], meta: {},
    } as DeviceDescriptor
    const commands: Array<{ id: string; cmd: Command }> = []
    const asked: Array<string | undefined> = []
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.range
      asked.push(range)
      if (String(url).includes('4416')) return new Response('ok', { status: 200 })
      return range
        ? new Response('partiel', { status: 206, headers: { 'content-length': '7', 'content-range': `bytes 1000-1006/${SIZE}` } })
        : new Response('tout', { status: 200, headers: { 'content-length': String(SIZE) } })
    }) as unknown as typeof fetch
    const { plugin, app } = await boot({
      spawnImpl: ff.spawnImpl,
      fetchImpl,
      getDevice: (id) => (id === player.id ? { descriptor: player } : undefined),
      execute: async (id, cmd) => { commands.push({ id, cmd }) },
    })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })
    await app.inject({
      method: 'POST', url: '/api/music/play',
      payload: { source: 'ytmusic', id: 'vid1', deviceId: player.id, title: 'Song', durationS: 265 },
    })
    // l'extension de l'URL n'est pas décorative : elle décide du type annoncé dans le DIDL Sonos
    const url = (commands[0]!.cmd as { url: string }).url
    expect(url).toMatch(/\/raw\/[0-9a-f]+\.m4a$/)
    // ffmpeg n'a pas été lancé : seul yt-dlp a tourné
    const spawned = (ff.spawnImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string[]]>
    expect(spawned.every(([, args]) => args.includes('-J'))).toBe(true)

    const file = url.split('/').pop()!
    const head = await app.inject({ method: 'HEAD', url: `/api/music/raw/${file}` })
    expect(head.statusCode).toBe(200)
    expect(head.headers['content-length']).toBe(String(SIZE))
    expect(head.headers['content-type']).toBe('audio/mp4')
    expect(head.headers['accept-ranges']).toBe('bytes')

    const whole = await app.inject({ method: 'GET', url: `/api/music/raw/${file}` })
    expect(whole.statusCode).toBe(200)
    expect(whole.headers['content-length']).toBe(String(SIZE))

    // la plage demandée par l'enceinte est repassée telle quelle à la source
    const part = await app.inject({ method: 'GET', url: `/api/music/raw/${file}`, headers: { range: 'bytes=1000-1006' } })
    expect(part.statusCode).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 1000-1006/${SIZE}`)
    expect(asked).toContain('bytes=1000-1006')

    // la session dit ce qu'elle sert : le format de la SOURCE, pas une sortie à nous
    const sess = (await app.inject({ method: 'GET', url: '/api/music/sessions' })).json().sessions
    expect(sess[0].quality).toMatchObject({ mime: 'audio/mp4', sampleRateHz: null, source: { ext: 'm4a', formatId: '140' } })

    await app.close()
    await plugin.stop()
  })

  it('recovers the main artist from album channel ids when the top card is missing', async () => {
    const session: InnertubeLike = {
      music: {
        async search(_q?: string, filters?: { type?: string }) {
          if (filters?.type === 'artist') {
            return {
              contents: [{
                contents: [
                  { id: 'UCjade_fake', item_type: 'artist', name: 'JÄDE', subscribers: '10 subscribers', thumbnail: [] },
                ],
              }],
            }
          }
          if (filters?.type === 'album') {
            return {
              contents: [{
                contents: [
                  {
                    id: 'MPREb_r',
                    item_type: 'album',
                    title: 'Romance',
                    artists: [{ name: 'Jäde', channel_id: 'UCjade_real' }],
                    subtitle: { text: 'Album · Jäde · 2021' },
                    thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }],
                  },
                  {
                    id: 'MPREb_m',
                    item_type: 'album',
                    title: 'Météo',
                    artists: [{ name: 'Jäde', channel_id: 'UCjade_real' }],
                    subtitle: { text: 'Album · Jäde · 2022' },
                    thumbnail: [{ url: 'https://i.ytimg.com/a.jpg', width: 60 }],
                  },
                ],
              }],
            }
          }
          if (filters?.type === 'song') return { contents: [] }
          return { contents: [] }
        },
        async getPlaylist() { return { items: [] } },
        async getLibrary() { return { contents: [] } },
      },
    }
    const { plugin, app } = await boot({ createSession: async () => session })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })
    const search = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/search?q=jäde' })
    const ids = (search.json().artists as Array<{ id: string }>).map((a) => a.id)
    expect(ids).toContain('UCjade_real')
    expect(ids).toContain('UCjade_fake')
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
      execute: async (id, cmd) => {
        if (cmd.type !== 'media_player.play_url') return
        const { url, title, artist, artUrl } = cmd
        played.push({ id, url, meta: { ...(title ? { title } : {}), ...(artist ? { artist } : {}), ...(artUrl ? { artUrl } : {}) } })
      },
    })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })
    const r = await app.inject({
      method: 'POST', url: '/api/music/play',
      payload: {
        source: 'ytmusic', id: 'vid1',
        deviceId: player.id,
        title: 'Song',
        artist: 'A',
        artUrl: 'https://i.ytimg.com/a.jpg',
      },
    })
    expect(r.statusCode).toBe(200)
    expect(played).toHaveLength(1)
    expect(played[0]!.id).toBe(player.id)
    expect(played[0]!.url).toMatch(/^http:\/\/192\.168\.1\.10:8787\/api\/music\/stream\/[a-f0-9]+$/)
    expect(played[0]!.meta).toEqual({ title: 'Song', artist: 'A', artUrl: 'https://i.ytimg.com/a.jpg' })
    await app.close()
    await plugin.stop()
  })

  /**
   * REPLI : la source de ce faux yt-dlp n'annonce AUCUNE taille, elle n'est donc pas relayable —
   * c'est le MP3 à trames fixes qui fabrique le « fichier » à partir de la durée.
   */
  it('serves the track as a sized MP3 file (HEAD, ranges), transfers with a native seek, and drops a session the player left', async () => {
    const office: DeviceDescriptor = { ...player, id: 'sonos:office', pluginId: 'sonos', externalId: 'office', name: 'Bureau' }
    const commands: { id: string; cmd: Command }[] = []
    const ff = fakeSpawn()
    const ctxRef = { clock: new ManualClock(0) as { now(): number } }
    type Dev = { descriptor: DeviceDescriptor; state?: unknown } | undefined
    const deviceOf = (id: string): Dev => {
      if (id === player.id) return { descriptor: player, state: { kind: 'media_player', playback: 'playing', nowPlaying: { title: 'Song' } } }
      // le Sonos publie sa position dans le morceau ; relevé il y a 1,5 s
      if (id === office.id) return { descriptor: office, state: { kind: 'media_player', playback: 'playing', updatedAt: ctxRef.clock.now() - 1_500, nowPlaying: { title: 'Song', positionS: 42.7 } } }
      return undefined
    }
    const devices = { get: deviceOf }
    const { plugin, app, ctx } = await boot({
      spawnImpl: ff.spawnImpl,
      getDevice: (id) => devices.get(id),
      execute: async (id, cmd) => { commands.push({ id, cmd }) },
    })
    ctxRef.clock = ctx.clock
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })

    // rien ne joue encore : pas de transfert possible
    expect((await app.inject({ method: 'POST', url: '/api/music/transfer', payload: { fromDeviceId: office.id, toDeviceId: player.id } })).statusCode).toBe(404)

    // la durée vient de yt-dlp (20 s), pas du catalogue (265 s)
    await app.inject({
      method: 'POST', url: '/api/music/play',
      payload: { source: 'ytmusic', id: 'vid1', deviceId: office.id, title: 'Song', artist: 'A', artUrl: 'https://i.ytimg.com/a.jpg', durationS: 265 },
    })
    expect(commands.map((c) => c.cmd.type)).toEqual(['media_player.play_url'])
    const sessions = (await app.inject({ method: 'GET', url: '/api/music/sessions' })).json().sessions
    expect(sessions).toEqual([expect.objectContaining({ deviceId: office.id, durationS: 20, title: 'Song', artist: 'A' })])
    expect(sessions[0]).not.toHaveProperty('startS')

    // un « fichier » : 20 s = 834 trames de 960 octets (320 kb/s à 48 kHz)
    const LENGTH = Math.ceil(20 / (1152 / 48000)) * 960
    const sid = (commands[0]!.cmd as { url: string }).url.split('/').pop()!
    const head = await app.inject({ method: 'HEAD', url: `/api/music/stream/${sid}` })
    expect(head.statusCode).toBe(200)
    expect(head.headers['content-length']).toBe(String(LENGTH))
    expect(head.headers['accept-ranges']).toBe('bytes')
    const ffArgs = () => (ff.spawnImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => !(c[1] as string[]).includes('-J') && !(c[1] as string[]).includes('lavfi')).at(-1)![1] as string[]
    // tout le fichier : ffmpeg depuis le début, taille promise tenue (la fausse sortie ne fait que 3 octets : on complète)
    const whole = await app.inject({ method: 'GET', url: `/api/music/stream/${sid}` })
    expect(whole.statusCode).toBe(200)
    expect(whole.headers['content-length']).toBe(String(LENGTH))
    expect(whole.rawPayload.length).toBe(LENGTH)
    expect(ffArgs()).not.toContain('-ss')
    expect(ffArgs()).toContain('libmp3lame')
    // une plage : ffmpeg lancé à la trame (96 000 octets = 100 trames = 2,4 s), 206 avec la bonne étendue
    const part = await app.inject({ method: 'GET', url: `/api/music/stream/${sid}`, headers: { range: `bytes=96000-` } })
    expect(part.statusCode).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 96000-${LENGTH - 1}/${LENGTH}`)
    expect(part.rawPayload.length).toBe(LENGTH - 96000)
    const args = ffArgs()
    expect(Number(args[args.indexOf('-ss') + 1])).toBeCloseTo(2.4, 3)
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    // plage hors du fichier : on sert tout (200), l'enceinte s'y retrouve
    expect((await app.inject({ method: 'GET', url: `/api/music/stream/${sid}`, headers: { range: `bytes=${LENGTH + 10}-` } })).statusCode).toBe(200)

    // transfert : même fichier sur la cible, déplacement natif à la position de la source
    // (42,7 + 1,5 s depuis le relevé), puis la source s'arrête
    commands.length = 0
    const r = await app.inject({ method: 'POST', url: '/api/music/transfer', payload: { fromDeviceId: office.id, toDeviceId: player.id } })
    expect(r.statusCode).toBe(200)
    expect(r.json().positionS).toBeCloseTo(44.2, 3)
    expect(commands.map((c) => [c.id, c.cmd.type])).toEqual([
      [player.id, 'media_player.play_url'],
      [player.id, 'media_player.seek'],
      [office.id, 'media_player.stop'],
    ])
    // la cible se place une seconde plus loin : le temps qu'elle démarre
    expect((commands[1]!.cmd as { positionS: number }).positionS).toBeCloseTo(45.2, 3)
    expect(commands[0]!.cmd).toMatchObject({ title: 'Song', artist: 'A', artUrl: 'https://i.ytimg.com/a.jpg' })
    const after = (await app.inject({ method: 'GET', url: '/api/music/sessions' })).json().sessions
    expect(after).toEqual([expect.objectContaining({ deviceId: player.id, source: 'ytmusic', id: 'vid1', durationS: 20 })])

    // l'enceinte joue autre chose (une radio lancée ailleurs) : la session ne compte plus, ni pour l'UI ni pour un transfert
    ;(ctx.clock as ManualClock).advance(6_000)
    const radio: Dev = { descriptor: player, state: { kind: 'media_player', playback: 'playing', nowPlaying: { title: 'franceinfo' } } }
    devices.get = (id) => (id === player.id ? radio : deviceOf(id))
    expect((await app.inject({ method: 'GET', url: '/api/music/sessions' })).json().sessions).toEqual([])
    expect((await app.inject({ method: 'POST', url: '/api/music/transfer', payload: { fromDeviceId: player.id, toDeviceId: office.id } })).statusCode).toBe(404)
    devices.get = deviceOf

    // relancer un autre titre là où l'un des nôtres joue : pause immédiate, puis le nouveau flux
    commands.length = 0
    await app.inject({ method: 'POST', url: '/api/music/play', payload: { source: 'ytmusic', id: 'vid2', deviceId: player.id, title: 'Next' } })
    expect(commands.map((c) => c.cmd.type)).toEqual(['media_player.pause', 'media_player.play_url'])
    await app.close()
    await plugin.stop()
  })

  it('chains a queue at the end of each track, repeats, skips, and follows a transfer', async () => {
    const office: DeviceDescriptor = { ...player, id: 'sonos:office', pluginId: 'sonos', externalId: 'office', name: 'Bureau', capabilities: ['playback', 'play_url', 'seek'] }
    const commands: { id: string; cmd: Command }[] = []
    const ff = fakeSpawn({ filesize: 400_000 })
    const states = new Map<string, { kind: 'media_player'; playback: string; nowPlaying?: { positionS?: number } | null }>([
      [office.id, { kind: 'media_player', playback: 'idle', nowPlaying: null }],
      [player.id, { kind: 'media_player', playback: 'idle', nowPlaying: null }],
    ])
    let feed: ((id: string, state: unknown) => void) | null = null
    const { plugin, app, ctx, music } = await boot({
      spawnImpl: ff.spawnImpl,
      getDevice: (id) => (id === office.id ? { descriptor: office, state: states.get(id) } : id === player.id ? { descriptor: player, state: states.get(id) } : undefined),
      execute: async (id, cmd) => { commands.push({ id, cmd }) },
      onState: (cb) => { feed = cb; return () => { feed = null } },
    })
    const clock = ctx.clock as ManualClock
    const say = (id: string, playback: string, positionS?: number) => {
      const st = { kind: 'media_player' as const, playback, nowPlaying: playback === 'idle' ? null : { ...(positionS !== undefined ? { positionS } : {}) } }
      states.set(id, st)
      feed?.(id, st)
    }
    const played = () => commands.filter((c) => c.cmd.type === 'media_player.play_url').map((c) => (c.cmd as { title?: string }).title)
    const ytdlpRuns = () => (ff.spawnImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[1] as string[]).includes('-J')).length
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url: `/api/music${url}`, payload })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })

    const tracks = ['A', 'B', 'C'].map((title) => ({ source: 'ytmusic', id: `v${title}`, title }))
    const r = await post('/queue', { deviceId: office.id, tracks })
    expect(r.statusCode).toBe(200)
    expect(r.json().queue).toMatchObject({ index: 0, repeat: 'off' })
    expect(played()).toEqual(['A'])
    // le suivant est résolu d'avance, pendant que le premier joue
    await vi.waitFor(() => expect(ytdlpRuns()).toBe(2))
    expect((await app.inject({ method: 'GET', url: '/api/music/sessions' })).json().sessions[0].queue).toEqual({ length: 3, index: 0, repeat: 'off' })

    // un arrêt en milieu de morceau (20 s au total) n'enchaîne pas
    clock.advance(4_000); say(office.id, 'playing', 5)
    clock.advance(2_000); say(office.id, 'idle')
    expect(played()).toEqual(['A'])

    // fin de piste : entendu à 17 s, à l'arrêt 2 s plus tard → B, sans nouvel aller yt-dlp
    say(office.id, 'playing', 17)
    clock.advance(2_000); say(office.id, 'idle')
    await vi.waitFor(() => expect(played()).toEqual(['A', 'B']))
    expect(ytdlpRuns()).toBe(3) // C, préparé à son tour

    // répéter une fois : B rejoue sur le même flux, puis la file reprend
    expect((await post('/queue/repeat', { deviceId: office.id, mode: 'once' })).json().repeat).toBe('once')
    clock.advance(4_000); say(office.id, 'playing', 18)
    clock.advance(1_000); say(office.id, 'idle')
    await vi.waitFor(() => expect(played()).toEqual(['A', 'B', 'B']))
    expect(ytdlpRuns()).toBe(3)
    expect((await app.inject({ method: 'GET', url: `/api/music/queue?deviceId=${office.id}` })).json()).toMatchObject({ index: 1, repeat: 'off' })

    // ajouter juste après le courant, retirer, sauter
    clock.advance(4_000); say(office.id, 'playing', 1)
    const added = await post('/queue/add', { deviceId: office.id, tracks: [{ source: 'ytmusic', id: 'vX', title: 'X' }], where: 'next' })
    expect(added.json()).toMatchObject({ started: false, queue: { index: 1 } })
    expect(added.json().queue.items.map((t: { title: string }) => t.title)).toEqual(['A', 'B', 'X', 'C'])
    expect((await post('/queue/remove', { deviceId: office.id, index: 1 })).statusCode).toBe(400) // celui qui joue
    expect((await post('/queue/remove', { deviceId: office.id, index: 0 })).json()).toMatchObject({ index: 0 })
    expect((await post('/queue/next', { deviceId: office.id })).json()).toMatchObject({ index: 1 })
    expect(played().at(-1)).toBe('X')

    // précédent : au début du titre s'il joue depuis un moment, sinon le titre d'avant
    clock.advance(4_000); say(office.id, 'playing', 30)
    commands.length = 0
    await post('/queue/previous', { deviceId: office.id })
    expect(commands.map((c) => c.cmd)).toEqual([{ type: 'media_player.seek', positionS: 0 }])
    say(office.id, 'playing', 1)
    await post('/queue/previous', { deviceId: office.id })
    expect(played()).toEqual(['B'])

    // transfert : la file suit le titre sur la cible
    clock.advance(4_000); say(office.id, 'playing', 2)
    expect((await post('/transfer', { fromDeviceId: office.id, toDeviceId: player.id })).statusCode).toBe(200)
    say(office.id, 'idle')
    states.set(player.id, { kind: 'media_player', playback: 'playing', nowPlaying: { positionS: 3 } })
    expect((await app.inject({ method: 'GET', url: `/api/music/queue?deviceId=${player.id}` })).json()).toMatchObject({ index: 0 })
    expect((await app.inject({ method: 'GET', url: `/api/music/queue?deviceId=${office.id}` })).statusCode).toBe(404)
    // … et y enchaîne en bout de titre
    clock.advance(4_000); say(player.id, 'playing', 18)
    clock.advance(2_000); say(player.id, 'idle')
    await vi.waitFor(() => expect(played().at(-1)).toBe('X'))

    // un autre titre lancé sur ce lecteur remplace la file
    await post('/play', { source: 'ytmusic', id: 'vZ', deviceId: player.id, title: 'Z' })
    expect((await app.inject({ method: 'GET', url: '/api/music/sessions' })).json().sessions[0].queue).toEqual({ length: 1, index: 0, repeat: 'off' })
    await app.close()
    await plugin.stop()
    music.stop()                           // c'est le lecteur commun qui suivait les enceintes
    expect(feed).toBeNull()
  })

  it('opens a browser session without any player, and transfers both ways with the queue', async () => {
    const office: DeviceDescriptor = { ...player, id: 'sonos:office', pluginId: 'sonos', externalId: 'office', name: 'Bureau', capabilities: ['playback', 'play_url', 'seek'] }
    const commands: { id: string; cmd: Command }[] = []
    const ff = fakeSpawn({ filesize: 400_000 })
    const states = new Map<string, unknown>([[office.id, { kind: 'media_player', playback: 'idle', nowPlaying: null }]])
    const { plugin, app, ctx } = await boot({
      spawnImpl: ff.spawnImpl,
      getDevice: (id) => (id === office.id ? { descriptor: office, state: states.get(id) } : undefined),
      execute: async (id, cmd) => { commands.push({ id, cmd }) },
      onState: () => () => {},
    })
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url: `/api/music${url}`, payload })
    const ytdlpRuns = () => (ff.spawnImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[1] as string[]).includes('-J')).length
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })
    const local = 'local:tablette-1234'

    // le navigateur reçoit un chemin RELATIF vers le relais ; aucune commande n'est partie, aucune enceinte
    const opened = await post('/local', { source: 'ytmusic', id: 'vA', title: 'A', clientId: 'tablette-1234', next: { source: 'ytmusic', id: 'vB' } })
    expect(opened.statusCode).toBe(200)
    expect(opened.json().streamUrl).toMatch(/^\/api\/music\/raw\/[0-9a-f]+\.m4a$/)
    expect(opened.json().session).toMatchObject({ deviceId: local, source: 'ytmusic', id: 'vA', durationS: 20, title: 'A' })
    expect(commands).toEqual([])
    // le suivant est résolu d'avance
    await vi.waitFor(() => expect(ytdlpRuns()).toBe(2))
    // une lecture locale n'est la session d'aucune enceinte
    expect((await app.inject({ method: 'GET', url: '/api/music/sessions' })).json().sessions).toEqual([])
    expect((await post('/local', { source: 'ytmusic', id: 'vA', clientId: 'x' })).statusCode).toBe(400)

    // navigateur → enceinte : la position vient du navigateur, sa file passe au serveur
    expect((await post('/transfer', { fromDeviceId: local, toDeviceId: office.id })).statusCode).toBe(400)
    const tracks = ['A', 'B', 'C'].map((title) => ({ source: 'ytmusic', id: `v${title}`, title }))
    const out = await post('/transfer', { fromDeviceId: local, toDeviceId: office.id, positionS: 7, queue: { tracks, index: 0, repeat: 'once' } })
    expect(out.statusCode).toBe(200)
    expect(out.json().queue).toMatchObject({ index: 0, repeat: 'once' })
    expect(commands.map((c) => c.cmd.type)).toEqual(['media_player.play_url', 'media_player.seek'])
    expect(commands[1]!.cmd).toEqual({ type: 'media_player.seek', positionS: 8 })
    // pas de nouvelle résolution : l'URL de la session du navigateur a resservi
    expect(ytdlpRuns()).toBe(2)

    // enceinte → navigateur : l'enceinte s'arrête, la file revient au navigateur
    states.set(office.id, { kind: 'media_player', playback: 'playing', nowPlaying: { positionS: 42, title: 'A' }, updatedAt: (ctx.clock as ManualClock).now() })
    commands.length = 0
    const back = await post('/transfer', { fromDeviceId: office.id, toDeviceId: local })
    expect(back.statusCode).toBe(200)
    expect(back.json()).toMatchObject({ positionS: 42, session: { deviceId: local, source: 'ytmusic', id: 'vA' }, queue: { index: 0, repeat: 'once' } })
    expect(back.json().queue.items).toHaveLength(3)
    expect(back.json().streamUrl).toMatch(/^\/api\/music\/raw\//)
    expect(commands).toEqual([{ id: office.id, cmd: { type: 'media_player.stop' } }])
    expect((await app.inject({ method: 'GET', url: `/api/music/queue?deviceId=${office.id}` })).statusCode).toBe(404)
    await app.close()
    await plugin.stop()
  })

  it('waits for the pause of the playing track before sending a prefetched one', async () => {
    const office: DeviceDescriptor = { ...player, id: 'sonos:office', pluginId: 'sonos', externalId: 'office', name: 'Bureau' }
    const steps: string[] = []
    const ff = fakeSpawn({ filesize: 400_000 })
    const { plugin, app, ctx } = await boot({
      spawnImpl: ff.spawnImpl,
      getDevice: (id) => (id === office.id ? { descriptor: office, state: { kind: 'media_player', playback: 'playing', nowPlaying: { positionS: 5 } } } : undefined),
      // un Sonos met quelques dizaines de ms à répondre à Pause : le titre suivant ne doit pas le doubler
      execute: async (_id, cmd) => {
        steps.push(cmd.type)
        if (cmd.type === 'media_player.pause') { await new Promise((r) => setTimeout(r, 30)); steps.push('paused') }
      },
      onState: () => () => {},
    })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })
    await app.inject({ method: 'POST', url: '/api/music/queue', payload: { deviceId: office.id, tracks: [{ source: 'ytmusic', id: 'v1', title: 'A' }, { source: 'ytmusic', id: 'v2', title: 'B' }] } })
    const ytdlp = () => (ff.spawnImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[1] as string[]).includes('-J')).length
    await vi.waitFor(() => expect(ytdlp()).toBe(2))
    ;(ctx.clock as ManualClock).advance(6_000)
    steps.length = 0
    expect((await app.inject({ method: 'POST', url: '/api/music/queue/next', payload: { deviceId: office.id } })).statusCode).toBe(200)
    expect(steps).toEqual(['media_player.pause', 'paused', 'media_player.play_url'])
    await app.close()
    await plugin.stop()
  })

  it('gives album tracks the album art, artist and title from the header (the rows carry neither)', async () => {
    const music = fakeMusic()
    music.music.getAlbum = async () => ({
      header: {
        type: 'MusicResponsiveHeader',
        title: { text: 'OK Computer' },
        subtitle: { runs: [{ text: 'Album' }, { text: ' • ' }, { text: '1997' }] },
        strapline_text_one: { text: 'Radiohead' },
        thumbnail: { type: 'MusicThumbnail', contents: [{ url: 'https://yt3.googleusercontent.com/ok=w544-h544', width: 544, height: 544 }] },
        description: { type: 'MusicDescriptionShelf', description: { text: ' OK Computer est le troisième album de Radiohead. ' } },
      },
      // telle que YouTube Music la rend : ni artistes, ni vignette, un compteur d'écoutes en sous-titre
      contents: [{ id: 'vAirbag', item_type: 'song', title: 'Airbag', duration: { seconds: 284 }, subtitle: { text: '19M plays' } }],
    })
    const { plugin, app } = await boot({ createSession: async () => music })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })
    const r = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/albums/MPREb_ok' })
    const [track] = r.json().tracks
    expect(track).toMatchObject({ videoId: 'vAirbag', artists: ['Radiohead'], album: 'OK Computer', year: '1997' })
    expect(track.artUrl).toMatch(/^https:\/\/yt3\.googleusercontent\.com\/ok=/)
    // le texte de présentation de l'en-tête, nettoyé
    expect(r.json().description).toBe('OK Computer est le troisième album de Radiohead.')

    // même chose pour un artiste : la présentation de son en-tête (`MusicImmersiveHeader`)
    // … et seuls ses TITRES : la page range aussi albums, playlists et artistes proches dans ses rangées
    music.music.getArtist = async () => ({
      header: { type: 'MusicImmersiveHeader', description: { text: 'Radiohead est un groupe de rock britannique.' } },
      sections: [{ contents: [
        { id: 'vCreep00001', item_type: 'song', title: 'Creep', artists: [{ name: 'Radiohead' }] },
        // le clip de la même chanson, dans la rangée « Clips » : une seule fois dans la liste
        { id: 'vCreepClip1', item_type: 'video', title: 'Creep', artists: [{ name: 'Radiohead' }] },
        { id: 'MPREb_kidA', item_type: 'album', title: 'Kid A' },
        { id: 'VLRDCLAK5uy_radiohead', item_type: 'playlist', title: 'This Is Radiohead' },
        { id: 'UCthomyorke', item_type: 'artist', title: 'Thom Yorke' },
        // sans type : un id de chaîne (24 caractères) n'est pas un titre
        { id: 'UCr_iyUANcn9OX_yy9piYoLw', title: 'Radiohead' },
      ] }],
    })
    const ar = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/artists/UCradiohead?hl=fr' })
    expect(ar.json().description).toBe('Radiohead est un groupe de rock britannique.')
    expect(ar.json().tracks.map((t: { videoId: string }) => t.videoId)).toEqual(['vCreep00001'])
    await app.close()
    await plugin.stop()
  })

  it('serves moods & genres in the asked language, and a category page without clips nor user playlists', async () => {
    const langs: Array<string | undefined> = []
    const btn = (text: string, params: string) => ({ musicNavigationButtonRenderer: { buttonText: { runs: [{ text }] }, solid: { leftStripeColor: 4288988671 }, clickCommand: { browseEndpoint: { params } } } })
    const grid = (title: string, items: unknown[]) => ({ gridRenderer: { header: { gridHeaderRenderer: { title: { runs: [{ text: title }] } } }, items } })
    let browses = 0
    let withNew = false
    const parsedFor: Array<string | undefined> = []
    const browsedIds: string[] = []
    const session = (lang?: string): InnertubeLike => ({
      ...fakeMusic(),
      async browseRaw() {
        browses++
        return { contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
          grid(lang === 'fr' ? 'Humeurs et moments' : 'Moods & moments', [btn(lang === 'fr' ? 'Calme' : 'Chill', 'p-calm')]),
          grid('Genres', [btn('Jazz', 'p-jazz'), ...(withNew ? [btn('Nouveau', 'p-new')] : [])]),
        ] } } } }] } } }
      },
      async browseParsed(id: string, params?: string) {
        browsedIds.push(id)
        if (id === 'FEmusic_moods_and_genres_category') parsedFor.push(params)
        // la page « Voir tout » des nouveautés : une grille de 120 albums, en une réponse
        if (id === 'FEmusic_new_releases_albums') {
          return { contents: { contents: [{ type: 'Grid', items: Array.from({ length: 120 }, (_, i) => ({ type: 'MusicTwoRowItem', item_type: 'album', id: `MPREb_new${i}`, title: { text: `Nouveau ${i}` } })) }] } }
        }
        return {
          contents: { contents: [
            { type: 'MusicCarouselShelf', header: { title: { text: 'Titres' } }, contents: [
              { type: 'MusicResponsiveListItem', item_type: 'song', id: 'vSo', title: 'So What', artists: [{ name: 'Miles Davis' }], duration: { seconds: 562 }, badges: [{ icon_type: 'MUSIC_EXPLICIT_BADGE' }] },
            ] },
            { type: 'MusicCarouselShelf', header: { title: { text: 'Playlists' } }, contents: [
              { type: 'MusicTwoRowItem', item_type: 'playlist', id: 'VLRDCLAK5uy_jazz', title: { text: 'Jazz essentiel' }, thumbnail: [{ url: 'https://lh3.googleusercontent.com/jazz=w226-h226', width: 226 }] },
              { type: 'MusicTwoRowItem', item_type: 'playlist', id: 'VLPLcommunity', title: { text: 'Mon jazz à moi' } },
              // la même playlist une seconde fois, même id (vu dans la grille des nouveautés)
              { type: 'MusicTwoRowItem', item_type: 'playlist', id: 'VLRDCLAK5uy_jazz', title: { text: 'Jazz essentiel' } },
            ] },
            { type: 'MusicCarouselShelf', header: { title: { text: 'Clips musicaux' } }, contents: [
              { type: 'MusicTwoRowItem', item_type: 'video', id: 'vClip', title: { text: 'Live' } },
            ] },
            { type: 'MusicCarouselShelf', header: { title: { text: 'Albums' } }, contents: [
              { type: 'MusicTwoRowItem', item_type: 'album', id: 'MPREb_kind', title: { text: 'Kind of Blue' }, artists: [{ name: 'Miles Davis' }] },
              // badges dans l'enveloppe `SuperParsedResult` de youtubei.js (vraie réponse `browse`) : sans clés, lue par ses méthodes
              { type: 'MusicTwoRowItem', item_type: 'album', id: 'MPREb_wrapped', title: { text: 'Explicite' },
                badges: { is_null: false, is_array: true, is_node: false, array: () => [{ icon_type: 'MUSIC_EXPLICIT_BADGE' }], item: () => null } },
            ] },
          ] },
        }
      },
    })
    const { plugin, app, ctx } = await boot({ createSession: async (_c, lang) => { langs.push(lang); return session(lang) } })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })

    const fr = (await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/explore?hl=fr' })).json()
    expect(fr.moods).toEqual({ title: 'Humeurs et moments', categories: [{ title: 'Calme', params: 'p-calm', color: '#a4c5ff' }] })
    expect(fr.genres.categories[0].title).toBe('Jazz')
    expect(langs).toContain('fr')
    // en cache : la même langue ne repart pas chez YouTube ; une autre si
    await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/explore?hl=fr' })
    expect(browses).toBe(1)
    const en = (await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/explore?hl=en' })).json()
    expect(en.moods.categories[0].title).toBe('Chill')
    // une langue mal formée est ignorée, pas transmise
    await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/explore?hl=../x' })
    expect(langs).not.toContain('../x')

    const cat = await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/explore/category?params=p-jazz&hl=fr' })
    expect(cat.statusCode).toBe(200)
    const body = cat.json()
    expect(body.shelves.map((sh: { title: string }) => sh.title)).toEqual(['Titres', 'Playlists', 'Albums'])
    expect(body.shelves[0].tracks[0]).toMatchObject({ videoId: 'vSo', artists: ['Miles Davis'], explicit: true })
    expect(body.shelves[1].playlists.map((p: { title: string }) => p.title)).toEqual(['Jazz essentiel'])
    expect(body.shelves[2].albums[0]).toMatchObject({ id: 'MPREb_kind', title: 'Kind of Blue' })
    expect(body.shelves[2].albums[1]).toMatchObject({ id: 'MPREb_wrapped', explicit: true })
    expect((await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/explore/category' })).statusCode).toBe(400)
    // les nouveautés : même lecture en rangées, sur `FEmusic_new_releases`
    const fresh = (await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/explore/new?hl=fr' })).json()
    expect(fresh.shelves.map((sh: { title: string }) => sh.title)).toEqual(['Titres', 'Playlists', 'Albums'])
    expect(browsedIds).toEqual(expect.arrayContaining(['FEmusic_new_releases', 'FEmusic_new_releases_albums']))
    // la rangée d'albums prend la liste complète de « Voir tout », en entier
    expect(fresh.shelves[2].albums).toHaveLength(120)
    expect(fresh.shelves[2].albums[0].title).toBe('Nouveau 0')

    // pochettes : la page des catégories n'en a pas, on les prend dans chaque page de catégorie
    parsedFor.length = 0
    const covers = (await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/explore/covers?hl=fr' })).json().covers
    expect(Object.keys(covers).sort()).toEqual(['p-calm', 'p-jazz'])
    expect(covers['p-jazz']).toHaveLength(1)
    expect(covers['p-jazz'][0]).toMatch(/googleusercontent\.com\/jazz=/)
    // Jazz était déjà lu (cache des catégories) : seule Calme repart chez YouTube, et plus rien ensuite
    expect(parsedFor).toEqual(['p-calm'])
    await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/explore/covers?hl=fr' })
    expect(parsedFor).toEqual(['p-calm'])
    // « Pour vous » tourne : une catégorie apparaît à la relecture de la page, SEULE elle est lue
    withNew = true
    ;(ctx.clock as ManualClock).advance(11 * 60_000)
    const later = (await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/explore/covers?hl=fr' })).json().covers
    expect(Object.keys(later).sort()).toEqual(['p-calm', 'p-jazz', 'p-new'])
    expect(parsedFor).toEqual(['p-calm', 'p-new'])
    await app.close()
    await plugin.stop()
  })

  it('keeps a relayed session when the Sonos publishes the file name as the title', async () => {
    const office: DeviceDescriptor = { ...player, id: 'sonos:office', pluginId: 'sonos', externalId: 'office', name: 'Bureau' }
    const ff = fakeSpawn({ filesize: 400_000 })
    const commands: Command[] = []
    let title = ''
    const { plugin, app, ctx } = await boot({
      spawnImpl: ff.spawnImpl,
      getDevice: (id) => (id === office.id ? { descriptor: office, state: { kind: 'media_player', playback: 'playing', nowPlaying: { title } } } : undefined),
      execute: async (_id, cmd) => { commands.push(cmd) },
    })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })
    await app.inject({ method: 'POST', url: '/api/music/play', payload: { source: 'ytmusic', id: 'v1', deviceId: office.id, title: 'Madwoman' } })
    // le relais s'appelle `<sid>.m4a`, et c'est ce que le Sonos affiche faute d'avoir lu le DIDL
    title = (commands[0] as { url: string }).url.split('/').pop()!
    expect(title).toMatch(/^[0-9a-f]{24}\.m4a$/)
    ;(ctx.clock as ManualClock).advance(6_000)
    expect((await app.inject({ method: 'GET', url: '/api/music/sessions' })).json().sessions).toEqual([expect.objectContaining({ title: 'Madwoman' })])
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

describe('ytmusic accounts', () => {
  const alice = { 'x-test-user': 'alice' }

  it('gives a signed-in user the public catalog without a cookie, and their own once linked', async () => {
    const cookies: string[] = []
    const yt = fakeSpawn()
    const { plugin, app, store } = await boot({
      createSession: async (c) => { cookies.push(c); return fakeMusic() },
      spawnImpl: yt.spawnImpl,
      getDevice: (id) => (id === player.id ? { descriptor: player } : undefined),
      execute: async () => {},
    })
    const ytdlpArgs = () => (yt.spawnImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as string[]).filter((args) => args.includes('-J'))

    // rien de relié : anonyme — catalogue public, rien de personnel, pas d'import du navigateur du serveur
    expect((await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/status', headers: alice })).json())
      .toMatchObject({ user: 'alice', linked: false, anonymous: true, browsers: [] })
    // son badge : anonyme, ça marche — pas « à relier » comme celui de la maison
    expect(await plugin.healthFor!('alice')).toMatchObject({ status: 'ok', detail: expect.stringContaining('anonymous') })
    expect((await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/search?q=jade', headers: alice })).statusCode).toBe(200)
    expect(cookies).toEqual([''])
    expect((await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/library/liked', headers: alice })).statusCode).toBeGreaterThanOrEqual(400)
    expect((await app.inject({ method: 'POST', url: '/api/plugins/ytmusic/cookie/from-browser', headers: alice, payload: { browser: 'firefox' } })).statusCode).toBe(400)
    const anon = await app.inject({ method: 'POST', url: '/api/music/play', headers: alice, payload: { source: 'ytmusic', id: 'vid1', deviceId: player.id } })
    expect(anon.statusCode).toBe(200)
    expect(ytdlpArgs()[0]).not.toContain('--cookies')
    // la maison sans cookie, elle, reste à relier
    expect((await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/search?q=jade' })).statusCode).toBeGreaterThanOrEqual(400)

    // Alice relie SON compte : la maison n'en sait rien
    const linked = await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', headers: alice, payload: { cookie: COOKIE } })
    expect(linked.json()).toMatchObject({ user: 'alice', linked: true, anonymous: false })
    expect(await store.read()).toBeNull()
    expect(plugin.health!().status).toBe('needs_pairing')
    expect(await plugin.healthFor!('alice')).toMatchObject({ status: 'ok', detail: expect.not.stringContaining('anonymous') })
    expect((await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/status' })).json()).toMatchObject({ user: null, linked: false, anonymous: false })
    expect((await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/library/liked', headers: alice })).statusCode).toBe(200)
    expect(cookies).toContain(COOKIE)
    await app.inject({ method: 'POST', url: '/api/music/play', headers: alice, payload: { source: 'ytmusic', id: 'vid2', deviceId: player.id } })
    expect(ytdlpArgs().at(-1)).toContain('--cookies')
    await plugin.stop()
  })

  it('keeps the house account for the house, whatever a user links', async () => {
    // chaque recherche dit avec quel cookie elle part
    const searchedWith: string[] = []
    const { plugin, app } = await boot({
      createSession: async (c) => {
        const m = fakeMusic()
        const search = m.music.search.bind(m.music)
        m.music.search = (async (...args: Parameters<typeof search>) => { searchedWith.push(c); return search(...args) }) as typeof search
        return m
      },
    })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', payload: { cookie: COOKIE } })
    await app.inject({ method: 'PUT', url: '/api/plugins/ytmusic/cookie', headers: alice, payload: { cookie: '__Secure-3PAPISID=alice' } })
    await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/search?q=jade' })
    expect(new Set(searchedWith)).toEqual(new Set([COOKIE]))
    searchedWith.length = 0
    await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/search?q=jade', headers: alice })
    expect(new Set(searchedWith)).toEqual(new Set(['__Secure-3PAPISID=alice']))
    // Alice oublie le sien : celui de la maison reste
    await app.inject({ method: 'DELETE', url: '/api/plugins/ytmusic/cookie', headers: alice })
    expect((await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/status' })).json()).toMatchObject({ linked: true })
    expect(plugin.health!().status).not.toBe('needs_pairing')
    await plugin.stop()
  })
})
