import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import type { ChannelColor, LightArea, LightStream, LightStreamer } from '../../core/lightStreamBridge'
import type { Decoding } from './decode'
import { memoryLightSyncSettings, type LightSyncSettingsByRoom } from './settingsFile'
import { LightSync, type PlayerReading } from './sync'

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

const AREA: LightArea = { id: 'area-1', name: 'Chambre 2', channels: [{ id: 0, x: -1, y: 0, z: 0 }, { id: 1, x: 1, y: 0, z: 0 }] }

function setup(saved: LightSyncSettingsByRoom = {}) {
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
  const decodes: { url: string; startS: number; stop: ReturnType<typeof vi.fn>; state: { done: boolean; failed: boolean; span: number; error?: string } }[] = []
  const decode = vi.fn((url: string, startS: number): Decoding => {
    const stop = vi.fn()
    const state: { done: boolean; failed: boolean; span: number; error?: string } = { done: false, failed: false, span: 30 }
    decodes.push({ url, startS, stop, state })
    const features = {
      startS,
      get endS() { return startS + state.span },
      at: (pos: number) => (pos >= startS && pos < startS + state.span ? { low: 1, mid: 0, high: 0, onset: 0 } : undefined),
    }
    return { features, get done() { return state.done }, get failed() { return state.failed }, get error() { return state.error }, stop }
  })
  const sessions = new Map<string, { sid: string; sourceUrl: string; artUrl?: string }>()
  const settingsStore = memoryLightSyncSettings(saved)
  const coverColors = vi.fn(async (url: string) => (url.includes('blue') ? ['#0000ff', '#00ffff'] : []))
  const states = new Map<string, PlayerReading>()
  let hue: LightStreamer | null = streamer
  const sync = new LightSync({
    session: (id) => sessions.get(id),
    playerState: (id) => states.get(id),
    room: (id) => (id === 'cast:speaker-1' || id === 'cast:speaker-2' ? { id: 'room-2', name: 'Chambre 2' } : id === 'cast:hall' ? { id: 'hall', name: 'Entrée' } : null),
    sceneColors: (id) => (id === 'scene-green' ? ['#00ff00', '#008800'] : undefined),
    coverColors,
    settingsStore,
    roomLights: (id) => (id === 'cast:speaker-1' || id === 'cast:speaker-2' ? ['hue:lamp-1'] : id === 'cast:hall' ? ['hue:other'] : null),
    streamer: () => hue,
    decode,
    clock,
    logger: pino({ level: 'silent' }),
  })
  const play = (id: string, sid: string, positionS = 0, artUrl?: string) => {
    sessions.set(id, { sid, sourceUrl: `https://source.example.org/${sid}`, ...(artUrl ? { artUrl } : {}) })
    states.set(id, { playback: 'playing', positionS, updatedAt: clock.now() })
  }
  const step = async (ms: number) => {
    for (let t = 0; t < ms; t += 10) { clock.advance(10); await flush() }
  }
  return { settingsStore, coverColors, clock, sync, streamer, streams, frames, decode, decodes, sessions, states, play, step, noHue: () => { hue = null } }
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

describe('LightSync settings', () => {
  const peak = (frame: ChannelColor[]) => Math.max(...frame.map((c) => Math.max(c.r, c.g, c.b)))

  it('starts from the defaults, per room, and says which colours it uses', async () => {
    const t = setup()
    await t.sync.ready
    const s = t.sync.status('cast:speaker-1')
    expect(s.room).toEqual({ id: 'room-2', name: 'Chambre 2' })
    expect(s.settings).toEqual({ effect: 'pulse', palette: { source: 'preset', preset: 'warm' }, energy: 0.5, brightness: 1 })
    expect(s.palette?.length).toBeGreaterThan(1)
  })

  it('saves a change for the room, shared by the speakers of that room, and refuses where there is no room', async () => {
    const t = setup()
    const s = await t.sync.setSettings('cast:speaker-1', { effect: 'wave', energy: 0.9 })
    expect(s?.settings).toMatchObject({ effect: 'wave', energy: 0.9, brightness: 1 })
    expect(t.sync.status('cast:speaker-2').settings?.effect).toBe('wave')
    expect(await t.settingsStore.load()).toMatchObject({ 'room-2': { effect: 'wave' } })
    expect(await t.sync.setSettings('cast:nowhere', { effect: 'wave' })).toBeNull()
    await expect(t.sync.setSettings('cast:speaker-1', { energy: 3 })).rejects.toThrow()
  })

  it('finds the saved settings again after a restart', async () => {
    const t = setup({ 'room-2': { effect: 'strobe', palette: { source: 'preset', preset: 'neon' }, energy: 1, brightness: 0.5 } })
    await t.sync.ready
    expect(t.sync.status('cast:speaker-1').settings?.effect).toBe('strobe')
  })

  it('applies a change to the running lights at once: brightness, then another effect', async () => {
    const t = setup()
    t.play('cast:speaker-1', 'sid-1')
    await t.sync.set('cast:speaker-1', true)
    await t.step(500)
    expect(peak(t.frames.at(-1)!)).toBeGreaterThan(0.9)
    await t.sync.setSettings('cast:speaker-1', { brightness: 0.4 })
    await t.step(40)
    expect(peak(t.frames.at(-1)!)).toBeLessThanOrEqual(0.4 + 1e-9)
    await t.sync.setSettings('cast:speaker-1', { effect: 'strobe', energy: 1, brightness: 1 })
    await t.step(200)
    expect(peak(t.frames.at(-1)!)).toBe(0)        // strobe: dark without an attack (the fake features have none)
    expect(t.streamer.open).toHaveBeenCalledTimes(1)
  })

  it('uses a scene of the room, and the cover of each track once known', async () => {
    const t = setup()
    await t.sync.setSettings('cast:speaker-1', { palette: { source: 'scene', sceneId: 'scene-green' } })
    expect(t.sync.status('cast:speaker-1').palette).toEqual(['#00ff00', '#008800'])
    t.play('cast:speaker-1', 'sid-1', 0, 'https://img.example.org/blue.jpg')
    await t.sync.set('cast:speaker-1', true)
    await t.sync.setSettings('cast:speaker-1', { palette: { source: 'cover' } })
    await t.step(300)
    expect(t.coverColors).toHaveBeenCalledWith('https://img.example.org/blue.jpg')
    expect(t.sync.status('cast:speaker-1').palette).toEqual(['#0000ff', '#00ffff'])
    const last = t.frames.at(-1)!
    expect(Math.max(...last.map((c) => c.b))).toBeGreaterThan(Math.max(...last.map((c) => c.r)))
    // a grey cover (no colours): the last colours stay rather than a jump to the default
    t.play('cast:speaker-1', 'sid-2', 0, 'https://img.example.org/grey.jpg')
    await t.step(300)
    expect(t.sync.status('cast:speaker-1').palette).toEqual(['#0000ff', '#00ffff'])
    expect(t.coverColors).toHaveBeenCalledTimes(2)
  })
})

describe('LightSync recovery', () => {
  it('restarts a sound analysis that failed partway, less and less often, and says so meanwhile', async () => {
    const t = setup()
    t.play('cast:speaker-1', 'sid-1', 0)
    await t.sync.set('cast:speaker-1', true)
    await t.step(300)
    Object.assign(t.decodes[0]!.state, { done: true, failed: true, span: 1 })   // the source cut after 1 s
    await t.step(1500)
    expect(t.decodes).toHaveLength(2)                                       // restarted at the speaker's position
    expect(t.decodes[1]!.startS).toBeGreaterThan(0)
    Object.assign(t.decodes[1]!.state, { done: true, failed: true, span: 0, error: 'HTTP error 403 Forbidden' })   // fails again at once
    await t.step(1000)
    expect(t.sync.status('cast:speaker-1')).toMatchObject({ problem: 'decode', problemDetail: 'HTTP error 403 Forbidden' })   // ffmpeg's own words
    expect(t.decodes).toHaveLength(2)                                       // waiting: 2 s before the second try
    await t.step(1500)
    expect(t.decodes).toHaveLength(3)
    await t.step(300)                                                       // this one works
    expect(t.sync.status('cast:speaker-1').problem).toBeUndefined()
  })

  it('never restarts an analysis that simply reached the end of the track', async () => {
    const t = setup()
    t.play('cast:speaker-1', 'sid-1', 0)
    await t.sync.set('cast:speaker-1', true)
    await t.step(300)
    Object.assign(t.decodes[0]!.state, { done: true, failed: false, span: 0.2 })
    await t.step(12_000)
    expect(t.decodes).toHaveLength(1)
  })

  it('reports a stream the bridge ended until a new one opens, and switching on again retries at once', async () => {
    const t = setup()
    t.play('cast:speaker-1', 'sid-1')
    await t.sync.set('cast:speaker-1', true)
    await t.step(300)
    t.streams[0]!.end('the bridge stopped the entertainment area')
    await t.step(500)
    expect(t.sync.status('cast:speaker-1')).toMatchObject({ on: true, active: false, problem: 'stream', problemDetail: 'the bridge stopped the entertainment area' })
    await t.sync.set('cast:speaker-1', false)
    await t.sync.set('cast:speaker-1', true)
    await t.step(300)
    expect(t.streamer.open).toHaveBeenCalledTimes(2)                        // not 10 s later
    expect(t.sync.status('cast:speaker-1')).toMatchObject({ active: true })
    expect(t.sync.status('cast:speaker-1').problem).toBeUndefined()
  })
})
