import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bus } from '../core/bus'
import { waitForDevices } from './bridge'

describe('waitForDevices (the bridge goes online with its devices)', () => {
  afterEach(() => { vi.useRealTimers() })

  const registryOf = (known: Set<string>) => ({ get: (id: string) => (known.has(id) ? ({} as never) : undefined) })
  const settled = async (p: Promise<void>): Promise<boolean> => {
    let done = false
    void p.then(() => { done = true })
    await Promise.resolve()
    await Promise.resolve()
    return done
  }

  it('resolves at once when every device is already known', async () => {
    const bus = new Bus()
    const { done } = waitForDevices(['a', 'b'], registryOf(new Set(['a', 'b'])), bus, 60_000)
    expect(await settled(done)).toBe(true)
    expect(bus.listenerCount('devices')).toBe(0)
  })

  it('waits for the last listed device to be registered, then stops listening', async () => {
    const bus = new Bus()
    const known = new Set(['a'])
    const { done } = waitForDevices(['a', 'b'], registryOf(known), bus, 60_000)
    bus.emit('devices', [])
    expect(await settled(done)).toBe(false)
    known.add('b')
    bus.emit('devices', [])
    expect(await settled(done)).toBe(true)
    expect(bus.listenerCount('devices')).toBe(0)
  })

  it('gives up after the timeout when a device never comes', async () => {
    vi.useFakeTimers()
    const bus = new Bus()
    const { done } = waitForDevices(['a'], registryOf(new Set()), bus, 60_000)
    vi.advanceTimersByTime(59_999)
    expect(await settled(done)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(await settled(done)).toBe(true)
    expect(bus.listenerCount('devices')).toBe(0)
  })

  it('stops waiting when cancelled (the server stops during the start)', async () => {
    const bus = new Bus()
    const { done, cancel } = waitForDevices(['a'], registryOf(new Set()), bus, 60_000)
    cancel()
    expect(await settled(done)).toBe(true)
    expect(bus.listenerCount('devices')).toBe(0)
  })
})
