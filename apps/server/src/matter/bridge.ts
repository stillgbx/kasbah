import { createHash } from 'node:crypto'
import type { Endpoint, ServerNode } from '@matter/main'
import { matterSettingsPatchSchema, type Command, type DeviceEntry, type DeviceId, type DeviceState, type MatterSettings, type MatterStatus } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import QRCode from 'qrcode'
import { z } from 'zod'
import { updateHouseFile, type LoadedHouse } from '../config/house'
import type { Bus } from '../core/bus'
import { stateFile } from '../core/paths'
import type { DeviceRegistry } from '../core/registry'
import type { WsHub } from '../ws/hub'
import { cabinCommandOf, closureCommandOf, coverCommandForLift, CLIMATE_FACET, fanCommandOf, fanSpeedMax, matterFacetsOf, matterStateOf, brightnessFromLevel, type MatterKind } from './mapping'

// Matter bridge: the devices the house opts in are published on the LAN as bridged endpoints of
// one Matter node, for Alexa, Google Home or Apple Home. It creates no device of its own — it reads
// the registry and sends the controllers' commands through the plugin host, like the MCP server.

export interface MatterBridgeOptions {
  /** The house's current setting, read again by `apply()`. */
  settings: () => MatterSettings | undefined
  registry: DeviceRegistry
  bus: Bus
  execute: (id: DeviceId, command: Command) => Promise<void>
  logger: Logger
}

// `key`: what the house lists (the device id, or `<id>#climate` for a car's climate)
interface Published { key: string; id: DeviceId; kind: MatterKind; name: string; endpoint?: Endpoint; speedMax: number; cabinMode?: number }

type MatterModules = Awaited<ReturnType<typeof loadMatter>>

let matterConfigured = false

/**
 * matter.js installs its Node environment when `@matter/main` is first imported: its process-wide
 * habits (signal traps, exit code, argv/env/config file reading, storage in the home folder) must
 * be turned off before, Kasbah owns the process.
 */
async function loadMatter() {
  if (!matterConfigured) {
    const { config } = await import('@matter/nodejs/config')
    config.defaultStoragePath = stateFile('matter')
    config.loadProcessArgv = false
    config.loadProcessEnv = false
    config.loadConfigFile = false
    config.trapProcessSignals = false
    config.trapUnhandledErrors = false
    config.setProcessExitCodeOnError = false
    matterConfigured = true
  }
  const main = await import('@matter/main')
  main.Logger.level = 'warn'
  return {
    ...main,
    ...(await import('@matter/main/endpoints/aggregator')),
    ...(await import('@matter/main/behaviors/bridged-device-basic-information')),
    ...(await import('@matter/main/behaviors/window-covering')),
    ...(await import('@matter/main/behaviors/door-lock')),
    ...(await import('@matter/main/devices/on-off-light')),
    ...(await import('@matter/main/devices/dimmable-light')),
    ...(await import('@matter/main/devices/window-covering')),
    ...(await import('@matter/main/devices/door-lock')),
    ...(await import('@matter/main/devices/fan')),
    ...(await import('@matter/main/behaviors/fan-control')),
    ...(await import('@matter/main/behaviors/on-off')),
    ...(await import('@matter/main/clusters/fan-control')),
    ...(await import('@matter/main/devices/closure')),
    ...(await import('@matter/main/behaviors/closure-control')),
    ...(await import('@matter/main/behaviors/descriptor')),
    ...(await import('@matter/main/devices/thermostat')),
    ...(await import('@matter/main/behaviors/thermostat')),
    ...(await import('@matter/main/clusters/thermostat')),
    ...(await import('@matter/main/clusters/door-lock')),
    ...(await import('@matter/main/clusters/window-covering')),
    FabricManager: (await import('@matter/main/protocol')).FabricManager,
  }
}

// Matter strings: 32 characters at most for labels and unique ids.
const label = (s: string): string => (s.length <= 32 ? s : `${s.slice(0, 31)}…`)
// `.` is refused in an endpoint id; the id also keys matter.js storage, so it must stay stable. A
// closure gets its own id: switching a garage door between blind and closure must not reuse the
// stored state of the other device type.
const endpointIdOf = (id: DeviceId, kind: MatterKind): string =>
  id.replaceAll('.', '_') + (kind === 'closure' ? '__closure' : kind === 'thermostat' ? '__climate' : '')
const deviceIdOf = (key: string): DeviceId => (key.endsWith(CLIMATE_FACET) ? key.slice(0, -CLIMATE_FACET.length) : key)

export class MatterBridge {
  private server: ServerNode | undefined
  private aggregator: Endpoint | undefined
  private matter: MatterModules | undefined
  private readonly published = new Map<string, Published>()   // by endpoint id
  private publishedFor(id: DeviceId): Published[] {
    return [...this.published.values()].filter((p) => p.id === id)
  }
  private publishedAs(key: string): Published | undefined {
    for (const p of this.published.values()) if (p.key === key) return p
    return undefined
  }
  private facetsOf(entry: DeviceEntry): { key: string; kind: MatterKind }[] {
    return matterFacetsOf(entry.descriptor, { closures: !!this.opts.settings()?.closures })
  }
  private kindOf(key: string, entry: DeviceEntry): MatterKind | null {
    return this.facetsOf(entry).find((f) => f.key === key)?.kind ?? null
  }
  private readonly skipped = new Map<string, 'unknown' | 'unsupported'>()
  private readonly unsubscribe: (() => void)[] = []
  private exposed: readonly string[] = []
  // start, stop, apply and sync run one at a time: a box ticked during the start must not
  // publish a device twice, nor a stop race a publish
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly opts: MatterBridgeOptions) {}

  private serial(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task, task)
    return this.queue
  }

  /** Never throws: a bridge that cannot start must not take the house down. */
  start(): Promise<void> { return this.serial(() => this.startNow()) }
  close(): Promise<void> { return this.serial(() => this.closeNow()) }

  /** Follows the house's setting without a restart: starts, stops, publishes, withdraws. */
  apply(): Promise<void> {
    return this.serial(async () => {
      const settings = this.opts.settings()
      if (!settings?.enabled) return this.closeNow()
      if (!this.server) return this.startNow()
      this.exposed = settings.devices
      for (const [endpointId, p] of [...this.published]) {
        // still listed and still the same Matter type (the closures setting can change it): kept
        const entry = this.opts.registry.get(p.id)
        if (this.exposed.includes(p.key) && (!entry || this.kindOf(p.key, entry) === p.kind)) continue
        this.published.delete(endpointId)
        await p.endpoint?.delete().catch((err: unknown) => this.opts.logger.warn({ err, deviceId: p.id }, 'matter bridge could not withdraw a device'))
      }
      for (const id of [...this.skipped.keys()]) if (!this.exposed.includes(id)) this.skipped.delete(id)
      await this.sync()
    })
  }

  private async startNow(): Promise<void> {
    const settings = this.opts.settings()
    if (!settings?.enabled || this.server) return
    this.exposed = settings.devices
    try {
      this.matter = await loadMatter()
      const m = this.matter
      this.server = await m.ServerNode.create({
        id: 'kasbah',
        productDescription: { name: 'Kasbah', deviceType: m.AggregatorEndpoint.deviceType },
        basicInformation: {
          vendorName: 'Kasbah',
          vendorId: m.VendorId(0xfff1),   // test vendor: an uncertified bridge
          productId: 0x8000,
          productName: 'Kasbah Bridge',
          productLabel: 'Matter Bridge',   // matter.js warns when it repeats the vendor name
          nodeLabel: 'Kasbah',
        },
      })
      this.aggregator = new m.Endpoint(m.AggregatorEndpoint, { id: 'aggregator' })
      await this.server.add(this.aggregator)
      await this.sync()
      this.unsubscribe.push(
        // plugins start in parallel with the bridge: a listed device can appear later
        this.opts.bus.on('devices', () => { void this.serial(() => this.sync()) }),
        this.opts.bus.on('state', (id, state) => { void this.push(id, state) }),
        this.opts.bus.on('availability', (ids, available) => {
          for (const id of ids) void this.setReachable(id, available)
        }),
      )
      await this.server.start()
      const commissioned = this.server.state.commissioning.commissioned
      this.opts.logger.info({ devices: this.published.size, commissioned }, commissioned ? 'matter bridge started' : 'matter bridge started, not paired yet: pairing code in Settings')
    } catch (err) {
      this.opts.logger.error({ err }, 'matter bridge failed to start')
      await this.closeNow()
    }
  }

  private async closeNow(): Promise<void> {
    for (const off of this.unsubscribe.splice(0)) off()
    const server = this.server
    this.server = undefined
    this.aggregator = undefined
    this.published.clear()
    this.skipped.clear()
    if (server) await server.close().catch((err: unknown) => this.opts.logger.warn({ err }, 'matter bridge close failed'))
  }

  /**
   * Unpairs one assistant: the bridge leaves its fabric (the controller is told) and forgets its
   * keys. Without any fabric left, matter.js offers the pairing code again.
   */
  removeFabric(index: number): Promise<void> {
    return this.serial(async () => {
      const server = this.server
      const m = this.matter
      if (!server || !m) return
      const fabric = server.env.get(m.FabricManager).find((f) => f.fabricIndex === index)
      if (!fabric) return
      await fabric.leave()
      // the last one gone, matter.js restarts the node to offer the code again: answer once it is
      // back, or the card would read "did not start" for a few seconds
      for (let waited = 0; !server.lifecycle.isOnline && waited < 10_000; waited += 200) {
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    })
  }

  async status(): Promise<MatterStatus> {
    const settings = this.opts.settings()
    const listed = settings?.devices ?? []
    const server = this.server
    const online = !!server?.lifecycle.isOnline
    const commissioned = online && !!server?.state.commissioning.commissioned
    const codes = online && !commissioned ? server?.state.commissioning.pairingCodes : undefined
    const candidates: MatterStatus['candidates'] = []
    for (const entry of this.opts.registry.list()) {
      const { descriptor } = entry
      for (const { key, kind: type } of this.facetsOf(entry)) {
        candidates.push({
          id: key, name: descriptor.name, pluginId: descriptor.pluginId, type,
          listed: listed.includes(key),
          published: !!this.publishedAs(key)?.endpoint,
        })
      }
    }
    return {
      enabled: !!settings?.enabled,
      closures: !!settings?.closures,
      running: online,
      commissioned,
      fabrics: online && server
        ? Object.values(server.state.commissioning.fabrics).map((f) => ({ index: f.fabricIndex, label: f.label, vendorId: f.rootVendorId }))
        : [],
      ...(codes ? { pairing: { manualCode: codes.manualPairingCode, qrSvg: await QRCode.toString(codes.qrPairingCode, { type: 'svg', margin: 1 }) } } : {}),
      candidates,
      skipped: [...this.skipped].map(([id, reason]) => ({ id, reason })),
    }
  }

  /** Publishes the listed devices the registry knows and the bridge does not publish yet. */
  private async sync(): Promise<void> {
    if (!this.server) return
    for (const key of this.exposed) {
      if (this.publishedAs(key)) continue
      const entry = this.opts.registry.get(deviceIdOf(key))
      if (!entry) { this.skipped.set(key, 'unknown'); continue }
      const kind = this.kindOf(key, entry)
      if (!kind) { this.skipped.set(key, 'unsupported'); continue }
      this.skipped.delete(key)
      try {
        await this.publish(entry, kind, key)
      } catch (err) {
        this.published.delete(endpointIdOf(entry.descriptor.id, kind))
        this.opts.logger.warn({ err, deviceId: entry.descriptor.id, kind }, 'matter bridge could not publish a device')
      }
    }
  }

  private async publish(entry: DeviceEntry, kind: MatterKind, key: string): Promise<void> {
    const m = this.matter
    const aggregator = this.aggregator
    if (!m || !aggregator) return
    const { descriptor, state } = entry
    const id = descriptor.id
    const endpointId = endpointIdOf(id, kind)
    const speedMax = kind === 'fan' ? fanSpeedMax(descriptor) : 0
    const published: Published = { key, id, kind, name: descriptor.name, speedMax }
    this.published.set(endpointId, published)
    const bridged = {
      // the car's climate is a second device of the same car: its name says which one
      nodeLabel: label(kind === 'thermostat' ? `${descriptor.name} (clim)` : descriptor.name),
      productName: label(descriptor.meta?.model ?? descriptor.kind),
      vendorName: label(descriptor.meta?.manufacturer ?? descriptor.pluginId),
      uniqueId: createHash('sha256').update(key).digest('hex').slice(0, 32),
      reachable: state.available,
    }
    const initial = matterStateOf(kind, state, speedMax)
    const send = (endpointId: string, command: Command): void => this.send(endpointId, command)

    let endpoint: Endpoint
    switch (kind) {
      case 'on_off_light':
        endpoint = new m.Endpoint(m.OnOffLightDevice.with(m.BridgedDeviceBasicInformationServer), {
          id: endpointId, bridgedDeviceBasicInformation: bridged, ...initial,
        })
        break
      case 'dimmable_light':
        endpoint = new m.Endpoint(m.DimmableLightDevice.with(m.BridgedDeviceBasicInformationServer), {
          id: endpointId, bridgedDeviceBasicInformation: bridged, ...initial,
        })
        break
      case 'window_covering': {
        // Commands are overridden rather than observed: a cover has no position to show until
        // the device moves, and "stop" changes nothing a listener could see.
        class KasbahCovering extends m.WindowCoveringServer.with('Lift', 'PositionAwareLift') {
          override upOrOpen() { send(this.endpoint.id, { type: 'cover.open' }) }
          override downOrClose() { send(this.endpoint.id, { type: 'cover.close' }) }
          override stopMotion() { send(this.endpoint.id, { type: 'cover.stop' }) }
          override goToLiftPercentage({ liftPercent100thsValue }: { liftPercent100thsValue: number }) {
            send(this.endpoint.id, coverCommandForLift(descriptor, liftPercent100thsValue))
          }
        }
        endpoint = new m.Endpoint(m.WindowCoveringDevice.with(m.BridgedDeviceBasicInformationServer, KasbahCovering), {
          id: endpointId, bridgedDeviceBasicInformation: bridged,
          windowCovering: { ...initial.windowCovering, type: m.WindowCovering.WindowCoveringType.Rollershade },
        })
        break
      }
      case 'door_lock': {
        class KasbahLock extends m.DoorLockServer {
          override lockDoor() { send(this.endpoint.id, { type: 'vehicle.lock' }) }
          override unlockDoor() { send(this.endpoint.id, { type: 'vehicle.unlock' }) }
        }
        endpoint = new m.Endpoint(m.DoorLockDevice.with(m.BridgedDeviceBasicInformationServer, KasbahLock), {
          id: endpointId, bridgedDeviceBasicInformation: bridged,
          doorLock: {
            ...initial.doorLock, lockType: m.DoorLock.LockType.Other, actuatorEnabled: true, operatingMode: m.DoorLock.OperatingMode.Normal,
            // Absent from the type without the PIN feature, yet matter.js 0.17.9 validates them
            // against their 1-255 range at startup (the default 0 fails): set, never used.
            ...({ wrongCodeEntryLimit: 5, userCodeTemporaryDisableTime: 10 } as object),
          },
        })
        break
      }
      case 'closure': {
        // Matter 1.5: the garage door (or gate) as such. Open, close and stop only: Kasbah's
        // garage doors have no pedestrian or ventilation position to offer.
        class KasbahClosure extends m.ClosureControlServer.with('Positioning') {
          override moveTo({ position }: { position?: number }) {
            const command = closureCommandOf(position)
            if (command) send(this.endpoint.id, command)
          }
          override stop() { send(this.endpoint.id, { type: 'cover.stop' }) }
        }
        const tag = descriptor.meta?.cover?.deviceClass === 'gate' ? m.ClosureTag.Gate : m.ClosureTag.GarageDoor
        // the tag says which closure it is (garage door or gate): the Descriptor only carries it
        // with its TagList feature on
        endpoint = new m.Endpoint(m.ClosureDevice.with(m.BridgedDeviceBasicInformationServer, KasbahClosure, m.DescriptorServer.with('TagList')), {
          id: endpointId, bridgedDeviceBasicInformation: bridged,
          descriptor: { tagList: [tag] },
          closureControl: { currentErrorList: [], ...initial.closureControl },
        } as never)
        break
      }
      case 'thermostat': {
        // Heating and Cooling, no Auto: in Auto, assistants show a range of two setpoints, while a
        // car keeps one. Limits = what a Tesla accepts (15-28 °C).
        endpoint = new m.Endpoint(m.ThermostatDevice.with(m.BridgedDeviceBasicInformationServer, m.ThermostatServer.with('Heating', 'Cooling')), {
          id: endpointId, bridgedDeviceBasicInformation: bridged,
          thermostat: {
            controlSequenceOfOperation: m.Thermostat.ControlSequenceOfOperation.CoolingAndHeating,
            absMinHeatSetpointLimit: 1500, absMaxHeatSetpointLimit: 2800, minHeatSetpointLimit: 1500, maxHeatSetpointLimit: 2800,
            absMinCoolSetpointLimit: 1500, absMaxCoolSetpointLimit: 2800, minCoolSetpointLimit: 1500, maxCoolSetpointLimit: 2800,
            ...initial.thermostat,
          },
        } as never)
        break
      }
      case 'fan': {
        // MultiSpeed only with speeds to offer, AirflowDirection only when the fan can reverse:
        // an attribute the device cannot honour would show a control that does nothing.
        const reverses = (descriptor.capabilities as readonly string[]).includes('fan_direction')
        const FanServer = speedMax
          ? (reverses ? m.FanControlServer.with('MultiSpeed', 'AirflowDirection') : m.FanControlServer.with('MultiSpeed'))
          : (reverses ? m.FanControlServer.with('AirflowDirection') : m.FanControlServer)
        endpoint = new m.Endpoint(m.FanDevice.with(m.BridgedDeviceBasicInformationServer, FanServer, m.OnOffServer), {
          id: endpointId, bridgedDeviceBasicInformation: bridged,
          onOff: initial.onOff,
          fanControl: { fanModeSequence: m.FanControl.FanModeSequence.OffLowMedHigh, ...(speedMax ? { speedMax } : {}), ...initial.fanControl },
        } as never)
        break
      }
    }
    published.endpoint = endpoint
    await aggregator.add(endpoint)

    if (kind === 'on_off_light' || kind === 'dimmable_light') {
      // A light is observed: its state must move at once, the level control couples to it.
      // Changes Kasbah writes itself come with an offline context and are not sent back.
      const events = endpoint.events as unknown as LightEvents
      events.onOff.onOff$Changed.on((on, _old, context) => {
        if (context && !context.offline) send(endpointId, { type: 'light.set', on })
      })
      events.levelControl?.currentLevel$Changed.on((level, _old, context) => {
        if (level !== null && context && !context.offline) send(endpointId, { type: 'light.set', brightness: brightnessFromLevel(level) })
      })
    }
    if (kind === 'thermostat') {
      // Turning the climate on wakes the car (`climate_start`); a setpoint only adjusts it
      // (`climate_set`), whatever the mode the controller shows.
      const events = endpoint.events as unknown as ThermostatEvents
      const target = () => {
        const s = this.opts.registry.get(id)?.state
        return s?.kind === 'vehicle' ? s.climateTargetC : undefined
      }
      const watch = (attribute: Parameters<typeof cabinCommandOf>[0], changed: Changed<number | null>) =>
        changed.on((value, _old, context) => {
          if (!context || context.offline) return
          // the mode the assistant chose is shown back while the climate runs (see matterStateOf)
          if (attribute === 'systemMode') published.cabinMode = value === 0 || value === null ? undefined : value
          const command = cabinCommandOf(attribute, value, target())
          if (command) send(endpointId, command)
        })
      watch('systemMode', events.thermostat.systemMode$Changed)
      watch('occupiedHeatingSetpoint', events.thermostat.occupiedHeatingSetpoint$Changed)
      watch('occupiedCoolingSetpoint', events.thermostat.occupiedCoolingSetpoint$Changed)
    }
    if (kind === 'fan') {
      // Matter leaves mode, percent and speed for the device to reconcile: each attribute a
      // controller writes becomes one command, and the state Kasbah reports back sets them all.
      const events = endpoint.events as unknown as FanEvents
      const watch = (attribute: Parameters<typeof fanCommandOf>[0], changed: Changed<number | boolean | null> | undefined) =>
        changed?.on((value, _old, context) => {
          if (!context || context.offline) return
          const command = fanCommandOf(attribute, value, speedMax)
          if (command) send(endpointId, command)
        })
      watch('onOff', events.onOff.onOff$Changed)
      watch('fanMode', events.fanControl.fanMode$Changed)
      watch('percentSetting', events.fanControl.percentSetting$Changed)
      watch('speedSetting', events.fanControl.speedSetting$Changed)
      watch('airflowDirection', events.fanControl.airflowDirection$Changed)
    }
  }

  /** A controller command, sent without holding the Matter transaction: a car takes seconds to answer. */
  private send(endpointId: string, command: Command): void {
    const p = this.published.get(endpointId)
    if (!p) return
    this.opts.execute(p.id, command).catch((err: unknown) => {
      this.opts.logger.warn({ err, deviceId: p.id, command: command.type }, 'matter command failed')
      // the controller already shows the change: put the device's real state back
      const entry = this.opts.registry.get(p.id)
      if (entry) void this.push(p.id, entry.state)
    })
  }

  private async push(id: DeviceId, state: DeviceState): Promise<void> {
    for (const p of this.publishedFor(id)) {
      if (!p.endpoint) continue
      try {
        if (p.kind === 'thermostat' && state.kind === 'vehicle' && !state.climateOn) p.cabinMode = undefined
        await p.endpoint.set(matterStateOf(p.kind, state, p.speedMax, p.cabinMode) as never)
      } catch (err) {
        this.opts.logger.warn({ err, deviceId: id, kind: p.kind }, 'matter state update failed')
      }
    }
  }

  private async setReachable(id: DeviceId, reachable: boolean): Promise<void> {
    for (const p of this.publishedFor(id)) {
      if (!p.endpoint) continue
      try {
        await p.endpoint.set({ bridgedDeviceBasicInformation: { reachable } } as never)
      } catch (err) {
        this.opts.logger.warn({ err, deviceId: id, kind: p.kind }, 'matter reachability update failed')
      }
    }
  }
}

interface Changed<T> { on(fn: (value: T, old: T, context: { offline?: boolean } | undefined) => void): void }
interface ThermostatEvents {
  thermostat: {
    systemMode$Changed: Changed<number | null>
    occupiedHeatingSetpoint$Changed: Changed<number | null>
    occupiedCoolingSetpoint$Changed: Changed<number | null>
  }
}
interface FanEvents {
  onOff: { onOff$Changed: Changed<number | boolean | null> }
  fanControl: {
    fanMode$Changed: Changed<number | boolean | null>
    percentSetting$Changed: Changed<number | boolean | null>
    speedSetting$Changed?: Changed<number | boolean | null>
    airflowDirection$Changed?: Changed<number | boolean | null>
  }
}
interface LightEvents {
  onOff: { onOff$Changed: Changed<boolean> }
  levelControl?: { currentLevel$Changed: Changed<number | null> }
}

export interface MatterRoutesDeps { bridge: MatterBridge; house: LoadedHouse; hub: WsHub }

export function registerMatterRoutes(app: FastifyInstance, deps: MatterRoutesDeps): void {
  app.get('/api/matter', async () => deps.bridge.status())
  app.patch('/api/matter', async (req) => {
    const patch = matterSettingsPatchSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => {
      const d = doc as { matter?: Partial<MatterSettings> }
      d.matter = { enabled: false, devices: [], ...d.matter, ...patch }
      return d
    })
    deps.hub.broadcast({ type: 'house', house })
    await deps.bridge.apply()
    return deps.bridge.status()
  })
  app.delete<{ Params: { index: string } }>('/api/matter/fabrics/:index', async (req) => {
    await deps.bridge.removeFabric(z.coerce.number().int().min(1).parse(req.params.index))   // ZodError → 400
    return deps.bridge.status()
  })
}
