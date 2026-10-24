import { readFile } from 'node:fs/promises'
import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { writeFileAtomic } from '../../core/atomic-file'
import { stateFile } from '../../core/paths'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import { TlsPin, createPinFile, type PinFile } from '../../core/tls-pin'
import { TahomaClient } from './client'
import { LightHistory, createLightHistoryFile, type LightHistoryStore } from './history'
import {
  assumedPosition, coverCommands, deviceUrlToExternalId, hasPositionFeedback, isCover, isLightSensor, luminance,
  readStates, sameNode, toAction, toAvailability, toCoverPatch, toDescriptor, toLightSensorDescriptor, type CoverCommands,
} from './mapping'
import type { OverkizAction, OverkizDevice, OverkizEvent } from './types'

// Somfy TaHoma plugin (Overkiz platform), LOCAL API of the "developer mode": no cloud call, a local
// token pasted into .env (TAHOMA_TOKEN). Without a token: `needs_pairing` mode, zero devices.
//
// The box mixes two radios and the plugin tells them apart by what it DECLARES, not by the URL
// prefix: io-homecontrol is bidirectional (real position, `setClosure`) whereas RTS is
// unidirectional (open / close / stop, no feedback). A device without a position command therefore
// does not announce the `position` capability: the UI shows no slider, and its position stays
// UNKNOWN until the first command, then inferred from it (100 after "open", 0 after "close").
// Recalling the motor's favorite position makes it unknown again: we do not know where it is set.

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

/**
 * An automation or a scene sends its shutters all at once: 15 simultaneous `exec/apply`, the box
 * took 9 in 8 s and the other 6 timed out without being executed (observed 2026-10-14). Requests
 * therefore go out one at a time (`queue`), or else the commands received within this window go out
 * in ONE execution (`batch`, 15 shutters accepted in ~200 ms the same evening). Real-time window,
 * not the context clock: it only measures the arrival of the requests of one burst.
 */
export const BATCH_WINDOW_MS = 50

/** A command waiting for the next grouped execution. */
interface Pending {
  action: OverkizAction
  type: Command['type']
  resolve(): void
  reject(err: unknown): void
}

export const tahomaConfigSchema = z.object({
  TAHOMA_HOST: z.string().min(1).optional(),
  TAHOMA_PORT: z.coerce.number().int().min(1).max(65535).default(8443),
  TAHOMA_TOKEN: z.string().min(1).optional(),
  TAHOMA_TLS_INSECURE: bool.default(true),
  TAHOMA_POLL_MS: z.coerce.number().int().min(500).max(60_000).default(2000),
  /**
   * Sending a burst of commands. `queue`: one execution per device, one request at a time.
   * `batch`: a single execution for the whole burst (like a TaHoma scenario), faster, but a stop sent
   * afterwards to ONE device might cancel the whole execution — not verified.
   */
  TAHOMA_COMMAND_MODE: z.enum(['queue', 'batch']).default('queue'),
  /** Light history of the solar shutters; empty = no persistence. */
  TAHOMA_LIGHT_HISTORY_FILE: z.string().trim().default(stateFile('tahoma-light-history.json')),
  /** Shutters in quiet mode (a Kasbah setting, the box does not keep it); empty = no persistence. */
  TAHOMA_QUIET_FILE: z.string().trim().default(stateFile('tahoma-quiet.json')),
})
export type TahomaConfig = z.infer<typeof tahomaConfigSchema>

export interface TahomaPluginDeps {
  /** Injection for tests (simulated fetch). */
  fetchImpl?: FetchLike
  /** Injection for tests: request timeout, shortened so as not to slow down the suite. */
  requestTimeoutMs?: number
  /** Injection for tests: in-memory light history. */
  lightHistoryStore?: LightHistoryStore
  /** Injection for tests: the box certificate pin (otherwise a file under `.state/`). */
  pinFile?: PinFile
}

interface Entry {
  device: OverkizDevice
  commands: CoverCommands
  /** Real position reported by the box (io) or inferred from the commands (RTS). */
  feedback: boolean
  /**
   * Last known FULL state, seeded by `/setup` then updated by each frame. The box only sends deltas,
   * often a single key at a time (`core:MovingState=true` arrives in its own frame, without position
   * or target): without this accumulation, a frame taken on its own never tells which way the cover
   * is moving.
   */
  states: Map<string, unknown>
}

/** A light sensor: the solar panel of a solar shutter. */
interface SensorEntry {
  device: OverkizDevice
  states: Map<string, unknown>
}

/** Shutters in quiet mode, read back at startup. Unreadable or missing file = none. */
async function loadQuiet(path: string): Promise<Set<string>> {
  try {
    const parsed = z.object({ quiet: z.array(z.string()) }).safeParse(JSON.parse(await readFile(path, 'utf8')))
    return new Set(parsed.success ? parsed.data.quiet : [])
  } catch { return new Set() }
}

async function saveQuiet(path: string, quiet: Set<string>): Promise<void> {
  await writeFileAtomic(path, JSON.stringify({ quiet: [...quiet].sort() }))
}

export function createTahomaPlugin(deps: TahomaPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: TahomaConfig | null = null
  let client: TahomaClient | null = null
  /** Box certificate, pinned on first use. */
  let pin: TlsPin | null = null
  let entries = new Map<string, Entry>()
  let sensors = new Map<string, SensorEntry>()
  let history = new LightHistory()
  let historyStore: LightHistoryStore | null = null
  /** Shutters in quiet mode (`externalId`). */
  let quiet = new Set<string>()
  let descriptors: DeviceDescriptor[] = []
  /** Last known position, to guess the direction of movement and for devices without feedback. */
  const positions = new Map<string, number>()
  let listenerId: string | null = null
  let poller: { stop(): void } | null = null
  let protocolVersion: string | undefined
  /**
   * The local API has answered at least once: developer mode is therefore indeed on. Set by the
   * `init` probe AND by any successful response afterwards: without that, a probe that landed during
   * a box restart (connections cut, observed 2026-09-24 at 8:00) left "activate developer mode"
   * displayed for good, even though everything after worked.
   */
  let localApiUp = false
  let lastError: string | null = null
  let needsResync = false
  /** Commands of the current burst, sent together when `batchTimer` fires. */
  let batch: Pending[] = []
  let batchTimer: ReturnType<typeof setTimeout> | null = null
  /** Last `exec/apply` request sent: the next one waits for it to finish. */
  let sending: Promise<unknown> = Promise.resolve()

  const log = () => ctx!.logger
  const ready = (): TahomaClient => {
    if (!client || !config?.TAHOMA_TOKEN) throw new PluginError('NEEDS_PAIRING', 'TaHoma local token missing (TAHOMA_TOKEN)')
    return client
  }

  /** Reads the setup again: devices kept, available commands, descriptors. */
  async function refresh(): Promise<void> {
    const devices = await ready().getSetup(ctx!.signal)
    const next = new Map<string, Entry>()
    const nextSensors = new Map<string, SensorEntry>()
    const skipped: string[] = []
    descriptors = []
    for (const device of devices) {
      if (isLightSensor(device)) {
        // attached to the motor on the same radio node (`…#2` → `…#1`): the UI shows them together
        const cover = devices.find((d) => sameNode(d.deviceURL, device.deviceURL) && isCover(d))
        nextSensors.set(deviceUrlToExternalId(device.deviceURL), { device, states: readStates(device.states) })
        descriptors.push(toLightSensorDescriptor(device, cover ? `tahoma:${deviceUrlToExternalId(cover.deviceURL)}` : undefined))
        continue
      }
      if (!isCover(device)) { skipped.push(device.definition?.uiClass ?? device.controllableName ?? '?'); continue }
      const externalId = deviceUrlToExternalId(device.deviceURL)
      next.set(externalId, {
        device, commands: coverCommands(device), feedback: hasPositionFeedback(device),
        states: readStates(device.states),
      })
      descriptors.push(toDescriptor(device))
    }
    entries = next
    sensors = nextSensors
    localApiUp = true
    if (skipped.length) log().debug({ skipped }, 'TaHoma devices ignored (not covers)')
    lastError = null
  }

  /** Publishes the current state of all devices (and their availability). */
  function emitAll(): void {
    for (const [externalId, entry] of entries) {
      const patch = toCoverPatch(entry.states, positions.get(externalId))
      // even empty, the patch marks the device available (`emitState` adds `available: true`)
      ctx!.emitState(externalId, patch)
      if (typeof patch.position === 'number') positions.set(externalId, patch.position)
      if (entry.commands.quiet) ctx!.emitState(externalId, { quiet: quiet.has(externalId) })
      ctx!.setAvailable(externalId, toAvailability(entry.device, entry.states))
    }
    for (const [externalId, entry] of sensors) {
      emitSensor(externalId, entry)
      ctx!.setAvailable(externalId, toAvailability(entry.device, entry.states))
    }
  }

  /** Publishes a sensor's luminance and records it in the history. */
  function emitSensor(externalId: string, entry: SensorEntry): void {
    const lux = luminance(entry.states)
    if (lux === undefined) return
    ctx!.emitState(externalId, { value: lux })
    if (history.record(externalId, lux, ctx!.clock.now())) void saveHistory()
  }

  /**
   * One write at a time: the 11 sensors open their hour in the same pass, and simultaneous writes
   * fight over the same temporary file (ENOENT on rename, observed). Requests arriving during a
   * write are merged into ONE more write.
   */
  let saving: Promise<void> | null = null
  let saveAgain = false
  function saveHistory(): Promise<void> {
    if (saving) { saveAgain = true; return saving }
    saving = (async () => {
      do { saveAgain = false; await historyStore?.save(history.toState()) } while (saveAgain)
    })().finally(() => { saving = null })
    return saving
  }

  async function resync(emitDevices: boolean): Promise<void> {
    await refresh()
    if (emitDevices) ctx!.emitDevices(descriptors)
    emitAll()
  }

  function handleEvents(events: OverkizEvent[]): void {
    for (const ev of events) {
      if (ev.name === 'DeviceCreatedEvent' || ev.name === 'DeviceRemovedEvent') { needsResync = true; continue }
      const externalId = ev.deviceURL ? deviceUrlToExternalId(ev.deviceURL) : undefined
      const sensor = externalId ? sensors.get(externalId) : undefined
      if (externalId && sensor) {
        if (ev.name === 'DeviceStateChangedEvent') {
          const frame = readStates(ev.deviceStates)
          for (const [name, value] of frame) sensor.states.set(name, value)
          if (frame.has('core:LuminanceState')) emitSensor(externalId, sensor)
          const status = frame.get('core:StatusState')
          if (status === 'available' || status === 'unavailable') ctx!.setAvailable(externalId, status === 'available')
        } else if (ev.name === 'DeviceUnavailableEvent' || ev.name === 'DeviceDisabledEvent') ctx!.setAvailable(externalId, false)
        else if (ev.name === 'DeviceAvailableEvent' || ev.name === 'DeviceEnabledEvent') ctx!.setAvailable(externalId, true)
        continue
      }
      const entry = externalId ? entries.get(externalId) : undefined
      if (!externalId || !entry) continue
      switch (ev.name) {
        case 'DeviceStateChangedEvent': {
          const frame = readStates(ev.deviceStates)
          for (const [name, value] of frame) entry.states.set(name, value)
          const patch = toCoverPatch(entry.states, positions.get(externalId))
          if (Object.keys(patch).length > 0) ctx!.emitState(externalId, patch)
          if (typeof patch.position === 'number') positions.set(externalId, patch.position)
          const status = frame.get('core:StatusState')      // only if the frame mentioned it
          if (status === 'available' || status === 'unavailable') ctx!.setAvailable(externalId, status === 'available')
          break
        }
        case 'DeviceUnavailableEvent':
        case 'DeviceDisabledEvent':
          ctx!.setAvailable(externalId, false)
          break
        case 'DeviceAvailableEvent':
        case 'DeviceEnabledEvent':
          ctx!.setAvailable(externalId, true)
          break
        default: break                                  // executions, gateway, calendar: off topic
      }
    }
  }

  /** One `exec/apply` request at a time: the box drops out when they arrive together. */
  function applyInTurn(label: string, actions: OverkizAction[]): Promise<void> {
    const sent = sending.then(() => ready().apply(label, actions, ctx!.signal))
    sending = sent.catch(() => undefined)
    return sent
  }

  /**
   * Sends an action according to `TAHOMA_COMMAND_MODE`; resolves when the box has taken the
   * execution. In `batch`, a device already in the batch goes into the next batch: two actions on the
   * same device, in the same execution, have no guaranteed order.
   */
  function enqueue(action: OverkizAction, type: Command['type']): Promise<void> {
    if (config!.TAHOMA_COMMAND_MODE === 'queue') return applyInTurn(`Kasbah ${type}`, [action])
    if (batch.some((p) => p.action.deviceURL === action.deviceURL)) sendBatch()
    return new Promise((resolve, reject) => {
      batch.push({ action, type, resolve, reject })
      batchTimer ??= setTimeout(sendBatch, BATCH_WINDOW_MS)
    })
  }

  /** Sends the current batch; the outcome (taken or failed) applies to all its commands. */
  function sendBatch(): void {
    if (batchTimer) clearTimeout(batchTimer)
    batchTimer = null
    const items = batch
    batch = []
    if (!items.length) return
    const types = [...new Set(items.map((p) => p.type))]
    const label = types.length === 1 ? `Kasbah ${types[0]}` : `Kasbah ${items.length} commands`
    void applyInTurn(label, items.map((p) => p.action)).then(
      () => { for (const p of items) p.resolve() },
      (err: unknown) => { for (const p of items) p.reject(err) },
    )
  }

  /** One polling pass: (re)registering the listener then reading the events. */
  async function tick(): Promise<void> {
    const c = ready()
    try {
      if (!listenerId) {
        listenerId = await c.registerListener(ctx!.signal)
        await resync(true)                              // blind until now: we start again from a full state
      }
      const events = await c.fetchEvents(listenerId, ctx!.signal)
      if (events === null) { listenerId = null; return }
      handleEvents(events)
      if (needsResync) { needsResync = false; await resync(true) }
      // an hour also opens without a frame (at night, the luminance does not change): we write it anyway
      if (history.advance(ctx!.clock.now())) await saveHistory()
      localApiUp = true
      lastError = null
    } catch (err) {
      lastError = (err as Error).message
      throw err                                         // the poller logs and applies its backoff
    }
  }

  return {
    id: 'tahoma',
    configSchema: tahomaConfigSchema,

    async init(c) {
      ctx = c
      config = c.config as TahomaConfig                 // already validated/transformed by the host
      historyStore = deps.lightHistoryStore ?? (config.TAHOMA_LIGHT_HISTORY_FILE ? createLightHistoryFile(config.TAHOMA_LIGHT_HISTORY_FILE, c.logger) : null)
      history = new LightHistory(await historyStore?.load())
      quiet = config.TAHOMA_QUIET_FILE ? await loadQuiet(config.TAHOMA_QUIET_FILE) : new Set()
      if (!config.TAHOMA_HOST) {
        lastError = 'TAHOMA_HOST is not set'
        return
      }
      // the token comes from `.env`, there is no pairing to clear the pin: deleting its file does
      const pinFile = deps.pinFile ?? createPinFile(stateFile('tahoma-tls-pin.json'), c.logger)
      pin = new TlsPin(await pinFile.load(), (fp) => { void pinFile.save(fp) }, { device: 'TaHoma box', logger: c.logger })
      client = new TahomaClient({
        host: config.TAHOMA_HOST, port: config.TAHOMA_PORT, insecureTls: config.TAHOMA_TLS_INSECURE, pin,
        logger: c.logger, ...(config.TAHOMA_TOKEN ? { token: config.TAHOMA_TOKEN } : {}),
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.requestTimeoutMs !== undefined ? { requestTimeoutMs: deps.requestTimeoutMs } : {}),
      })
      // `/apiVersion` is the only endpoint WITHOUT a token: it only answers if the local API is
      // served, hence if developer mode is on. We probe it even without a token, to be able to tell
      // "box unreachable / developer mode off" from "box ready, token missing".
      try {
        protocolVersion = await client.getApiVersion(c.signal)
        localApiUp = true
        lastError = null
      } catch (err) {
        lastError = (err as Error).message
        c.logger.warn({ err }, 'TaHoma local API did not answer')
      }
    },

    async discover(): Promise<DeviceDescriptor[]> {
      if (!client || !config?.TAHOMA_TOKEN) return []
      try {
        await refresh()
        return descriptors
      } catch (err) {
        lastError = (err as Error).message
        throw err
      }
    },

    async start() {
      if (!client || !config?.TAHOMA_TOKEN) return
      emitAll()                                         // `discover` has just filled the entries
      // listener registered here and not at the first tick: the plugin is "ok" from startup, and
      // the tick only has one re-registration case left (the box forgot the listener).
      try { listenerId = await client.registerListener(ctx!.signal) }
      catch (err) { lastError = (err as Error).message; log().warn({ err }, 'TaHoma event listener registration failed') }
      poller = createPoller({
        name: 'tahoma-events', intervalMs: config.TAHOMA_POLL_MS, fn: tick,
        clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
      })
    },

    async execute(externalId: string, command: Command) {
      ready()
      const entry = entries.get(externalId)
      if (!entry) throw new PluginError('DEVICE_UNAVAILABLE', `unknown TaHoma device ${externalId}`)
      if (command.type === 'cover.set_quiet') {
        // nothing is sent to the box: quiet mode is an option of the following moves
        if (!entry.commands.quiet) throw new PluginError('UNSUPPORTED_COMMAND', `${command.type} on ${entry.device.controllableName ?? externalId}`)
        if (command.on) quiet.add(externalId)
        else quiet.delete(externalId)
        if (config?.TAHOMA_QUIET_FILE) await saveQuiet(config.TAHOMA_QUIET_FILE, quiet)
        ctx!.emitState(externalId, { quiet: command.on })
        return
      }
      const action = toAction(entry.device.deviceURL, command, entry.commands, quiet.has(externalId))
      if (!action) throw new PluginError('UNSUPPORTED_COMMAND', `${command.type} on ${entry.device.controllableName ?? externalId}`)
      await enqueue(action, command.type)
      if (entry.feedback) return
      // unidirectional radio: the box will never say where the cover is, we set what we asked for
      const assumed = assumedPosition(command)
      if (assumed !== undefined) {
        positions.set(externalId, assumed)
        ctx!.emitState(externalId, { position: assumed, motion: 'stopped' })
      } else if (command.type === 'cover.preset' || command.type === 'cover.stop') {
        // Two commands that leave the cover WITHOUT A KNOWN POSITION on a unidirectional radio. The
        // recall: the favorite position lives in the motor, which does not say which one it is. The
        // stop: it cuts a travel in the middle, and nobody knows where. In both cases what we were
        // showing (the end of travel inferred from the previous command) has become wrong — we CLEAR
        // it (`null`) rather than keep a stale one. That is what clearing is for.
        //
        // A stop on a cover that is already still therefore clears a correct position: accepted, it
        // is the price to pay for never ASSERTING "lowered" for a blind stopped halfway.
        positions.delete(externalId)
        ctx!.emitState(externalId, { position: null, motion: 'stopped' })
      }
    },

    async stop() {
      poller?.stop()
      poller = null
      if (batchTimer) clearTimeout(batchTimer)
      batchTimer = null
      for (const p of batch) p.reject(new PluginError('DEVICE_UNAVAILABLE', 'TaHoma plugin stopped before the command was sent'))
      batch = []
      await saveHistory()                               // the current hour is only written when it rolls over
      if (client && listenerId) {
        try { await client.unregisterListener(listenerId) }
        catch (err) { log().debug({ err }, 'TaHoma listener unregister failed') }
      }
      listenerId = null
      client?.close()
      client = null
    },

    registerRoutes(app: FastifyInstance) {
      /**
       * A sensor's light history: maximum per hour, per day and per month. Built frame after frame
       * and returned as is, never a call to the box.
       */
      app.get<{ Params: { externalId: string } }>('/light/:externalId', async (req, reply) => {
        const snap = history.snapshot(req.params.externalId, ctx?.clock.now() ?? Date.now())
        if (!snap) return reply.code(404).send({ error: `no light history for ${req.params.externalId}` })
        return snap
      })
    },

    health(): PluginHealth {
      if (!config?.TAHOMA_HOST) return { status: 'error', detail: 'set TAHOMA_HOST to the box address' }
      if (pin?.changed) return { status: 'error', detail: 'Le certificat de la box TaHoma a changé : connexion refusée. Pour accepter le nouveau, supprimer .state/tahoma-tls-pin.json puis redémarrer le serveur.' }
      if (!localApiUp) {
        return {
          status: 'error',
          detail: `no local API on ${config.TAHOMA_HOST}:${config.TAHOMA_PORT} — activate developer mode in the TaHoma app (7 taps on the gateway PIN), then resync the box${lastError ? ` [${lastError}]` : ''}`,
        }
      }
      if (!config.TAHOMA_TOKEN) {
        return { status: 'needs_pairing', detail: 'developer mode is on: generate a token in the TaHoma app and set TAHOMA_TOKEN' }
      }
      if (lastError) return { status: 'error', detail: lastError }
      if (!listenerId) return { status: 'degraded', detail: 'event listener not registered yet' }
      return { status: 'ok', detail: protocolVersion ? `${config.TAHOMA_HOST} (protocol ${protocolVersion})` : config.TAHOMA_HOST }
    },
  }
}
