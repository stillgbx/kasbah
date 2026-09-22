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
  createSession?: () => Promise<InnertubeLike>
} = {}) {
  const store = createCookieFile('')
  const plugin = createYtmusicPlugin({
    cookieStore: store,
    createSession: extra.createSession ?? (async () => fakeMusic()),
    fetchImpl: extra.fetchImpl ?? (async () => new Response('ok', { status: 200 })) as typeof fetch,
    ...(extra.execute ? { execute: extra.execute } : {}),
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
          duration: 20,
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
    expect((await app.inject({ method: 'POST', url: '/api/plugins/ytmusic/transfer', payload: { fromDeviceId: office.id, toDeviceId: player.id } })).statusCode).toBe(404)

    // la durée vient de yt-dlp (20 s), pas du catalogue (265 s)
    await app.inject({
      method: 'POST', url: '/api/plugins/ytmusic/play',
      payload: { videoId: 'vid1', deviceId: office.id, title: 'Song', artist: 'A', artUrl: 'https://i.ytimg.com/a.jpg', durationS: 265 },
    })
    expect(commands.map((c) => c.cmd.type)).toEqual(['media_player.play_url'])
    const sessions = (await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/sessions' })).json().sessions
    expect(sessions).toEqual([expect.objectContaining({ deviceId: office.id, durationS: 20, title: 'Song', artist: 'A' })])
    expect(sessions[0]).not.toHaveProperty('startS')

    // un « fichier » : 20 s = 834 trames de 576 octets
    const LENGTH = Math.ceil(20 / (1152 / 48000)) * 576
    const sid = (commands[0]!.cmd as { url: string }).url.split('/').pop()!
    const head = await app.inject({ method: 'HEAD', url: `/api/plugins/ytmusic/stream/${sid}` })
    expect(head.statusCode).toBe(200)
    expect(head.headers['content-length']).toBe(String(LENGTH))
    expect(head.headers['accept-ranges']).toBe('bytes')
    const ffArgs = () => (ff.spawnImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => !(c[1] as string[]).includes('-J') && !(c[1] as string[]).includes('lavfi')).at(-1)![1] as string[]
    // tout le fichier : ffmpeg depuis le début, taille promise tenue (la fausse sortie ne fait que 3 octets : on complète)
    const whole = await app.inject({ method: 'GET', url: `/api/plugins/ytmusic/stream/${sid}` })
    expect(whole.statusCode).toBe(200)
    expect(whole.headers['content-length']).toBe(String(LENGTH))
    expect(whole.rawPayload.length).toBe(LENGTH)
    expect(ffArgs()).not.toContain('-ss')
    expect(ffArgs()).toContain('libmp3lame')
    // une plage : ffmpeg lancé à la trame (57 600 octets = 100 trames = 2,4 s), 206 avec la bonne étendue
    const part = await app.inject({ method: 'GET', url: `/api/plugins/ytmusic/stream/${sid}`, headers: { range: `bytes=57600-` } })
    expect(part.statusCode).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 57600-${LENGTH - 1}/${LENGTH}`)
    expect(part.rawPayload.length).toBe(LENGTH - 57600)
    const args = ffArgs()
    expect(Number(args[args.indexOf('-ss') + 1])).toBeCloseTo(2.4, 3)
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    // plage hors du fichier : on sert tout (200), l'enceinte s'y retrouve
    expect((await app.inject({ method: 'GET', url: `/api/plugins/ytmusic/stream/${sid}`, headers: { range: `bytes=${LENGTH + 10}-` } })).statusCode).toBe(200)

    // transfert : même fichier sur la cible, déplacement natif à la position de la source
    // (42,7 + 1,5 s depuis le relevé), puis la source s'arrête
    commands.length = 0
    const r = await app.inject({ method: 'POST', url: '/api/plugins/ytmusic/transfer', payload: { fromDeviceId: office.id, toDeviceId: player.id } })
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
    const after = (await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/sessions' })).json().sessions
    expect(after).toEqual([expect.objectContaining({ deviceId: player.id, videoId: 'vid1', durationS: 20 })])

    // l'enceinte joue autre chose (une radio lancée ailleurs) : la session ne compte plus, ni pour l'UI ni pour un transfert
    ;(ctx.clock as ManualClock).advance(6_000)
    const radio: Dev = { descriptor: player, state: { kind: 'media_player', playback: 'playing', nowPlaying: { title: 'franceinfo' } } }
    devices.get = (id) => (id === player.id ? radio : deviceOf(id))
    expect((await app.inject({ method: 'GET', url: '/api/plugins/ytmusic/sessions' })).json().sessions).toEqual([])
    expect((await app.inject({ method: 'POST', url: '/api/plugins/ytmusic/transfer', payload: { fromDeviceId: player.id, toDeviceId: office.id } })).statusCode).toBe(404)
    devices.get = deviceOf

    // relancer un autre titre là où l'un des nôtres joue : pause immédiate, puis le nouveau flux
    commands.length = 0
    await app.inject({ method: 'POST', url: '/api/plugins/ytmusic/play', payload: { videoId: 'vid2', deviceId: player.id, title: 'Next' } })
    expect(commands.map((c) => c.cmd.type)).toEqual(['media_player.pause', 'media_player.play_url'])
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
