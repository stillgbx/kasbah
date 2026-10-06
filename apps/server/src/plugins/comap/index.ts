import type { Command, ConsumptionPoint, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginConsumption, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { createPoller } from '../../core/poll'
import { sendError } from '../../http/errors'
import { applyReading, monthlyOf, readingAt, type ComapHistoryCursor } from './history'
import { modelOf, parseRead, readRequest, toDescriptor, toStatePatch, STATION_ID } from './mapping'
import { netSocketFactory, readOnce, type SocketFactory } from './socket'
import { createHistoryFile, EMPTY_HISTORY, type ComapHistoryState, type HistoryStore } from './state'


// Plugin COMAP Proteo 2 : station de filtration d'eau lue en JSON clair sur TCP/23, sans
// authentification, LAN pur, adresse fixe dans `COMAP_HOST` (aucun défaut). UN SEUL appareil
// `water` publié — la station reste un objet unique, pas un capteur par consommable. Lecture
// seule : le protocole sait écrire (réglages de la lampe UVc), mais une fausse manœuvre à distance
// sur l'eau potable coûterait plus cher que le confort gagné ; ce plugin n'envoie jamais de trame
// `write`.
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
  /**
   * Adresse de la station. Pas de défaut : la station ne se découvre pas, et une adresse d'exemple
   * ferait sonder une machine au hasard. Absente, le plugin ne déclare rien et le dit dans sa santé
   * (comme `TAHOMA_HOST`), au lieu de bloquer la configuration de tous les plugins au démarrage.
   */
  COMAP_HOST: z.string().trim().min(1).optional(),
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
  /** Où garder l'historique de consommation déjà calculé (voir `history.ts`). Chaîne vide = ne rien garder. */
  COMAP_HISTORY_FILE: z.string().trim().default(stateFile('comap-consumption.json')),
})
export type ComapConfig = z.infer<typeof comapConfigSchema>

export interface ComapPluginDeps {
  /** Injectée par les tests : fabrique de socket TCP (voir `socket.ts`). */
  connect?: SocketFactory
  /** Injecté par les tests : fichier de l'historique de consommation (voir `state.ts`). */
  historyStore?: HistoryStore
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
  let historyStore: HistoryStore | null = null
  /** Historique déjà calculé : SURVIT au redémarrage (relu du fichier dans `init`). */
  let history: ComapHistoryState = EMPTY_HISTORY
  /**
   * Ce qu'il faut pour dater et chiffrer le PROCHAIN delta. Contrairement à `history`, ne survit PAS
   * au redémarrage : un sondage qui suit un redémarrage n'a pas de précédent (voir `history.ts`).
   */
  let cursor: ComapHistoryCursor | undefined
  /** Mensuel : jamais persisté, dérivé de la dernière lecture réussie (`year` + `month`). */
  let monthly: ConsumptionPoint[] = []

  async function read(): Promise<unknown> {
    const host = config!.COMAP_HOST
    if (!host) throw new Error('COMAP_HOST is not set')
    msgId += 1
    return readOnce({
      host, port: config!.COMAP_PORT, request: readRequest(msgId),
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
    // `day`/`rtc` datent et chiffrent l'historique ; sans l'un des deux, rien à en tirer cette fois.
    if (parsed.consumption?.day !== undefined && parsed.rtc) {
      const applied = applyReading(history, cursor, { day: parsed.consumption.day, at: readingAt(parsed.rtc) })
      history = applied.state
      cursor = applied.cursor
      void historyStore?.save(history)
      if (parsed.consumption.month !== undefined && parsed.consumption.year) {
        monthly = monthlyOf(parsed.rtc, parsed.consumption.month, parsed.consumption.year)
      }
    }
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
      // `history`, lui, ne se remet PAS à zéro ici : c'est justement ce qui doit survivre au
      // redémarrage (voir `state.ts`). Seul `cursor` (le précédent du prochain delta) repart de rien.
      cursor = undefined
      monthly = []
      historyStore = deps.historyStore ?? (config.COMAP_HISTORY_FILE ? createHistoryFile(config.COMAP_HISTORY_FILE, context.logger) : null)
      history = await historyStore?.load() ?? EMPTY_HISTORY
    },

    /** Aucun appel réseau ici : l'appareil se déclare avec ses capacités, la première lecture du poller le remplit. */
    async discover(): Promise<DeviceDescriptor[]> {
      if (!config?.COMAP_HOST) return []
      return [toDescriptor(model)]
    },

    async start() {
      if (!config?.COMAP_HOST) return
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

    /** L'historique tenu au fil des sondages (`history.ts`) : jamais un nouveau relevé à la demande. */
    async consumption(externalId: string): Promise<PluginConsumption> {
      if (externalId !== STATION_ID) throw new PluginError('DEVICE_UNAVAILABLE', `unknown water device "${externalId}"`)
      return { hourly: history.hourly, daily: history.daily, monthly }
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
        if (!config?.COMAP_HOST) return sendError(reply, 409, 'DEVICE_UNAVAILABLE', 'COMAP_HOST is not set')
        try { return await read() }
        catch (err) { return sendError(reply, 502, 'UPSTREAM_ERROR', (err as Error).message) }
      })
    },

    health(): PluginHealth {
      if (!ctx) return { status: 'error', detail: 'plugin not started' }
      if (!config?.COMAP_HOST) return { status: 'error', detail: 'set COMAP_HOST to the station address' }
      if (failures >= AVAILABILITY_FAILURE_THRESHOLD) {
        return { status: 'degraded', detail: lastError ?? 'station silent', deviceCount: 1 }
      }
      return { status: 'ok', detail: model ? `Proteo (${model})` : 'Proteo', deviceCount: 1 }
    },
  }
}
