import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Command, DeviceKind, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { writeFileAtomic } from '../../core/atomic-file'
import { publicFetch } from '../../core/outbound'
import { stateFile } from '../../core/paths'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { isRasterImage, sendArt } from '../../http/art'
import { sendError } from '../../http/errors'
import { HaError, HaSocket, type HaEvent, type WsFactory } from './client'
import {
  candidatesOf, duplicateOf, isShown, toPatch, toServiceCall, UnsupportedCommand,
  type HaAreaEntry, type HaDeviceEntry, type HaEntityEntry, type HaState, type Tracked,
} from './mapping'

// Home Assistant plugin: brings into Kasbah the lights, covers, heaters, sensors and players of a
// Home Assistant installation, each in the house room of the same name (HA area = `meta.room`).
// Home Assistant stays the only one in command: a command becomes a `call_service` and the state
// comes back through the `state_changed` subscription. The plugin creates no automation.
//
// Which entities show up is chosen in Settings (`/entities`): all of them by default, except those a
// native Kasbah plugin that is on already provides (`NATIVE_PLUGIN`). Contributed by qgiu
// (https://github.com/qgiu).

const list = (def: string) => z.string().default(def).transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))

export const homeAssistantConfigSchema = z.object({
  /** HTTP base of Home Assistant, e.g. `http://192.168.1.10:8123`. */
  HA_URL: z.string().url().optional(),
  /** Long-lived access token (HA profile → Security). */
  HA_TOKEN: z.string().min(1).optional(),
  /** Or: path of a file holding the token (avoids copying it into .env). */
  HA_TOKEN_FILE: z.string().min(1).optional(),
  HA_DOMAINS: list('light,cover,climate,sensor,media_player'),
  HA_SENSOR_CLASSES: list('temperature,humidity'),
  /** Suffix of the "slow speed" twin covers (Somfy), absorbed as the quiet mode; empty = none. */
  HA_SLOW_SUFFIX: z.string().default('_low_speed'),
  /** The choices made in Settings and the covers in quiet mode (Kasbah settings, HA does not keep them). */
  HA_STATE_FILE: z.string().trim().default(stateFile('home-assistant.json')),
})
export type HomeAssistantConfig = z.infer<typeof homeAssistantConfigSchema>

/** One translatable entity, as the Settings card lists it. */
export interface HaEntityInfo {
  entityId: string
  name: string
  kind: DeviceKind
  /** HA integration (`hue`, `overkiz`…), `''` if unknown. */
  integration: string
  room?: string
  shown: boolean
  /** Shown or hidden by an explicit choice, rather than by the default. */
  chosen: boolean
  /** The Kasbah plugin, on, that already provides this entity. */
  duplicateOf?: string
}
export interface HaEntitiesResponse {
  connected: boolean
  entities: HaEntityInfo[]
}

const savedSchema = z.object({
  choices: z.record(z.string(), z.boolean()).default({}),
  quiet: z.array(z.string()).default([]),
})
/** `null` = back to the default. */
const choicesBodySchema = z.object({ choices: z.record(z.string().min(1).max(255), z.boolean().nullable()) })

async function loadSaved(path: string): Promise<z.infer<typeof savedSchema>> {
  try {
    const parsed = savedSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
    if (parsed.success) return parsed.data
  } catch { /* missing or unreadable file: nothing chosen yet */ }
  return { choices: {}, quiet: [] }
}

const ART_TIMEOUT_MS = 10_000

export interface HomeAssistantPluginDeps {
  wsFactory?: WsFactory
  /** Download of a cover (tests). */
  fetchImpl?: (url: string, init: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>
}

export function createHomeAssistantPlugin(deps: HomeAssistantPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: HomeAssistantConfig | null = null
  let token: string | undefined
  let socket: HaSocket | null = null
  /** Every translatable entity, by externalId. */
  let candidates = new Map<string, Tracked>()
  /** The ones shown in Kasbah. */
  let tracked = new Map<string, Tracked>()
  /** Last state of each candidate (the slow twins aside). */
  const states = new Map<string, HaState>()
  /** Choices made in Settings, by entity_id: shown or hidden whatever the default. */
  let choices: Record<string, boolean> = {}
  /** Covers in quiet mode: a Kasbah setting (as with TaHoma), kept in `HA_STATE_FILE`. */
  let quiet = new Set<string>()
  let climateModes = new Map<string, string[]>()
  let synced = false
  let lastError: string | null = null
  let down = false
  let resyncTimer: unknown = null
  let art: { entityId: string; picture: string; type: string; body: Buffer } | null = null

  const log = () => ctx!.logger
  const enabledPlugins = () => ctx?.enabledPlugins?.() ?? []

  async function save(): Promise<void> {
    await writeFileAtomic(config!.HA_STATE_FILE, `${JSON.stringify({ choices, quiet: [...quiet].sort() })}\n`)
  }

  /** Publishes the shown entities and their states: after a sync, a choice, or another plugin turned on or off. */
  function applySelection(): void {
    if (!ctx || !synced) return
    const enabled = enabledPlugins()
    tracked = new Map([...candidates].filter(([, t]) => isShown(t, choices, enabled)))
    ctx.emitDevices([...tracked.values()].map((t) => t.descriptor))
    for (const t of tracked.values()) {
      const st = states.get(t.entityId)
      if (st) emit(t, st)
    }
  }

  async function sync(): Promise<void> {
    const s = socket!
    const [all, entities, devices, areas] = await Promise.all([
      s.call<HaState[]>({ type: 'get_states' }),
      s.call<HaEntityEntry[]>({ type: 'config/entity_registry/list' }),
      s.call<HaDeviceEntry[]>({ type: 'config/device_registry/list' }),
      s.call<HaAreaEntry[]>({ type: 'config/area_registry/list' }),
    ])
    const found = candidatesOf(all, entities, devices, areas, {
      pluginId: ctx!.pluginId, domains: config!.HA_DOMAINS, sensorClasses: config!.HA_SENSOR_CLASSES,
      slowSuffix: config!.HA_SLOW_SUFFIX,
    })
    candidates = new Map(found.map((t) => [t.externalId, t]))
    const stateById = new Map(all.map((st) => [st.entity_id, st]))
    states.clear()
    for (const t of found) {
      const st = stateById.get(t.entityId)
      if (st) states.set(t.entityId, st)
    }
    climateModes = new Map(found.filter((t) => t.kind === 'climate').map((t) => {
      const raw = stateById.get(t.entityId)?.attributes.hvac_modes
      return [t.externalId, Array.isArray(raw) ? raw.map(String) : []]
    }))
    synced = true
    applySelection()
    lastError = null
    down = false
    log().info({ entities: found.length, shown: tracked.size }, 'Home Assistant devices synced')
  }

  function emit(t: Tracked, st: HaState): void {
    const q = t.slowEntityId ? quiet.has(t.externalId) : undefined
    ctx!.emitState(t.externalId, toPatch(t.kind, st, q))
  }

  function scheduleResync(): void {
    if (resyncTimer !== null) return
    resyncTimer = ctx!.clock.setTimeout(() => {
      resyncTimer = null
      sync().catch((err) => { lastError = (err as Error).message; log().warn({ err }, 'Home Assistant resync failed') })
    }, 2_000)
  }

  function onEvent(ev: HaEvent): void {
    if (ev.event_type === 'state_changed') {
      // the slow twin moves the same motor: only the main cover is authoritative for the state
      const t = candidates.get(ev.data.entity_id as string)
      if (!t) return
      const st = ev.data.new_state as HaState | null
      if (st) states.set(t.entityId, st)
      else states.delete(t.entityId)
      if (!tracked.has(t.externalId)) return
      if (!st) { ctx!.setAvailable(t.externalId, false); return }
      emit(t, st)
      return
    }
    // area renamed, entity added or moved: read everything again (rare)
    if (ev.event_type === 'entity_registry_updated' || ev.event_type === 'area_registry_updated'
      || ev.event_type === 'device_registry_updated') scheduleResync()
  }

  async function onReady(isReconnect: boolean): Promise<void> {
    if (isReconnect) log().info('Home Assistant reconnected: resyncing')
    const s = socket!
    try {
      // subscribe BEFORE reading the states: a change in between would otherwise be lost
      for (const type of ['state_changed', 'entity_registry_updated', 'area_registry_updated', 'device_registry_updated']) {
        await s.call({ type: 'subscribe_events', event_type: type })
      }
      await sync()
    } catch (err) {
      lastError = `sync failed: ${(err as Error).message}`
      throw err
    }
  }

  function entitiesResponse(): HaEntitiesResponse {
    const enabled = enabledPlugins()
    const entities = [...candidates.values()].map((t): HaEntityInfo => {
      const dup = duplicateOf(t, enabled)
      return {
        entityId: t.entityId, name: t.descriptor.name, kind: t.kind, integration: t.integration,
        ...(t.descriptor.meta.room ? { room: t.descriptor.meta.room } : {}),
        shown: isShown(t, choices, enabled), chosen: t.entityId in choices,
        ...(dup ? { duplicateOf: dup } : {}),
      }
    })
    entities.sort((a, b) => a.integration.localeCompare(b.integration) || a.name.localeCompare(b.name))
    return { connected: !!socket?.connected && synced, entities }
  }

  /** The current cover of a player, downloaded with the HA token (relative address) or from the Internet. */
  async function artOf(entityId: string): Promise<{ type: string; body: Buffer } | null> {
    const picture = states.get(entityId)?.attributes.entity_picture
    if (typeof picture !== 'string' || !picture || !tracked.has(entityId)) return null
    if (art?.entityId === entityId && art.picture === picture) return art
    const signal = AbortSignal.timeout(ART_TIMEOUT_MS)
    const absolute = /^https?:\/\//i.test(picture)
    const res = absolute
      ? await (deps.fetchImpl ?? ((u, i) => publicFetch(u, i) as unknown as Promise<Response>))(picture, { signal })
      : await (deps.fetchImpl ?? fetch)(`${config!.HA_URL!.replace(/\/+$/, '')}${picture.startsWith('/') ? '' : '/'}${picture}`,
        { headers: { authorization: `Bearer ${token}` }, signal })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !isRasterImage(type)) return null
    art = { entityId, picture, type, body: Buffer.from(await res.arrayBuffer()) }
    return art
  }

  return {
    id: 'home_assistant',
    configSchema: homeAssistantConfigSchema,

    async init(c) {
      ctx = c
      config = c.config as HomeAssistantConfig
      candidates = new Map()
      tracked = new Map()
      states.clear()
      climateModes = new Map()
      synced = false
      lastError = null
      down = false
      art = null
      const saved = await loadSaved(config.HA_STATE_FILE)
      choices = saved.choices
      quiet = new Set(saved.quiet)
      token = config.HA_TOKEN
      if (!token && config.HA_TOKEN_FILE) {
        try { token = readFileSync(config.HA_TOKEN_FILE, 'utf8').trim() || undefined }
        catch (err) { lastError = `cannot read HA_TOKEN_FILE (${(err as NodeJS.ErrnoException).code ?? 'error'})` }
      }
    },

    async discover() {
      // no network here: the devices are born at the first sync (start)
      return []
    },

    async start() {
      if (!config!.HA_URL || !token) return
      socket = new HaSocket({
        baseUrl: config!.HA_URL, token, logger: ctx!.logger, clock: ctx!.clock, signal: ctx!.signal,
        ...(deps.wsFactory ? { wsFactory: deps.wsFactory } : {}),
        onReady, onEvent,
        onDown: (reason) => { down = true; lastError = reason; ctx!.setAvailable('*', false) },
      })
      socket.start()
    },

    async execute(externalId: string, command: Command) {
      const t = tracked.get(externalId)
      if (!t) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Home Assistant entity ${externalId}`)
      if (command.type === 'cover.set_quiet') {
        if (!t.slowEntityId) throw new PluginError('UNSUPPORTED_COMMAND', `${externalId} has no slow-speed twin`)
        if (command.on) quiet.add(externalId)
        else quiet.delete(externalId)
        await save()
        ctx!.emitState(externalId, { quiet: command.on })
        return
      }
      if (!socket?.connected) throw new PluginError('DEVICE_UNAVAILABLE', 'Home Assistant not connected')
      let call
      try { call = toServiceCall(t, command, quiet.has(externalId), climateModes.get(externalId) ?? []) }
      catch (err) {
        if (err instanceof UnsupportedCommand) throw new PluginError('UNSUPPORTED_COMMAND', err.message)
        throw err
      }
      try {
        await socket.call({
          type: 'call_service', domain: call.domain, service: call.service,
          service_data: call.data, target: { entity_id: call.entityId },
        })
      } catch (err) {
        if (err instanceof HaError && err.code === 'TIMEOUT') throw new PluginError('TIMEOUT', err.message)
        throw new PluginError('UPSTREAM_ERROR', (err as Error).message, { cause: err })
      }
    },

    onPluginsChanged() {
      applySelection()
    },

    async stop() {
      if (resyncTimer !== null) { ctx?.clock.clearTimeout(resyncTimer); resyncTimer = null }
      socket?.close()
      socket = null
      synced = false
    },

    registerRoutes(app: FastifyInstance) {
      // Every translatable entity, for the Settings card; empty while the plugin is off or not connected.
      app.get('/entities', async () => entitiesResponse())

      // Explicit choices; `null` gives an entity back to the default. Applied live.
      app.patch('/entities', async (req, reply) => {
        if (!config) return sendError(reply, 409, 'NOT_RUNNING', 'the Home Assistant plugin is not running')
        const body = choicesBodySchema.safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'BAD_REQUEST', body.error.issues[0]?.message ?? 'invalid body')
        const next = { ...choices }
        for (const [entityId, shown] of Object.entries(body.data.choices)) {
          if (shown === null) delete next[entityId]
          else next[entityId] = shown
        }
        choices = next
        await save()
        applySelection()
        return entitiesResponse()
      })

      // A player's cover: `entity_picture` carries an HA token and points at the LAN, so the server
      // fetches it. Only the current cover of a shown player is served: it is not an open relay.
      app.get<{ Params: { entityId: string } }>('/art/:entityId', async (req, reply) => {
        const got = await artOf(req.params.entityId).catch((err: Error) => {
          ctx?.logger.debug({ err, entityId: req.params.entityId }, 'Home Assistant cover download failed')
          return null
        })
        if (!got) return sendError(reply, 404, 'NOT_FOUND', 'no cover for this player')
        return sendArt(reply, got)
      })
    },

    health(): PluginHealth {
      if (!config?.HA_URL) return { status: 'error', detail: 'set HA_URL in apps/server/.env' }
      if (!token) return { status: 'error', detail: lastError ?? 'set HA_TOKEN or HA_TOKEN_FILE in apps/server/.env' }
      if (down || !socket?.connected) return { status: 'degraded', detail: lastError ?? 'connecting to Home Assistant' }
      if (lastError) return { status: 'degraded', detail: lastError }
      return { status: 'ok', detail: `${tracked.size} of ${candidates.size} entities shown` }
    },
  }
}
