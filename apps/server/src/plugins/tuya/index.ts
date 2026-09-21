import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Command, DeviceDescriptor, PluginHealth, StatePatch } from '@kasbah/shared'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import {
  createTuyapiFactory,
  DeviceSession,
  type TuyaSocketFactory,
} from './client'
import {
  dpsMatchExpected,
  fanCommandToDps,
  fanExternalId,
  isFanExternalId,
  isLightExternalId,
  lightCommandToDps,
  lightExternalId,
  physicalIdOf,
  PLUGIN_ID,
  toDescriptors,
  toFanPatch,
  toLightPatch,
} from './mapping'
import { parseTuyaDevices, type TuyaDeviceConfig, type TuyaDps } from './types'

// Plugin Tuya — protocole local 3.5 (tuyapi), pas de cloud après la clé.
//
// Un appareil physique (ventilateur-lumière CREATE) produit DEUX descripteurs : `light` et `fan`,
// liés par `meta.linkedTo` du fan vers la lumière. Découverte = configuration uniquement
// (broadcast UDP filtré par l'AP Synology — mesuré, inutilisable).
//
// Pièges tenus ici : jamais sonder un DP, attendre l'état republé pas l'accusé, reconnexion
// obligatoire, écrire speed allume le ventilateur (patch optimiste côté UI).

export const tuyaConfigSchema = z.object({
  /**
   * Tableau JSON d'appareils `{ id, key, ip, name, version? }`. Id + clé + IP sont
   * indissociables ; la clé (16 car., caractères spéciaux) ne doit jamais passer en CLI ni en log.
   */
  TUYA_DEVICES: z.string().default('').transform((s, ctx) => {
    try {
      return parseTuyaDevices(s)
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: (err as Error).message })
      return z.NEVER
    }
  }),
  /** Délai d'attente de l'effet après écriture (ms). Plafonné aussi par KASBAH_COMMAND_TIMEOUT_MS. */
  TUYA_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
  /** Intervalle de reconnexion (ms). Mesuré nécessaire : la socket tombe sans prévenir. */
  TUYA_RECONNECT_MS: z.coerce.number().int().min(100).max(30_000).default(700),
})
export type TuyaConfig = z.infer<typeof tuyaConfigSchema>

export interface TuyaPluginDeps {
  createSocket?: TuyaSocketFactory
  /** Délai d'attente d'effet injectable (tests). */
  commandTimeoutMs?: number
}

export function createTuyaPlugin(deps: TuyaPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: TuyaConfig | null = null
  let devices: TuyaDeviceConfig[] = []
  const sessions = new Map<string, DeviceSession>()
  /** DP accumulés par appareil physique. */
  const rawByPhysical = new Map<string, TuyaDps>()
  const connected = new Set<string>()
  let lastError: string | null = null

  const createSocket = deps.createSocket ?? createTuyapiFactory()

  function log() {
    return ctx!.logger
  }

  function publishFromDps(physicalId: string, fragment: TuyaDps): void {
    const prev = rawByPhysical.get(physicalId) ?? {}
    const merged = { ...prev, ...fragment }
    rawByPhysical.set(physicalId, merged)

    const lightPatch = toLightPatch(fragment)
    const fanPatch = toFanPatch(fragment)
    if (Object.keys(lightPatch).length) ctx!.emitState(lightExternalId(physicalId), lightPatch as StatePatch)
    if (Object.keys(fanPatch).length) ctx!.emitState(fanExternalId(physicalId), fanPatch as StatePatch)
  }

  function setPhysicalAvailable(physicalId: string, available: boolean): void {
    if (available) connected.add(physicalId)
    else connected.delete(physicalId)
    ctx!.setAvailable(lightExternalId(physicalId), available)
    ctx!.setAvailable(fanExternalId(physicalId), available)
  }

  function openSessions(): void {
    for (const d of devices) {
      if (sessions.has(d.id)) continue
      const session = new DeviceSession({
        id: d.id,
        key: d.key,
        ip: d.ip,
        version: d.version,
        createSocket,
        clock: ctx!.clock,
        signal: ctx!.signal,
        reconnectMs: config!.TUYA_RECONNECT_MS,
        logger: log(),
        onDps: (fragment) => publishFromDps(d.id, fragment),
        onConnectionChange: (up) => setPhysicalAvailable(d.id, up),
      })
      sessions.set(d.id, session)
      session.start()
    }
  }

  async function closeSessions(): Promise<void> {
    const all = [...sessions.values()]
    sessions.clear()
    connected.clear()
    await Promise.all(all.map((s) => s.stop()))
  }

  async function applyWrites(
    physicalId: string,
    writes: { dps: number; set: unknown }[],
  ): Promise<void> {
    if (!writes.length) return
    const session = sessions.get(physicalId)
    if (!session) throw new PluginError('DEVICE_UNAVAILABLE', `tuya ${physicalId} has no session`)

    const timeoutMs = deps.commandTimeoutMs ?? config!.TUYA_COMMAND_TIMEOUT_MS
    const writeSignal = AbortSignal.any([ctx!.signal, AbortSignal.timeout(timeoutMs)])

    for (const w of writes) {
      await session.write(w.dps, w.set, writeSignal)
    }

    // Attendre l'effet publié, pas l'accusé (piège 2). Passé le plafond → on résout quand même.
    if (dpsMatchExpected(session.snapshot(), writes)) return
    const waitSignal = AbortSignal.any([ctx!.signal, AbortSignal.timeout(timeoutMs)])
    await session.waitForDps(writes, waitSignal)
  }

  return {
    id: PLUGIN_ID,
    configSchema: tuyaConfigSchema as unknown as DevicePlugin['configSchema'],

    async init(c: PluginContext): Promise<void> {
      ctx = c
      config = c.config as TuyaConfig
      // Fermeture qui survit à stop() : tout remettre à zéro (leçon iRobot / Tahoma).
      await closeSessions()
      rawByPhysical.clear()
      lastError = null
      devices = config.TUYA_DEVICES
      if (!devices.length) {
        log().info('TUYA_DEVICES empty: no Tuya device configured')
      }
    },

    async discover(): Promise<DeviceDescriptor[]> {
      // Aucun appel réseau — les plugins démarrent en série.
      return devices.flatMap(toDescriptors)
    },

    async start(): Promise<void> {
      if (!devices.length) return
      openSessions()
    },

    async execute(externalId: string, command: Command): Promise<void> {
      const physicalId = physicalIdOf(externalId)
      if (!physicalId) throw new PluginError('UNSUPPORTED_COMMAND', `unknown tuya id ${externalId}`)
      if (!connected.has(physicalId) && !sessions.has(physicalId)) {
        throw new PluginError('DEVICE_UNAVAILABLE', `tuya ${physicalId} is not configured`)
      }
      if (!connected.has(physicalId)) {
        throw new PluginError('DEVICE_UNAVAILABLE', `tuya ${physicalId} is not connected`)
      }

      if (isLightExternalId(externalId)) {
        if (command.type !== 'light.set') {
          throw new PluginError('UNSUPPORTED_COMMAND', `tuya light cannot do ${command.type}`)
        }
        await applyWrites(physicalId, lightCommandToDps(command))
        return
      }
      if (isFanExternalId(externalId)) {
        if (command.type !== 'fan.set') {
          throw new PluginError('UNSUPPORTED_COMMAND', `tuya fan cannot do ${command.type}`)
        }
        await applyWrites(physicalId, fanCommandToDps(command))
        return
      }
      throw new PluginError('UNSUPPORTED_COMMAND', `unknown tuya id ${externalId}`)
    },

    async stop(): Promise<void> {
      await closeSessions()
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/raw', async (_req, reply) => {
        if (!devices.length) {
          return reply.code(409).send({ error: { code: 'NEEDS_PAIRING', message: 'TUYA_DEVICES is empty' } })
        }
        return {
          devices: devices.map((d) => ({
            id: d.id,
            name: d.name,
            ip: d.ip,
            connected: connected.has(d.id),
            dps: rawByPhysical.get(d.id) ?? null,
          })),
        }
      })
    },

    health(): PluginHealth {
      if (!devices.length) {
        return { status: 'needs_pairing', detail: 'set TUYA_DEVICES in the server environment' }
      }
      const up = connected.size
      if (up === 0) {
        return {
          status: 'degraded',
          detail: lastError ?? `no Tuya device connected (${devices.length} configured)`,
        }
      }
      if (up < devices.length) {
        return { status: 'degraded', detail: `${up}/${devices.length} Tuya devices connected` }
      }
      return { status: 'ok' }
    },
  }
}
