import { createHash } from 'node:crypto'
import type { Endpoint, ServerNode } from '@matter/main'
import { matterSettingsPatchSchema, type Command, type DeviceEntry, type DeviceId, type DeviceState, type MatterSettings, type MatterStatus } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import QRCode from 'qrcode'
import { updateHouseFile, type LoadedHouse } from '../config/house'
import type { Bus } from '../core/bus'
import { stateFile } from '../core/paths'
import type { DeviceRegistry } from '../core/registry'
import type { WsHub } from '../ws/hub'
import { coverCommandForLift, matterKindOf, matterStateOf, brightnessFromLevel, type MatterKind } from './mapping'

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

interface Published { id: DeviceId; kind: MatterKind; name: string; endpoint?: Endpoint }

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
    ...(await import('@matter/main/clusters/door-lock')),
    ...(await import('@matter/main/clusters/window-covering')),
  }
}

// Matter strings: 32 characters at most for labels and unique ids.
const label = (s: string): string => (s.length <= 32 ? s : `${s.slice(0, 31)}…`)
// `.` is refused in an endpoint id; the id also keys matter.js storage, so it must stay stable.
const endpointIdOf = (id: DeviceId): string => id.replaceAll('.', '_')

export class MatterBridge {
  private server: ServerNode | undefined
  private aggregator: Endpoint | undefined
  private matter: MatterModules | undefined
  private readonly published = new Map<string, Published>()   // by endpoint id
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
        if (this.exposed.includes(p.id)) continue
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
          productLabel: 'Kasbah Bridge',
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

  async status(): Promise<MatterStatus> {
    const settings = this.opts.settings()
    const listed = settings?.devices ?? []
    const server = this.server
    const online = !!server?.lifecycle.isOnline
    const commissioned = online && !!server?.state.commissioning.commissioned
    const codes = online && !commissioned ? server?.state.commissioning.pairingCodes : undefined
    const candidates: MatterStatus['candidates'] = []
    for (const { descriptor } of this.opts.registry.list()) {
      const type = matterKindOf(descriptor)
      if (!type) continue
      candidates.push({
        id: descriptor.id, name: descriptor.name, pluginId: descriptor.pluginId, type,
        listed: listed.includes(descriptor.id),
        published: !!this.published.get(endpointIdOf(descriptor.id))?.endpoint,
      })
    }
    return {
      enabled: !!settings?.enabled,
      running: online,
      commissioned,
      ...(codes ? { pairing: { manualCode: codes.manualPairingCode, qrSvg: await QRCode.toString(codes.qrPairingCode, { type: 'svg', margin: 1 }) } } : {}),
      candidates,
      skipped: [...this.skipped].map(([id, reason]) => ({ id, reason })),
    }
  }

  /** Publishes the listed devices the registry knows and the bridge does not publish yet. */
  private async sync(): Promise<void> {
    if (!this.server) return
    for (const id of this.exposed) {
      if (this.published.has(endpointIdOf(id))) continue
      const entry = this.opts.registry.get(id)
      if (!entry) { this.skipped.set(id, 'unknown'); continue }
      const kind = matterKindOf(entry.descriptor)
      if (!kind) { this.skipped.set(id, 'unsupported'); continue }
      this.skipped.delete(id)
      try {
        await this.publish(entry, kind)
      } catch (err) {
        this.published.delete(endpointIdOf(id))
        this.opts.logger.warn({ err, deviceId: id }, 'matter bridge could not publish a device')
      }
    }
  }

  private async publish(entry: DeviceEntry, kind: MatterKind): Promise<void> {
    const m = this.matter
    const aggregator = this.aggregator
    if (!m || !aggregator) return
    const { descriptor, state } = entry
    const id = descriptor.id
    const endpointId = endpointIdOf(id)
    const published: Published = { id, kind, name: descriptor.name }
    this.published.set(endpointId, published)
    const bridged = {
      nodeLabel: label(descriptor.name),
      productName: label(descriptor.meta?.model ?? descriptor.kind),
      vendorName: label(descriptor.meta?.manufacturer ?? descriptor.pluginId),
      uniqueId: createHash('sha256').update(id).digest('hex').slice(0, 32),
      reachable: state.available,
    }
    const initial = matterStateOf(kind, state)
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
    const p = this.published.get(endpointIdOf(id))
    if (!p?.endpoint) return
    try {
      await p.endpoint.set(matterStateOf(p.kind, state) as never)
    } catch (err) {
      this.opts.logger.warn({ err, deviceId: id }, 'matter state update failed')
    }
  }

  private async setReachable(id: DeviceId, reachable: boolean): Promise<void> {
    const p = this.published.get(endpointIdOf(id))
    if (!p?.endpoint) return
    try {
      await p.endpoint.set({ bridgedDeviceBasicInformation: { reachable } } as never)
    } catch (err) {
      this.opts.logger.warn({ err, deviceId: id }, 'matter reachability update failed')
    }
  }
}

interface Changed<T> { on(fn: (value: T, old: T, context: { offline?: boolean } | undefined) => void): void }
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
}
