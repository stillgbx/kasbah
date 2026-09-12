import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import { TahomaClient } from './client'
import {
  assumedPosition, coverCommands, deviceUrlToExternalId, hasPositionFeedback, isCover, readStates,
  toAction, toAvailability, toCoverPatch, toDescriptor, type CoverCommands,
} from './mapping'
import type { OverkizDevice, OverkizEvent } from './types'

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

export const tahomaConfigSchema = z.object({
  TAHOMA_HOST: z.string().min(1).optional(),
  TAHOMA_PORT: z.coerce.number().int().min(1).max(65535).default(8443),
  TAHOMA_TOKEN: z.string().min(1).optional(),
  TAHOMA_TLS_INSECURE: bool.default(true),
  TAHOMA_POLL_MS: z.coerce.number().int().min(500).max(60_000).default(2000),
})
export type TahomaConfig = z.infer<typeof tahomaConfigSchema>

export interface TahomaPluginDeps {
  /** Injection pour les tests (fetch simulé). */
  fetchImpl?: FetchLike
  /** Injection pour les tests : délai d'abandon d'une requête, abrégé pour ne pas ralentir la suite. */
  requestTimeoutMs?: number
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

export function createTahomaPlugin(deps: TahomaPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: TahomaConfig | null = null
  let client: TahomaClient | null = null
  let entries = new Map<string, Entry>()
  let descriptors: DeviceDescriptor[] = []
  /** Dernière position connue, pour deviner le sens du mouvement et pour les appareils sans retour. */
  const positions = new Map<string, number>()
  let listenerId: string | null = null
  let poller: { stop(): void } | null = null
  let protocolVersion: string | undefined
  /** L'API locale a répondu au moins une fois : le mode développeur est donc bien actif. */
  let localApiUp = false
  let lastError: string | null = null
  let needsResync = false

  const log = () => ctx!.logger
  const ready = (): TahomaClient => {
    if (!client || !config?.TAHOMA_TOKEN) throw new PluginError('NEEDS_PAIRING', 'TaHoma local token missing (TAHOMA_TOKEN)')
    return client
  }

  /** Relit le setup : appareils retenus, commandes disponibles, descripteurs. */
  async function refresh(): Promise<void> {
    const devices = await ready().getSetup(ctx!.signal)
    const next = new Map<string, Entry>()
    const skipped: string[] = []
    descriptors = []
    for (const device of devices) {
      if (!isCover(device)) { skipped.push(device.definition?.uiClass ?? device.controllableName ?? '?'); continue }
      const externalId = deviceUrlToExternalId(device.deviceURL)
      next.set(externalId, {
        device, commands: coverCommands(device), feedback: hasPositionFeedback(device),
        states: readStates(device.states),
      })
      descriptors.push(toDescriptor(device))
    }
    entries = next
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
      ctx!.setAvailable(externalId, toAvailability(entry.device, entry.states))
    }
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
      const c = ready()
      const entry = entries.get(externalId)
      if (!entry) throw new PluginError('DEVICE_UNAVAILABLE', `unknown TaHoma device ${externalId}`)
      const action = toAction(entry.device.deviceURL, command, entry.commands)
      if (!action) throw new PluginError('UNSUPPORTED_COMMAND', `${command.type} on ${entry.device.controllableName ?? externalId}`)
      await c.apply(`Kasbah ${command.type}`, action, ctx!.signal)
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
      if (client && listenerId) {
        try { await client.unregisterListener(listenerId) }
        catch (err) { log().debug({ err }, 'TaHoma listener unregister failed') }
      }
      listenerId = null
      client?.close()
      client = null
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
