import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { connectSse, type FetchLike } from '../../core/sse'
import { describeError, sendError } from '../../http/errors'
import { HueClient } from './client'
import { findBridge } from './discovery'
import { connectivityToAvailability, indexResources, toDescriptor, toGroupDescriptor, toLightPatch, toPutBody, type HueIndex } from './mapping'
import {
  hueDeviceSchema, hueEventFrameSchema, hueGroupedLightSchema, hueLightSchema, hueRoomSchema, hueZigbeeConnectivitySchema,
  type HueGroupedLight, type HueLight, type HueZigbeeConnectivity,
} from './types'

// Plugin Philips Hue : API locale CLIP v2 + flux d'événements SSE. Sans clé : mode `needs_pairing`
// et route POST /api/plugins/hue/pair. La clé obtenue est adoptée EN MÉMOIRE immédiatement (le serveur
// n'écrit jamais .env : c'est à l'utilisateur d'y coller HUE_APP_KEY pour la persister).

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

export const hueConfigSchema = z.object({
  HUE_BRIDGE_HOST: z.string().min(1).optional(),
  HUE_APP_KEY: z.string().min(1).optional(),
  HUE_EXPOSE_ROOMS: bool.default(false),
  HUE_TLS_INSECURE: bool.default(true),
})
export type HueConfig = z.infer<typeof hueConfigSchema>

export interface HuePluginDeps {
  /** Injection pour les tests (fetch simulé). */
  fetchImpl?: FetchLike
}

export function createHuePlugin(deps: HuePluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: HueConfig | null = null
  let client: HueClient | null = null
  let host: string | null = null
  let appKey: string | undefined
  let index: HueIndex = indexResources([], [], [])
  let groups = new Map<string, HueGroupedLight>()
  let sseCtrl: AbortController | null = null
  let sseDown = false
  let lastError: string | null = null
  let resyncTimer: unknown = null

  const log = () => ctx!.logger

  function makeClient(): HueClient {
    return new HueClient({
      host: host!, ...(appKey ? { appKey } : {}), insecureTls: config!.HUE_TLS_INSECURE, clock: ctx!.clock,
      logger: ctx!.logger, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    })
  }

  async function fetchAll(): Promise<{ lights: HueLight[]; groups: HueGroupedLight[]; zigbee: HueZigbeeConnectivity[] }> {
    const c = client!
    const signal = ctx!.signal
    const [lights, devices, rooms, zigbee] = await Promise.all([
      c.getResources('light', hueLightSchema, signal),
      c.getResources('device', hueDeviceSchema, signal),
      c.getResources('room', hueRoomSchema, signal),
      c.getResources('zigbee_connectivity', hueZigbeeConnectivitySchema, signal),
    ])
    index = indexResources(lights, devices, rooms)
    const grouped = config!.HUE_EXPOSE_ROOMS ? await c.getResources('grouped_light', hueGroupedLightSchema, signal) : []
    groups = new Map(grouped.filter((g) => g.owner?.rtype === 'room').map((g) => [g.id, g]))
    return { lights, groups: [...groups.values()], zigbee }
  }

  function describeAll(lights: HueLight[], grouped: HueGroupedLight[]): DeviceDescriptor[] {
    const out = lights.map((l) => {
      const device = l.owner ? index.devices.get(l.owner.rid) : undefined
      const room = device ? index.roomOfDevice.get(device.id) : undefined
      return toDescriptor(l, device, room)
    })
    for (const g of grouped) out.push(toGroupDescriptor(g, g.owner ? index.rooms.get(g.owner.rid) : undefined))
    return out
  }

  function emitFullStates(lights: HueLight[], grouped: HueGroupedLight[], zigbee: HueZigbeeConnectivity[]) {
    for (const l of lights) ctx!.emitState(l.id, toLightPatch(l))
    for (const g of grouped) ctx!.emitState(g.id, toLightPatch(g))
    for (const [lightId, available] of connectivityToAvailability(zigbee, index)) ctx!.setAvailable(lightId, available)
  }

  /** Redécouverte complète + réémission des états (après reconnexion SSE ou ajout/suppression). */
  async function resync(emitDevices: boolean): Promise<void> {
    const { lights, groups: grouped, zigbee } = await fetchAll()
    if (emitDevices) ctx!.emitDevices(describeAll(lights, grouped))
    emitFullStates(lights, grouped, zigbee)
    lastError = null
  }

  function scheduleResync() {
    if (resyncTimer !== null) return
    resyncTimer = ctx!.clock.setTimeout(() => {
      resyncTimer = null
      resync(true).catch((err) => log().warn({ err }, 'Hue resync failed'))
    }, 1500)
  }

  function handleEvents(raw: string) {
    let frame
    try { frame = hueEventFrameSchema.parse(JSON.parse(raw)) }
    catch (err) { log().debug({ err }, 'unparseable Hue event'); return }
    for (const ev of frame) {
      for (const item of ev.data) {
        if (ev.type === 'update') {
          if (item.type === 'light') ctx!.emitState(item.id, toLightPatch(item as Partial<HueLight>))
          else if (item.type === 'grouped_light' && groups.has(item.id)) ctx!.emitState(item.id, toLightPatch(item as Partial<HueGroupedLight>))
          else if (item.type === 'zigbee_connectivity') {
            const z = hueZigbeeConnectivitySchema.safeParse(item)
            if (z.success) for (const [lightId, available] of connectivityToAvailability([z.data], index)) ctx!.setAvailable(lightId, available)
          }
        } else if ((ev.type === 'add' || ev.type === 'delete') && (item.type === 'light' || item.type === 'device' || item.type === 'room')) {
          scheduleResync()
        }
      }
    }
  }

  function startEventStream() {
    sseCtrl?.abort()
    sseCtrl = new AbortController()
    const signal = AbortSignal.any([ctx!.signal, sseCtrl.signal])
    const c = client!
    void connectSse({
      url: c.eventStreamUrl,
      headers: c.headers(),
      fetchImpl: c.fetchImpl,
      ...(c.dispatcher ? { dispatcher: c.dispatcher } : {}),
      signal, clock: ctx!.clock, logger: ctx!.logger,
      onEvent: (ev) => handleEvents(ev.data),
      onOpen: async (isReconnect) => {
        sseDown = false
        if (isReconnect) {
          log().info('Hue event stream reconnected: resyncing')
          await resync(false).catch((err) => log().warn({ err }, 'Hue resync failed'))
        }
      },
      onDown: (attempts) => {
        if (attempts >= 2 && !sseDown) { sseDown = true; ctx!.setAvailable('*', false) }
      },
    })
  }

  async function connectWithKey(): Promise<void> {
    client?.close()
    client = makeClient()
    await resync(true)
    startEventStream()
  }

  return {
    id: 'hue',
    configSchema: hueConfigSchema,

    async init(c) {
      ctx = c
      config = c.config as HueConfig   // déjà validé/transformé par l'hôte via configSchema
      appKey = config.HUE_APP_KEY
      if (config.HUE_BRIDGE_HOST) host = config.HUE_BRIDGE_HOST
      else {
        try {
          const found = await findBridge(deps.fetchImpl ?? ((url, init) => new HueClient({ host: 'x', clock: c.clock }).fetchImpl(url, init)))
          host = found.host
          c.logger.info({ host, bridgeId: found.bridgeId }, 'Hue bridge discovered — pin it with HUE_BRIDGE_HOST')
        } catch (err) {
          lastError = (err as Error).message
          c.logger.warn({ err }, 'Hue bridge discovery failed')
        }
      }
      if (host) client = makeClient()
    },

    async discover(): Promise<DeviceDescriptor[]> {
      if (!client || !appKey) return []
      try {
        const { lights, groups: grouped } = await fetchAll()
        return describeAll(lights, grouped)
      } catch (err) {
        lastError = (err as Error).message
        throw err
      }
    },

    async start() {
      if (!client || !appKey) return
      const { lights, groups: grouped, zigbee } = await fetchAll()
      emitFullStates(lights, grouped, zigbee)
      startEventStream()
    },

    async execute(externalId: string, command: Command) {
      if (!client || !appKey) throw new PluginError('NEEDS_PAIRING', 'Hue bridge not paired')
      if (command.type !== 'light.set') throw new PluginError('UNSUPPORTED_COMMAND', `${command.type} on Hue light`)
      const isGroup = groups.has(externalId)
      const light = index.lights.get(externalId)
      if (!isGroup && !light) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Hue light ${externalId}`)
      const descriptor = isGroup
        ? toGroupDescriptor(groups.get(externalId)!, undefined)
        : toDescriptor(light!, light!.owner ? index.devices.get(light!.owner.rid) : undefined)
      const { body, warnings } = toPutBody(command, descriptor, light?.dimming?.min_dim_level ?? 1)
      for (const w of warnings) log().debug({ externalId, w }, 'light.set')
      if (Object.keys(body).length === 0) return
      await client.putLimited(isGroup ? 'grouped_light' : 'light', externalId, body)
    },

    async stop() {
      sseCtrl?.abort()
      if (resyncTimer !== null) ctx?.clock.clearTimeout(resyncTimer)
      client?.close()
    },

    registerRoutes(app: FastifyInstance) {
      app.post('/pair', async (_req, reply) => {
        if (!client) return sendError(reply, 502, 'UPSTREAM_ERROR', lastError ?? 'Hue bridge host unknown (set HUE_BRIDGE_HOST)')
        try {
          const result = await client.pair()
          appKey = result.appKey
          await connectWithKey()
          return { appKey: result.appKey, hint: 'Add HUE_APP_KEY=<appKey> to apps/server/.env to persist the pairing.' }
        } catch (err) {
          const d = describeError(err)
          return sendError(reply, d.status, d.code === 'NEEDS_PAIRING' ? 'LINK_BUTTON_NOT_PRESSED' : d.code, d.message)
        }
      })
    },

    health(): PluginHealth {
      if (!host) return { status: 'error', detail: lastError ?? 'bridge not found' }
      if (!appKey) return { status: 'needs_pairing', detail: `press the link button on ${host} then call POST /api/plugins/hue/pair` }
      if (lastError) return { status: 'error', detail: lastError }
      if (sseDown) return { status: 'degraded', detail: 'event stream disconnected' }
      return { status: 'ok', detail: host }
    },
  }
}
