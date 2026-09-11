import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { sendError } from '../../http/errors'
import { createPoller } from '../../core/poll'
import { EnphaseClient } from './client'
import {
  batteriesOf, isBatteryAvailable, isPanelStale, toBatteryPatch, toDailyPatch, toDescriptors, toPanelPatch,
  toSitePatch, SITE_ID, type Inventory,
} from './mapping'
import {
  ensembleInventorySchema, ensemblePowerSchema, invertersSchema, livedataSchema, productionSchema,
  type EnsembleDevice, type Inverter,
} from './types'
import {
  RENEW_WARNING_DAYS, checkToken, createTokenFile, mintEnphaseToken, rejectionMessage, resolveEnphaseToken,
  type CheckedToken, type TokenSource, type TokenStore,
} from './token'

// Plugin Enphase : production solaire, micro-onduleurs et batteries lus sur l'API LOCALE de la
// passerelle IQ (aucun quota cloud, aucune dépendance à Internet une fois le jeton en place).
//
// Publie un site `energy`, un `sensor` de puissance par micro-onduleur et un `energy` de stockage
// par batterie IQ (voir `mapping.ts`). Deux cadences : les compteurs mesurent en temps réel, les
// onduleurs ne rapportent que toutes les cinq minutes.
//
// Le mappage a été écrit APRÈS la capture de vraies réponses (`GET /api/plugins/enphase/raw`, dont
// `__fixtures__/gateway.ts` est tiré) : la leçon TaHoma est que des fixtures écrites d'après la
// documentation laissent passer des bugs que le vrai matériel trouve tout de suite. Elle a resservi
// ici, le signe du stockage étant l'inverse de celui que le contrat attend.
//
// La borne IQ EV Charger 2 n'est PAS visible ici : elle ne parle qu'au cloud Enphase, son Modbus
// local étant verrouillé côté installateur. Elle fera l'objet d'un chemin séparé.

const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')

export const enphaseConfigSchema = z.object({
  /** Nom ou IP de la passerelle. `envoy.local` est le nom que le fabricant lui donne sur le LAN. */
  ENPHASE_HOST: z.string().trim().min(1).default('envoy.local'),
  /**
   * Jeton d'amorçage, facultatif : celui qu'on obtient à la main sur entrez.enphaseenergy.com.
   * Sans lui, le plugin démarre en `needs_pairing` et l'appairage se fait depuis les Réglages.
   * Le mot de passe du compte Enphase n'est VOLONTAIREMENT pas une clé de configuration : il est
   * demandé au moment de frapper un jeton, et jamais conservé.
   */
  ENPHASE_TOKEN: optionalKey,
  /** Où garder le jeton entre deux démarrages (il vaut un an). Chaîne vide = ne rien garder. */
  ENPHASE_TOKEN_FILE: z.string().trim().default(resolve(REPO_ROOT, 'apps/server/.state/enphase-token.json')),
  /** Cadence des compteurs : ils mesurent en temps réel, c'est ce que la vue Énergie montre. */
  ENPHASE_POLL_MS: z.coerce.number().int().min(2000).max(300_000).default(10_000),
  /**
   * Cadence des micro-onduleurs et des batteries. Inutile de descendre : un onduleur ne rapporte
   * QUE toutes les cinq minutes environ, sonder plus vite ne ferait que relire la même valeur.
   */
  ENPHASE_SLOW_POLL_MS: z.coerce.number().int().min(30_000).max(900_000).default(60_000),
})
export type EnphaseConfig = z.infer<typeof enphaseConfigSchema>

/** Relevé brut : ce qu'il faut capturer une fois pour écrire les fixtures du mappage. */
const RAW_PATHS = [
  '/production.json?details=1',
  '/api/v1/production/inverters',
  '/ivp/meters',
  '/ivp/meters/readings',
  '/ivp/livedata/status',
  '/ivp/ensemble/inventory',
  '/ivp/ensemble/power',
  '/ivp/meters/reports/consumption',
] as const

/**
 * Corps de l'appairage : un jeton déjà obtenu, OU les identifiants du compte pour en frapper un.
 * `force` sert à passer outre le garde-fou qui refuse de frapper un jeton quand celui en place est
 * encore bon : chaque frappe crée un jeton CHEZ Enphase, et en accumuler d'inutilisés n'a pas de sens.
 */
const pairingSchema = z.union([
  z.object({ token: z.string().min(1) }),
  z.object({ user: z.string().min(1), password: z.string().min(1), force: z.boolean().default(false) }),
])

/** Ce que l'UI affiche de l'appairage. Ne porte JAMAIS le jeton lui-même. */
export interface TokenStatus {
  paired: boolean
  host: string
  serial: string | undefined
  software: string | undefined
  stage: 'ok' | 'expiring' | 'expired' | 'none'
  daysLeft: number | undefined
  expiresAt: number | undefined
  role: string | undefined
  username: string | undefined
  source: 'config' | 'cache' | 'minted' | undefined
  /** Seuil (jours) sous lequel l'UI réclame un renouvellement. */
  renewUnderDays: number
  /**
   * Où le serveur garde le jeton, ou `null` si `ENPHASE_TOKEN_FILE` est vide. C'est ce qui dit à
   * l'UI s'il y a quelque chose à recopier à la main : avec un cache, non, l'appairage depuis une
   * tablette suffit et survit aux redémarrages. Sans cache, il faudra le poser dans `.env`.
   */
  tokenFile: string | null
}

export interface EnphasePluginDeps {
  /** Injecté par les tests : requêtes vers la passerelle. */
  gatewayFetch?: FetchLike
  /** Injecté par les tests : requêtes vers le cloud Enphase (frappe du jeton). */
  cloudFetch?: FetchLike
  /** Injecté par les tests : cache du jeton (sinon un fichier sous `.state/`). */
  store?: TokenStore
}

export function createEnphasePlugin(deps: EnphasePluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: EnphaseConfig | null = null
  let client: EnphaseClient | null = null
  let store: TokenStore | null = null
  /** Identité de la passerelle (`/info`, sans jeton). Absente si elle n'a pas encore répondu. */
  let gateway: { serial: string; software?: string } | null = null
  let token: (CheckedToken & { source: TokenSource }) | null = null
  let lastError: string | null = null
  /** Dernier inventaire connu (compteurs, onduleurs, batteries) : source des descripteurs. */
  let inventory: Inventory | null = null
  let pollers: { stop(): void }[] = []

  const log = () => ctx!.logger

  /** Relit `/info` : donne le numéro de série, qui sert à valider tout jeton proposé. */
  async function readGateway(): Promise<void> {
    try {
      gateway = await client!.info(ctx!.signal)
      lastError = null
    } catch (err) {
      lastError = (err as Error).message
      log().warn({ err, host: config!.ENPHASE_HOST }, 'IQ Gateway did not answer /info')
    }
  }

  function status(): TokenStatus {
    return {
      paired: !!token,
      host: config?.ENPHASE_HOST ?? '',
      serial: gateway?.serial ?? token?.claims.serial,
      software: gateway?.software,
      stage: token?.stage ?? 'none',
      daysLeft: token?.daysLeft,
      expiresAt: token?.claims.expiresAt,
      role: token?.claims.role,
      username: token?.claims.username,
      source: token?.source,
      renewUnderDays: RENEW_WARNING_DAYS,
      tokenFile: config?.ENPHASE_TOKEN_FILE || null,
    }
  }

  /** Vérifie un jeton pour CETTE passerelle, puis l'adopte : client, cache, état courant. */
  async function adopt(candidate: string): Promise<void> {
    const result = checkToken(candidate, { serial: gateway?.serial, now: ctx!.clock.now() })
    if (!result.ok) {
      throw new PluginError('NEEDS_PAIRING', rejectionMessage(result.reason, result.claims, gateway?.serial))
    }
    token = { ...result.checked, source: 'minted' }
    client!.setToken(result.checked.token)
    await store?.save(result.checked.token)
  }

  const get = async <T>(path: string, parse: (j: unknown) => T): Promise<T> =>
    parse(await client!.getJson(path, ctx!.signal))

  /**
   * Les batteries sont facultatives : une passerelle sans stockage ne sert pas `/ivp/ensemble/`.
   * Un échec ici ne doit donc pas priver l'utilisateur de sa production.
   */
  async function readBatteries(): Promise<EnsembleDevice[]> {
    try { return batteriesOf(await get('/ivp/ensemble/inventory', (j) => ensembleInventorySchema.parse(j))) }
    catch (err) { log().debug({ err }, 'no Enphase storage inventory: assuming no battery'); return [] }
  }

/**
   * Relit ce qui compose l'installation. Les requêtes s'enchaînent au lieu de partir ensemble : la
   * passerelle est un petit boîtier, et les lancer en parallèle la faisait dépasser le délai.
   */
  async function readInventory(): Promise<Inventory> {
    const report = await get('/production.json?details=1', (j) => productionSchema.parse(j))
    const inverters = await get('/api/v1/production/inverters', (j) => invertersSchema.parse(j))
    const batteries = await readBatteries()
    return { report, inverters, batteries }
  }

  /** Signature de l'inventaire : change quand un onduleur ou une batterie apparaît ou disparaît. */
  const deviceIds = (inv: Inventory) =>
    [...inv.inverters.map((i) => i.serialNumber), ...inv.batteries.map((b) => b.serial_num)].sort().join(',')

/**
   * Mesure temps réel du site, ce que la vue Énergie affiche. UNE seule requête, à `livedata` :
   * elle porte les mêmes compteurs que `production.json` et répond en 0,2 s contre 1,5 à 11 s.
   */
  async function pollMeters(): Promise<void> {
    const live = await get('/ivp/livedata/status', (j) => livedataSchema.parse(j))
    ctx!.emitState(SITE_ID, toSitePatch(live))
    lastError = null
  }

  /**
   * Onduleurs et batteries. Un onduleur muet depuis une demi-heure (la nuit, ou en panne) devient
   * indisponible plutôt que de se voir attribuer un zéro qu'on n'a pas mesuré.
   */
  async function pollDevices(): Promise<void> {
    const inverters = await get('/api/v1/production/inverters', (j) => invertersSchema.parse(j))
    const batteries = await readBatteries()
    const power = await get('/ivp/ensemble/power', (j) => ensemblePowerSchema.parse(j)).catch(() => undefined)
    const now = ctx!.clock.now()
    for (const inv of inverters as Inverter[]) {
      if (isPanelStale(inv, now)) ctx!.setAvailable(inv.serialNumber, false)
      else ctx!.emitState(inv.serialNumber, toPanelPatch(inv))
    }
    for (const b of batteries) {
      if (!isBatteryAvailable(b)) { ctx!.setAvailable(b.serial_num, false); continue }
      ctx!.emitState(b.serial_num, toBatteryPatch(b, power))
    }
    // les totaux du jour ne sont QUE dans `production.json`, lent : c'est ici qu'on le paie, une
    // fois par minute, et non à chaque mesure temps réel
    const report = await get('/production.json?details=1', (j) => productionSchema.parse(j))
    ctx!.emitState(SITE_ID, toDailyPatch(report))

    // un onduleur ajouté ou déposé change la liste : on republie, sinon son état partirait vers un
    // appareil que le registre ne connaît pas
    const next: Inventory = { report, inverters, batteries }
    if (!inventory || deviceIds(inventory) !== deviceIds(next)) {
      log().info({ inverters: inverters.length, batteries: batteries.length }, 'Enphase inventory changed')
      inventory = next
      ctx!.emitDevices(toDescriptors(next))
    } else inventory = next
    lastError = null
  }

  return {
    id: 'enphase',
    configSchema: enphaseConfigSchema,

    async init(context) {
      ctx = context
      config = context.config as EnphaseConfig
      store = deps.store ?? (config.ENPHASE_TOKEN_FILE ? createTokenFile(config.ENPHASE_TOKEN_FILE, context.logger) : null)
      client = new EnphaseClient({
        host: config.ENPHASE_HOST,
        ...(deps.gatewayFetch ? { fetchImpl: deps.gatewayFetch } : {}),
        logger: context.logger,
      })

      // `/info` d'abord : il ne demande aucun jeton et donne le numéro de série, donc on sait à
      // quelle passerelle un jeton doit correspondre avant de l'accepter.
      await readGateway()

      const resolved = await resolveEnphaseToken({
        token: config.ENPHASE_TOKEN,
        ...(store ? { store } : {}),
        ...(gateway ? { serial: gateway.serial } : {}),
        now: context.clock.now(),
        logger: context.logger,
      })
      if (resolved) {
        token = resolved
        client.setToken(resolved.token)
        log().info({ source: resolved.source, daysLeft: resolved.daysLeft, role: resolved.claims.role }, 'Enphase token accepted')
        if (resolved.stage === 'expiring') {
          log().warn({ daysLeft: resolved.daysLeft }, 'Enphase token is about to expire: renew it from Settings')
        }
      } else {
        log().warn('no usable Enphase token: pair the gateway from Settings (POST /api/plugins/enphase/token)')
      }
    },

    /** Sans jeton, rien à publier : la carte des Réglages dit quoi faire, et l'inventaire suivra. */
    async discover(): Promise<DeviceDescriptor[]> {
      if (!client?.hasToken) return []
      inventory = await readInventory()
      log().info({ inverters: inventory.inverters.length, batteries: inventory.batteries.length }, 'Enphase inventory read')
      return toDescriptors(inventory)
    },

    async start() {
      if (!client?.hasToken) return                      // un appairage plus tard relancera le plugin
      pollers = [
        createPoller({ name: 'enphase:meters', intervalMs: config!.ENPHASE_POLL_MS, fn: pollMeters, clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger }),
        createPoller({ name: 'enphase:devices', intervalMs: config!.ENPHASE_SLOW_POLL_MS, fn: pollDevices, clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger }),
      ]
    },

    async execute(_externalId, command: Command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `Enphase devices are read-only (${command.type})`)
    },

    async stop() {
      for (const p of pollers) p.stop()
      pollers = []
      client = null
      token = null
      gateway = null
      inventory = null
    },

    registerRoutes(app: FastifyInstance) {
      // État de l'appairage, pour la carte des Réglages. Jamais le jeton, seulement son échéance.
      app.get('/token', async () => status())

      /**
       * Appairage. Deux corps acceptés :
       *  - `{ token }` : un jeton obtenu à la main sur entrez.enphaseenergy.com ;
       *  - `{ user, password }` : les identifiants du compte Enphase, qui servent à frapper un
       *    jeton puis sont OUBLIÉS — ni journalisés, ni écrits, ni renvoyés. C'est le choix
       *    délibéré de ne pas les garder en configuration.
       */
      app.post('/token', async (req, reply) => {
        if (!client || !ctx) return sendError(reply, 409, 'NEEDS_PAIRING', 'plugin not started')
        const parsed = pairingSchema.safeParse(req.body)
        if (!parsed.success) {
          return sendError(reply, 400, 'INVALID_BODY', 'send either { token } or { user, password }')
        }
        // la passerelle a pu être injoignable au démarrage : on retente, son numéro de série est
        // ce qui permet de refuser un jeton émis pour une autre passerelle
        if (!gateway) await readGateway()

        try {
          if ('token' in parsed.data) {
            await adopt(parsed.data.token)
          } else {
            if (!gateway) {
              return sendError(reply, 502, 'UPSTREAM_ERROR', `cannot reach the gateway at ${config!.ENPHASE_HOST}: its serial number is needed to mint a token`)
            }
            // garde-fou : un jeton encore confortablement valable n'a pas à être remplacé. Sans
            // cela, chaque visite de la carte des Réglages pourrait créer un jeton de plus chez
            // Enphase, tous valables un an et tous inutilisés sauf le dernier.
            if (token && token.stage === 'ok' && !parsed.data.force) {
              return sendError(reply, 409, 'TOKEN_STILL_VALID',
                `the current token is still valid for ${token.daysLeft} day(s): send force to replace it anyway`)
            }
            const minted = await mintEnphaseToken({
              user: parsed.data.user, password: parsed.data.password, serial: gateway.serial,
              ...(deps.cloudFetch ? { fetchImpl: deps.cloudFetch } : {}),
              signal: ctx.signal,
            })
            await adopt(minted.token)
          }
        } catch (err) {
          const e = err as PluginError
          lastError = e.message
          const code = e.code ?? 'UPSTREAM_ERROR'
          return sendError(reply, code === 'NEEDS_PAIRING' ? 400 : 502, code, e.message)
        }
        log().info({ daysLeft: token?.daysLeft, role: token?.claims.role }, 'Enphase gateway paired')
        return status()
      })

      /**
       * Relevé BRUT des routes locales, pour écrire les fixtures du mappage depuis de vraies
       * réponses (et non depuis la documentation). Lecture seule ; une route en échec est rendue
       * avec son erreur au lieu de faire échouer tout le relevé.
       */
      app.get('/raw', async (_req, reply) => {
        if (!client?.hasToken) return sendError(reply, 409, 'NEEDS_PAIRING', 'pair the gateway first')
        const out: Record<string, unknown> = { info: gateway }
        for (const path of RAW_PATHS) {
          try { out[path] = await client.getJson(path, ctx!.signal) }
          catch (err) { out[path] = { error: (err as Error).message } }
        }
        return out
      })
    },

    health(): PluginHealth {
      const keys = ['ENPHASE_HOST', 'ENPHASE_TOKEN', 'ENPHASE_TOKEN_FILE']
      if (!token) {
        return { status: 'needs_pairing', detail: lastError ?? 'no Enphase token: pair the gateway from Settings', keys }
      }
      if (token.stage === 'expiring') {
        // `degraded` et non `ok` : c'est ce qui fait passer la pastille des Réglages à l'orange
        // AVANT la panne. Un jeton d'installateur (12 h) naît dans cet état, et c'est voulu.
        return { status: 'degraded', detail: `Enphase token expires in ${token.daysLeft} day(s): renew it`, keys, deviceCount: inventory ? toDescriptors(inventory).length : 0 }
      }
      const deviceCount = inventory ? toDescriptors(inventory).length : 0
      if (lastError) return { status: 'degraded', detail: lastError, keys, deviceCount }
      const parc = inventory ? ` · ${inventory.inverters.length} onduleurs, ${inventory.batteries.length} batteries` : ''
      return { status: 'ok', detail: `IQ Gateway ${gateway?.software ?? ''}${parc}`.trim(), keys, deviceCount }
    },
  }
}
