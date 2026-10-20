import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { Command } from '@kasbah/shared'
import { memoryLastPlayed, type LastPlayedStore } from './lastPlayed'
import { createMusicPlayer } from './player'
import type { MusicSource } from './sources'

// The last listening survives a server restart: the queue and the position reached are kept,
// `/last` returns them, `/resume` restarts the track where it was.

const speaker = { id: 'sonos:bureau', kind: 'media_player', capabilities: ['play_url', 'seek'] }
const source: MusicSource = {
  id: 'fake',
  label: 'Fake',
  resolve: async (id) => ({ url: `https://cdn.example/${id}.m4a`, formatId: '141', ext: 'm4a', abrKbps: 256, sizeBytes: 1_000_000, durationS: 600 }),
}
const tracks = [
  { source: 'fake', id: 'a', title: 'Alpha', artist: 'A', durationS: 600 },
  { source: 'fake', id: 'b', title: 'Beta', artist: 'B', durationS: 600 },
]

async function boot(store: LastPlayedStore, clock: { t: number }) {
  const execute = vi.fn(async (_id: string, _c: Command) => {})
  let emit: (deviceId: string, state: unknown) => void = () => {}
  let state: unknown = { kind: 'media_player', playback: 'idle' }
  const music = createMusicPlayer({
    config: { MUSIC_PUBLISH_BASE: 'http://192.168.1.10:8787' },
    logger: pino({ level: 'silent' }),
    now: () => clock.t,
    source: (id) => (id === 'fake' ? source : undefined),
    execute,
    getDevice: (id) => (id === speaker.id ? { descriptor: speaker, state } : undefined),
    onState: (cb) => { emit = cb; return () => {} },
    lastStore: store,
  })
  const app = Fastify()
  await app.register(async (sub) => music.registerRoutes(sub), { prefix: '/api/music' })
  await app.ready()
  const publish = (s: unknown) => { state = s; emit(speaker.id, s) }
  return { app, music, execute, publish }
}
const flush = () => new Promise((r) => setTimeout(r, 5))

describe('music last played', () => {
  it('shows the interrupted track after a restart and resumes it at its position', async () => {
    const store = memoryLastPlayed()
    const clock = { t: 1_000_000 }
    const first = await boot(store, clock)
    const started = await first.app.inject({ method: 'POST', url: '/api/music/queue', payload: { deviceId: speaker.id, tracks } })
    expect(started.statusCode).toBe(200)
    // while the track plays, it is not a "last listening": the session is alive
    expect((await first.app.inject({ method: 'GET', url: '/api/music/last' })).json()).toEqual({ last: [] })

    clock.t += 10_000
    first.publish({ kind: 'media_player', playback: 'playing', nowPlaying: { title: 'Alpha', positionS: 125.4 } })
    first.music.stop() // server shutdown: the most recent position goes to disk
    await first.app.close()
    await flush()

    const second = await boot(store, clock)
    const last = (await second.app.inject({ method: 'GET', url: '/api/music/last' })).json()
    expect(last.last).toEqual([expect.objectContaining({
      deviceId: speaker.id,
      track: expect.objectContaining({ id: 'a', title: 'Alpha' }),
      positionS: 125,
      durationS: 600,
      queue: { length: 2, index: 0, repeat: 'off' },
    })])

    const resumed = await second.app.inject({ method: 'POST', url: '/api/music/resume', payload: { deviceId: speaker.id } })
    expect(resumed.statusCode).toBe(200)
    expect(resumed.json().queue.items.map((t: { id: string }) => t.id)).toEqual(['a', 'b'])
    const sent = second.execute.mock.calls.map(([, c]) => c)
    expect(sent[0]).toMatchObject({ type: 'media_player.play_url', title: 'Alpha' })
    expect(sent).toContainEqual({ type: 'media_player.seek', positionS: 125 })
    await second.app.close()
  })

  it('resumes at a position chosen in the bar', async () => {
    const store = memoryLastPlayed({ [speaker.id]: { items: tracks, index: 1, repeat: 'once', positionS: 300, durationS: 600, at: 1 } })
    const { app, execute } = await boot(store, { t: 1_000_000 })
    const r = await app.inject({ method: 'POST', url: '/api/music/resume', payload: { deviceId: speaker.id, positionS: 42 } })
    expect(r.json().queue).toMatchObject({ index: 1, repeat: 'once' })
    expect(execute.mock.calls.map(([, c]) => c)).toContainEqual({ type: 'media_player.seek', positionS: 42 })
    expect((await app.inject({ method: 'POST', url: '/api/music/resume', payload: { deviceId: 'cast:salon' } })).statusCode).toBe(404)
    await app.close()
  })

  it('writes a pause and a jump at once, not 15 s later', async () => {
    const store = memoryLastPlayed()
    const clock = { t: 1_000_000 }
    const { app, publish } = await boot(store, clock)
    await app.inject({ method: 'POST', url: '/api/music/play', payload: { deviceId: speaker.id, ...tracks[0] } })
    await flush()
    clock.t += 10_000
    publish({ kind: 'media_player', playback: 'playing', nowPlaying: { title: 'Alpha', positionS: 10 } })
    clock.t += 2_000
    publish({ kind: 'media_player', playback: 'playing', nowPlaying: { title: 'Alpha', positionS: 300 } })
    await flush()
    expect((await store.load())[speaker.id]?.positionS).toBe(300)
    clock.t += 2_000
    publish({ kind: 'media_player', playback: 'paused', nowPlaying: { title: 'Alpha', positionS: 302 } })
    await flush()
    expect((await store.load())[speaker.id]?.positionS).toBe(302)
    await app.close()
  })

  it('forgets the listening once the queue has played to its end', async () => {
    const store = memoryLastPlayed()
    const clock = { t: 1_000_000 }
    const { app, publish } = await boot(store, clock)
    await app.inject({ method: 'POST', url: '/api/music/play', payload: { deviceId: speaker.id, ...tracks[0] } })
    clock.t += 10_000
    publish({ kind: 'media_player', playback: 'playing', nowPlaying: { title: 'Alpha', positionS: 598 } })
    clock.t += 3_000
    publish({ kind: 'media_player', playback: 'idle' })
    await flush()
    expect(await store.load()).toEqual({})
    await app.close()
  })
})
