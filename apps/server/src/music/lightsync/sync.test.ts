import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import type { ChannelColor, LightArea, LightStream, LightStreamer } from '../../core/lightStreamBridge'
import type { Decoding } from './decode'
import { PulseEffect } from './effect'
import { LightSync, type PlayerReading } from './sync'

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

const AREA: LightArea = { id: 'area-1', name: 'Chambre 2', channels: [{ id: 0, x: -1, y: 0, z: 0 }, { id: 1, x: 1, y: 0, z: 0 }] }

function setup() {
  const clock = new ManualClock(1_000_000)
  const frames: ChannelColor[][] = []
  const streams: { closed: boolean; end: (reason: string) => void }[] = []
  const streamer: LightStreamer = {
    areaFor: (lights) => (lights.includes('hue:lamp-1') ? AREA : undefined),
    open: vi.fn(async () => {
      let ended: (reason: string) => void = () => {}
      const s = { closed: false, end: (r: string) => ended(r) }
      streams.push(s)
      const stream: LightStream = {
        area: AREA,
        send: (c) => { if (!s.closed) frames.push([...c]) },
        close: async () => { s.closed = true },
        onEnded: (cb) => { ended = cb },
      }
      return stream
    }),
  }
  const decodes: { url: string; startS: number; stop: ReturnType<typeof vi.fn> }[] = []
  const decode = vi.fn((url: string, startS: number): Decoding => {
    const stop = vi.fn()
    decodes.push({ url, startS, stop })
    return { features: { startS, endS: startS + 30, at: () => ({ low: 1, mid: 0, high: 0, onset: 0 }) }, done: false, stop }
  })
  const sessions = new Map<string, { sid: string; sourceUrl: string }>()
  const states = new Map<string, PlayerReading>()
  let hue: LightStreamer | null = streamer
  const sync = new LightSync({
    session: (id) => sessions.get(id),
    playerState: (id) => states.get(id),
    roomLights: (id) => (id === 'cast:speaker-1' || id === 'cast:speaker-2' ? ['hue:lamp-1'] : id === 'cast:hall' ? ['hue:other'] : null),
    streamer: () => hue,
    decode,
    clock,
    logger: pino({ level: 'silent' }),
  })
  const play = (id: string, sid: string, positionS = 0) => {
    sessions.set(id, { sid, sourceUrl: `https://source.example.org/${sid}` })
    states.set(id, { playback: 'playing', positionS, updatedAt: clock.now() })
  }
  const step = async (ms: number) => {
    for (let t = 0; t < ms; t += 10) { clock.advance(10); await flush() }
  }
  return { clock, sync, streamer, streams, frames, decode, decodes, sessions, states, play, step, noHue: () => { hue = null } }
}

describe('LightSync', () => {
  it('says why a room cannot be synced', () => {
    const t = setup()
    expect(t.sync.status('cast:nowhere')).toMatchObject({ available: false, reason: 'no_room' })
    expect(t.sync.status('cast:hall')).toMatchObject({ available: false, reason: 'no_area' })
    expect(t.sync.status('cast:speaker-1')).toMatchObject({ available: true, area: 'Chambre 2', on: false, active: false })
    t.noHue()
    expect(t.sync.status('cast:speaker-1')).toMatchObject({ available: false, reason: 'no_hue' })
  })

  it('refuses to switch on where it cannot work', async () => {
    const t = setup()
    expect(await t.sync.set('cast:hall', true)).toMatchObject({ on: false, reason: 'no_area' })
  })

  it('streams while the speaker plays our track, decoding the source from its position', async () => {
    const t = setup()
    t.play('cast:speaker-1', 'sid-1', 42)
    await t.sync.set('cast:speaker-1', true)
    await t.step(1000)
    expect(t.streamer.open).toHaveBeenCalledWith('area-1')
    expect(t.decodes[0]).toMatchObject({ url: 'https://source.example.org/sid-1' })
    expect(t.decodes[0]!.startS).toBeCloseTo(41, 1)
    expect(t.frames.length).toBeGreaterThan(40)          // ~50 frames per second
    const last = t.frames.at(-1)!
    expect(last.map((c) => c.id).sort()).toEqual([0, 1])
    expect(Math.max(last[0]!.r, last[0]!.g, last[0]!.b)).toBeGreaterThan(0.9)   // loud bass = full brightness
    expect(t.sync.status('cast:speaker-1')).toMatchObject({ on: true, active: true })
  })

  it('waits for something to play, and ignores a speaker playing something that is not ours', async () => {
    const t = setup()
    t.states.set('cast:speaker-1', { playback: 'playing', positionS: 3, updatedAt: t.clock.now() })   // no proxy session
    await t.sync.set('cast:speaker-1', true)
    await t.step(1000)
    expect(t.streamer.open).not.toHaveBeenCalled()
    t.play('cast:speaker-1', 'sid-1')
    await t.step(500)
    expect(t.streamer.open).toHaveBeenCalledTimes(1)
  })

  it('hands the lights back after a pause of 5 s, and takes them again on resume', async () => {
    const t = setup()
    t.play('cast:speaker-1', 'sid-1')
    await t.sync.set('cast:speaker-1', true)
    await t.step(500)
    t.states.set('cast:speaker-1', { playback: 'paused', positionS: 0.5, updatedAt: t.clock.now() })
    await t.step(4000)
    expect(t.streams[0]!.closed).toBe(false)
    await t.step(1500)
    expect(t.streams[0]!.closed).toBe(true)
    expect(t.decodes[0]!.stop).toHaveBeenCalled()
    expect(t.sync.status('cast:speaker-1')).toMatchObject({ on: true, active: false })
    t.states.set('cast:speaker-1', { playback: 'playing', positionS: 0.5, updatedAt: t.clock.now() })
    await t.step(500)
    expect(t.streamer.open).toHaveBeenCalledTimes(2)
  })

  it('decodes the next track when the queue moves on, and the new position after a seek', async () => {
    const t = setup()
    t.play('cast:speaker-1', 'sid-1', 10)
    await t.sync.set('cast:speaker-1', true)
    await t.step(300)
    t.play('cast:speaker-1', 'sid-2', 0)
    await t.step(100)
    expect(t.decodes.at(-1)).toMatchObject({ url: 'https://source.example.org/sid-2', startS: 0 })
    expect(t.decodes[0]!.stop).toHaveBeenCalled()
    t.play('cast:speaker-1', 'sid-2', 600)            // a jump far ahead of what was decoded
    await t.step(100)
    expect(t.decodes.at(-1)!.startS).toBeCloseTo(599, 0)
    expect(t.streamer.open).toHaveBeenCalledTimes(1)  // same stream throughout
  })

  it('one speaker at a time: switching another one on hands the stream over', async () => {
    const t = setup()
    t.play('cast:speaker-1', 'sid-1')
    t.play('cast:speaker-2', 'sid-2')
    await t.sync.set('cast:speaker-1', true)
    await t.step(300)
    await t.sync.set('cast:speaker-2', true)
    expect(t.streams[0]!.closed).toBe(true)
    expect(t.sync.status('cast:speaker-1').on).toBe(false)
    await t.step(300)
    expect(t.streamer.open).toHaveBeenCalledTimes(2)
    expect(t.decodes.at(-1)!.url).toContain('sid-2')
  })

  it('switching off closes the stream; a stream the bridge ends is retried later', async () => {
    const t = setup()
    t.play('cast:speaker-1', 'sid-1')
    await t.sync.set('cast:speaker-1', true)
    await t.step(300)
    t.streams[0]!.end('taken over by another app')
    await t.step(1000)
    expect(t.streamer.open).toHaveBeenCalledTimes(1)   // not hammered
    await t.step(10_000)
    expect(t.streamer.open).toHaveBeenCalledTimes(2)
    await t.sync.set('cast:speaker-1', false)
    expect(t.streams[1]!.closed).toBe(true)
    expect(t.sync.status('cast:speaker-1')).toMatchObject({ on: false, active: false })
  })
})

describe('PulseEffect', () => {
  const channels = AREA.channels
  const peak = (c: ChannelColor[]) => Math.max(...c.map((x) => Math.max(x.r, x.g, x.b)))

  it('follows the bass: bright on a hit, settling back towards the floor, never dark', () => {
    const fx = new PulseEffect(channels)
    for (let i = 0; i < 10; i++) fx.next({ low: 0.5, mid: 0, high: 0, onset: 0 }, 0.02)
    expect(peak(fx.next({ low: 0.5, mid: 0, high: 0, onset: 0 }, 0.02))).toBeGreaterThan(0.9)
    let out: ChannelColor[] = []
    for (let i = 0; i < 100; i++) out = fx.next({ low: 0, mid: 0, high: 0, onset: 0 }, 0.02)
    expect(peak(out)).toBeLessThan(0.2)
    expect(peak(out)).toBeGreaterThan(0.05)
  })

  it('swaps the colours on a strong attack, once per attack', () => {
    const fx = new PulseEffect(channels)
    const quiet = { low: 0.5, mid: 0, high: 0, onset: 0 }
    for (let i = 0; i < 50; i++) fx.next(quiet, 0.02)
    const before = fx.next(quiet, 0.02)
    fx.next({ ...quiet, onset: 1 }, 0.02)
    fx.next({ ...quiet, onset: 1 }, 0.02)               // same attack, second frame: no second swap
    let after: ChannelColor[] = []
    for (let i = 0; i < 50; i++) after = fx.next(quiet, 0.02)
    // the left channel now shows what the right one showed
    expect(after[0]!.r).toBeCloseTo(before[1]!.r, 2)
    expect(after[0]!.b).toBeCloseTo(before[1]!.b, 2)
  })
})
