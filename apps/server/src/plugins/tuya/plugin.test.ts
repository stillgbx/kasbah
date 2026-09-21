import { EventEmitter } from 'node:events'
import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '../../core/plugin'
import { CONNECT_FULL, DELTA_FAN_SPEED_4, DELTA_LIGHT_OFF } from './__fixtures__/tuya'
import type { TuyaSocket, TuyaSocketFactory } from './client'
import { createTuyaPlugin, tuyaConfigSchema } from './index'
import type { TuyaDps } from './types'

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }

const DEVICE = {
  id: 'bf0000000000000000abcd',
  key: 'xxxxxxxxxxxxxxxx',
  ip: '192.168.1.56',
  name: 'Ventilateur plafonnier chambre 2',
  version: '3.5',
}

/** Fausse socket tuyapi : EventEmitter + connect/set contrôlés. */
function fakeSocketFactory() {
  const sockets: FakeSocket[] = []
  let connectImpl: (s: FakeSocket) => Promise<void> = async (s) => {
    s.emit('data', { dps: CONNECT_FULL })
  }
  const createSocket: TuyaSocketFactory = () => {
    const s = new FakeSocket()
    sockets.push(s)
    s.connectImpl = () => connectImpl(s)
    return s
  }
  return {
    createSocket,
    sockets,
    setConnect(fn: (s: FakeSocket) => Promise<void>) { connectImpl = fn },
    last(): FakeSocket { return sockets.at(-1)! },
  }
}

class FakeSocket extends EventEmitter implements TuyaSocket {
  connected = false
  writes: { dps: number; set: unknown }[] = []
  connectImpl: () => Promise<void> = async () => undefined
  dropOnWrite = false

  async connect(): Promise<void> {
    await this.connectImpl()
    this.connected = true
    this.emit('connected')
  }

  disconnect(): void {
    this.connected = false
    this.emit('disconnected')
  }

  async set(opts: { dps: number; set: unknown }): Promise<unknown> {
    this.writes.push(opts)
    if (this.dropOnWrite) return { success: true } // accusé menteur — pas d'événement
    // Effet réel : publier le DP (et allumer le ventilateur si vitesse — piège 1)
    const dps: TuyaDps = { [String(opts.dps)]: opts.set }
    if (opts.dps === 62) dps['60'] = true
    queueMicrotask(() => this.emit('data', { dps }))
    return { success: true }
  }
}

function fakeContext(clock: ManualClock, devices = [DEVICE]): { ctx: PluginContext; ctrl: AbortController } {
  const ctrl = new AbortController()
  const cfg = tuyaConfigSchema.parse({ TUYA_DEVICES: JSON.stringify(devices), TUYA_RECONNECT_MS: 100 })
  const ctx: PluginContext = {
    pluginId: 'tuya', config: cfg, logger: pino({ level: 'silent' }), clock, signal: ctrl.signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  return { ctx, ctrl }
}

const patches = (ctx: PluginContext, externalId: string) =>
  (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === externalId).map((c) => c[1] as Record<string, unknown>)

describe('tuya plugin', () => {
  afterEach(() => vi.useRealTimers())

  it('discover() déclare les deux appareils sans réseau', async () => {
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock)
    const fake = fakeSocketFactory()
    const plugin = createTuyaPlugin({ createSocket: fake.createSocket })
    await plugin.init(ctx)
    const list = await plugin.discover()
    expect(list.map((d) => d.kind)).toEqual(['light', 'fan'])
    expect(fake.sockets).toHaveLength(0)
  })

  it('start() connecte et publie l\'état complet', async () => {
    const clock = new ManualClock(0)
    const { ctx, ctrl } = fakeContext(clock)
    const fake = fakeSocketFactory()
    const plugin = createTuyaPlugin({ createSocket: fake.createSocket })
    await plugin.init(ctx)
    await plugin.start()
    await flush()
    expect(patches(ctx, `${DEVICE.id}_light`).at(-1)).toMatchObject({ on: true, colorTempMirek: 303 })
    expect(patches(ctx, `${DEVICE.id}_fan`).at(-1)).toMatchObject({ on: false, speed: 3 })
    ctrl.abort()
    await plugin.stop()
  })

  it('reconnecte après une coupure (piège 5)', async () => {
    const clock = new ManualClock(0)
    const { ctx, ctrl } = fakeContext(clock)
    const fake = fakeSocketFactory()
    let connects = 0
    fake.setConnect(async (s) => {
      connects++
      s.emit('data', { dps: CONNECT_FULL })
    })
    const plugin = createTuyaPlugin({ createSocket: fake.createSocket })
    await plugin.init(ctx)
    await plugin.start()
    await flush()
    expect(connects).toBe(1)
    fake.last().disconnect()
    await flush()
    clock.advance(100)
    await flush(20)
    expect(connects).toBeGreaterThanOrEqual(2)
    ctrl.abort()
    await plugin.stop()
  })

  it('execute light.set attend l\'effet, pas l\'accusé', async () => {
    const clock = new ManualClock(0)
    const { ctx, ctrl } = fakeContext(clock)
    const fake = fakeSocketFactory()
    const plugin = createTuyaPlugin({ createSocket: fake.createSocket, commandTimeoutMs: 500 })
    await plugin.init(ctx)
    await plugin.start()
    await flush()
    await plugin.execute(`${DEVICE.id}_light`, { type: 'light.set', on: false })
    expect(fake.last().writes).toContainEqual({ dps: 20, set: false })
    // Le fake publie l'effet ; un delta RF arrive aussi
    fake.last().emit('data', { dps: DELTA_LIGHT_OFF })
    await flush()
    expect(patches(ctx, `${DEVICE.id}_light`).some((p) => p.on === false)).toBe(true)
    ctrl.abort()
    await plugin.stop()
  })

  it('execute fan.set speed écrit le DP 62', async () => {
    const clock = new ManualClock(0)
    const { ctx, ctrl } = fakeContext(clock)
    const fake = fakeSocketFactory()
    const plugin = createTuyaPlugin({ createSocket: fake.createSocket, commandTimeoutMs: 500 })
    await plugin.init(ctx)
    await plugin.start()
    await flush()
    await plugin.execute(`${DEVICE.id}_fan`, { type: 'fan.set', speed: 4 })
    expect(fake.last().writes).toContainEqual({ dps: 62, set: 4 })
    fake.last().emit('data', { dps: DELTA_FAN_SPEED_4 })
    await flush()
    expect(patches(ctx, `${DEVICE.id}_fan`).some((p) => p.speed === 4 && p.on === true)).toBe(true)
    ctrl.abort()
    await plugin.stop()
  })

  it('refuse une température hors crans', async () => {
    const clock = new ManualClock(0)
    const { ctx, ctrl } = fakeContext(clock)
    const fake = fakeSocketFactory()
    const plugin = createTuyaPlugin({ createSocket: fake.createSocket })
    await plugin.init(ctx)
    await plugin.start()
    await flush()
    await expect(plugin.execute(`${DEVICE.id}_light`, { type: 'light.set', colorTempMirek: 280 }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    ctrl.abort()
    await plugin.stop()
  })

  it('health needs_pairing sans appareils', async () => {
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock, [])
    const plugin = createTuyaPlugin({ createSocket: fakeSocketFactory().createSocket })
    await plugin.init(ctx)
    expect(plugin.health?.()).toMatchObject({ status: 'needs_pairing' })
  })
})
