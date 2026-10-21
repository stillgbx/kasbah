import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import { sleep } from '../../core/clock'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import { HormannClient } from './client'
import {
  doorExternalId,
  doorIdOf,
  effectReached,
  isBusAlive,
  lightExternalId,
  PLUGIN_ID,
  toDescriptors,
  toDoorPatch,
  toLightPatch,
  toRequest,
} from './mapping'
import { parseHormannDoors, type HormannDoorConfig, type HormannStatus } from './types'

// Hörmann plugin — SupraMatic series 4 garage doors through an HCPBridgeMqtt bridge (ESP32 +
// RS485 on the motor's HCP2 bus), local HTTP, no cloud, no MQTT broker.
//
// The state is POLLED on `/status`: the bridge's `/events` stream only carries its optional
// sensors and digital I/O, never the door (firmware v1.0.2, `events.send` calls).

export const hormannConfigSchema = z.object({
  /** JSON array of doors `{ id, host, password, name }`, one bridge per door. */
  HORMANN_DOORS: z.string().default('').transform((s, ctx) => {
    try {
      return parseHormannDoors(s)
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: (err as Error).message })
      return z.NEVER
    }
  }),
  /** `/status` reading interval per door (ms). A door moves in 15-20 s: 2 s shows it moving. */
  HORMANN_POLL_MS: z.coerce.number().int().min(500).max(60_000).default(2_000),
  /**
   * Time for the door to start doing what was asked (ms), read every `EFFECT_POLL_MS`. Must leave
   * room for the command request itself under KASBAH_COMMAND_TIMEOUT_MS (10 s by default).
   */
  HORMANN_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
})
export type HormannConfig = z.infer<typeof hormannConfigSchema>

/** Reading cadence while waiting for the effect of a command. */
const EFFECT_POLL_MS = 500

export interface HormannPluginDeps {
  fetchImpl?: FetchLike
  requestTimeoutMs?: number
}

export function createHormannPlugin(deps: HormannPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: HormannConfig | null = null
  let doors: HormannDoorConfig[] = []
  const clients = new Map<string, HormannClient>()
  const pollers: { stop(): void }[] = []
  const lastStatus = new Map<string, HormannStatus>()
  /** Doors whose bridge answers AND whose bus is alive. */
  const alive = new Set<string>()
  const lastError = new Map<string, PluginError | Error>()

  function setDoorAvailable(doorId: string, available: boolean): void {
    if (available) alive.add(doorId)
    else alive.delete(doorId)
    ctx!.setAvailable(doorExternalId(doorId), available)
    ctx!.setAvailable(lightExternalId(doorId), available)
  }

  /** Publishes one reading; a bridge that answers with a dead bus makes the door unavailable. */
  function publish(doorId: string, status: HormannStatus): void {
    lastStatus.set(doorId, status)
    if (!isBusAlive(status)) {
      lastError.set(doorId, new Error(`bus silent for ${status.busResponseAge ?? '?'} s (run a bus scan on the motor)`))
      setDoorAvailable(doorId, false)
      return
    }
    lastError.delete(doorId)
    alive.add(doorId)
    ctx!.emitState(doorExternalId(doorId), toDoorPatch(status))
    ctx!.emitState(lightExternalId(doorId), toLightPatch(status))
  }

  async function read(doorId: string, signal?: AbortSignal): Promise<HormannStatus> {
    try {
      const status = await clients.get(doorId)!.status(signal ?? ctx!.signal)
      publish(doorId, status)
      return status
    } catch (err) {
      lastError.set(doorId, err as Error)
      setDoorAvailable(doorId, false)
      throw err
    }
  }

  function stopPollers(): void {
    for (const p of pollers.splice(0)) p.stop()
  }

  return {
    id: PLUGIN_ID,
    configSchema: hormannConfigSchema as unknown as DevicePlugin['configSchema'],

    async init(c: PluginContext): Promise<void> {
      ctx = c
      config = c.config as HormannConfig
      // Closure that survives stop(): reset everything (Automower lesson).
      stopPollers()
      clients.clear()
      lastStatus.clear()
      alive.clear()
      lastError.clear()
      doors = config.HORMANN_DOORS
      for (const d of doors) {
        clients.set(d.id, new HormannClient({
          host: d.host,
          password: d.password,
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          ...(deps.requestTimeoutMs ? { requestTimeoutMs: deps.requestTimeoutMs } : {}),
        }))
      }
      if (!doors.length) ctx.logger.info('HORMANN_DOORS empty: no Hörmann door configured')
    },

    async discover(): Promise<DeviceDescriptor[]> {
      // No network call: the devices are born unavailable and the first reading fills them.
      return doors.flatMap(toDescriptors)
    },

    async start(): Promise<void> {
      for (const d of doors) {
        pollers.push(createPoller({
          name: `hormann:${d.id}`,
          intervalMs: config!.HORMANN_POLL_MS,
          fn: async () => { await read(d.id) },
          clock: ctx!.clock,
          signal: ctx!.signal,
          logger: ctx!.logger,
        }))
      }
    },

    async execute(externalId: string, command: Command): Promise<void> {
      const doorId = doorIdOf(externalId)
      const client = doorId ? clients.get(doorId) : undefined
      if (!doorId || !client) throw new PluginError('UNSUPPORTED_COMMAND', `unknown hormann id ${externalId}`)
      if (!alive.has(doorId)) throw new PluginError('DEVICE_UNAVAILABLE', `hormann door ${doorId} is not reachable`)

      const request = toRequest(externalId, command, lastStatus.get(doorId))
      if (!request) return
      await client.command(request.action, request.params, ctx!.signal)

      // The firmware answers "OK" to everything, including a command it drops: wait for the effect.
      const deadline = ctx!.clock.now() + config!.HORMANN_COMMAND_TIMEOUT_MS
      for (;;) {
        await sleep(ctx!.clock, EFFECT_POLL_MS, ctx!.signal)
        if (ctx!.signal.aborted) return
        const status = await read(doorId)
        if (effectReached(externalId, command, status)) return
        if (ctx!.clock.now() >= deadline) {
          throw new PluginError('UPSTREAM_ERROR', `hormann door ${doorId} did not react to ${command.type}`)
        }
      }
    },

    async stop(): Promise<void> {
      stopPollers()
    },

    registerRoutes(app: FastifyInstance) {
      // Last raw reading of each bridge: the capture for fixtures. Never the password.
      app.get('/raw', async (_req, reply) => {
        if (!doors.length) {
          return reply.code(409).send({ error: { code: 'NEEDS_PAIRING', message: 'HORMANN_DOORS is empty' } })
        }
        return {
          doors: doors.map((d) => ({
            id: d.id,
            host: d.host,
            alive: alive.has(d.id),
            status: lastStatus.get(d.id) ?? null,
          })),
        }
      })
    },

    health(): PluginHealth {
      if (!doors.length) return { status: 'needs_pairing', detail: 'set HORMANN_DOORS in the server environment' }
      const refused = doors.find((d) => (lastError.get(d.id) as PluginError | undefined)?.code === 'NEEDS_PAIRING')
      if (refused) return { status: 'needs_pairing', detail: `door ${refused.id}: the bridge refused the password` }
      const down = doors.filter((d) => !alive.has(d.id))
      if (!down.length) return { status: 'ok' }
      const first = down[0]!
      const why = lastError.get(first.id)?.message ?? 'no reading yet'
      return { status: 'degraded', detail: `${doors.length - down.length}/${doors.length} doors reachable; ${first.id}: ${why}` }
    },
  }
}
