import { createHash } from 'node:crypto'
import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { Command, DeviceDescriptor } from '@kasbah/shared'
import type { PluginContext } from '../../core/plugin'
import { describeError, sendError } from '../../http/errors'
import { createMusicPlayer } from '../../music/player'
import { getMusicSource } from '../../music/sources'
import { createPodcastDirectory, createPodcastIndex, EPISODE_ID_RE, isPublicFeedUrl, parseDuration, parseFeed, rssShowId, toShow, type PodcastDirectory, type PodcastIndex, type PodcastShow } from './api'
import { createPodcastsPlugin } from './index'
import { resolveEpisode } from './resolve'
import { memoryPodcasts, noteEpisodeProgress, type PodcastsStore } from './store'

// An invented show, in the shape of real feeds (Apple's directory, an RSS 2.0 feed with the itunes
// namespace): a numeric guid, a CDATA title, a video item and an item without a file to skip.
const SHOW: PodcastShow = {
  id: '1000000001', title: 'Les Ondes du Jardin', author: 'Radio Exemple', artUrl: 'https://img.example.org/show-600.jpg',
  feedUrl: 'https://feeds.example.org/jardin.xml', genre: 'Science',
}
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Les Ondes du Jardin</title>
    <itunes:image href="https://img.example.org/channel.jpg"/>
    <item>
      <title>Épisode 1 : les semis</title>
      <guid isPermaLink="false">101</guid>
      <pubDate>Mon, 02 Nov 2026 06:00:00 +0000</pubDate>
      <enclosure url="https://track.example.org/r/https://cdn.example.org/ep1.mp3" type="audio/mpeg" length="0"/>
      <itunes:duration>45:30</itunes:duration>
    </item>
    <item>
      <title><![CDATA[Épisode 2 : la taille & le paillage]]></title>
      <guid>102</guid>
      <pubDate>Wed, 04 Nov 2026 06:00:00 +0000</pubDate>
      <enclosure url="https://cdn.example.org/ep2.m4a" type="audio/x-m4a" length="1000"/>
      <itunes:duration>3720</itunes:duration>
      <itunes:image href="https://img.example.org/ep2.jpg"/>
    </item>
    <item>
      <title>Bonus vidéo</title>
      <guid>103</guid>
      <pubDate>Thu, 05 Nov 2026 06:00:00 +0000</pubDate>
      <enclosure url="https://cdn.example.org/bonus.mp4" type="video/mp4" length="1000"/>
    </item>
    <item><title>Un article sans fichier</title><guid>104</guid></item>
  </channel>
</rss>`

const speaker: DeviceDescriptor = {
  id: 'sonos:salon', pluginId: 'sonos', externalId: 'salon', kind: 'media_player', name: 'Salon',
  capabilities: ['playback', 'play_url', 'seek'], meta: {},
}
const SIZE = 43_680_000
/** A feed the directories do not list, added by its address. */
const PERSO_FEED = 'https://radio.example.org/podcast/rss_10078.xml'

function fakeCtx(): PluginContext {
  return {
    pluginId: 'podcasts',
    config: {},
    logger: pino({ level: 'silent' }),
    clock: new ManualClock(1_790_000_000_000),
    signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {},
    site: { lat: 0, lon: 0, alt: 0 },
  }
}

/** The feed, then the file: HEAD on the tracking address lands on the CDN with its size. */
function fakeFetch(feed = FEED) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === SHOW.feedUrl || url === PERSO_FEED) return new Response(feed, { headers: { 'content-type': 'application/rss+xml' } })
    if (init?.method === 'HEAD') {
      const res = new Response(null, { status: 200, headers: { 'content-length': String(SIZE), 'accept-ranges': 'bytes', 'content-type': 'audio/mpeg' } })
      Object.defineProperty(res, 'url', { value: 'https://cdn.example.org/ep1.mp3' })
      return res
    }
    return new Response('not found', { status: 404 })
  })
}

function fakeDirectory(): PodcastDirectory {
  return {
    search: vi.fn(async () => [SHOW]),
    lookup: vi.fn(async (id: string) => (id === SHOW.id ? SHOW : null)),
  }
}

async function boot(opts: { fetchImpl?: typeof fetch; store?: PodcastsStore; index?: PodcastIndex } = {}) {
  const store = opts.store ?? memoryPodcasts()
  const userStores = new Map<string, PodcastsStore>()
  const userStore = (user: string) => { if (!userStores.has(user)) userStores.set(user, memoryPodcasts()); return userStores.get(user)! }
  const fetchImpl = opts.fetchImpl ?? (fakeFetch() as unknown as typeof fetch)
  const directory = fakeDirectory()
  const plugin = createPodcastsPlugin({ directory, store, userStore, fetchImpl, ...(opts.index ? { index: opts.index } : {}) })
  const ctx = fakeCtx()
  await plugin.init(ctx)
  await plugin.start()
  const execute = vi.fn(async (_id: string, _c: Command) => {})
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
  app.setErrorHandler((err, _req, reply) => { const d = describeError(err); return sendError(reply, d.status, d.code, d.message) })
  app.decorateRequest('sessionUser', null)
  app.addHook('onRequest', async (req) => {
    const u = req.headers['x-test-user']
    if (typeof u === 'string') req.sessionUser = u
  })
  await app.register(async (sub) => plugin.registerRoutes!.call(plugin, sub), { prefix: '/api/plugins/podcasts' })
  await app.register(async (sub) => music.registerRoutes(sub), { prefix: '/api/music' })
  await app.ready()
  return { plugin, app, store, userStore, execute, directory, fetchImpl, ctx }
}

describe('podcasts feed', () => {
  it('reads the audio episodes, newest first, with a stable id per guid', () => {
    const feed = parseFeed(FEED, SHOW)
    expect(feed.title).toBe('Les Ondes du Jardin')
    expect(feed.artUrl).toBe('https://img.example.org/channel.jpg')
    expect(feed.episodes.map((e) => e.title)).toEqual(['Épisode 2 : la taille & le paillage', 'Épisode 1 : les semis'])
    const [ep2, ep1] = feed.episodes
    expect(ep2).toMatchObject({ showId: SHOW.id, durationS: 3720, artUrl: 'https://img.example.org/ep2.jpg', audioType: 'audio/x-m4a' })
    expect(ep1).toMatchObject({ durationS: 2730, artUrl: 'https://img.example.org/channel.jpg', publishedAt: Date.parse('2026-11-02T06:00:00Z') })
    for (const e of feed.episodes) expect(EPISODE_ID_RE.test(e.id)).toBe(true)
    // the same guid gives the same id from one read to the next
    expect(parseFeed(FEED, SHOW).episodes[0]!.id).toBe(ep2!.id)
    expect(() => parseFeed('<html><body>no</body></html>', SHOW)).toThrow(/not an RSS feed/)
  })

  it('reads every itunes:duration form', () => {
    expect(parseDuration('90')).toBe(90)
    expect(parseDuration('05:30')).toBe(330)
    expect(parseDuration('1:02:03')).toBe(3723)
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('n/a')).toBeNull()
  })

  it('keeps only the directory entries that have an http(s) feed', async () => {
    expect(toShow({ collectionId: 5, collectionName: 'X', artistName: 'Y', feedUrl: 'https://f.example.org/x.xml', artworkUrl600: 'a' })).toMatchObject({ id: '5', title: 'X', artUrl: 'a' })
    expect(toShow({ collectionId: 6, collectionName: 'Apple only' })).toBeNull()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ results: [{ collectionId: 7, feedUrl: 'https://f.example.org/7.xml' }, { collectionId: 8 }] })))
    const dir = createPodcastDirectory('https://itunes.apple.com', 'FR', fetchImpl as unknown as typeof fetch)
    expect((await dir.search('jardin')).map((s) => s.id)).toEqual(['7'])
    const called = new URL(String((fetchImpl.mock.calls[0] as unknown as [URL])[0]))
    expect(called.searchParams.get('media')).toBe('podcast')
    expect(called.searchParams.get('country')).toBe('FR')
    // a lookup never goes out with something that is not an Apple id
    expect(await dir.lookup('../x')).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('podcasts other sources', () => {
  it('signs Podcast Index requests and reads its feeds', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/search/byterm')) {
        return new Response(JSON.stringify({ feeds: [
          { id: 42, title: 'Les Matins', url: 'https://radio.example.org/rss_42.xml', author: 'Radio Exemple', artwork: 'https://img.example.org/42.jpg', itunesId: 777, categories: { 55: 'News' } },
          { id: 43, title: 'No feed' },
        ] }))
      }
      return new Response(JSON.stringify({ feed: { id: 42, title: 'Les Matins', url: 'https://radio.example.org/rss_42.xml', itunesId: 777 } }))
    })
    const pi = createPodcastIndex('https://api.podcastindex.org', 'KEY', 'SECRET', fetchImpl as unknown as typeof fetch, undefined, () => 1_790_000_000_000)
    expect(await pi.search('matins')).toEqual([{ id: 'pi-42', title: 'Les Matins', author: 'Radio Exemple', artUrl: 'https://img.example.org/42.jpg', feedUrl: 'https://radio.example.org/rss_42.xml', genre: 'News', itunesId: '777' }])
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['x-auth-key']).toBe('KEY')
    expect(headers['x-auth-date']).toBe('1790000000')
    // sha1('KEY' + 'SECRET' + '1790000000')
    expect(headers.authorization).toBe(createHash('sha1').update('KEYSECRET1790000000').digest('hex'))
    expect(await pi.byId('pi-42')).toMatchObject({ id: 'pi-42', feedUrl: 'https://radio.example.org/rss_42.xml' })
    expect(await pi.byId('../42')).toBeNull()
  })

  it('accepts only public feed addresses', () => {
    expect(isPublicFeedUrl('https://radio.example.org/rss.xml')).toBe(true)
    expect(isPublicFeedUrl('http://93.184.216.34/feed')).toBe(true)
    for (const bad of ['ftp://example.org/x', 'http://localhost:8787/api', 'http://nas/feed', 'http://box.local/feed', 'http://192.168.1.1/x', 'http://10.0.0.2/x', 'http://127.0.0.1/x', 'http://172.20.1.1/x', 'http://169.254.169.254/latest', 'http://[::1]/x', 'http://[fd00::1]/x', 'not a url']) {
      expect(isPublicFeedUrl(bad), bad).toBe(false)
    }
  })
})

describe('podcasts resolve', () => {
  const ep = parseFeed(FEED, SHOW).episodes[1]!

  it('follows the tracking redirect and reads the size', async () => {
    const r = await resolveEpisode(ep, fakeFetch() as unknown as typeof fetch)
    expect(r).toEqual({ url: 'https://cdn.example.org/ep1.mp3', formatId: null, ext: 'mp3', abrKbps: 128, sizeBytes: SIZE, durationS: 2730 })
  })

  it('asks for one byte when HEAD is refused, and gives no size when nothing says it', async () => {
    const ranged = vi.fn(async (_u: string, init?: RequestInit) => (init?.method === 'HEAD'
      ? new Response(null, { status: 405 })
      : new Response('x', { status: 206, headers: { 'content-range': `bytes 0-0/${SIZE}`, 'content-type': 'audio/mpeg' } })))
    expect((await resolveEpisode(ep, ranged as unknown as typeof fetch)).sizeBytes).toBe(SIZE)
    const silent = vi.fn(async () => new Response('x', { status: 200 }))
    expect((await resolveEpisode(ep, silent as unknown as typeof fetch)).sizeBytes).toBeNull()
  })
})

describe('podcasts progress', () => {
  it('remembers a position, then counts the episode as listened to near its end', () => {
    const id = `${SHOW.id}:0123456789abcdef`
    let s = noteEpisodeProgress(memoryState(), id, 600, 2730, false, 1)
    expect(s.resume[id]?.positionS).toBe(600)
    expect(s.played[id]).toBeUndefined()
    s = noteEpisodeProgress(s, id, 2700, 2730, false, 2)
    expect(s.resume[id]).toBeUndefined()
    expect(s.played[id]).toBe(2)
    // a very short episode is not "listened to" after 15 s
    const short = noteEpisodeProgress(memoryState(), id, 15, 100, false, 3)
    expect(short.played[id]).toBeUndefined()
  })
})
const memoryState = () => ({ subscriptions: [], resume: {}, played: {} })

describe('podcasts routes', () => {
  it('searches, subscribes per account, lists episodes and what is new', async () => {
    const { app, plugin, store, userStore } = await boot()
    const found = (await app.inject({ method: 'GET', url: '/api/plugins/podcasts/search?q=jardin' })).json()
    expect(found.shows).toEqual([{ id: SHOW.id, title: SHOW.title, author: SHOW.author, artUrl: SHOW.artUrl, genre: 'Science', subscribed: false }])
    expect((await app.inject({ method: 'GET', url: '/api/plugins/podcasts/search?q=j' })).statusCode).toBe(400)

    // the house subscribes; a signed-in user sees none of it
    const sub = await app.inject({ method: 'PUT', url: `/api/plugins/podcasts/subscriptions/${SHOW.id}` })
    expect(sub.json().shows.map((s: { id: string }) => s.id)).toEqual([SHOW.id])
    expect((await store.load()).subscriptions.map((s) => s.feedUrl)).toEqual([SHOW.feedUrl])
    const alice = (await app.inject({ method: 'GET', url: '/api/plugins/podcasts/subscriptions', headers: { 'x-test-user': 'alice' } })).json()
    expect(alice.shows).toEqual([])
    expect((await app.inject({ method: 'PUT', url: '/api/plugins/podcasts/subscriptions/999' })).statusCode).toBe(404)

    const show = (await app.inject({ method: 'GET', url: `/api/plugins/podcasts/shows/${SHOW.id}` })).json()
    expect(show.show).toMatchObject({ id: SHOW.id, subscribed: true })
    expect(show.show.feedUrl).toBeUndefined()
    expect(show.episodes).toHaveLength(2)
    expect(show.episodes[0].audioUrl).toBeUndefined()
    expect(show.next).toBeNull()

    const latest = (await app.inject({ method: 'GET', url: '/api/plugins/podcasts/latest' })).json()
    expect(latest.episodes.map((e: { title: string }) => e.title)).toEqual(['Épisode 2 : la taille & le paillage', 'Épisode 1 : les semis'])
    expect((await app.inject({ method: 'GET', url: '/api/plugins/podcasts/latest', headers: { 'x-test-user': 'alice' } })).json().episodes).toEqual([])

    await app.inject({ method: 'DELETE', url: `/api/plugins/podcasts/subscriptions/${SHOW.id}` })
    expect((await store.load()).subscriptions).toEqual([])
    expect(await userStore('alice').load()).toMatchObject({ subscriptions: [] })
    await plugin.stop()
  })

  it('adds what only Podcast Index has, after Apple, without listing a show twice', async () => {
    const index: PodcastIndex = {
      search: vi.fn(async () => [
        { ...SHOW, id: 'pi-1', itunesId: SHOW.id },                                                      // Apple already gave it
        { id: 'pi-2', title: 'Les Matins', author: 'Radio Exemple', artUrl: null, feedUrl: 'https://radio.example.org/rss_2.xml', genre: null, itunesId: '555' },
        { id: 'pi-3', title: 'Copie', author: '', artUrl: null, feedUrl: SHOW.feedUrl, genre: null, itunesId: null },   // same feed
      ]),
      byId: vi.fn(async () => null),
    }
    const { app, plugin } = await boot({ index })
    const found = (await app.inject({ method: 'GET', url: '/api/plugins/podcasts/search?q=matins' })).json()
    expect(found.shows.map((s: { id: string }) => s.id)).toEqual([SHOW.id, 'pi-2'])
    expect(plugin.health!().detail).toContain('Podcast Index')
    await plugin.stop()
  })

  it('subscribes to a feed by its address, for the account that added it, and plays it', async () => {
    const { app, plugin, userStore, execute } = await boot()
    const alice = { 'x-test-user': 'alice' }
    expect((await app.inject({ method: 'POST', url: '/api/plugins/podcasts/subscriptions/rss', headers: alice, payload: { url: 'http://192.168.1.1/feed.xml' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/plugins/podcasts/subscriptions/rss', headers: alice, payload: { url: 'https://radio.example.org/nothing.xml' } })).statusCode).toBe(400)
    const added = await app.inject({ method: 'POST', url: '/api/plugins/podcasts/subscriptions/rss', headers: alice, payload: { url: PERSO_FEED } })
    expect(added.statusCode).toBe(200)
    const id = rssShowId(PERSO_FEED)
    expect(added.json().show).toMatchObject({ id, title: 'Les Ondes du Jardin', subscribed: true })
    expect((await userStore('alice').load()).subscriptions.map((s) => s.feedUrl)).toEqual([PERSO_FEED])
    // twice: no duplicate
    await app.inject({ method: 'POST', url: '/api/plugins/podcasts/subscriptions/rss', headers: alice, payload: { url: PERSO_FEED } })
    expect((await userStore('alice').load()).subscriptions).toHaveLength(1)
    await plugin.stop()

    // after a restart, the show is found again through alice's subscriptions
    const again = createPodcastsPlugin({ directory: fakeDirectory(), store: memoryPodcasts(), userStore, fetchImpl: fakeFetch() as unknown as typeof fetch })
    await again.init(fakeCtx())
    const ep = parseFeed(FEED, { id, title: '', artUrl: null }).episodes[0]!
    const resolved = await getMusicSource('podcasts')!.resolve(ep.id, 'alice')
    expect(resolved).toMatchObject({ ext: 'mp3', sizeBytes: SIZE })
    await again.stop()
    expect(execute).not.toHaveBeenCalled()
  })

  it('reads a feed once per half hour, whoever asks', async () => {
    const fetchImpl = fakeFetch()
    const { app, plugin } = await boot({ fetchImpl: fetchImpl as unknown as typeof fetch })
    await app.inject({ method: 'GET', url: `/api/plugins/podcasts/shows/${SHOW.id}` })
    await app.inject({ method: 'GET', url: `/api/plugins/podcasts/shows/${SHOW.id}`, headers: { 'x-test-user': 'alice' } })
    expect(fetchImpl.mock.calls.filter((c) => String(c[0]) === SHOW.feedUrl)).toHaveLength(1)
    await plugin.stop()
  })

  it('plays an episode through the common player, relayed as mp3, and keeps its resume for its account only', async () => {
    const { app, plugin, execute, store, userStore } = await boot()
    const ep = parseFeed(FEED, SHOW).episodes[1]!
    const res = await app.inject({
      method: 'POST', url: '/api/music/play', headers: { 'x-test-user': 'alice' },
      payload: { source: 'podcasts', id: ep.id, deviceId: speaker.id, title: ep.title, artist: SHOW.title, durationS: 2730 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().streamUrl).toMatch(/^http:\/\/192\.168\.1\.10:8787\/api\/music\/raw\/[0-9a-f]+\.mp3$/)
    expect(execute.mock.calls[0]![1]).toMatchObject({ type: 'media_player.play_url', title: ep.title })
    const sessions = (await app.inject({ method: 'GET', url: '/api/music/sessions' })).json().sessions
    expect(sessions[0]).toMatchObject({ source: 'podcasts', id: ep.id, quality: { mime: 'audio/mpeg', lengthBytes: SIZE } })

    // a position from alice's browser: hers, not the house's
    await app.inject({ method: 'POST', url: '/api/music/progress', headers: { 'x-test-user': 'alice' }, payload: { source: 'podcasts', id: ep.id, positionS: 900, durationS: 2730 } })
    const seen = (await app.inject({ method: 'GET', url: `/api/plugins/podcasts/shows/${SHOW.id}`, headers: { 'x-test-user': 'alice' } })).json()
    expect(seen.episodes.find((e: { id: string }) => e.id === ep.id)).toMatchObject({ resumeS: 900 })
    const house = (await app.inject({ method: 'GET', url: `/api/plugins/podcasts/shows/${SHOW.id}` })).json()
    expect(house.episodes.find((e: { id: string }) => e.id === ep.id).resumeS).toBeUndefined()

    // the end: listened to, written at once
    await app.inject({ method: 'POST', url: '/api/music/progress', headers: { 'x-test-user': 'alice' }, payload: { source: 'podcasts', id: ep.id, positionS: 2730, durationS: 2730, ended: true } })
    await vi.waitFor(async () => expect((await userStore('alice').load()).played[ep.id]).toBeTypeOf('number'))
    const done = (await app.inject({ method: 'GET', url: `/api/plugins/podcasts/shows/${SHOW.id}`, headers: { 'x-test-user': 'alice' } })).json()
    expect(done.episodes.find((e: { id: string }) => e.id === ep.id)).toMatchObject({ played: true })

    // start over: neither position nor "listened to"
    await app.inject({ method: 'DELETE', url: `/api/plugins/podcasts/resume?id=${encodeURIComponent(ep.id)}`, headers: { 'x-test-user': 'alice' } })
    expect((await userStore('alice').load()).played).toEqual({})
    expect((await store.load()).played).toEqual({})

    // an id that is not an episode never reaches the network
    const bad = await app.inject({ method: 'POST', url: '/api/music/play', payload: { source: 'podcasts', id: 'https://evil.example/x.mp3', deviceId: speaker.id } })
    expect(bad.statusCode).toBeGreaterThanOrEqual(400)
    await plugin.stop()
    const off = await app.inject({ method: 'POST', url: '/api/music/play', payload: { source: 'podcasts', id: ep.id, deviceId: speaker.id } })
    expect(off.statusCode).toBe(400)
  })
})
