import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { Command } from '@kasbah/shared'
import { memoryLastPlayed } from './lastPlayed'
import { createMusicPlayer } from './player'
import type { MusicSource, MusicUser } from './sources'

// Chaque compte écoute avec SES comptes musicaux : une file garde le compte de qui l'a lancée (ses
// pistes suivantes se résolvent et se notent chez lui, quel que soit l'écran qui la pilote), et un flux
// résolu pour l'un ne sert pas à l'autre.

const speaker = { id: 'sonos:bureau', kind: 'media_player', capabilities: ['play_url', 'seek'] }
const tracks = [
  { source: 'fake', id: 'a', title: 'Alpha', durationS: 600 },
  { source: 'fake', id: 'b', title: 'Beta', durationS: 600 },
]

async function boot() {
  const clock = { t: 1_000_000 }
  const resolved: Array<{ id: string; user: MusicUser }> = []
  const prepared: MusicUser[] = []
  const progress = vi.fn((_id: string, _pos: number, _dur: number | undefined, _ended: boolean, _user: MusicUser) => {})
  const source: MusicSource = {
    id: 'fake',
    label: 'Fake',
    prepare: async (user) => { prepared.push(user) },
    resolve: async (id, user) => {
      resolved.push({ id, user })
      return { url: `https://cdn.example/${id}.m4a`, formatId: '141', ext: 'm4a', abrKbps: 256, sizeBytes: 1_000_000, durationS: 600 }
    },
    onProgress: progress,
  }
  let emit: (deviceId: string, state: unknown) => void = () => {}
  let state: unknown = { kind: 'media_player', playback: 'idle' }
  const music = createMusicPlayer({
    config: { MUSIC_PUBLISH_BASE: 'http://192.168.1.10:8787' },
    logger: pino({ level: 'silent' }),
    now: () => clock.t,
    source: (id) => (id === 'fake' ? source : undefined),
    execute: vi.fn(async (_id: string, _c: Command) => {}),
    getDevice: (id) => (id === speaker.id ? { descriptor: speaker, state } : undefined),
    onState: (cb) => { emit = cb; return () => {} },
    lastStore: memoryLastPlayed(),
  })
  const app = Fastify()
  // ce que fait la porte à session (ou le jeton MCP) : le compte de la requête
  app.decorateRequest('sessionUser', null)
  app.addHook('onRequest', async (req) => {
    const u = req.headers['x-test-user']
    if (typeof u === 'string') req.sessionUser = u
  })
  await app.register(async (sub) => music.registerRoutes(sub), { prefix: '/api/music' })
  await app.ready()
  const publish = (s: unknown) => { state = s; emit(speaker.id, s) }
  const as = (user: string | null) => (user ? { 'x-test-user': user } : {})
  return { app, music, clock, resolved, prepared, progress, publish, as }
}
const flush = () => new Promise((r) => setTimeout(r, 5))

describe('music accounts', () => {
  it('keeps the account of whoever started the queue, whoever drives it next', async () => {
    const t = await boot()
    const started = await t.app.inject({ method: 'POST', url: '/api/music/queue', headers: t.as('alice'), payload: { deviceId: speaker.id, tracks } })
    expect(started.statusCode).toBe(200)
    await flush()
    // la piste lancée ET la suivante, résolue d'avance : chez Alice
    expect(t.resolved).toEqual([{ id: 'a', user: 'alice' }, { id: 'b', user: 'alice' }])
    expect(t.prepared.every((u) => u === 'alice')).toBe(true)

    // la position de la piste va chez Alice
    t.clock.t += 10_000
    t.publish({ kind: 'media_player', playback: 'playing', nowPlaying: { title: 'Alpha', positionS: 125 } })
    expect(t.progress).toHaveBeenLastCalledWith('a', 125, 600, false, 'alice')

    // l'écran de la maison passe au suivant : c'est toujours la file d'Alice
    const next = await t.app.inject({ method: 'POST', url: '/api/music/queue/next', payload: { deviceId: speaker.id } })
    expect(next.statusCode).toBe(200)
    expect(t.resolved.filter((r) => r.user !== 'alice')).toEqual([])
    t.clock.t += 10_000
    t.publish({ kind: 'media_player', playback: 'playing', nowPlaying: { title: 'Beta', positionS: 30 } })
    expect(t.progress).toHaveBeenLastCalledWith('b', 30, 600, false, 'alice')
    t.music.stop()
    await t.app.close()
  })

  it('never hands a stream resolved for one account to another', async () => {
    const t = await boot()
    await t.app.inject({ method: 'POST', url: '/api/music/queue', headers: t.as('alice'), payload: { deviceId: speaker.id, tracks } })
    await flush()
    expect(t.resolved).toContainEqual({ id: 'b', user: 'alice' })
    // la maison lance `b` : celle préparée pour Alice ne sert pas, `b` est résolue pour la maison
    const house = await t.app.inject({ method: 'POST', url: '/api/music/play', payload: { deviceId: speaker.id, ...tracks[1] } })
    expect(house.statusCode).toBe(200)
    expect(t.resolved).toContainEqual({ id: 'b', user: null })
    t.music.stop()
    await t.app.close()
  })

  it('notes a browser listening for the account of that browser', async () => {
    const t = await boot()
    const local = await t.app.inject({ method: 'POST', url: '/api/music/local', headers: t.as('bob'), payload: { ...tracks[0], clientId: 'browser-1234' } })
    expect(local.statusCode).toBe(200)
    expect(t.resolved).toEqual([{ id: 'a', user: 'bob' }])
    await t.app.inject({ method: 'POST', url: '/api/music/progress', headers: t.as('bob'), payload: { source: 'fake', id: 'a', positionS: 300 } })
    expect(t.progress).toHaveBeenLastCalledWith('a', 300, undefined, false, 'bob')
    await t.app.inject({ method: 'POST', url: '/api/music/progress', payload: { source: 'fake', id: 'a', positionS: 310 } })
    expect(t.progress).toHaveBeenLastCalledWith('a', 310, undefined, false, null)
    t.music.stop()
    await t.app.close()
  })
})
