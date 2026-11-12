import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import Fastify from 'fastify'
import pino from 'pino'
import { expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import { createMusicPlayer } from './player'
import type { SpawnFn } from './proxy'
import { memoryLightSyncSettings } from './lightsync/settingsFile'

// The address the player gives the speakers is derived from the page issuing the command. Opened
// through the public name (NAS proxy), it would be an address that requires a session: a speaker
// cannot connect to it.

const PUBLIC = 'kasbah.example.org'

async function build(config: Record<string, string> = {}) {
  const player = createMusicPlayer({
    config, logger: pino({ level: 'silent' }), publicHosts: [PUBLIC],
    source: () => undefined,
    getDevice: () => ({ descriptor: { kind: 'media_player', capabilities: ['play_url'] } }),
    execute: async () => {},
  })
  const app = Fastify()
  await app.register(async (sub) => player.registerRoutes(sub), { prefix: '/api/music' })
  return app
}

const play = (app: Awaited<ReturnType<typeof build>>, headers: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/api/music/play', headers, payload: { source: 'ytmusic', id: 'x', deviceId: 'sonos:salon' } })

it('refuses to publish the public address to the speakers, and asks for MUSIC_PUBLISH_BASE', async () => {
  const app = await build()
  const asPublic: Record<string, string>[] = [{ host: PUBLIC }, { host: '192.168.1.90:8787', 'x-forwarded-host': PUBLIC }]
  for (const headers of asPublic) {
    const res = await play(app, headers)
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.body).toContain('MUSIC_PUBLISH_BASE required when the UI is opened through the public address')
  }
  expect((await play(app, { host: '192.168.1.90:8787' })).body).not.toContain('public address')
})

it('goes through MUSIC_PUBLISH_BASE when it is set, even under the public name', async () => {
  const app = await build({ MUSIC_PUBLISH_BASE: 'http://192.168.1.90:8787' })
  expect((await play(app, { host: PUBLIC })).body).not.toContain('public address')
})

it('light sync routes: status per speaker, refusal where the room cannot, switch where it can', async () => {
  const area = { id: 'area-1', name: 'Chambre 2', channels: [{ id: 0, x: 0, y: 0, z: 0 }] }
  const player = createMusicPlayer({
    logger: pino({ level: 'silent' }),
    source: () => undefined,
    getDevice: () => ({ descriptor: { kind: 'media_player', capabilities: ['play_url'] } }),
    execute: async () => {},
    roomLights: (id) => (id === 'cast:speaker-1' ? ['hue:lamp-1'] : null),
    room: (id) => (id === 'cast:speaker-1' ? { id: 'room-2', name: 'Chambre 2' } : null),
    lightSyncSettings: memoryLightSyncSettings(),
    lightStreamer: () => {
      const notHere = async (): Promise<never> => { throw new Error('not in this test') }
      return { areaFor: (lights) => (lights.length ? area : undefined), open: notHere, saveLights: notHere, restoreLights: notHere, switchOff: notHere }
    },
  })
  const app = Fastify()
  await app.register(async (sub) => player.registerRoutes(sub), { prefix: '/api/music' })
  const list = await app.inject({ method: 'GET', url: '/api/music/lightsync?deviceIds=cast:speaker-1,cast:nowhere' })
  expect(list.json().lightsync).toEqual([
    expect.objectContaining({ deviceId: 'cast:speaker-1', available: true, area: 'Chambre 2', on: false, active: false }),
    expect.objectContaining({ deviceId: 'cast:nowhere', available: false, reason: 'no_room', on: false, active: false }),
  ])
  expect((await app.inject({ method: 'PUT', url: '/api/music/lightsync/cast:nowhere', payload: { on: true } })).statusCode).toBe(409)
  expect((await app.inject({ method: 'PUT', url: '/api/music/lightsync/cast:speaker-1', payload: {} })).statusCode).toBe(400)
  const on = await app.inject({ method: 'PUT', url: '/api/music/lightsync/cast:speaker-1', payload: { on: true } })
  expect(on.json()).toMatchObject({ on: true, available: true })
  const set = await app.inject({ method: 'PUT', url: '/api/music/lightsync/cast:speaker-1/settings', payload: { effect: 'spectrum', palette: { source: 'custom', colors: ['#ff0000', '#0000ff'] } } })
  expect(set.json()).toMatchObject({ settings: { effect: 'spectrum', energy: 0.5 }, palette: ['#ff0000', '#0000ff'], room: { name: 'Chambre 2' } })
  expect((await app.inject({ method: 'PUT', url: '/api/music/lightsync/cast:speaker-1/settings', payload: { effect: 'disco' } })).statusCode).toBe(400)
  expect((await app.inject({ method: 'PUT', url: '/api/music/lightsync/cast:nowhere/settings', payload: { energy: 1 } })).statusCode).toBe(409)
  player.stop()
  await app.close()
})

it('a browser playing the music itself: its room is chosen, its own reports place it in the track', async () => {
  const clock = new ManualClock(1_000_000)
  const area = { id: 'area-b', name: 'Bureau', channels: [{ id: 0, x: 0, y: 0, z: 0 }] }
  const streams: { closed: boolean }[] = []
  const open = vi.fn(async () => {
    const s = { closed: false }
    streams.push(s)
    return { area, send: () => {}, close: async () => { s.closed = true }, onEnded: () => {} }
  })
  // an ffmpeg that never says anything: the stream opens whatever the analysis does
  const spawnImpl = vi.fn(() => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true })) as unknown as SpawnFn
  const player = createMusicPlayer({
    logger: pino({ level: 'silent' }), now: () => clock.now(), clock, spawnImpl,
    source: (id) => (id === 'fake' ? { id: 'fake', label: 'Fake', resolve: async () => ({ url: 'https://cdn.example/a.m4a', formatId: '141', ext: 'm4a', abrKbps: 256, sizeBytes: 1_000_000, durationS: 600 }) } : undefined),
    getDevice: () => undefined,
    execute: async () => {},
    rooms: () => [{ id: 'office', name: 'Bureau' }, { id: 'attic', name: 'Grenier' }],
    lightsOfRoom: (id) => (id === 'office' ? ['hue:lamp-1'] : []),
    lightSyncSettings: memoryLightSyncSettings(),
    lightStreamer: () => ({
      areaFor: (lights) => (lights.length ? area : undefined), open,
      saveLights: async (areaId) => ({ areaId }), restoreLights: async () => {}, switchOff: async () => {},
    }),
  })
  const app = Fastify()
  await app.register(async (sub) => player.registerRoutes(sub), { prefix: '/api/music' })
  const browser = 'local:browser-1234'
  const step = async (ms: number) => { for (let t = 0; t < ms; t += 50) { clock.advance(50); await new Promise((r) => setImmediate(r)) } }

  expect((await app.inject({ method: 'GET', url: '/api/music/lightsync/rooms' })).json()).toEqual({ rooms: [{ id: 'office', name: 'Bureau', area: 'Bureau' }] })
  expect((await app.inject({ method: 'PUT', url: '/api/music/lightsync/cast:speaker-1/room', payload: { roomId: 'office' } })).statusCode).toBe(400)
  expect((await app.inject({ method: 'PUT', url: `/api/music/lightsync/${browser}/room`, payload: { roomId: 'nowhere' } })).statusCode).toBe(404)
  const chosen = await app.inject({ method: 'PUT', url: `/api/music/lightsync/${browser}/room`, payload: { roomId: 'office' } })
  expect(chosen.json()).toMatchObject({ available: true, area: 'Bureau', room: { id: 'office', name: 'Bureau' } })
  expect((await app.inject({ method: 'PUT', url: `/api/music/lightsync/${browser}`, payload: { on: true } })).json()).toMatchObject({ on: true })

  expect((await app.inject({ method: 'POST', url: '/api/music/local', payload: { source: 'fake', id: 'a', title: 'Alpha', clientId: 'browser-1234' } })).statusCode).toBe(200)
  await step(500)
  expect(open).not.toHaveBeenCalled()          // nothing said yet: not playing
  expect((await app.inject({ method: 'POST', url: '/api/music/local/state', payload: { clientId: 'browser-1234', playback: 'playing' } })).statusCode).toBe(400)
  expect((await app.inject({ method: 'POST', url: '/api/music/local/state', payload: { clientId: 'browser-1234', playback: 'playing', positionS: 12 } })).statusCode).toBe(200)
  await step(500)
  expect(open).toHaveBeenCalledWith('area-b')
  expect(vi.mocked(spawnImpl).mock.calls[0]![1]).toEqual(expect.arrayContaining(['-ss', 'https://cdn.example/a.m4a']))
  // the tab goes silent while playing: after 25 s it no longer counts as playing, 5 s later the lights go back
  await step(29_000)
  expect(streams[0]!.closed).toBe(false)
  await step(2000)
  expect(streams[0]!.closed).toBe(true)
  player.stop()
  await app.close()
})

// A mix of several hours is ONE request held open on the source, which sometimes drops it. The relay
// used to end its response there, short of the announced length: the player then waited for the
// missing bytes on a live connection and the sound stopped. Real sockets here: `inject` would not
// show that wait.
async function relaying(fetchImpl: typeof fetch) {
  const player = createMusicPlayer({
    logger: pino({ level: process.env.RELAY_DEBUG ? 'debug' : 'silent' }),
    fetchImpl,
    source: (id) => (id === 'mixcloud'
      ? { id, label: 'Mixcloud', resolve: async () => ({ url: 'https://cdn.example.org/mix.m4a', formatId: 'http', ext: 'm4a', abrKbps: 64, sizeBytes: FILE.length, durationS: 60 }) }
      : undefined),
  })
  const app = Fastify()
  await app.register(async (sub) => player.registerRoutes(sub), { prefix: '/api/music' })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
  const opened = await fetch(`${base}/api/music/local`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'mixcloud', id: '/someone/a-mix/', clientId: 'browser-1' }),
  })
  const { streamUrl } = await opened.json() as { streamUrl: string }
  return { url: `${base}${streamUrl}`, close: async () => { player.stop(); await app.close() } }
}

const FILE = Uint8Array.from({ length: 1000 }, (_, i) => i % 251)
/** The source sends `bytes` then drops the connection. */
const cutAfter = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({
  start(c) { c.enqueue(bytes) },
  // once those are read: erroring in `start` would drop the queued bytes
  pull(c) { c.error(new Error('ECONNRESET')) },
})

it('relay: a source cut mid-file is reopened from the byte reached, the player gets the whole file', async () => {
  const asked: Array<string | undefined> = []
  // the source drops the connection at bytes 400 and 700
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.range
    asked.push(range)
    const at = range ? Number(/^bytes=(\d+)-/.exec(range)![1]) : 0
    const cut = [400, 700].find((c) => c > at)
    const headers = { 'content-length': String(1000 - at), ...(range ? { 'content-range': `bytes ${at}-999/1000` } : {}) }
    const body = cut ? cutAfter(FILE.subarray(at, cut)) : FILE.subarray(at)
    return new Response(body, { status: range ? 206 : 200, headers })
  }) as unknown as typeof fetch
  const { url, close } = await relaying(fetchImpl)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(FILE)
    expect(asked).toEqual([undefined, 'bytes=400-999', 'bytes=700-999'])
  } finally { await close() }
})

it('relay: a source that refuses the reopening closes the connection, the player does not wait', async () => {
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.range
    return range
      ? new Response('expired', { status: 403 })
      : new Response(cutAfter(FILE.subarray(0, 400)), { status: 200, headers: { 'content-length': '1000' } })
  }) as unknown as typeof fetch
  const { url, close } = await relaying(fetchImpl)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    // a failure (connection closed short), not the 5 s timeout of a wait
    const err = await res.arrayBuffer().then(() => null, (e: Error) => e)
    expect(err?.name).not.toBe('TimeoutError')
    expect(err).toBeInstanceOf(Error)
  } finally { await close() }
})
