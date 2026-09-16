import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Command, DeviceDescriptor, JournalEntry, PluginHealth, StatePatch } from '@kasbah/shared'
import { createBackoff } from '../../core/backoff'
import { PluginError, type DevicePlugin, type PluginContext, type PluginJournal } from '../../core/plugin'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import { AutomowerAuth } from './auth'
import { AutomowerClient } from './client'
import { actionBody, applyEvent, connectedOf, isTimeZone, parseMowers, toDescriptor, toJournal, toJournalEntry, toStatePatch } from './mapping'
import { WINDOW_MS, WINDOW_REQUESTS, createUsageFile, currentUsage, type AutomowerUsage, type UsageStore } from './state'
import { AutomowerSocket, type WsFactory } from './ws'
import { mowerListSchema, wsEventSchema, wsReadySchema, type MowerData } from './types'

// Plugin Husqvarna Automower — Automower Connect API (cloud du fabricant, rien en local).
//
// Ce que le fabricant impose, et ce que le plugin en fait :
//
//  1. Une APPLICATION sur developer.husqvarnagroup.cloud, reliée aux deux API « Authentication » et
//     « Automower Connect » : sa clé et son secret suffisent (`client_credentials`), le jeton
//     représente le compte qui l'a créée — donc le propriétaire du robot. Pas de consentement dans un
//     navigateur, pas de jeton à garder : il se redemande, et vaut une journée.
//  2. Un QUOTA de 21 000 requêtes par fenêtre de sept jours et par clé (portail développeur, relevé
//     du 2026-09-16 ; la documentation tierce disait 10 000 par mois), et une par seconde. D'où le
//     WebSocket : le fabricant y pousse batterie, activité, planning, position et hauteur de coupe
//     dès qu'ils changent, gratuitement ; le REST ne sert qu'à lire l'état complet au démarrage, à
//     chaque reconnexion du flux, puis à cadence lente pour resynchroniser (`AUTOMOWER_POLL_MS`).
//     Le compteur de la fenêtre survit au redémarrage (`state.ts`) et se lit dans la jauge de la vue.
//  3. Des HORODATAGES en heure locale écrite comme si c'était de l'UTC (prochain départ, erreur) :
//     le fuseau de la maison les ramène à de vrais instants (`mapping.ts`).
//
// Le robot publie sa POSITION en GPS ; c'est la scène 3D qui la projette sur le terrain, comme pour
// un véhicule. Le plugin ne connaît pas le repère de la maison et n'a pas à le connaître.
//
// ÉTAT DE CE FICHIER : phase 1, vérifiée sur le vrai compte le 2026-09-16 (liste lue, flux ouvert,
// fixtures remplacées par la capture de `GET /api/plugins/automower/raw`). Les événements du flux, eux,
// restent à capturer.

const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')

export const automowerConfigSchema = z.object({
  /** Clé (« Application key ») et secret de l'application, developer.husqvarnagroup.cloud. */
  AUTOMOWER_APP_KEY: optionalKey,
  AUTOMOWER_APP_SECRET: optionalKey,
  /**
   * Cadence de la relecture complète. Le flux d'événements porte le vivant ; cette lecture ne sert
   * qu'à rattraper ce qu'il aurait manqué. 10 min = 4 320 requêtes par mois, sous la moitié du quota.
   */
  AUTOMOWER_POLL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(600_000),
  /** Fuseau des horodatages « locaux » du robot. Défaut : celui du serveur. */
  AUTOMOWER_TIMEZONE: optionalKey.refine((tz) => tz === undefined || isTimeZone(tz), 'AUTOMOWER_TIMEZONE: fuseau IANA inconnu'),
  /** Où garder le compte de requêtes de la fenêtre. Chaîne vide = ne rien garder. */
  AUTOMOWER_USAGE_FILE: z.string().trim().default(resolve(REPO_ROOT, 'apps/server/.state/automower-usage.json')),
  /**
   * Un instant de remise à zéro du quota tel que le portail développeur l'affiche (« Resets at … »),
   * en ISO 8601 : cale la fenêtre de sept jours exactement. Absent = la première requête fait foi.
   */
  AUTOMOWER_QUOTA_RESET_AT: optionalKey.refine((v) => v === undefined || Number.isFinite(Date.parse(v)), 'AUTOMOWER_QUOTA_RESET_AT: date ISO 8601 attendue'),
})
export type AutomowerConfig = z.infer<typeof automowerConfigSchema>

/** Ce que la carte des Réglages et les tests lisent. Jamais la clé ni le secret. */
export interface AutomowerStatus {
  configured: boolean
  mowers: { id: string; name: string; model: string | null; connected: boolean }[]
  live: boolean
  pollMs: number
  timezone: string
  /** Requêtes à l'API depuis le début de la fenêtre de sept jours, et quand elle se remet à zéro. */
  requestsInWindow: number
  windowLimit: number
  windowResetAt: number
  lastError: string | null
}

export interface AutomowerPluginDeps {
  fetchImpl?: FetchLike
  wsFactory?: WsFactory
  usageStore?: UsageStore
}

/** Entre deux relectures forcées par le flux (reconnexion, robot inconnu), au moins ceci. */
const RESYNC_MIN_MS = 60_000

export function createAutomowerPlugin(deps: AutomowerPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: AutomowerConfig | null = null
  let auth: AutomowerAuth | null = null
  let client: AutomowerClient | null = null
  let socket: AutomowerSocket | null = null
  let poller: { stop(): void } | null = null
  let usageStore: UsageStore | null = null
  let usage: AutomowerUsage = { windowStart: 0, requests: 0 }
  let quotaAnchor: number | undefined
  let tz = 'UTC'
  let lastError: string | null = null
  let lastResync = 0
  /** Dernière lecture complète de chaque robot, par id fabricant. */
  const mowers = new Map<string, MowerData>()
  /**
   * Les derniers messages BRUTS du flux, tels que reçus : c'est par là qu'on capture les fixtures
   * d'événements (`GET /raw/events`), les seules qu'on n'ait pas encore prises sur le vrai compte.
   */
  const recentEvents: { at: number; message: unknown }[] = []
  const RECENT_EVENTS_MAX = 200
  /**
   * Le JOURNAL de chaque robot, lu au fabricant à la première demande (une requête, comptée), puis
   * tenu à jour par les `message-event-v2` du flux — sans relire. `stale` après une coupure du flux :
   * des messages ont pu passer, la prochaine demande relit.
   */
  const journals = new Map<string, { entries: JournalEntry[]; stale: boolean }>()
  const JOURNAL_MAX = 100
  let published: DeviceDescriptor[] = []

  const log = () => ctx!.logger
  const configured = () => !!(config?.AUTOMOWER_APP_KEY && config?.AUTOMOWER_APP_SECRET)
  const mapOptions = () => ({ tz, now: ctx!.clock.now() })

  /** Chaque requête à l'API compte (pas les jetons), et le compte survit au redémarrage. */
  function countCall(): void {
    usage = currentUsage(usage, ctx!.clock.now(), quotaAnchor)
    usage.requests += 1
    void usageStore?.save(usage)
  }
  const usageNow = () => currentUsage(usage, ctx?.clock.now() ?? Date.now(), quotaAnchor)

  /** Publie les descripteurs si l'inventaire a changé (robot ajouté, retiré, renommé). */
  function publishDescriptors(): void {
    const next = [...mowers.values()].map(toDescriptor)
    if (JSON.stringify(next) === JSON.stringify(published)) return
    published = next
    ctx!.emitDevices(next)
  }

  function emitFull(m: MowerData): void {
    const patch: StatePatch<'mower'> = toStatePatch(m, mapOptions())
    ctx!.emitState(m.id, patch)
    ctx!.setAvailable(m.id, connectedOf(m))
  }

  /** Une lecture complète : la liste, les descripteurs si besoin, l'état de chaque robot. */
  async function pollOnce(signal?: AbortSignal): Promise<void> {
    const raw = await client!.mowers(signal)
    if (!mowerListSchema.safeParse(raw).success) throw new PluginError('UPSTREAM_ERROR', 'GET /mowers has an unexpected shape')
    const list = parseMowers(raw, (issue) => log().warn({ issue }, 'Automower: a mower was skipped, unexpected shape'))
    mowers.clear()
    for (const m of list) mowers.set(m.id, m)
    publishDescriptors()
    for (const m of list) emitFull(m)
    lastError = null
  }

  /** Relire MAINTENANT, mais pas plus d'une fois par minute : le flux peut réclamer souvent. */
  function resync(reason: string): void {
    const now = ctx!.clock.now()
    if (now - lastResync < RESYNC_MIN_MS) return
    lastResync = now
    log().info({ reason }, 'Automower: full read requested')
    pollOnce(ctx!.signal).catch((err) => {
      lastError = (err as Error).message
      log().warn({ err }, 'Automower: full read failed')
    })
  }

  function onEvent(message: unknown): void {
    recentEvents.push({ at: ctx!.clock.now(), message })
    if (recentEvents.length > RECENT_EVENTS_MAX) recentEvents.splice(0, recentEvents.length - RECENT_EVENTS_MAX)
    const ready = wsReadySchema.safeParse(message)
    if (ready.success && !('type' in (message as object))) {
      log().debug({ connectionId: ready.data.connectionId }, 'Automower websocket ready')
      return
    }
    const ev = wsEventSchema.safeParse(message)
    if (!ev.success) { log().debug({ message }, 'Automower websocket: unknown message'); return }
    // une ligne de journal : elle rejoint le journal qu'on tient, s'il a déjà été lu
    if (ev.data.type === 'message-event-v2') {
      const entry = toJournalEntry(ev.data.attributes?.message, tz)
      const j = journals.get(ev.data.id)
      if (entry && j && !j.entries.some((e) => e.at === entry.at && e.code === entry.code)) {
        j.entries = [entry, ...j.entries].sort((a, b) => b.at - a.at).slice(0, JOURNAL_MAX)
      }
      return
    }
    // un robot que la liste ne connaît pas : il vient d'être ajouté au compte, on relit tout
    const current = mowers.get(ev.data.id)
    if (!current) { resync(`event for unknown mower ${ev.data.id}`); return }
    // un delta se fond dans le robot connu, et c'est le robot fondu qu'on garde pour le suivant
    const applied = applyEvent(ev.data, current, mapOptions())
    if (!applied) return
    mowers.set(ev.data.id, applied.next)
    ctx!.emitState(ev.data.id, applied.patch)
  }

  function status(): AutomowerStatus {
    return {
      configured: configured(),
      mowers: [...mowers.values()].map((m) => ({ id: m.id, name: toDescriptor(m).name, model: m.attributes.system?.model ?? null, connected: connectedOf(m) })),
      live: socket?.connected ?? false,
      pollMs: config?.AUTOMOWER_POLL_MS ?? 0,
      timezone: tz,
      requestsInWindow: usageNow().requests,
      windowLimit: WINDOW_REQUESTS,
      windowResetAt: usageNow().windowStart + WINDOW_MS,
      lastError,
    }
  }

  return {
    id: 'automower',
    configSchema: automowerConfigSchema,

    async init(context: PluginContext): Promise<void> {
      ctx = context
      config = context.config as AutomowerConfig
      // Un plugin se REDÉMARRE (bascule dans les Réglages, sous-item changé) : l'hôte a alors vidé
      // ses appareils avec le résultat de `discover`. Ce qu'on croyait « déjà publié » ne l'est plus —
      // sans cette remise à zéro, `publishDescriptors` ne réémettait rien et la tondeuse disparaissait
      // du registre tout en restant lue (constaté sur le vrai serveur le 2026-09-16).
      published = []
      lastError = null
      lastResync = 0
      journals.clear()
      tz = config.AUTOMOWER_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
      usageStore = deps.usageStore ?? (config.AUTOMOWER_USAGE_FILE ? createUsageFile(config.AUTOMOWER_USAGE_FILE, context.logger) : null)
      quotaAnchor = config.AUTOMOWER_QUOTA_RESET_AT ? Date.parse(config.AUTOMOWER_QUOTA_RESET_AT) : undefined
      usage = currentUsage(await usageStore?.load() ?? null, context.clock.now(), quotaAnchor)
      if (!configured()) { log().info('Automower: no application key or secret, plugin idle (AUTOMOWER_APP_KEY / AUTOMOWER_APP_SECRET)'); return }
      const fetchImpl = deps.fetchImpl ?? fetch
      auth = new AutomowerAuth({ appKey: config.AUTOMOWER_APP_KEY!, appSecret: config.AUTOMOWER_APP_SECRET!, fetchImpl, now: () => context.clock.now() })
      client = new AutomowerClient({ auth, appKey: config.AUTOMOWER_APP_KEY!, fetchImpl, logger: context.logger, onCall: countCall })
      socket = new AutomowerSocket({
        token: (signal) => auth!.accessToken(signal),
        clock: context.clock, signal: context.signal, logger: context.logger,
        onEvent,
        // une reconnexion a pu manquer des événements : l'état complet remet tout d'accord, et le
        // journal se relira à la prochaine demande
        onOpen: (reconnected) => {
          if (!reconnected) return
          for (const j of journals.values()) j.stale = true
          resync('websocket reconnected')
        },
        ...(deps.wsFactory ? { factory: deps.wsFactory } : {}),
      })
    },

    /**
     * Aucun appel réseau ici (les plugins démarrent en série) : la première lecture est dans `start`.
     * Mais ce qu'on SAIT déjà (un redémarrage garde la dernière liste) est redit tout de suite : le
     * registre ne reste pas vide le temps de la relecture.
     */
    async discover(): Promise<DeviceDescriptor[]> {
      published = [...mowers.values()].map(toDescriptor)
      return published
    },

    async start(): Promise<void> {
      if (!configured()) return
      const intervalMs = config!.AUTOMOWER_POLL_MS
      poller = createPoller({
        name: 'automower', intervalMs, clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
        // pas de reprise serrée : le quota est la ressource rare, et une API fâchée ne se calme pas en deux secondes
        backoff: createBackoff({ initialMs: Math.min(intervalMs, 120_000), maxMs: intervalMs }),
        fn: async () => {
          try { await pollOnce(ctx!.signal) }
          catch (err) { lastError = (err as Error).message; throw err }
        },
      })
      socket!.start()
      log().info({ intervalMs, tz }, 'Automower started (polling + websocket)')
    },

    /**
     * Trois gestes, traduits en actions du fabricant (`mapping.ts`). Le fabricant accuse en 202 dès
     * qu'il a PRIS la demande ; l'effet arrive ensuite par le flux d'événements, c'est lui qui met
     * la carte à jour — rien n'est publié ici par anticipation.
     */
    async execute(externalId: string, command: Command): Promise<void> {
      if (!configured()) throw new PluginError('NEEDS_PAIRING', 'Automower: no application key or secret')
      const body = actionBody(command)
      if (!body) throw new PluginError('UNSUPPORTED_COMMAND', `Automower plugin does not support ${command.type}`)
      const m = mowers.get(externalId)
      if (!m) throw new PluginError('DEVICE_UNAVAILABLE', `unknown mower ${externalId}`)
      if (!connectedOf(m)) throw new PluginError('DEVICE_UNAVAILABLE', `mower ${externalId} is not connected to Husqvarna`)
      await client!.action(externalId, body, ctx?.signal)
      log().info({ mower: externalId, action: body.data.type }, 'Automower action accepted')
    },

    /** Le journal du robot : lu une fois au fabricant, puis tenu par le flux. */
    async journal(externalId: string): Promise<PluginJournal> {
      if (!configured()) throw new PluginError('NEEDS_PAIRING', 'Automower: no application key or secret')
      if (!mowers.has(externalId)) throw new PluginError('DEVICE_UNAVAILABLE', `unknown mower ${externalId}`)
      let j = journals.get(externalId)
      if (!j || j.stale) {
        const entries = toJournal(await client!.messages(externalId, ctx?.signal), tz).slice(0, JOURNAL_MAX)
        j = { entries, stale: false }
        journals.set(externalId, j)
      }
      return { entries: j.entries }
    },

    async stop(): Promise<void> {
      poller?.stop()
      poller = null
      socket?.stop()
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/status', async () => status())

      /** Les derniers messages du flux, bruts et datés : la capture des fixtures d'événements. */
      app.get('/raw/events', async () => ({ live: socket?.connected ?? false, events: recentEvents }))

      /**
       * Recale le compteur sur le PORTAIL développeur (« n of 21000 requests · Resets at … ») : le
       * compte de la fenêtre, et l'instant de remise à zéro, gardé dans le fichier d'usage pour caler
       * les fenêtres suivantes. L'estimation dérive forcément (appels faits hors de Kasbah, fichier
       * repris de zéro) ; le portail reste la seule vérité — comme la console de Tesla.
       */
      app.post('/usage', async (req, reply) => {
        if (!ctx) return reply.code(409).send({ error: 'plugin not started' })
        const body = z.object({
          requests: z.number().int().min(0),
          resetAt: z.union([z.string().refine((v) => Number.isFinite(Date.parse(v)), 'ISO 8601'), z.number().int()]).optional(),
        }).safeParse(req.body)
        if (!body.success) return reply.code(400).send({ error: 'send { requests, resetAt? } (resetAt: ISO 8601 or ms epoch)' })
        const now = ctx.clock.now()
        if (body.data.resetAt !== undefined) quotaAnchor = typeof body.data.resetAt === 'number' ? body.data.resetAt : Date.parse(body.data.resetAt)
        usage = { ...currentUsage(usage, now, quotaAnchor), requests: body.data.requests, ...(quotaAnchor === undefined ? {} : { anchor: quotaAnchor }) }
        await usageStore?.save(usage)
        log().info({ usage }, 'Automower usage realigned on the developer portal')
        return status()
      })

      /** Le journal d'un robot tel que le fabricant le rend (une requête, comptée). */
      app.get<{ Params: { id: string } }>('/raw/messages/:id', async (req, reply) => {
        if (!configured() || !client) return reply.code(409).send({ error: 'Automower: no application key or secret' })
        try { return { messages: await client.messages(req.params.id, ctx?.signal) } }
        catch (err) { lastError = (err as Error).message; return reply.code(502).send({ error: lastError }) }
      })

      /**
       * Relevé brut, à capturer dès les clés posées : c'est lui qui remplacera les fixtures. Une
       * requête au fabricant, comptée comme les autres.
       */
      app.get('/raw', async (_req, reply) => {
        if (!configured() || !client) return reply.code(409).send({ error: 'Automower: no application key or secret' })
        try {
          return { mowers: await client.mowers(ctx?.signal) }
        } catch (err) {
          lastError = (err as Error).message
          const code = err instanceof PluginError && err.code === 'NEEDS_PAIRING' ? 401 : 502
          return reply.code(code).send({ error: lastError })
        }
      })
    },

    health(): PluginHealth {
      const deviceCount = mowers.size
      if (!configured()) return { status: 'needs_pairing', detail: 'AUTOMOWER_APP_KEY and AUTOMOWER_APP_SECRET missing', deviceCount: 0 }
      const u = usageNow()
      const quota = { used: u.requests, limit: WINDOW_REQUESTS, labelKey: 'mower.quotaRequests', since: u.windowStart }
      if (lastError) return { status: 'degraded', detail: lastError, deviceCount, quota }
      const connected = [...mowers.values()].filter(connectedOf).length
      const flow = socket?.connected ? 'live events' : 'polling only'
      return { status: 'ok', detail: `${deviceCount} mower(s), ${connected} connected · ${flow} · ${u.requests}/${WINDOW_REQUESTS} requests this week`, deviceCount, quota }
    },
  }
}
