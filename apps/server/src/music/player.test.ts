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
    lightStreamer: () => ({ areaFor: (lights) => (lights.length ? area : undefined), open: async () => { throw new Error('not in this test') } }),
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
    lightStreamer: () => ({ areaFor: (lights) => (lights.length ? area : undefined), open }),
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
