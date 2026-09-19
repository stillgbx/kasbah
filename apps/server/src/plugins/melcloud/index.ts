import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import { createBackoff } from '../../core/backoff'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import { DEFAULT_APP_VERSION, DEFAULT_BASE_URL, MelcloudAuth, createSessionFile, type SessionStore } from './auth'
import { MelcloudClient } from './client'
import { HeatingHistory, createHistoryFile, type HistoryStore } from './history'
import { toDescriptors, toDeviceLinks, toStatePatch, toSystem, toZones, zoneExternalId } from './mapping'
import type { DeviceLink, SystemReading } from './types'

// Plugin MELCloud (pompes à chaleur Mitsubishi Electric) — API cloud du fabricant.
//
// Il n'existe rien en local : le module Wi-Fi d'une Ecodan ne parle qu'au cloud de Mitsubishi, et
// il n'y a AUCUNE API publique pour un particulier. Reste celle de l'application MELCloud, avec ce
// que cela implique :
//
//  1. Un MOT DE PASSE, pas un OAuth. Il traverse le serveur une fois (`POST /login`) et n'est
//     jamais gardé ; seule la `ContextKey` survit (voir `auth.ts`).
//  2. Des réponses TOUJOURS EN HTTP 200, avec l'échec dans le corps (`ErrorId`) — le même piège
//     que Gigya chez Renault.
//  3. Une cadence bornée par la PHYSIQUE : la machine capturée annonce `NextCommunication` une
//     minute après `LastCommunication`. Sonder plus vite que cela relit la même chose.
//
// CE QUE LE PLUGIN PUBLIE : un appareil `climate` par ZONE de chauffage, en lecture seule. Pas un
// appareil par machine — l'installation de référence a trois Zubadan en cascade derrière un seul
// régulateur, et MELCloud n'en montre qu'un. Pas de ballon non plus : `HasHotWaterTank` est faux,
// le ballon de cette maison n'est pas piloté par la pompe à chaleur.
//
// CE QU'IL NE PUBLIE PAS : l'état de la MACHINE (dégivrage, appoints, circulateurs, départ/retour,
// demande). Une douzaine de capteurs pour des valeurs qu'on ne consulte qu'à un seul endroit
// encombrerait l'inventaire, la recherche et la scène 3D ; ils sont servis à la vue Chauffage par
// `GET /api/plugins/melcloud/system`.

/** Profondeur du relevé d'énergie du `raw`, quand la requête n'en demande pas d'autre. */
const REPORT_DAYS = 7

export const melcloudConfigSchema = z.object({
  /**
   * Point d'entrée de l'API. En configuration pour la même raison que les clés Renault : le
   * fabricant peut le déplacer, et une adresse neuve doit se poser dans `.env` sans toucher au code.
   */
  MELCLOUD_BASE_URL: z.string().url().default(DEFAULT_BASE_URL),
  /** Version d'application annoncée à la connexion (MELCloud l'exige). */
  MELCLOUD_APP_VERSION: z.string().trim().min(1).default(DEFAULT_APP_VERSION),
  /** Où garder la clé de session. Le mot de passe du compte n'y est JAMAIS écrit. */
  MELCLOUD_SESSION_FILE: z.string().trim().default(stateFile('melcloud-session.json')),
  /**
   * Cadence de lecture. UN seul appel par tour quel que soit le nombre de machines : `ListDevices`
   * rend tout le compte d'un coup, et il est plus riche que la lecture détaillée (210 champs contre
   * 42). Deux minutes suivent d'assez près une machine qui remonte au cloud chaque minute, sans la
   * marteler — le chauffage est de toute façon une grandeur lente.
   */
  MELCLOUD_POLL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(120_000),
  /**
   * Où garder l'historique de fonctionnement DÉJÀ CALCULÉ (une semaine d'heures, quelques dizaines
   * de kilo-octets). Le fabricant n'en sert aucun sur cette installation : il se construit au fil
   * des sondages, et sans ce fichier il repartirait de zéro à chaque redémarrage. Chaîne vide = ne
   * rien garder.
   */
  MELCLOUD_HISTORY_FILE: z.string().trim().default(stateFile('melcloud-history.json')),
})
export type MelcloudConfig = z.infer<typeof melcloudConfigSchema>

/** Ce que la carte des Réglages affiche. Ne porte jamais le mot de passe ni la clé de session. */
export interface MelcloudStatus {
  linked: boolean
  /** Nom du compte tel que MELCloud le rend, pour confirmer qu'on a lié le bon. */
  accountName: string | null
  devices: { deviceId: string; name: string; family: string | null; buildingName: string | null }[]
  /** Nombre d'appareils publiés à la maison : une zone de chauffage, pas une machine. */
  zoneCount: number
  pollMs: number
  sessionFile: string | null
  lastError: string | null
}

export interface MelcloudPluginDeps {
  /** Injecté par les tests : toutes les requêtes (connexion et API). */
  fetchImpl?: FetchLike
  sessionStore?: SessionStore
  historyStore?: HistoryStore
}

export function createMelcloudPlugin(deps: MelcloudPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: MelcloudConfig | null = null
  let auth: MelcloudAuth | null = null
  let client: MelcloudClient | null = null
  let links: DeviceLink[] = []
  let systems: SystemReading[] = []
  let lastError: string | null = null
  let poller: { stop(): void } | null = null
  let history = new HeatingHistory()
  let historyStore: HistoryStore | null = null
  /**
   * Ce qui a déjà été publié au registre, pour ne pas le redire à chaque tour. Remis à zéro dans
   * `init` : l'hôte redémarre un plugin SANS le réinstancier, et une empreinte survivante ferait
   * croire à des appareils publiés que le registre vient justement de vider.
   */
  let publishedFingerprint: string | null = null

  const log = () => ctx!.logger

  /** Les appareils de la maison : une zone de chauffage chacun, toutes machines confondues. */
  function descriptors(): DeviceDescriptor[] {
    return links.flatMap((l) => toDescriptors(l))
  }

  /**
   * Un tour de lecture. UN appel pour tout le compte, puis un état par zone.
   *
   * Les descripteurs ne sont republiés que s'ils ont changé : une machine qui bascule sa zone 2 de
   * l'ambiante à la loi d'eau change son `meta.climate.control`, et l'UI doit le savoir — mais
   * redire la même chose toutes les deux minutes ferait battre le registre pour rien.
   */
  async function pollOnce(signal?: AbortSignal): Promise<void> {
    links = toDeviceLinks(await client!.listDevices(signal))
    const now = ctx!.clock.now()
    systems = links.map((l) => toSystem(l, now))

    const found = descriptors()
    const fingerprint = JSON.stringify(found)
    if (fingerprint !== publishedFingerprint) {
      ctx!.emitDevices(found)
      publishedFingerprint = fingerprint
      log().info({ zones: found.length, units: links.length }, 'MELCloud devices published')
    }

    let rolled = false
    for (const link of links) {
      const zones = toZones(link.fields)
      for (const z of zones) {
        ctx!.emitState(zoneExternalId(link.deviceId, z.zone), toStatePatch(link.fields, z, now))
      }
      // l'historique ne suit que la PREMIÈRE machine : un foyer en a une, et mélanger deux pompes
      // à chaleur dans une même courbe ne voudrait rien dire. À revoir le jour où il y en a deux.
      if (link === links[0]) rolled = history.record(toSystem(link, now), zones, now)
    }
    // écrire à la bascule d'heure, pas à chaque sondage : une lecture toutes les deux minutes ferait
    // 720 écritures par jour pour sauver au mieux deux minutes de trace
    if (rolled) await historyStore?.save(history.toState())
    lastError = null
  }

  /** Fenêtre demandée par la requête, quand elle en donne une (`?from=2026-01-01&to=2026-03-01`). */
  function pickRange(q: { from?: string; to?: string }): { from?: string; to?: string } {
    const clean = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(0, 10)}T00:00:00` : undefined)
    const from = clean(q.from)
    const to = clean(q.to)
    return { ...(from ? { from } : {}), ...(to ? { to } : {}) }
  }

  /** Bornes du relevé d'énergie, au format que MELCloud attend (local, sans fuseau). */
  function reportRange(now: number): { from: string; to: string } {
    const iso = (t: number) => new Date(t).toISOString().slice(0, 19)
    return { from: iso(now - REPORT_DAYS * 86_400_000), to: iso(now) }
  }

  function status(): MelcloudStatus {
    return {
      linked: auth?.linked ?? false,
      accountName: auth?.accountName ?? null,
      devices: links.map((l) => ({ deviceId: l.deviceId, name: l.name, family: l.family, buildingName: l.buildingName })),
      zoneCount: descriptors().length,
      pollMs: config?.MELCLOUD_POLL_MS ?? 0,
      sessionFile: config?.MELCLOUD_SESSION_FILE ?? null,
      lastError,
    }
  }

  return {
    id: 'melcloud',
    configSchema: melcloudConfigSchema,

    async init(context: PluginContext): Promise<void> {
      ctx = context
      config = context.config as MelcloudConfig
      // remise à zéro : l'hôte REDÉMARRE un plugin sans le réinstancier, et tout ce qui sert à
      // décider « ai-je déjà publié ? » mentirait au tour suivant (`3_2_ecrire-un-plugin.md`)
      links = []
      systems = []
      publishedFingerprint = null
      lastError = null
      const store = deps.sessionStore ?? createSessionFile(config.MELCLOUD_SESSION_FILE, context.logger)
      historyStore = deps.historyStore ?? (config.MELCLOUD_HISTORY_FILE ? createHistoryFile(config.MELCLOUD_HISTORY_FILE, context.logger) : null)
      history = new HeatingHistory(await historyStore?.load())
      auth = new MelcloudAuth({
        baseUrl: config.MELCLOUD_BASE_URL,
        appVersion: config.MELCLOUD_APP_VERSION,
        fetchImpl: deps.fetchImpl ?? fetch,
        store,
        logger: context.logger,
      })
      client = new MelcloudClient({
        baseUrl: config.MELCLOUD_BASE_URL,
        auth,
        fetchImpl: deps.fetchImpl ?? fetch,
        logger: context.logger,
      })
      if (await auth.restore()) log().info('MELCloud account restored from the session cache')
      else log().info('no MELCloud account linked yet: POST /api/plugins/melcloud/login')
    },

    /**
     * AUCUN appel réseau : les plugins démarrent en série, et une API lente retarderait tous les
     * suivants. On redit ce qu'on sait déjà (rien au premier démarrage) ; c'est la première lecture
     * du poller, immédiate, qui publie les zones par `emitDevices`.
     */
    async discover(): Promise<DeviceDescriptor[]> {
      return descriptors()
    },

    async start(): Promise<void> {
      if (!auth?.linked) return
      const intervalMs = config!.MELCLOUD_POLL_MS
      poller = createPoller({
        name: 'melcloud',
        intervalMs,
        clock: ctx!.clock,
        signal: ctx!.signal,
        logger: ctx!.logger,
        // pas de reprise serrée : la machine ne dira rien de neuf avant sa prochaine remontée, et
        // réessayer dans deux secondes ne ferait que fâcher une API déjà muette
        backoff: createBackoff({ initialMs: intervalMs, maxMs: intervalMs }),
        fn: () => pollOnce(ctx!.signal),
      })
      log().info({ intervalMs }, 'MELCloud polling started')
    },

    /**
     * Lecture seule assumée. Le contraire d'un oubli : les zones ne déclarent ni `target_temp` ni
     * `hvac_mode`, donc l'UI n'offre aucun bouton qui finirait ici.
     */
    async execute(_externalId: string, command: Command): Promise<void> {
      throw new PluginError('UNSUPPORTED_COMMAND', `MELCloud plugin is read-only for now (${command.type})`)
    },

    async stop(): Promise<void> {
      poller?.stop()
      poller = null
      // l'heure en cours n'est pas encore écrite (on n'écrit qu'à la bascule) : la sauver ici évite
      // de la perdre à chaque redémarrage, ce qui trouerait la courbe une fois par session de travail
      await historyStore?.save(history.toState())
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/status', async () => status())

      /**
       * L'état des MACHINES, pour la vue Chauffage : ce qui ne mérite pas d'être un appareil mais
       * qu'on veut voir sur une page. Rend la dernière lecture du sondage, jamais un nouvel appel —
       * même règle que les prévisions météo et l'historique de consommation.
       */
      app.get('/system', async (_req, reply) => {
        if (!auth?.linked) return reply.code(409).send({ error: 'no MELCloud account linked' })
        return { units: systems, pollMs: config!.MELCLOUD_POLL_MS }
      })

      /**
       * L'historique de fonctionnement, construit au fil des sondages. Rendu tel quel : c'est une
       * trace accumulée, jamais un relevé refait à la demande.
       */
      app.get('/history', async () => ({ ...history.toState(), pollMs: config!.MELCLOUD_POLL_MS }))

      /**
       * Relier le compte. Le mot de passe ne vit que le temps de cette requête : il n'est ni gardé,
       * ni journalisé, ni renvoyé. Ce qui en sort est une `ContextKey` dans le fichier de session.
       */
      app.post<{ Body: { email?: string; password?: string } }>('/login', async (req, reply) => {
        const body = z.object({ email: z.string().trim().min(1), password: z.string().min(1) }).safeParse(req.body)
        if (!body.success) return reply.code(400).send({ error: 'email and password are required' })
        try {
          await auth!.login(body.data.email, body.data.password, ctx?.signal)
          await pollOnce(ctx?.signal)
          log().info({ units: links.length }, 'MELCloud account linked')
          return status()
        } catch (err) {
          lastError = (err as Error).message
          const code = err instanceof PluginError && err.code === 'NEEDS_PAIRING' ? 401 : 502
          return reply.code(code).send({ error: lastError })
        }
      })

      /** Délier : la clé de session est effacée, rien d'autre n'a jamais été gardé. */
      app.post('/logout', async () => {
        await auth!.forget()
        links = []
        systems = []
        publishedFingerprint = null
        ctx?.emitDevices([])
        return status()
      })

      /**
       * Relevé brut, tel qu'il a servi à écrire le mappage et les fixtures. Chaque lecture est
       * tentée séparément et son échec est RENDU plutôt que levé — savoir ce que MELCloud refuse
       * vaut autant que savoir ce qu'il donne.
       *
       * La fenêtre du relevé d'énergie est réglable (`?from=2026-01-15&to=2026-02-15`) : une
       * semaine de septembre rend des zéros sur une machine qui ne chauffe pas, ce qui ne prouve
       * rien sur l'existence d'un compteur. Il a fallu interroger l'hiver pour trancher.
       *
       * Contient des identifiants de compte et des noms de bâtiment : à ANONYMISER avant d'en faire
       * une fixture du dépôt.
       */
      app.get<{ Querystring: { from?: string; to?: string } }>('/raw', async (req, reply) => {
        if (!auth?.linked) return reply.code(409).send({ error: 'no MELCloud account linked' })
        try {
          const list = await client!.listDevices(ctx?.signal)
          const found = toDeviceLinks(list)
          links = found
          const { from, to } = { ...reportRange(ctx!.clock.now()), ...pickRange(req.query) }
          const details: unknown[] = []
          const reports: unknown[] = []
          for (const link of found) {
            try { details.push({ deviceId: link.deviceId, ok: true, body: await client!.device({ deviceId: link.deviceId, buildingId: link.buildingId, signal: ctx?.signal }) }) }
            catch (err) { details.push({ deviceId: link.deviceId, ok: false, error: (err as Error).message }) }
            try { reports.push({ deviceId: link.deviceId, ok: true, from, to, body: await client!.energyReport({ deviceId: link.deviceId, from, to, signal: ctx?.signal }) }) }
            catch (err) { reports.push({ deviceId: link.deviceId, ok: false, from, to, error: (err as Error).message }) }
          }
          return { devices: found.map((l) => ({ ...l, fields: undefined })), list, details, reports }
        } catch (err) {
          lastError = (err as Error).message
          return reply.code(502).send({ error: lastError })
        }
      })
    },

    health(): PluginHealth {
      const keys = ['MELCLOUD_BASE_URL', 'MELCLOUD_APP_VERSION', 'MELCLOUD_SESSION_FILE', 'MELCLOUD_POLL_MS', 'MELCLOUD_HISTORY_FILE']
      const zones = descriptors().length
      if (!auth?.linked) return { status: 'needs_pairing', detail: 'no MELCloud account linked', keys, deviceCount: 0 }
      if (lastError) return { status: 'degraded', detail: lastError, keys, deviceCount: zones }
      // dire ce qu'on publie ET ce qu'on ne publie pas : « 2 zones » sur « 1 machine » est
      // exactement ce qui surprend quand on croit avoir trois pompes à chaleur
      const faulty = systems.filter((s) => s.error.hasError).length
      const detail = `${zones} zone(s) on ${links.length} unit(s) · read-only${faulty ? ` · ${faulty} in error` : ''}`
      return { status: faulty ? 'degraded' : 'ok', detail, keys, deviceCount: zones }
    },
  }
}
