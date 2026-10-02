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

// « Charger » une voiture branchée sur une borne en charge verte, sans soleil : il faut forcer la borne.

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

/** La R5 : elle ne sait pas arrêter sa charge à distance, c'est la borne qui l'arrête. */
const r5: DeviceDescriptor = { ...car, meta: { vehicle: { stopViaCharger: true } } }
const stop: Command = { type: 'vehicle.stop_charge' }
const charging = [{ d: evse('a'), status: 'charging' }]

describe('quelle borne arrêter à la place du véhicule', () => {
  it('véhicule qui s\'arrête par la borne, branché, à la maison, UNE borne en charge : celle-là', () => {
    expect(chargerToStop(car.id, stop, world({ car: r5, chargers: charging }).registry.list(), HOME)).toBe('evse:a')
  })

  it('jamais pour un véhicule qui s\'arrête lui-même, ni pour le démarrage', () => {
    expect(chargerToStop(car.id, stop, world({ chargers: charging }).registry.list(), HOME)).toBeUndefined()
    expect(chargerToStop(car.id, start, world({ car: r5, chargers: charging }).registry.list(), HOME)).toBeUndefined()
  })

  it('rien si la borne ne charge pas, si DEUX chargent, si le véhicule est débranché ou loin', () => {
    expect(chargerToStop(car.id, stop, world({ car: r5 }).registry.list(), HOME)).toBeUndefined()
    const two = [{ d: evse('a'), status: 'charging' }, { d: evse('b'), status: 'charging' }]
    expect(chargerToStop(car.id, stop, world({ car: r5, chargers: two }).registry.list(), HOME)).toBeUndefined()
    expect(chargerToStop(car.id, stop, world({ car: r5, chargers: charging, vehicle: { pluggedIn: false } }).registry.list(), HOME)).toBeUndefined()
    const away = { location: { lat: 47.4, lon: 5.2, at: 0 } }
    expect(chargerToStop(car.id, stop, world({ car: r5, chargers: charging, vehicle: away }).registry.list(), HOME)).toBeUndefined()
  })
})

describe('limite de charge atteinte', () => {
  const at = (v: Record<string, unknown>) => ({ kind: 'vehicle', available: true, updatedAt: 0, pluggedIn: true, ...v }) as never
  it('la voiture à sa limite et qui ne charge plus', () => {
    expect(chargeLimitReached(at({ soc: 50, chargeLimit: 50, charging: false }))).toBe(true)
    // la R5 du 2026-10-02 s'est arrêtée à 51 % pour 50 %
    expect(chargeLimitReached(at({ soc: 51, chargeLimit: 50, charging: false }))).toBe(true)
  })
  it('pas tant qu\'elle charge encore, ni sous sa limite, ni limite ou niveau inconnus', () => {
    expect(chargeLimitReached(at({ soc: 50, chargeLimit: 50, charging: true }))).toBe(false)
    expect(chargeLimitReached(at({ soc: 40, chargeLimit: 50, charging: false }))).toBe(false)
    expect(chargeLimitReached(at({ soc: 50, charging: false }))).toBe(false)
    expect(chargeLimitReached(at({ chargeLimit: 50, charging: false }))).toBe(false)
  })
})

describe('une voiture qui se dit en charge, démentie par les bornes', () => {
  const claimed = { soc: 52, pluggedIn: true, charging: true }
  const at = (w: ReturnType<typeof world>) => w.registry.get(car.id)!.state
  const refuted = (w: ReturnType<typeof world>) => chargingRefuted(at(w), w.registry.list(), HOME)

  it('à la maison, branchée, et aucune borne ne charge : démentie (la R5 du 2026-10-02)', () => {
    expect(refuted(world({ vehicle: claimed }))).toBe(true)
    expect(refuted(world({ vehicle: claimed, chargers: [{ d: evse('a'), status: 'connected' }, { d: evse('b'), status: 'disconnected' }] }))).toBe(true)
  })
  it('pas quand une borne charge : on ne sait pas laquelle des voitures elle sert', () => {
    expect(refuted(world({ vehicle: claimed, chargers: [{ d: evse('a'), status: 'charging' }] }))).toBe(false)
  })
  it('pas sans borne, ni avec une borne injoignable', () => {
    expect(refuted(world({ vehicle: claimed, chargers: [] }))).toBe(false)
    const w = world({ vehicle: claimed })
    w.registry.setAvailable('evse', 'a', false)
    expect(refuted(w)).toBe(false)
  })
  it('pas loin de la maison, ni sans position connue : elle peut charger ailleurs', () => {
    expect(refuted(world({ vehicle: { ...claimed, location: { lat: 48.85, lon: 2.35, at: 0 } } }))).toBe(false)
    expect(refuted(world({ vehicle: { ...claimed, location: undefined } }))).toBe(false)
  })
  it('pas quand la voiture MESURE sa puissance de charge (Tesla) : elle sait mieux que nous', () => {
    expect(refuted(world({ vehicle: { ...claimed, chargePowerW: 3200 } }))).toBe(false)
  })
  it('rien à démentir quand elle ne se dit pas en charge', () => {
    expect(refuted(world({ vehicle: { charging: false } }))).toBe(false)
  })
})

describe('l\'hôte relaie', () => {
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
    // les plugins de test ne publient rien : on remet la scène après leur `discover` vide
    const w = world({ bus: new Bus() })
    registry.register('car', [car]); registry.register('evse', [evse('a')])
    for (const e of w.registry.list()) registry.applyPatch(e.descriptor.id, e.state as never)
    return { host, sent, registry, ctxs }
  }

  it('« Arrêter » un véhicule qui s\'arrête par la borne : la borne SEULE, rien au véhicule', async () => {
    const { host, sent, registry } = await hosted()
    registry.register('car', [r5])
    registry.applyPatch('evse:a', { status: 'charging' } as never)
    await host.execute(car.id, stop)
    expect(sent).toEqual(['evse:a ev_charger.stop'])
    await host.stopAll()
  })

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

  it('la voiture forcée arrive à sa limite : la borne reprend son mode, une seule fois', async () => {
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

  it('rien sans forçage par Kasbah, ni après un débranchement (la borne s\'en charge)', async () => {
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

  it('« en charge » publié par le véhicule est démenti tant qu\'aucune borne ne charge, et rendu quand l\'une charge', async () => {
    const { host, registry, ctxs } = await hosted()
    const charging = () => (registry.get(car.id)!.state as { charging?: boolean }).charging
    ctxs.car!.emitState('1', { charging: true, chargeMinutesRemaining: 480 } as never)
    expect(charging()).toBe(false)
    expect((registry.get(car.id)!.state as { chargeMinutesRemaining?: number | null }).chargeMinutesRemaining ?? null).toBeNull()
    registry.applyPatch('evse:a', { status: 'charging' } as never)
    expect(charging()).toBe(true)
    registry.applyPatch('evse:a', { status: 'connected' } as never)
    expect(charging()).toBe(false)
    // le véhicule se dit à l'arrêt : plus rien à rendre quand la borne charge (pour une autre voiture)
    ctxs.car!.emitState('1', { charging: false } as never)
    registry.applyPatch('evse:a', { status: 'charging' } as never)
    expect(charging()).toBe(false)
    await host.stopAll()
  })
})
