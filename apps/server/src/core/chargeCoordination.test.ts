import { ManualClock } from '@kasbah/mock-sim'
import { DEFAULT_PLUGIN_SETTINGS, type Command, type DeviceDescriptor } from '@kasbah/shared'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Bus } from './bus'
import { chargerToForce } from './chargeCoordination'
import { PluginError, type DevicePlugin } from './plugin'
import { PluginHost } from './plugin-host'
import { DeviceRegistry } from './registry'
import { SceneRegistry } from './scene-registry'

// « Charger » une voiture branchée sur une borne en charge verte, sans soleil : il faut forcer la borne.

const HOME = { lat: 45.18, lon: 5.72, alt: 0 }
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

const car: DeviceDescriptor = { id: 'car:1', pluginId: 'car', externalId: '1', kind: 'vehicle', name: 'Voiture', capabilities: ['soc', 'charging'], meta: {} }
const evse = (n: string, caps: DeviceDescriptor['capabilities'] = ['charge_control']): DeviceDescriptor =>
  ({ id: `evse:${n}`, pluginId: 'evse', externalId: n, kind: 'ev_charger', name: `Borne ${n}`, capabilities: caps, meta: {} })

function world(o: { vehicle?: Record<string, unknown>; chargers?: { d: DeviceDescriptor; status: string }[] } = {}) {
  const clock = new ManualClock(0)
  const registry = new DeviceRegistry(new Bus(), clock)
  const chargers = o.chargers ?? [{ d: evse('a'), status: 'connected' }]
  registry.register('car', [car])
  registry.register('evse', chargers.map((c) => c.d))
  registry.applyPatch(car.id, { available: true, soc: 16, pluggedIn: true, charging: false, location: { lat: HOME.lat, lon: HOME.lon, at: 0 }, ...o.vehicle } as never)
  for (const c of chargers) registry.applyPatch(c.d.id, { available: true, status: c.status } as never)
  return { registry, clock }
}

const start: Command = { type: 'vehicle.start_charge' }

describe('quelle borne forcer', () => {
  it('voiture branchée, pas en charge, à la maison, une borne branchée sans charger : celle-là', () => {
    expect(chargerToForce(car.id, start, world().registry.list(), HOME)).toBe('evse:a')
  })

  it('rien pour une autre commande, et jamais pour l\'arrêt (il bloquerait la charge verte jusqu\'au débranchement)', () => {
    const devices = world().registry.list()
    expect(chargerToForce(car.id, { type: 'vehicle.stop_charge' }, devices, HOME)).toBeUndefined()
    expect(chargerToForce(car.id, { type: 'vehicle.wake' }, devices, HOME)).toBeUndefined()
  })

  it('rien si la voiture est débranchée, déjà en charge, ou loin de la maison', () => {
    expect(chargerToForce(car.id, start, world({ vehicle: { pluggedIn: false } }).registry.list(), HOME)).toBeUndefined()
    expect(chargerToForce(car.id, start, world({ vehicle: { charging: true } }).registry.list(), HOME)).toBeUndefined()
    const away = { location: { lat: 47.4, lon: 5.2, at: 0 } }
    expect(chargerToForce(car.id, start, world({ vehicle: away }).registry.list(), HOME)).toBeUndefined()
  })

  it('position inconnue : on la croit à la maison', () => {
    const { registry } = world()
    const devices = registry.list().map((e) => e.descriptor.id === car.id
      ? { ...e, state: { ...e.state, location: undefined } } : e) as ReturnType<typeof registry.list>
    expect(chargerToForce(car.id, start, devices, HOME)).toBe('evse:a')
  })

  it('rien si aucune borne n\'attend, si elle n\'est pas pilotable, ou si DEUX attendent (on ne devine pas)', () => {
    expect(chargerToForce(car.id, start, world({ chargers: [{ d: evse('a'), status: 'charging' }] }).registry.list(), HOME)).toBeUndefined()
    expect(chargerToForce(car.id, start, world({ chargers: [{ d: evse('a', []), status: 'connected' }] }).registry.list(), HOME)).toBeUndefined()
    const two = [{ d: evse('a'), status: 'connected' }, { d: evse('b'), status: 'connected' }]
    expect(chargerToForce(car.id, start, world({ chargers: two }).registry.list(), HOME)).toBeUndefined()
  })
})

describe('l\'hôte relaie', () => {
  async function hosted(evseFails = false) {
    const { registry, clock } = world()
    const sent: string[] = []
    const plugin = (id: string): DevicePlugin => ({
      id, configSchema: z.object({}),
      async init() {}, async discover() { return [] }, async start() {}, async stop() {},
      async execute(externalId, command) {
        if (id === 'evse' && evseFails) throw new PluginError('UPSTREAM_ERROR', 'cloud down')
        sent.push(`${id}:${externalId} ${command.type}`)
      },
    })
    const bus = new Bus()
    const host = new PluginHost({
      site: () => HOME, settingsOf: () => ({ ...DEFAULT_PLUGIN_SETTINGS, enabled: true }), strict: false,
      factories: { car: () => plugin('car'), evse: () => plugin('evse') },
      registry, scenes: new SceneRegistry(bus, clock), bus, clock, logger: pino({ level: 'silent' }), envSource: {},
    })
    await host.startAll()
    await flush()
    // les plugins de test ne publient rien : on remet la scène après leur `discover` vide
    const w = world()
    registry.register('car', [car]); registry.register('evse', [evse('a')])
    for (const e of w.registry.list()) registry.applyPatch(e.descriptor.id, e.state as never)
    return { host, sent }
  }

  it('« Charger » force la borne PUIS lance la voiture', async () => {
    const { host, sent } = await hosted()
    await host.execute(car.id, start)
    expect(sent).toEqual(['evse:a ev_charger.start', 'car:1 vehicle.start_charge'])
    await host.stopAll()
  })

  it('une borne en échec n\'empêche pas la commande à la voiture', async () => {
    const { host, sent } = await hosted(true)
    await host.execute(car.id, start)
    expect(sent).toEqual(['car:1 vehicle.start_charge'])
    await host.stopAll()
  })
})
