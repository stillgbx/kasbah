import type { Command, DeviceDescriptor, PluginHealth, PluginScene, SceneGroupKind, SceneRecall, SceneUpdate } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { stateFile } from '../../core/paths'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { connectSse, type FetchLike } from '../../core/sse'
import { TlsPin, createPinFile, type PinFile } from '../../core/tls-pin'
import { describeError, sendError } from '../../http/errors'
import { HueClient } from './client'
import { findBridge } from './discovery'
import { roomKey } from '@kasbah/shared'
import {
  connectivityToAvailability, indexResources, sceneStatusToActive, sceneTargetLights, toCreateSceneBody, toDescriptor,
  toGroupDescriptor, toLightPatch, toPutBody, toSceneDescriptor, toSceneRecallBody, type HueIndex,
} from './mapping'
import {
  hueDeviceSchema, hueEventFrameSchema, hueGroupedLightSchema, hueLightSchema, hueRoomSchema, hueSceneSchema,
  hueZigbeeConnectivitySchema, type HueGroupedLight, type HueLight, type HueRoom, type HueScene, type HueZigbeeConnectivity,
} from './types'

// Philips Hue plugin: local CLIP v2 API + SSE event stream. Without a key: `needs_pairing` mode
// and the POST /api/plugins/hue/pair route. The key obtained is adopted IN MEMORY immediately (the
// server never writes .env: it is up to the user to paste HUE_APP_KEY there to persist it).

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

export const hueConfigSchema = z.object({
  HUE_BRIDGE_HOST: z.string().min(1).optional(),
  HUE_APP_KEY: z.string().min(1).optional(),
  HUE_EXPOSE_ROOMS: bool.default(false),
  HUE_TLS_INSECURE: bool.default(true),
})
export type HueConfig = z.infer<typeof hueConfigSchema>

export interface HuePluginDeps {
  /** Injection for the tests (simulated fetch). */
  fetchImpl?: FetchLike
  /** Injection for the tests: the bridge certificate pin (otherwise a file under `.state/`). */
  pinFile?: PinFile
}

export function createHuePlugin(deps: HuePluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: HueConfig | null = null
  let client: HueClient | null = null
  let host: string | null = null
  let appKey: string | undefined
  /** Bridge certificate, pinned on first use: the bridge has no other state file to keep it in. */
  let pin: TlsPin | null = null
  let index: HueIndex = indexResources([], [], [])
  let groups = new Map<string, HueGroupedLight>()
  /** The bridge's zones (groupings that cross rooms): same shape as a room. */
  let zones = new Map<string, HueRoom>()
  let scenes: HueScene[] = []
  /** rid of a room OR a zone → rid of its `grouped_light` (used to switch off a light scene). */
  let groupedLightOfGroup = new Map<string, string>()
  let sseCtrl: AbortController | null = null
  let sseDown = false
  let lastError: string | null = null
  let resyncTimer: unknown = null

  const log = () => ctx!.logger

  function makeClient(): HueClient {
    return new HueClient({
      host: host!, ...(appKey ? { appKey } : {}), insecureTls: config!.HUE_TLS_INSECURE, pin: pin!, clock: ctx!.clock,
      logger: ctx!.logger, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    })
  }

  async function fetchAll(): Promise<{ lights: HueLight[]; groups: HueGroupedLight[]; zigbee: HueZigbeeConnectivity[] }> {
    const c = client!
    const signal = ctx!.signal
    const [lights, devices, rooms, zigbee, sceneList, zoneList] = await Promise.all([
      c.getResources('light', hueLightSchema, signal),
      c.getResources('device', hueDeviceSchema, signal),
      c.getResources('room', hueRoomSchema, signal),
      c.getResources('zigbee_connectivity', hueZigbeeConnectivitySchema, signal),
      c.getResources('scene', hueSceneSchema, signal),
      c.getResources('zone', hueRoomSchema, signal),
    ])
    index = indexResources(lights, devices, rooms)
    zones = new Map(zoneList.map((z) => [z.id, z]))
    scenes = sceneList
    groupedLightOfGroup = new Map()
    for (const g of [...rooms, ...zoneList]) {
      const service = g.services.find((sv) => sv.rtype === 'grouped_light')
      if (service) groupedLightOfGroup.set(g.id, service.rid)
    }
    const grouped = config!.HUE_EXPOSE_ROOMS ? await c.getResources('grouped_light', hueGroupedLightSchema, signal) : []
    groups = new Map(grouped.filter((g) => g.owner?.rtype === 'room').map((g) => [g.id, g]))
    return { lights, groups: [...groups.values()], zigbee }
  }

  /** Room OR zone whose name matches (same normalization as auto-placement). */
  function findGroup(name: string): { ref: { rid: string; rtype: string }; lights: string[] } | undefined {
    const key = roomKey(name)
    for (const [rtype, groups] of [['room', index.rooms], ['zone', zones]] as const) {
      for (const g of groups.values()) {
        if (!g.metadata?.name || roomKey(g.metadata.name) !== key) continue
        const lights: string[] = []
        for (const c of g.children) {
          if (c.rtype === 'light') lights.push(c.rid)
          else if (c.rtype === 'device') lights.push(...(index.lightsOfDevice.get(c.rid) ?? []))
        }
        return { ref: { rid: g.id, rtype }, lights }
      }
    }
    return undefined
  }

  /** A scene's group: the Hue room will attach to the house room of the same name. */
  function sceneGroup(scene: HueScene): { name: string; kind: SceneGroupKind } | undefined {
    const ref = scene.group
    if (!ref) return undefined
    const name = (ref.rtype === 'zone' ? zones.get(ref.rid) : index.rooms.get(ref.rid))?.metadata?.name
    if (!name) return undefined
    return { name, kind: ref.rtype === 'zone' ? 'zone' : 'room' }
  }

  function describeScenes(): PluginScene[] {
    return scenes.map((s) => toSceneDescriptor(s, sceneGroup(s)))
  }

  function emitScenes() {
    ctx!.emitScenes(describeScenes())
    for (const s of scenes) ctx!.emitSceneState(s.id, sceneStatusToActive(s))
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

  /** Full rediscovery + re-emission of the states (after SSE reconnection or add/delete). */
  async function resync(emitDevices: boolean): Promise<void> {
    const { lights, groups: grouped, zigbee } = await fetchAll()
    if (emitDevices) ctx!.emitDevices(describeAll(lights, grouped))
    emitFullStates(lights, grouped, zigbee)
    emitScenes()
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
          else if (item.type === 'scene') {
            // scene fragment: each field is only there if it changed
            const fragment = item as { status?: { active?: string }; auto_dynamic?: boolean }
            if (fragment.status?.active) ctx!.emitSceneState(item.id, sceneStatusToActive({ status: fragment.status }))
            // the "start animated" setting lives on the bridge: re-reading it wherever it comes from
            // (Kasbah, Hue app, another screen) keeps a single source of truth
            if (fragment.auto_dynamic !== undefined) {
              const scene = scenes.find((sc) => sc.id === item.id)
              if (scene && scene.auto_dynamic !== fragment.auto_dynamic) {
                scene.auto_dynamic = fragment.auto_dynamic
                ctx!.emitScenes(describeScenes())
              }
            }
          }
          else if (item.type === 'zigbee_connectivity') {
            const z = hueZigbeeConnectivitySchema.safeParse(item)
            if (z.success) for (const [lightId, available] of connectivityToAvailability([z.data], index)) ctx!.setAvailable(lightId, available)
          }
        } else if ((ev.type === 'add' || ev.type === 'delete')
          && (item.type === 'light' || item.type === 'device' || item.type === 'room' || item.type === 'scene' || item.type === 'zone')) {
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
      config = c.config as HueConfig   // already validated/transformed by the host via configSchema
      appKey = config.HUE_APP_KEY
      const pinFile = deps.pinFile ?? createPinFile(stateFile('hue-tls-pin.json'), c.logger)
      pin = new TlsPin(await pinFile.load(), (fp) => { void pinFile.save(fp) }, { device: 'Hue bridge', logger: c.logger })
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
      emitScenes()
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

    async recallScene(externalId: string, recall: SceneRecall) {
      if (!client || !appKey) throw new PluginError('NEEDS_PAIRING', 'Hue bridge not paired')
      const scene = scenes.find((s) => s.id === externalId)
      if (!scene) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Hue scene ${externalId}`)
      if (recall.mode !== 'off') {
        await client.putLimited('scene', externalId, toSceneRecallBody(recall))
        return
      }
      // Switching off: the bridge has no "deactivate the scene". A single PUT on the group's
      // grouped_light (it also covers the lights the scene does not list), otherwise light by light.
      const groupedLight = scene.group ? groupedLightOfGroup.get(scene.group.rid) : undefined
      if (groupedLight) {
        await client.putLimited('grouped_light', groupedLight, { on: { on: false } })
        return
      }
      const targets = sceneTargetLights(scene)
      if (targets.length === 0) throw new PluginError('UPSTREAM_ERROR', `Hue scene ${externalId} has no light to switch off`)
      await Promise.all(targets.map((id) => client!.putLimited('light', id, { on: { on: false } })))
    },

    async updateScene(externalId: string, update: SceneUpdate) {
      if (!client || !appKey) throw new PluginError('NEEDS_PAIRING', 'Hue bridge not paired')
      if (!scenes.some((s) => s.id === externalId)) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Hue scene ${externalId}`)
      // separate queue (`intent`): this setting must not supersede a recall of the same scene
      await client.putLimited('scene', externalId, { auto_dynamic: update.autoDynamic }, 'settings')
    },

    async createScene(fromExternalId: string, groupName: string) {
      if (!client || !appKey) throw new PluginError('NEEDS_PAIRING', 'Hue bridge not paired')
      const source = scenes.find((s) => s.id === fromExternalId)
      if (!source) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Hue scene ${fromExternalId}`)
      const group = findGroup(groupName)
      if (!group) throw new PluginError('DEVICE_UNAVAILABLE', `no Hue room or zone named "${groupName}"`)
      const lights = group.lights.map((id) => index.lights.get(id)).filter((l): l is HueLight => !!l)
      if (lights.length === 0) throw new PluginError('DEVICE_UNAVAILABLE', `"${groupName}" has no Hue light`)
      const already = scenes.some((s) => s.group?.rid === group.ref.rid && s.metadata?.name === source.metadata?.name)
      if (already) throw new PluginError('UNSUPPORTED_COMMAND', `"${source.metadata?.name}" already exists in "${groupName}"`)
      await client.createResource('scene', toCreateSceneBody(source, group.ref, lights))
      // the bridge emits an `add`: the deferred resync will republish the scenes
      scheduleResync()
    },

    async deleteScene(externalId: string) {
      if (!client || !appKey) throw new PluginError('NEEDS_PAIRING', 'Hue bridge not paired')
      if (!scenes.some((s) => s.id === externalId)) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Hue scene ${externalId}`)
      await client.deleteResource('scene', externalId)
      scheduleResync()   // the bridge also emits a `delete`
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
          // pairing again is what accepts a bridge whose certificate changed
          pin!.clear()
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
      if (pin?.changed) return { status: 'error', detail: 'Le certificat du pont Hue a changé : connexion refusée. Appairer de nouveau accepte le nouveau certificat.' }
      if (!appKey) return { status: 'needs_pairing', detail: `press the link button on ${host} then call POST /api/plugins/hue/pair` }
      if (lastError) return { status: 'error', detail: lastError }
      if (sseDown) return { status: 'degraded', detail: 'event stream disconnected' }
      return { status: 'ok', detail: host }
    },
  }
}
