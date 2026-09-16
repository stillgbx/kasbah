import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { createPoller } from '../../core/poll'
import { sendError } from '../../http/errors'
import { modelOf, parseRead, readRequest, toDescriptor, toStatePatch, STATION_ID } from './mapping'
import { netSocketFactory, readOnce, type SocketFactory } from './socket'

// Plugin COMAP Proteo 2 : station de filtration d'eau lue en JSON clair sur TCP/23, sans
// authentification, LAN pur (192.168.1.92 par défaut). UN SEUL appareil `water` publié — la station
// reste un objet unique, pas un capteur par consommable. Lecture seule : le protocole sait écrire
// (réglages de la lampe UVc), mais une fausse manœuvre à distance sur l'eau potable coûterait plus
// cher que le confort gagné ; ce plugin n'envoie jamais de trame `write`.
//
// La station n'accepte qu'UNE connexion TCP à la fois (vérifiée le 2026-09-16 : une lecture faite
// pendant que l'appli mobile du fabricant tenait la connexion est restée sans réponse, la connexion
// ayant pourtant été acceptée). Deux conséquences :
//  - chaque sondage ouvre une connexion COURTE, lit, referme (`socket.ts`) — jamais de connexion
//    permanente, qui monopoliserait la station et casserait l'appli du propriétaire ;
//  - une lecture muette est un événement NORMAL (quelqu'un d'autre parle à la station), pas une
//    panne : l'appareil ne passe indisponible qu'après plusieurs échecs DE SUITE
//    (`AVAILABILITY_FAILURE_THRESHOLD`), jamais sur un seul silence.

export const comapConfigSchema = z.object({
  COMAP_HOST: z.string().trim().min(1).default('192.168.1.92'),
  COMAP_PORT: z.coerce.number().int().min(1).max(65535).default(23),
  /**
   * Cadence de sondage. La station est sur le LAN, sans quota ni cloud, mais rien ne justifie de la
   * marteler : l'usure des consommables et les compteurs de consommation évoluent lentement, et un
   * sondage plus rapproché augmenterait surtout le risque de tomber pendant une session de l'appli
   * du fabricant (une seule connexion TCP à la fois). Trente secondes suit le débit instantané d'assez
   * près pour l'affichage sans jamais serrer la station.
   */
  COMAP_POLL_MS: z.coerce.number().int().min(5_000).max(600_000).default(30_000),
  /** La station accepte la connexion même quand elle est déjà occupée, et ne répond alors jamais. */
  COMAP_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
})
export type ComapConfig = z.infer<typeof comapConfigSchema>

export interface ComapPluginDeps {
  /** Injectée par les tests : fabrique de socket TCP (voir `socket.ts`). */
  connect?: SocketFactory
}

/**
 * Échecs de lecture consécutifs tolérés avant de déclarer la station indisponible. Trois sondages
 * ratés de suite, à la cadence par défaut, couvrent 90 s de silence — largement plus que la session
 * de l'appli du fabricant observée (23:09:34-23:10:24, 50 s) — avant de conclure à une vraie panne
 * plutôt qu'à une connexion occupée ailleurs.
 */
const AVAILABILITY_FAILURE_THRESHOLD = 3

export function createComapPlugin(deps: ComapPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: ComapConfig | null = null
  let connect: SocketFactory = netSocketFactory
  let model: string | undefined
  let msgId = 0
  let failures = 0
  let lastError: string | null = null
  let poller: { stop(): void } | null = null

  async function read(): Promise<unknown> {
    msgId += 1
    return readOnce({
      host: config!.COMAP_HOST, port: config!.COMAP_PORT, request: readRequest(msgId),
      connect, clock: ctx!.clock, signal: ctx!.signal, timeoutMs: config!.COMAP_TIMEOUT_MS,
    })
  }

  async function pollOnce(): Promise<void> {
    const raw = await read()
    const parsed = parseRead(raw)
    if (!parsed) throw new Error('unexpected COMAP response shape')
    ctx!.emitState(STATION_ID, toStatePatch(parsed))                 // `available: true` implicite
    const next = modelOf(parsed)
    if (next && next !== model) { model = next; ctx!.emitDevices([toDescriptor(model)]) }
  }

  return {
    id: 'comap',
    configSchema: comapConfigSchema,

    async init(context) {
      ctx = context
      config = context.config as ComapConfig
      connect = deps.connect ?? netSocketFactory
      // Un plugin est une fermeture qui SURVIT à `stop()` : tout ce qui décide « déjà publié » ou
      // « en panne » se remet à zéro ici, pas seulement à la déclaration du module.
      model = undefined
      msgId = 0
      failures = 0
      lastError = null
    },

    /** Aucun appel réseau ici : l'appareil se déclare avec ses capacités, la première lecture du poller le remplit. */
    async discover(): Promise<DeviceDescriptor[]> {
      return [toDescriptor(model)]
    },

    async start() {
      poller = createPoller({
        name: 'comap', intervalMs: config!.COMAP_POLL_MS, clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
        fn: async () => {
          try {
            await pollOnce()
            failures = 0
            lastError = null
          } catch (err) {
            failures += 1
            lastError = (err as Error).message
            if (failures >= AVAILABILITY_FAILURE_THRESHOLD) ctx!.setAvailable(STATION_ID, false)
            throw err
          }
        },
      })
    },

    async execute(_externalId: string, command: Command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `COMAP station is read-only (${command.type})`)
    },

    async stop() {
      poller?.stop()
      poller = null
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      /** Relevé brut, pour capturer une fixture depuis une vraie réponse plutôt que la notice. */
      app.get('/raw', async (_req, reply) => {
        if (!ctx) return sendError(reply, 409, 'DEVICE_UNAVAILABLE', 'plugin not started')
        try { return await read() }
        catch (err) { return sendError(reply, 502, 'UPSTREAM_ERROR', (err as Error).message) }
      })
    },

    health(): PluginHealth {
      if (!ctx) return { status: 'error', detail: 'plugin not started' }
      if (failures >= AVAILABILITY_FAILURE_THRESHOLD) {
        return { status: 'degraded', detail: lastError ?? 'station silent', deviceCount: 1 }
      }
      return { status: 'ok', detail: model ? `Proteo (${model})` : 'Proteo', deviceCount: 1 }
    },
  }
}
