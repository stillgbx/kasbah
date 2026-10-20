import { ManualClock } from '@kasbah/mock-sim'
import { DEFAULT_PLUGIN_SETTINGS } from '@kasbah/shared'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Bus } from './bus'
import { PluginError, type DevicePlugin } from './plugin'
import { PluginHost } from './plugin-host'
import { DeviceRegistry } from './registry'
import { SceneRegistry } from './scene-registry'

// Failed plugin start: the host retries, more and more spaced out, unless it is a pairing issue.

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

/** Plugin whose `discover` fails the first `failures` times, with the given error. */
function flaky(failures: number, error: () => Error) {
  const calls = { discover: 0, stop: 0 }
  const plugin: DevicePlugin = {
    id: 'flaky',
    configSchema: z.object({}),
    async init() {},
    async discover() { if (calls.discover++ < failures) throw error(); return [] },
    async start() {},
    async execute() {},
    async stop() { calls.stop++ },
  }
  return { plugin, calls }
}

function host(plugin: DevicePlugin, clock: ManualClock, enabled = { value: true }) {
  const logger = pino({ level: 'silent' })
  const bus = new Bus()
  return new PluginHost({
    site: () => ({ lat: 0, lon: 0, alt: 0 }),
    settingsOf: () => ({ ...DEFAULT_PLUGIN_SETTINGS, enabled: enabled.value }),
    strict: false,
    factories: { flaky: () => plugin },
    registry: new DeviceRegistry(bus, clock), scenes: new SceneRegistry(bus, clock), bus, clock, logger,
    envSource: {}, retryInitialMs: 1000,
  })
}

describe('plugin host start retry', () => {
  it('retries a plugin whose vendor was unreachable at startup, until it starts', async () => {
    const clock = new ManualClock(0)
    const { plugin, calls } = flaky(2, () => new PluginError('UPSTREAM_ERROR', 'box unreachable (read ECONNRESET)'))
    const h = host(plugin, clock)
    await h.startAll()
    expect((await h.health()).flaky).toMatchObject({ status: 'error', detail: expect.stringContaining('retry in') })
    clock.advance(1200); await flush()                      // 2nd attempt, failed too: delay doubled
    expect(calls.discover).toBe(2)
    clock.advance(1200); await flush()
    expect(calls.discover).toBe(2)                          // not yet: ~2 s this time
    clock.advance(1200); await flush()
    expect(calls.discover).toBe(3)
    expect((await h.health()).flaky).toMatchObject({ status: 'ok' })
    expect(calls.stop).toBeGreaterThanOrEqual(2)            // each attempt starts again from a stopped plugin
    await h.stopAll()
  })

  it('does not retry a missing or rejected pairing: that is for the user to fix', async () => {
    const clock = new ManualClock(0)
    const { plugin, calls } = flaky(5, () => new PluginError('NEEDS_PAIRING', 'token rejected'))
    const h = host(plugin, clock)
    await h.startAll()
    clock.advance(60_000); await flush()
    expect(calls.discover).toBe(1)
    expect((await h.health()).flaky).toMatchObject({ status: 'error', detail: 'token rejected' })
    await h.stopAll()
  })

  it('drops a pending retry when the plugin is switched off', async () => {
    const clock = new ManualClock(0)
    const enabled = { value: true }
    const { plugin, calls } = flaky(5, () => new Error('network down'))
    const h = host(plugin, clock, enabled)
    await h.startAll()
    enabled.value = false
    await h.apply('flaky')
    clock.advance(60_000); await flush()
    expect(calls.discover).toBe(1)
    expect((await h.health()).flaky).toMatchObject({ status: 'disabled' })
  })
})

describe('plugin host startup', () => {
  it('starts plugins side by side: a slow vendor does not hold back the others', async () => {
    const clock = new ManualClock(0)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const make = (id: string, discover: () => Promise<void>): DevicePlugin => ({
      id, configSchema: z.object({}),
      async init() {}, async discover() { await discover(); return [] }, async start() {}, async execute() {}, async stop() {},
    })
    const h = new PluginHost({
      site: () => ({ lat: 0, lon: 0, alt: 0 }),
      settingsOf: () => ({ ...DEFAULT_PLUGIN_SETTINGS, enabled: true }),
      strict: false,
      factories: { slow: () => make('slow', () => gate), fast: () => make('fast', async () => {}) },
      registry: new DeviceRegistry(new Bus(), clock), scenes: new SceneRegistry(new Bus(), clock), bus: new Bus(), clock,
      logger: pino({ level: 'silent' }), envSource: {},
    })
    const all = h.startAll()
    await flush()
    expect((await h.health()).fast).toMatchObject({ status: 'ok' })  // started without waiting for `slow`
    expect((await h.health()).slow).not.toMatchObject({ status: 'ok' })
    release()
    await all
    expect((await h.health()).slow).toMatchObject({ status: 'ok' })
    await h.stopAll()
  })
})

describe('plugin host health per account', () => {
  it('gives a signed-in user the health of their own accounts, and the house its own', async () => {
    const plugin: DevicePlugin = {
      ...flaky(0, () => new Error('never')).plugin,
      health: () => ({ status: 'needs_pairing', detail: 'house: link the account' }),
      async healthFor(user) {
        if (user === 'eve') throw new Error('unreadable state')
        return { status: 'ok', detail: `${user}: linked` }
      },
    }
    const h = host(plugin, new ManualClock(0))
    await h.startAll()
    expect((await h.health()).flaky).toMatchObject({ status: 'needs_pairing', detail: 'house: link the account' })
    expect((await h.health('bob')).flaky).toMatchObject({ status: 'ok', detail: 'bob: linked' })
    expect((await h.inventory('bob'))[0]!.health).toMatchObject({ status: 'ok', detail: 'bob: linked' })
    // an unreadable per-account health does not bring down the inventory
    expect((await h.inventory('eve'))[0]!.health).toMatchObject({ status: 'needs_pairing' })
    await h.stopAll()
  })
})
