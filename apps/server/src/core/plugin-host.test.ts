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

// Démarrage raté d'un plugin : l'hôte retente, de plus en plus espacé, sauf si c'est un appairage.

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

/** Plugin dont `discover` échoue les `failures` premières fois, avec l'erreur donnée. */
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
    expect(h.health().flaky).toMatchObject({ status: 'error', detail: expect.stringContaining('retry in') })
    clock.advance(1200); await flush()                      // 2ᵉ essai, raté aussi : délai doublé
    expect(calls.discover).toBe(2)
    clock.advance(1200); await flush()
    expect(calls.discover).toBe(2)                          // pas encore : ~2 s cette fois
    clock.advance(1200); await flush()
    expect(calls.discover).toBe(3)
    expect(h.health().flaky).toMatchObject({ status: 'ok' })
    expect(calls.stop).toBeGreaterThanOrEqual(2)            // chaque essai repart d'un plugin arrêté
    await h.stopAll()
  })

  it('does not retry a missing or rejected pairing: that is for the user to fix', async () => {
    const clock = new ManualClock(0)
    const { plugin, calls } = flaky(5, () => new PluginError('NEEDS_PAIRING', 'token rejected'))
    const h = host(plugin, clock)
    await h.startAll()
    clock.advance(60_000); await flush()
    expect(calls.discover).toBe(1)
    expect(h.health().flaky).toMatchObject({ status: 'error', detail: 'token rejected' })
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
    expect(h.health().flaky).toMatchObject({ status: 'disabled' })
  })
})
