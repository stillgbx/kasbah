import { readFile } from 'node:fs/promises'
import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { writeFileAtomic } from '../../core/atomic-file'
import { stateFile } from '../../core/paths'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { TlsPin, createPinFile, type PinFile } from '../../core/tls-pin'
import { describeError, sendError } from '../../http/errors'
import { DirigeraClient } from './client'
import { mergeEvent, PLUGIN_ID, toDescriptors, toPatches, toWrites, externalIdsOf } from './mapping'
import { DirigeraSocket, type WsFactory } from './socket'
import { dirigeraEventSchema, type DirigeraDevice } from './types'

// IKEA DIRIGERA plugin: the TRÅDFRI (Zigbee) and Matter devices paired to the hub, through its local
// API — a REST read of the devices, a WebSocket for their changes, a PATCH per command. Unofficial
// API, written WITHOUT a hub to test against and checked against the `dirigera` npm library (2.0.2,
// read, not used: it would bring got, commander and mDNS for a handful of calls): what is still a guess is
// listed in the wiki page (3_29). Without a token: `needs_pairing` and POST /api/plugins/dirigera/pair,
// which waits for a press on the hub's action button.

export const dirigeraConfigSchema = z.object({
  /** IP of the hub (fix it with a DHCP lease). */
  DIRIGERA_HOST: z.string().min(1).optional(),
  /** Where the pairing keeps the token (0600). */
  DIRIGERA_TOKEN_FILE: z.string().trim().default(stateFile('dirigera-token.json')),
})
export type DirigeraConfig = z.infer<typeof dirigeraConfigSchema>

const tokenFileSchema = z.object({ token: z.string().min(1) })

/** How long the pairing waits for the action button (the hub's own window is about a minute). */
const PAIR_WINDOW_MS = 60_000

export interface DirigeraPluginDeps {
  fetchImpl?: FetchLike
  wsFactory?: WsFactory
  pinFile?: PinFile
}

export function createDirigeraPlugin(deps: DirigeraPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: DirigeraConfig | null = null
  let token: string | undefined
  let pin: TlsPin | null = null
  let client: DirigeraClient | null = null
  let socket: DirigeraSocket | null = null
  /** Last FULL state of each hub device: the socket only sends deltas. */
  let devices = new Map<string, DirigeraDevice>()
  let descriptorsKey = ''
  let lastError: string | null = null
  let socketDown = false
  let resyncTimer: unknown = null

  const log = () => ctx!.logger

  function makeClient(): DirigeraClient {
    return new DirigeraClient({
      host: config!.DIRIGERA_HOST!, ...(token ? { token } : {}), pin: pin!, clock: ctx!.clock, logger: ctx!.logger,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    })
  }

  function describeAll(): DeviceDescriptor[] {
    return [...devices.values()].flatMap(toDescriptors)
  }

  /** Republishes the device list only when it changed (a name, a room, a new measurement). */
  function publishDevices(force = false): void {
    const list = describeAll()
    const key = JSON.stringify(list)
    if (!force && key === descriptorsKey) return
    descriptorsKey = key
    ctx!.emitDevices(list)
  }

  function emitDevice(d: DirigeraDevice): void {
    for (const [externalId, patch] of toPatches(d)) ctx!.emitState(externalId, patch)
    if (d.isReachable === false) for (const id of externalIdsOf(d)) ctx!.setAvailable(id, false)
  }

  async function resync(): Promise<void> {
    const list = await client!.getDevices(ctx!.signal)
    devices = new Map(list.map((d) => [d.id, d]))
    publishDevices(true)
    for (const d of devices.values()) emitDevice(d)
    lastError = null
  }

  function scheduleResync(): void {
    if (resyncTimer !== null) return
    resyncTimer = ctx!.clock.setTimeout(() => {
      resyncTimer = null
      resync().catch((err) => { lastError = (err as Error).message; log().warn({ err }, 'DIRIGERA resync failed') })
    }, 1_500)
  }

  function onEvent(raw: unknown): void {
    const parsed = dirigeraEventSchema.safeParse(raw)
    if (!parsed.success) return
    const { type, data } = parsed.data
    if (type === 'deviceStateChanged' && data?.id) {
      const known = devices.get(data.id)
      if (!known) { scheduleResync(); return }
      const merged = mergeEvent(known, data)
      devices.set(merged.id, merged)
      publishDevices()
      emitDevice(merged)
      return
    }
    // added, removed, renamed, moved to another room: read everything again (rare)
    if (/^(device|room)/.test(type)) scheduleResync()
  }

  function openSocket(): void {
    socket?.stop()
    socket = new DirigeraSocket({
      url: client!.socketUrl, token: token!, pin: pin!, clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
      ...(deps.wsFactory ? { factory: deps.wsFactory } : {}),
      onEvent,
      onOpen: (reconnected) => {
        socketDown = false
        if (reconnected) {
          log().info('DIRIGERA socket reconnected: resyncing')
          scheduleResync()
        }
      },
      onClose: () => { socketDown = true; ctx!.setAvailable('*', false) },
    })
    socket.start()
  }

  async function connect(): Promise<void> {
    try { await resync() }
    catch (err) { lastError = (err as Error).message; log().warn({ err }, 'DIRIGERA first read failed') }
    openSocket()
  }

  async function loadToken(path: string): Promise<string | undefined> {
    try {
      const parsed = tokenFileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
      return parsed.success ? parsed.data.token : undefined
    } catch { return undefined }
  }

  return {
    id: PLUGIN_ID,
    configSchema: dirigeraConfigSchema,

    async init(c) {
      ctx = c
      config = c.config as DirigeraConfig   // already validated/transformed by the host
      devices = new Map()
      descriptorsKey = ''
      lastError = null
      socketDown = false
      token = await loadToken(config.DIRIGERA_TOKEN_FILE)
      const pinFile = deps.pinFile ?? createPinFile(stateFile('dirigera-tls-pin.json'), c.logger)
      pin = new TlsPin(await pinFile.load(), (fp) => { void pinFile.save(fp) }, { device: 'DIRIGERA hub', logger: c.logger })
      client = config.DIRIGERA_HOST ? makeClient() : null
    },

    async discover() {
      // no network here: the devices are born at the first read (start)
      return describeAll()
    },

    async start() {
      if (!client || !token) return
      await connect()
    },

    async execute(externalId: string, command: Command) {
      if (!client || !token) throw new PluginError('NEEDS_PAIRING', 'DIRIGERA hub not paired')
      // a measurement (`<hub id>.<measure>`) is not a hub device: nothing to drive
      const device = devices.get(externalId)
      if (!device) {
        if (externalId.includes('.')) throw new PluginError('UNSUPPORTED_COMMAND', `${command.type} on a DIRIGERA measurement`)
        throw new PluginError('DEVICE_UNAVAILABLE', `unknown DIRIGERA device ${externalId}`)
      }
      // one PATCH per attribute family, in order (switch on before dimming)
      for (const write of toWrites(device, command)) await client.patchDevice(device.id, [write])
    },

    async stop() {
      if (resyncTimer !== null) { ctx?.clock.clearTimeout(resyncTimer); resyncTimer = null }
      socket?.stop()
      socket = null
      client?.close()
    },

    registerRoutes(app: FastifyInstance) {
      // Starts the pairing, then waits (up to a minute) for a press on the hub's action button.
      app.post('/pair', async (_req, reply) => {
        if (!ctx || !config) return sendError(reply, 409, 'NOT_RUNNING', 'the DIRIGERA plugin is not running')
        if (!client) return sendError(reply, 502, 'UPSTREAM_ERROR', 'DIRIGERA hub host unknown (set DIRIGERA_HOST)')
        try {
          // pairing again is what accepts a hub whose certificate changed
          pin!.clear()
          const fresh = await client.pair({
            name: 'kasbah', windowMs: PAIR_WINDOW_MS,
            signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(PAIR_WINDOW_MS + 30_000)]),
          })
          await writeFileAtomic(config.DIRIGERA_TOKEN_FILE, `${JSON.stringify({ token: fresh })}\n`, { mode: 0o600 })
          token = fresh
          client.close()
          client = makeClient()
          await connect()
          return { paired: true, devices: devices.size }
        } catch (err) {
          const d = describeError(err)
          return sendError(reply, d.status, d.code === 'NEEDS_PAIRING' ? 'ACTION_BUTTON_NOT_PRESSED' : d.code, d.message)
        }
      })
    },

    health(): PluginHealth {
      if (!config?.DIRIGERA_HOST) return { status: 'error', detail: 'set DIRIGERA_HOST in apps/server/.env' }
      if (pin?.changed) return { status: 'error', detail: 'Le certificat du hub DIRIGERA a changé : connexion refusée. Appairer de nouveau accepte le nouveau certificat.' }
      if (!token) return { status: 'needs_pairing', detail: `call POST /api/plugins/dirigera/pair, then press the action button of ${config.DIRIGERA_HOST} within a minute` }
      if (lastError) return { status: 'error', detail: lastError }
      if (socketDown || !socket?.connected) return { status: 'degraded', detail: 'event socket disconnected' }
      return { status: 'ok', detail: `${devices.size} devices on ${config.DIRIGERA_HOST}` }
    },
  }
}
