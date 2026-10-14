import { readFile } from 'node:fs/promises'
import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { writeFileAtomic } from '../../core/atomic-file'
import { stateFile } from '../../core/paths'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import { TahomaClient } from './client'
import { LightHistory, createLightHistoryFile, type LightHistoryStore } from './history'
import {
  assumedPosition, coverCommands, deviceUrlToExternalId, hasPositionFeedback, isCover, isLightSensor, luminance,
  readStates, sameNode, toAction, toAvailability, toCoverPatch, toDescriptor, toLightSensorDescriptor, type CoverCommands,
} from './mapping'
import type { OverkizAction, OverkizDevice, OverkizEvent } from './types'

// Plugin Somfy TaHoma (plateforme Overkiz), API LOCALE du « mode développeur » : aucun appel cloud,
// un jeton local collé dans .env (TAHOMA_TOKEN). Sans jeton : mode `needs_pairing`, zéro appareil.
//
// La box mélange deux radios et le plugin les distingue par ce qu'elle DÉCLARE, pas par le préfixe
// de l'URL : io-homecontrol est bidirectionnel (position réelle, `setClosure`) alors que RTS est
// unidirectionnel (ouvrir / fermer / stop, aucun retour). Un appareil sans commande de position
// n'annonce donc pas la capacité `position` : l'UI n'affiche pas de curseur, et sa position reste
// INCONNUE jusqu'à la première commande, puis déduite d'elle (100 après « ouvrir », 0 après
// « fermer »). Rappeler la position favorite du moteur la rend inconnue à nouveau : on ne sait pas
// où elle est réglée.

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

/**
 * Une automatisation ou une scène envoie ses volets d'un bloc : 15 `exec/apply` simultanés, la box
 * en a pris 9 en 8 s et les 6 autres ont expiré sans être exécutés (relevé le 2026-10-14). Les
 * requêtes partent donc une à une (`queue`), ou bien les commandes reçues dans cette fenêtre
 * partent en UNE exécution (`batch`, 15 volets acceptés en ~200 ms le même soir). Fenêtre en temps
 * réel, pas l'horloge du contexte : elle ne mesure que l'arrivée des requêtes d'une même rafale.
 */
export const BATCH_WINDOW_MS = 50

/** Une commande en attente de la prochaine exécution groupée. */
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
   * Envoi d'une rafale de commandes. `queue` : une exécution par appareil, une requête à la fois.
   * `batch` : une seule exécution pour toute la rafale (comme un scénario TaHoma), plus rapide, mais
   * un arrêt envoyé ensuite à UN appareil pourrait annuler l'exécution entière — non vérifié.
   */
  TAHOMA_COMMAND_MODE: z.enum(['queue', 'batch']).default('queue'),
  /** Historique de luminosité des volets solaires ; vide = pas de persistance. */
  TAHOMA_LIGHT_HISTORY_FILE: z.string().trim().default(stateFile('tahoma-light-history.json')),
  /** Volets en mode discret (un réglage de Kasbah, la box ne le retient pas) ; vide = pas de persistance. */
  TAHOMA_QUIET_FILE: z.string().trim().default(stateFile('tahoma-quiet.json')),
})
export type TahomaConfig = z.infer<typeof tahomaConfigSchema>

export interface TahomaPluginDeps {
  /** Injection pour les tests (fetch simulé). */
  fetchImpl?: FetchLike
  /** Injection pour les tests : délai d'abandon d'une requête, abrégé pour ne pas ralentir la suite. */
  requestTimeoutMs?: number
  /** Injection pour les tests : historique de luminosité en mémoire. */
  lightHistoryStore?: LightHistoryStore
}

interface Entry {
  device: OverkizDevice
  commands: CoverCommands
  /** Position réelle remontée par la box (io) ou déduite des commandes (RTS). */
  feedback: boolean
  /**
   * Dernier état COMPLET connu, semé par `/setup` puis mis à jour par chaque trame. La box
   * n'envoie que des deltas, souvent une seule clé à la fois (`core:MovingState=true` arrive dans
   * sa propre trame, sans position ni cible) : sans cette accumulation, une trame prise isolément
   * ne permet jamais de dire dans quel sens l'ouvrant se déplace.
   */
  states: Map<string, unknown>
}

/** Un capteur de luminosité : le panneau d'un volet solaire. */
interface SensorEntry {
  device: OverkizDevice
  states: Map<string, unknown>
}

/** Volets en mode discret, relus au démarrage. Fichier illisible ou absent = aucun. */
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
  let entries = new Map<string, Entry>()
  let sensors = new Map<string, SensorEntry>()
  let history = new LightHistory()
  let historyStore: LightHistoryStore | null = null
  /** Volets en mode discret (`externalId`). */
  let quiet = new Set<string>()
  let descriptors: DeviceDescriptor[] = []
  /** Dernière position connue, pour deviner le sens du mouvement et pour les appareils sans retour. */
  const positions = new Map<string, number>()
  let listenerId: string | null = null
  let poller: { stop(): void } | null = null
  let protocolVersion: string | undefined
  /**
   * L'API locale a répondu au moins une fois : le mode développeur est donc bien actif. Posé par la
   * sonde de `init` ET par toute réponse réussie ensuite : sans ça, une sonde tombée pendant un
   * redémarrage de la box (connexions coupées, relevé le 2026-09-24 à 8 h) laissait « activez le
   * mode développeur » affiché pour de bon, alors que la suite fonctionnait.
   */
  let localApiUp = false
  let lastError: string | null = null
  let needsResync = false
  /** Commandes de la rafale en cours, envoyées ensemble à l'échéance de `batchTimer`. */
  let batch: Pending[] = []
  let batchTimer: ReturnType<typeof setTimeout> | null = null
  /** Dernière requête `exec/apply` partie : la suivante attend qu'elle soit finie. */
  let sending: Promise<unknown> = Promise.resolve()

  const log = () => ctx!.logger
  const ready = (): TahomaClient => {
    if (!client || !config?.TAHOMA_TOKEN) throw new PluginError('NEEDS_PAIRING', 'TaHoma local token missing (TAHOMA_TOKEN)')
    return client
  }

  /** Relit le setup : appareils retenus, commandes disponibles, descripteurs. */
  async function refresh(): Promise<void> {
    const devices = await ready().getSetup(ctx!.signal)
    const next = new Map<string, Entry>()
    const nextSensors = new Map<string, SensorEntry>()
    const skipped: string[] = []
    descriptors = []
    for (const device of devices) {
      if (isLightSensor(device)) {
        // rattaché au moteur du même nœud radio (`…#2` → `…#1`) : l'UI les montre ensemble
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

  /** Publie l'état courant de tous les appareils (et leur disponibilité). */
  function emitAll(): void {
    for (const [externalId, entry] of entries) {
      const patch = toCoverPatch(entry.states, positions.get(externalId))
      // même vide, le patch marque l'appareil disponible (`emitState` ajoute `available: true`)
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

  /** Publie la luminance d'un capteur et l'inscrit dans l'historique. */
  function emitSensor(externalId: string, entry: SensorEntry): void {
    const lux = luminance(entry.states)
    if (lux === undefined) return
    ctx!.emitState(externalId, { value: lux })
    if (history.record(externalId, lux, ctx!.clock.now())) void saveHistory()
  }

  /**
   * Une écriture à la fois : les 11 capteurs ouvrent leur heure dans la même passe, et des
   * écritures simultanées se disputent le même fichier temporaire (ENOENT au renommage, relevé).
   * Les demandes arrivées pendant une écriture sont fusionnées en UNE écriture de plus.
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
          const status = frame.get('core:StatusState')      // seulement si la trame en parlait
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
        default: break                                  // exécutions, passerelle, calendrier : hors sujet
      }
    }
  }

  /** Une requête `exec/apply` à la fois : la box décroche quand elles arrivent ensemble. */
  function applyInTurn(label: string, actions: OverkizAction[]): Promise<void> {
    const sent = sending.then(() => ready().apply(label, actions, ctx!.signal))
    sending = sent.catch(() => undefined)
    return sent
  }

  /**
   * Envoie une action selon `TAHOMA_COMMAND_MODE` ; se résout quand la box a pris l'exécution.
   * En `batch`, un appareil déjà dans le lot part dans le lot suivant : deux actions sur un même
   * appareil, dans une même exécution, n'ont pas d'ordre garanti.
   */
  function enqueue(action: OverkizAction, type: Command['type']): Promise<void> {
    if (config!.TAHOMA_COMMAND_MODE === 'queue') return applyInTurn(`Kasbah ${type}`, [action])
    if (batch.some((p) => p.action.deviceURL === action.deviceURL)) sendBatch()
    return new Promise((resolve, reject) => {
      batch.push({ action, type, resolve, reject })
      batchTimer ??= setTimeout(sendBatch, BATCH_WINDOW_MS)
    })
  }

  /** Envoie le lot en cours ; l'issue (prise ou échec) vaut pour toutes ses commandes. */
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

  /** Une passe de sondage : (ré)enregistrement de l'écouteur puis lecture des événements. */
  async function tick(): Promise<void> {
    const c = ready()
    try {
      if (!listenerId) {
        listenerId = await c.registerListener(ctx!.signal)
        await resync(true)                              // aveugle jusqu'ici : on repart d'un état complet
      }
      const events = await c.fetchEvents(listenerId, ctx!.signal)
      if (events === null) { listenerId = null; return }
      handleEvents(events)
      if (needsResync) { needsResync = false; await resync(true) }
      // une heure s'ouvre aussi sans trame (la nuit, la luminance ne change pas) : on l'écrit quand même
      if (history.advance(ctx!.clock.now())) await saveHistory()
      localApiUp = true
      lastError = null
    } catch (err) {
      lastError = (err as Error).message
      throw err                                         // le poller journalise et applique son backoff
    }
  }

  return {
    id: 'tahoma',
    configSchema: tahomaConfigSchema,

    async init(c) {
      ctx = c
      config = c.config as TahomaConfig                 // déjà validé/transformé par l'hôte
      historyStore = deps.lightHistoryStore ?? (config.TAHOMA_LIGHT_HISTORY_FILE ? createLightHistoryFile(config.TAHOMA_LIGHT_HISTORY_FILE, c.logger) : null)
      history = new LightHistory(await historyStore?.load())
      quiet = config.TAHOMA_QUIET_FILE ? await loadQuiet(config.TAHOMA_QUIET_FILE) : new Set()
      if (!config.TAHOMA_HOST) {
        lastError = 'TAHOMA_HOST is not set'
        return
      }
      client = new TahomaClient({
        host: config.TAHOMA_HOST, port: config.TAHOMA_PORT, insecureTls: config.TAHOMA_TLS_INSECURE,
        logger: c.logger, ...(config.TAHOMA_TOKEN ? { token: config.TAHOMA_TOKEN } : {}),
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.requestTimeoutMs !== undefined ? { requestTimeoutMs: deps.requestTimeoutMs } : {}),
      })
      // `/apiVersion` est le seul endpoint SANS jeton : il répond uniquement si l'API locale est
      // servie, donc si le mode développeur est actif. On le sonde même sans jeton, pour pouvoir
      // distinguer « box injoignable / mode développeur éteint » de « box prête, jeton manquant ».
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
      emitAll()                                         // `discover` vient de remplir les entrées
      // écouteur enregistré ici et pas au premier tick : le plugin est « ok » dès le démarrage,
      // et le tick n'a plus qu'un cas de réenregistrement (la box a oublié l'écouteur).
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
        // rien n'est envoyé à la box : le mode discret est une option des manœuvres suivantes
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
      // radio unidirectionnelle : la box ne dira jamais où en est l'ouvrant, on pose ce qu'on a demandé
      const assumed = assumedPosition(command)
      if (assumed !== undefined) {
        positions.set(externalId, assumed)
        ctx!.emitState(externalId, { position: assumed, motion: 'stopped' })
      } else if (command.type === 'cover.preset' || command.type === 'cover.stop') {
        // Deux commandes qui laissent l'ouvrant SANS POSITION CONNUE sur une radio unidirectionnelle.
        // Le rappel : la position favorite vit dans le moteur, qui ne dit pas laquelle c'est. L'arrêt :
        // il coupe une course au milieu, et personne ne sait où. Dans les deux cas ce qu'on affichait
        // (la fin de course déduite de la commande précédente) est devenu faux — on l'EFFACE (`null`)
        // plutôt que d'en garder une périmée. C'est à ça que sert l'effacement.
        //
        // Un arrêt sur un ouvrant déjà immobile efface donc une position juste : assumé, c'est le
        // prix à payer pour ne jamais AFFIRMER « baissé » d'un store arrêté à mi-course.
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
      await saveHistory()                               // l'heure en cours n'est écrite qu'à sa bascule
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
       * Historique de luminosité d'un capteur : maximum par heure, par jour et par mois. Construit
       * au fil des trames et rendu tel quel, jamais un appel à la box.
       */
      app.get<{ Params: { externalId: string } }>('/light/:externalId', async (req, reply) => {
        const snap = history.snapshot(req.params.externalId, ctx?.clock.now() ?? Date.now())
        if (!snap) return reply.code(404).send({ error: `no light history for ${req.params.externalId}` })
        return snap
      })
    },

    health(): PluginHealth {
      if (!config?.TAHOMA_HOST) return { status: 'error', detail: 'set TAHOMA_HOST to the box address' }
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
