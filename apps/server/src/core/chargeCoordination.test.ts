import { ManualClock } from '@kasbah/mock-sim'
import { DEFAULT_PLUGIN_SETTINGS, type Command, type DeviceDescriptor } from '@kasbah/shared'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Bus } from './bus'
import { chargeLimitReached, chargerToForce, chargerToStop, chargingRefuted } from './chargeCoordination'
import { PluginError, type DevicePlugin, type PluginContext } from './plugin'
import { PluginHost } from './plugin-host'
import { DeviceRegistry } from './registry'
import { SceneRegistry } from './scene-registry'

// "Start charging" on a car plugged into a charger in green charging mode, without sun: the charger must be forced.

const HOME = { lat: 45.18, lon: 5.72, alt: 0 }
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

const car: DeviceDescriptor = { id: 'car:1', pluginId: 'car', externalId: '1', kind: 'vehicle', name: 'Voiture', capabilities: ['soc', 'charging'], meta: {} }
const evse = (n: string, caps: DeviceDescriptor['capabilities'] = ['charge_control']): DeviceDescriptor =>
  ({ id: `evse:${n}`, pluginId: 'evse', externalId: n, kind: 'ev_charger', name: `Borne ${n}`, capabilities: caps, meta: {} })

function world(o: { vehicle?: Record<string, unknown>; chargers?: { d: DeviceDescriptor; status: string }[]; car?: DeviceDescriptor; bus?: Bus } = {}) {
  const clock = new ManualClock(0)
  const registry = new DeviceRegistry(o.bus ?? new Bus(), clock)
  const chargers = o.chargers ?? [{ d: evse('a'), status: 'connected' }]
  registry.register('car', [o.car ?? car])
  registry.register('evse', chargers.map((c) => c.d))
  registry.applyPatch(car.id, { available: true, soc: 16, pluggedIn: true, charging: false, location: { lat: HOME.lat, lon: HOME.lon, at: 0 }, ...o.vehicle } as never)
  for (const c of chargers) registry.applyPatch(c.d.id, { available: true, status: c.status } as never)
  return { registry, clock }
}

const start: Command = { type: 'vehicle.start_charge' }

describe('which charger to force', () => {
  it('car plugged in, not charging, at home, one charger plugged in without charging: that one', () => {
    expect(chargerToForce(car.id, start, world().registry.list(), HOME)).toBe('evse:a')
  })

  it('nothing for another command, and never for stopping (it would lock green charging until unplugging)', () => {
    const devices = world().registry.list()
    expect(chargerToForce(car.id, { type: 'vehicle.stop_charge' }, devices, HOME)).toBeUndefined()
    expect(chargerToForce(car.id, { type: 'vehicle.wake' }, devices, HOME)).toBeUndefined()
  })

  it('nothing if the car is unplugged, already charging, or far from home', () => {
    expect(chargerToForce(car.id, start, world({ vehicle: { pluggedIn: false } }).registry.list(), HOME)).toBeUndefined()
    expect(chargerToForce(car.id, start, world({ vehicle: { charging: true } }).registry.list(), HOME)).toBeUndefined()
    const away = { location: { lat: 47.4, lon: 5.2, at: 0 } }
    expect(chargerToForce(car.id, start, world({ vehicle: away }).registry.list(), HOME)).toBeUndefined()
  })

  it('unknown position: we believe it is at home', () => {
    const { registry } = world()
    const devices = registry.list().map((e) => e.descriptor.id === car.id
      ? { ...e, state: { ...e.state, location: undefined } } : e) as ReturnType<typeof registry.list>
    expect(chargerToForce(car.id, start, devices, HOME)).toBe('evse:a')
  })

  it('nothing if no charger is waiting, if it is not controllable, or if TWO are waiting (we don\'t guess)', () => {
    expect(chargerToForce(car.id, start, world({ chargers: [{ d: evse('a'), status: 'charging' }] }).registry.list(), HOME)).toBeUndefined()
    expect(chargerToForce(car.id, start, world({ chargers: [{ d: evse('a', []), status: 'connected' }] }).registry.list(), HOME)).toBeUndefined()
    const two = [{ d: evse('a'), status: 'connected' }, { d: evse('b'), status: 'connected' }]
    expect(chargerToForce(car.id, start, world({ chargers: two }).registry.list(), HOME)).toBeUndefined()
  })
})

/** The R5: it cannot stop its charge remotely, the charger stops it. */
const r5: DeviceDescriptor = { ...car, meta: { vehicle: { stopViaCharger: true } } }
const stop: Command = { type: 'vehicle.stop_charge' }
const charging = [{ d: evse('a'), status: 'charging' }]

describe('which charger to stop in place of the vehicle', () => {
  it('vehicle that stops through the charger, plugged in, at home, ONE charger charging: that one', () => {
    expect(chargerToStop(car.id, stop, world({ car: r5, chargers: charging }).registry.list(), HOME)).toBe('evse:a')
  })

  it('never for a vehicle that stops itself, nor for starting', () => {
    expect(chargerToStop(car.id, stop, world({ chargers: charging }).registry.list(), HOME)).toBeUndefined()
    expect(chargerToStop(car.id, start, world({ car: r5, chargers: charging }).registry.list(), HOME)).toBeUndefined()
  })

  it('nothing if the charger is not charging, if TWO are charging, if the vehicle is unplugged or far away', () => {
    expect(chargerToStop(car.id, stop, world({ car: r5 }).registry.list(), HOME)).toBeUndefined()
    const two = [{ d: evse('a'), status: 'charging' }, { d: evse('b'), status: 'charging' }]
    expect(chargerToStop(car.id, stop, world({ car: r5, chargers: two }).registry.list(), HOME)).toBeUndefined()
    expect(chargerToStop(car.id, stop, world({ car: r5, chargers: charging, vehicle: { pluggedIn: false } }).registry.list(), HOME)).toBeUndefined()
    const away = { location: { lat: 47.4, lon: 5.2, at: 0 } }
    expect(chargerToStop(car.id, stop, world({ car: r5, chargers: charging, vehicle: away }).registry.list(), HOME)).toBeUndefined()
  })
})

describe('charge limit reached', () => {
  const at = (v: Record<string, unknown>) => ({ kind: 'vehicle', available: true, updatedAt: 0, pluggedIn: true, ...v }) as never
  it('the car at its limit and no longer charging', () => {
    expect(chargeLimitReached(at({ soc: 50, chargeLimit: 50, charging: false }))).toBe(true)
    // the R5 on 2026-10-02 stopped at 51 % for 50 %
    expect(chargeLimitReached(at({ soc: 51, chargeLimit: 50, charging: false }))).toBe(true)
  })
  it('not while it is still charging, nor below its limit, nor with an unknown limit or level', () => {
    expect(chargeLimitReached(at({ soc: 50, chargeLimit: 50, charging: true }))).toBe(false)
    expect(chargeLimitReached(at({ soc: 40, chargeLimit: 50, charging: false }))).toBe(false)
    expect(chargeLimitReached(at({ soc: 50, charging: false }))).toBe(false)
    expect(chargeLimitReached(at({ chargeLimit: 50, charging: false }))).toBe(false)
  })
})

describe('a car that says it is charging, contradicted by the chargers', () => {
  const claimed = { soc: 52, pluggedIn: true, charging: true }
  const at = (w: ReturnType<typeof world>) => w.registry.get(car.id)!.state
  const refuted = (w: ReturnType<typeof world>) => chargingRefuted(at(w), w.registry.list(), HOME)

  it('at home, plugged in, and no charger is charging: contradicted (the R5 on 2026-10-02)', () => {
    expect(refuted(world({ vehicle: claimed }))).toBe(true)
    expect(refuted(world({ vehicle: claimed, chargers: [{ d: evse('a'), status: 'connected' }, { d: evse('b'), status: 'disconnected' }] }))).toBe(true)
  })
  it('not when a charger is charging: we don\'t know which of the cars it serves', () => {
    expect(refuted(world({ vehicle: claimed, chargers: [{ d: evse('a'), status: 'charging' }] }))).toBe(false)
  })
  it('not without a charger, nor with an unreachable charger', () => {
    expect(refuted(world({ vehicle: claimed, chargers: [] }))).toBe(false)
    const w = world({ vehicle: claimed })
    w.registry.setAvailable('evse', 'a', false)
    expect(refuted(w)).toBe(false)
  })
  it('not far from home, nor without a known position: it may be charging elsewhere', () => {
    expect(refuted(world({ vehicle: { ...claimed, location: { lat: 48.85, lon: 2.35, at: 0 } } }))).toBe(false)
    expect(refuted(world({ vehicle: { ...claimed, location: undefined } }))).toBe(false)
  })
  it('not when the car MEASURES its charging power (Tesla): it knows better than we do', () => {
    expect(refuted(world({ vehicle: { ...claimed, chargePowerW: 3200 } }))).toBe(false)
  })
  it('nothing to contradict when it does not say it is charging', () => {
    expect(refuted(world({ vehicle: { charging: false } }))).toBe(false)
  })
})

describe('the host relays', () => {
  async function hosted(evseFails = false) {
    const bus = new Bus()
    const { registry, clock } = world({ bus })
    const sent: string[] = []
    const ctxs: Record<string, PluginContext> = {}
    const plugin = (id: string): DevicePlugin => ({
      id, configSchema: z.object({}),
      async init(ctx) { ctxs[id] = ctx }, async discover() { return [] }, async start() {}, async stop() {},
      async execute(externalId, command) {
        if (id === 'evse' && evseFails) throw new PluginError('UPSTREAM_ERROR', 'cloud down')
        sent.push(`${id}:${externalId} ${command.type}`)
      },
    })
    const host = new PluginHost({
      site: () => HOME, settingsOf: () => ({ ...DEFAULT_PLUGIN_SETTINGS, enabled: true }), strict: false,
      factories: { car: () => plugin('car'), evse: () => plugin('evse') },
      registry, scenes: new SceneRegistry(bus, clock), bus, clock, logger: pino({ level: 'silent' }), envSource: {},
    })
    await host.startAll()
    await flush()
    // the test plugins publish nothing: we set the stage again after their empty `discover`
    const w = world({ bus: new Bus() })
    registry.register('car', [car]); registry.register('evse', [evse('a')])
    for (const e of w.registry.list()) registry.applyPatch(e.descriptor.id, e.state as never)
    return { host, sent, registry, ctxs }
  }

  it('"Stop charging" on a vehicle that stops through the charger: the charger ONLY, nothing to the vehicle', async () => {
    const { host, sent, registry } = await hosted()
    registry.register('car', [r5])
    registry.applyPatch('evse:a', { status: 'charging' } as never)
    await host.execute(car.id, stop)
    expect(sent).toEqual(['evse:a ev_charger.stop'])
    await host.stopAll()
  })

  it('"Start charging" forces the charger THEN starts the car', async () => {
    const { host, sent } = await hosted()
    await host.execute(car.id, start)
    expect(sent).toEqual(['evse:a ev_charger.start', 'car:1 vehicle.start_charge'])
    await host.stopAll()
  })

  it('a failing charger does not prevent the command to the car', async () => {
    const { host, sent } = await hosted(true)
    await host.execute(car.id, start)
    expect(sent).toEqual(['car:1 vehicle.start_charge'])
    await host.stopAll()
  })

  it('the forced car reaches its limit: the charger goes back to its mode, only once', async () => {
    const { host, sent, registry } = await hosted()
    await host.execute(car.id, start)
    registry.applyPatch(car.id, { soc: 50, chargeLimit: 50, charging: true } as never)
    await flush()
    expect(sent).not.toContain('evse:a ev_charger.resume_mode')
    registry.applyPatch(car.id, { charging: false } as never)
    await flush()
    registry.applyPatch(car.id, { soc: 51 } as never)
    await flush()
    expect(sent.filter((s) => s === 'evse:a ev_charger.resume_mode')).toHaveLength(1)
    await host.stopAll()
  })

  it('nothing without forcing by Kasbah, nor after unplugging (the charger handles it)', async () => {
    const { host, sent, registry } = await hosted()
    registry.applyPatch(car.id, { soc: 80, chargeLimit: 80, charging: false } as never)
    await flush()
    await host.execute(car.id, start)
    registry.applyPatch(car.id, { soc: 30, chargeLimit: 80, pluggedIn: false } as never)
    registry.applyPatch(car.id, { soc: 80, pluggedIn: true } as never)
    await flush()
    expect(sent).not.toContain('evse:a ev_charger.resume_mode')
    await host.stopAll()
  })

  it('"charging" published by the vehicle is contradicted as long as no charger is charging, and restored when one charges', async () => {
    const { host, registry, ctxs } = await hosted()
    const charging = () => (registry.get(car.id)!.state as { charging?: boolean }).charging
    ctxs.car!.emitState('1', { charging: true, chargeMinutesRemaining: 480 } as never)
    expect(charging()).toBe(false)
    expect((registry.get(car.id)!.state as { chargeMinutesRemaining?: number | null }).chargeMinutesRemaining ?? null).toBeNull()
    registry.applyPatch('evse:a', { status: 'charging' } as never)
    expect(charging()).toBe(true)
    registry.applyPatch('evse:a', { status: 'connected' } as never)
    expect(charging()).toBe(false)
    // the vehicle says it has stopped: nothing left to restore when the charger charges (for another car)
    ctxs.car!.emitState('1', { charging: false } as never)
    registry.applyPatch('evse:a', { status: 'charging' } as never)
    expect(charging()).toBe(false)
    await host.stopAll()
  })
})
