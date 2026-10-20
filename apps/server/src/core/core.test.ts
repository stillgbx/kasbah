import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { DeviceDescriptor } from '@kasbah/shared'
import { createBackoff } from './backoff'
import { Bus } from './bus'
import { createPoller, withTimeout } from './poll'
import { TokenBucket } from './rate-limit'
import { DeviceRegistry } from './registry'
import { SceneRegistry } from './scene-registry'
import { connectSse, parseSse } from './sse'
import { PluginError } from './plugin'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('backoff', () => {
  it('grows exponentially, is bounded and resets', () => {
    const b = createBackoff({ initialMs: 100, maxMs: 1000, factor: 2, jitter: 0 })
    expect([b.next(), b.next(), b.next(), b.next(), b.next()]).toEqual([100, 200, 400, 800, 1000])
    b.reset()
    expect(b.next()).toBe(100)
  })
  it('applies jitter within bounds', () => {
    const b = createBackoff({ initialMs: 1000, jitter: 0.2, rng: () => 1 })
    expect(b.next()).toBe(1200)
  })
})

describe('poller', () => {
  it('runs immediately, then every interval on success, backs off on error', async () => {
    const clock = new ManualClock(0)
    const calls: number[] = []
    let fail = true
    const ctrl = new AbortController()
    const p = createPoller({
      name: 't', intervalMs: 1000, clock, signal: ctrl.signal,
      backoff: createBackoff({ initialMs: 500, jitter: 0 }),
      fn: async () => { calls.push(clock.now()); if (fail) throw new Error('boom') },
    })
    await flush()
    expect(calls).toEqual([0])
    clock.advance(499); await flush()
    expect(calls).toHaveLength(1)
    clock.advance(1); await flush()           // backoff 500 ms
    expect(calls).toEqual([0, 500])
    fail = false
    clock.advance(1000); await flush()        // backoff 1000 ms (2nd failure)
    expect(calls).toEqual([0, 500, 1500])
    clock.advance(1000); await flush()        // success → normal interval
    expect(calls).toEqual([0, 500, 1500, 2500])
    p.stop()
    clock.advance(5000); await flush()
    expect(calls).toHaveLength(4)
  })
  it('withTimeout rejects with PluginError TIMEOUT', async () => {
    const clock = new ManualClock(0)
    const never = new Promise<void>(() => {})
    const p = withTimeout(never, 100, clock, 'x')
    clock.advance(100)
    await expect(p).rejects.toBeInstanceOf(PluginError)
    await expect(p).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})

describe('token bucket', () => {
  it('limits and refills over time', () => {
    const clock = new ManualClock(0)
    const b = new TokenBucket(2, 1, clock)
    expect(b.tryTake()).toBe(true)
    expect(b.tryTake()).toBe(true)
    expect(b.tryTake()).toBe(false)
    expect(b.waitMs()).toBe(1000)
    clock.advance(1000)
    expect(b.tryTake()).toBe(true)
  })
})

describe('registry', () => {
  const light: DeviceDescriptor = { id: 'p:a', pluginId: 'p', externalId: 'a', kind: 'light', name: 'A', capabilities: ['on_off'], meta: {} }
  const cover: DeviceDescriptor = { id: 'p:b', pluginId: 'p', externalId: 'b', kind: 'cover', name: 'B', capabilities: ['position'], meta: {} }
  it('seeds default states and publishes only real changes', () => {
    const bus = new Bus(), clock = new ManualClock(1000)
    const states = vi.fn(), devices = vi.fn()
    bus.on('state', states); bus.on('devices', devices)
    const reg = new DeviceRegistry(bus, clock)
    reg.register('p', [light, cover])
    expect(devices).toHaveBeenCalledTimes(1)
    expect(reg.get('p:a')!.state).toMatchObject({ kind: 'light', available: false, on: false })
    expect(reg.applyPatch('p:a', { on: true, available: true })).toBe(true)
    expect(states).toHaveBeenCalledWith('p:a', expect.objectContaining({ on: true, available: true, updatedAt: 1000 }))
    expect(reg.applyPatch('p:a', { on: true })).toBe(false)
    expect(states).toHaveBeenCalledTimes(1)
    expect(reg.applyPatch('p:a', { position: 3 } as never)).toBe(false)     // invalid for a light
    expect(reg.applyPatch('p:zzz', { on: true })).toBe(false)
  })
  it('bulk availability and re-registration', () => {
    const bus = new Bus(), clock = new ManualClock(0)
    const avail = vi.fn()
    bus.on('availability', avail)
    const reg = new DeviceRegistry(bus, clock)
    reg.register('p', [light, cover])
    reg.applyPatch('p:a', { available: true }); reg.applyPatch('p:b', { available: true })
    expect(reg.setAvailable('p', '*', false)).toEqual(['p:a', 'p:b'])
    expect(avail).toHaveBeenCalledWith(['p:a', 'p:b'], false)
    expect(reg.setAvailable('p', '*', false)).toEqual([])
    reg.register('p', [light])
    expect(reg.has('p:b')).toBe(false)
    expect(reg.get('p:a')!.state.available).toBe(false)       // state kept
    expect(reg.countOf('p')).toBe(1)
  })
})

describe('scene registry', () => {
  const scene = (id: string, group?: string, dynamic = false) => ({
    id: `hue:${id}`, pluginId: 'hue', externalId: id, name: id, dynamic, autoDynamic: false, swatches: [],
    ...(group ? { group: { name: group, kind: 'room' as const } } : {}),
  })

  it('keeps the activation of scenes that survive a re-registration, drops the others', () => {
    const bus = new Bus()
    const clock = new ManualClock(1000)
    const reg = new SceneRegistry(bus, clock)
    const seen: [string, string][] = []
    bus.on('scene', (id, state) => seen.push([id, state.active]))
    reg.register('hue', [scene('a', 'Salon'), scene('b', 'Salon')])
    reg.setActive('hue:a', 'static')
    expect(reg.get('hue:a')!.state).toEqual({ active: 'static', updatedAt: 1000 })
    reg.register('hue', [scene('a', 'Salon')])
    expect(reg.get('hue:a')!.state.active).toBe('static')
    expect(reg.get('hue:b')).toBeUndefined()
    expect(seen).toEqual([['hue:a', 'static']])
  })

  it('one active scene per group: activating a sibling deactivates the previous one', () => {
    const bus = new Bus()
    const reg = new SceneRegistry(bus, new ManualClock(0))
    reg.register('hue', [scene('a', 'Salon'), scene('b', 'Salon', true), scene('c', 'Cuisine')])
    reg.setActive('hue:a', 'static')
    reg.setActive('hue:c', 'static')
    reg.setActive('hue:b', 'dynamic')
    expect(reg.list().map((e) => [e.scene.externalId, e.state.active])).toEqual([['a', 'inactive'], ['b', 'dynamic'], ['c', 'static']])
    expect(reg.setActive('hue:unknown', 'static')).toBe(false)
  })

  it('rejects a scene whose id does not match its plugin and external id', () => {
    const bus = new Bus()
    const reg = new SceneRegistry(bus, new ManualClock(0))
    reg.register('hue', [{ ...scene('a'), id: 'hue:other' }])
    expect(reg.list()).toEqual([])
  })
})

describe('sse', () => {
  const stream = (chunks: string[]) => new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close() },
  })
  it('parses events split across chunks and multi-line data', async () => {
    const text = 'id: 1\ndata: {"a":\ndata: 1}\n\n: comment\nevent: ping\ndata: x\r\n\r\ndata: tail\n'
    const chunks = [text.slice(0, 7), text.slice(7, 20), text.slice(20)]
    const events = []
    for await (const ev of parseSse(stream(chunks))) events.push(ev)
    expect(events).toEqual([
      { id: '1', data: '{"a":\n1}' },
      { event: 'ping', data: 'x' },
      { data: 'tail' },
    ])
  })
  it('reconnects with backoff and resyncs on reopen', async () => {
    const clock = new ManualClock(0)
    const ctrl = new AbortController()
    const calls: number[] = []
    const events: string[] = []
    const opens: boolean[] = []
    const fetchImpl = vi.fn(async () => {
      calls.push(clock.now())
      if (calls.length <= 2) throw new Error('ECONNREFUSED')
      return { ok: true, status: 200, body: stream(['data: hello\n\n']), json: async () => ({}), text: async () => '' }
    })
    const done = connectSse({
      url: 'https://b/eventstream', fetchImpl, signal: ctrl.signal, clock,
      onEvent: (ev) => events.push(ev.data), onOpen: (r) => { opens.push(r) },
    })
    await flush()
    expect(calls).toHaveLength(1)
    clock.advance(1300); await flush()          // 1 s ± 20 %
    expect(calls).toHaveLength(2)
    clock.advance(2500); await flush()          // 2 s ± 20 %
    expect(calls).toHaveLength(3)
    await flush()
    expect(events).toEqual(['hello'])
    expect(opens).toEqual([false])
    clock.advance(5000); await flush()          // the stream ended → reconnection
    expect(calls).toHaveLength(4)
    await flush()
    expect(opens).toEqual([false, true])
    ctrl.abort()
    clock.advance(60_000)
    await done
  })
})
