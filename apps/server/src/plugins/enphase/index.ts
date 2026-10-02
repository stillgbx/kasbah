import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import type { FetchLike } from '../../core/sse'
import { sendError } from '../../http/errors'
import { createPoller } from '../../core/poll'
import { sleep } from '../../core/clock'
import { EnphaseClient } from './client'
import {
  batteriesOf, chargerSummariesOf, chargersOf, enabledChargingMode, isBatteryAvailable, isPanelStale, toBatteryPatch, toChargerDescriptors,
  toChargerPatch, toDailyPatch, toDescriptors, toPanelPatch, toSitePatch, SITE_ID, type EvCharger, type EvChargerSummary,
  type Inventory,
} from './mapping'
import {
  ensembleInventorySchema, ensemblePowerSchema, invertersSchema, livedataSchema, productionSchema,
  type EnsembleDevice, type Inverter,
} from './types'
import {
  RENEW_WARNING_DAYS, checkToken, createTokenFile, exchangeEnphaseToken, rejectionMessage, resolveEnphaseToken,
  type CheckedToken, type TokenSource, type TokenStore,
} from './token'
import {
  EnlightenClient, createCloudFile, openCloudSession, probeEvRaw, type CloudStore,
} from './cloud'

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
// La borne IQ EV Charger 2 n'est PAS sur la passerelle : elle parle au cloud Enphase (API privée
// de l'appli). Un sous-item `ev_charger` et une session Enlighten distincte du jeton local.
// Mappage d'après `GET /api/plugins/enphase/ev/raw` du 20/09 : lecture seule (aucune commande
// capturée), `SUSPENDED_EVSE` / `INSUFFICIENT_SOLAR` lu comme `connected`.

const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()

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
  ENPHASE_TOKEN_FILE: z.string().trim().default(stateFile('enphase-token.json')),
  /**
   * Session Enlighten (borne). Distincte du jeton local : coller un JWT de passerelle n'ouvre pas
   * le cloud. Chaîne vide = ne pas garder la session, donc retaper le compte pour relire la borne.
   */
  ENPHASE_CLOUD_FILE: z.string().trim().default(stateFile('enphase-cloud.json')),
  /** Cadence des compteurs : ils mesurent en temps réel, c'est ce que la vue Énergie montre. */
  ENPHASE_POLL_MS: z.coerce.number().int().min(2000).max(300_000).default(10_000),
  /**
   * Cadence des micro-onduleurs et des batteries. Inutile de descendre : un onduleur ne rapporte
   * QUE toutes les cinq minutes environ, sonder plus vite ne ferait que relire la même valeur.
   */
  ENPHASE_SLOW_POLL_MS: z.coerce.number().int().min(30_000).max(900_000).default(60_000),
})
export type EnphaseConfig = z.infer<typeof enphaseConfigSchema>

/** Après une commande de la borne, délai avant de relire : le courant arrive en 20 s à 1 min. */
const EV_FOLLOW_UP_MS = 45_000
/** Entre le passage en manuel et le retour au mode d'avant : essayé à la main avec ~20 s, pas plus vite. */
const MODE_RESTORE_GAP_MS = 5_000
/** Le cloud met un moment à refléter le mode rendu : on ne recommence pas avant. */
const MODE_RESTORE_RETRY_MS = 15 * 60_000

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
  /** Session Enlighten en cache : indispensable pour la borne, inutile à la passerelle. */
  cloudLinked: boolean
  cloudFile: string | null
  siteId: string | undefined
}

export interface EnphasePluginDeps {
  /** Injecté par les tests : requêtes vers la passerelle. */
  gatewayFetch?: FetchLike
  /** Injecté par les tests : requêtes vers le cloud Enphase (frappe du jeton). */
  cloudFetch?: FetchLike
  /** Injecté par les tests : cache du jeton (sinon un fichier sous `.state/`). */
  store?: TokenStore
  /** Injecté par les tests : session Enlighten (borne). */
  cloudStore?: CloudStore
}

export function createEnphasePlugin(deps: EnphasePluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: EnphaseConfig | null = null
  let client: EnphaseClient | null = null
  let store: TokenStore | null = null
  let cloudStore: CloudStore | null = null
  let enlighten: EnlightenClient | null = null
  /** Identité de la passerelle (`/info`, sans jeton). Absente si elle n'a pas encore répondu. */
  let gateway: { serial: string; software?: string } | null = null
  let token: (CheckedToken & { source: TokenSource }) | null = null
  let lastError: string | null = null
  /** Dernier inventaire connu (compteurs, onduleurs, batteries) : source des descripteurs. */
  let inventory: Inventory | null = null
  let chargers: EvCharger[] | null = null
  let chargerSummaries: EvChargerSummary[] = []
  /** Bornes démarrées ou arrêtées par Kasbah depuis le dernier retour à leur mode. */
  const forced = new Set<string>()
  /** Mode à rendre après un passage en manuel dont le retour a échoué : on ne repasse pas par le manuel. */
  const owed = new Map<string, string>()
  const lastRestore = new Map<string, number>()
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
      cloudLinked: !!enlighten?.hasSession,
      cloudFile: config?.ENPHASE_CLOUD_FILE || null,
      siteId: enlighten?.current?.siteId,
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
      publishDevices()
    } else inventory = next
    lastError = null
  }

  const chargersOn = () => ctx!.parts.ev_charger !== false

  function publishDevices() {
    ctx!.emitDevices([
      ...(inventory ? toDescriptors(inventory) : []),
      ...(chargers ? toChargerDescriptors(chargers, chargerSummaries) : []),
    ])
  }

  async function ensureSiteId(): Promise<string | undefined> {
    if (!enlighten?.hasSession) return undefined
    if (enlighten.current?.siteId) return enlighten.current.siteId
    const sites = await enlighten.readSites(ctx!.signal)
    if (!sites[0] || !enlighten.current) return undefined
    const session = { ...enlighten.current, siteId: sites[0].id }
    enlighten.setSession(session)
    await cloudStore?.save(session)
    return sites[0].id
  }

  async function fetchChargers(): Promise<void> {
    const siteId = await ensureSiteId()
    if (!siteId || !enlighten) { chargers = []; return }
    const status = await enlighten.getJson(`/service/evse_controller/${siteId}/ev_chargers/status`, ctx!.signal)
    const summary = await enlighten.getJson(
      `/service/evse_controller/api/v2/${siteId}/ev_chargers/summary?filter_retired=true`, ctx!.signal,
    ).catch(() => undefined)
    chargers = chargersOf(status)
    if (summary) chargerSummaries = chargerSummariesOf(summary)
  }

  async function pollChargers(): Promise<void> {
    await fetchChargers()
    publishDevices()
    for (const c of chargers ?? []) {
      if (!c.connected) ctx!.setAvailable(c.sn, false)
      else {
        const sum = chargerSummaries.find((s) => s.serialNumber === c.sn)
        ctx!.emitState(c.sn, toChargerPatch(c, sum))
      }
    }
    try { await restoreModes() }
    catch (err) { log().warn({ err }, 'Enphase charger mode not restored') }
  }

  /**
   * Rendre à la borne débranchée le mode d'avant le forçage. Vu sur la vraie borne le 2026-10-02 :
   * une charge forcée finie et la voiture débranchée, l'annulation tenait encore (`mode` 0) et
   * l'appli refusait de remettre le vert (« Charging mode is already enabled »). Le mode d'avant est
   * la préférence de l'appli, qu'un forçage ne change pas ; passer en manuel puis la réécrire lève
   * l'annulation (essayé ce jour-là).
   *
   * Sans forçage connu (redémarrage du serveur, geste dans l'appli), on ne le fait qu'en charge
   * verte, où `mode` 0 débranchée est sûrement une annulation oubliée. Une préférence manuelle est le
   * choix de l'utilisateur : rien à rendre. La voiture encore branchée, c'est le serveur qui le
   * demande, à sa limite de charge (`ev_charger.resume_mode`).
   */
  async function restoreModes(): Promise<void> {
    const siteId = enlighten?.current?.siteId
    if (!siteId || !enlighten) return
    for (const c of chargers ?? []) {
      if (!owed.has(c.sn)) {
        if (c.pluggedIn || !c.manualOverride) continue
        const now = ctx!.clock.now()
        if (now - (lastRestore.get(c.sn) ?? -Infinity) < MODE_RESTORE_RETRY_MS) continue
        lastRestore.set(c.sn, now)
        if (!await leaveOverride(siteId, c.sn, forced.has(c.sn))) continue
        await sleep(ctx!.clock, MODE_RESTORE_GAP_MS, ctx!.signal)
      }
      await giveModeBack(siteId, c.sn)
    }
  }

  const modePath = (siteId: string | number, sn: string) =>
    `/service/evse_scheduler/api/v1/iqevc/charging-mode/${siteId}/${encodeURIComponent(sn)}/preference`

  /**
   * Premier temps : lire la préférence (le mode d'avant) et passer en manuel. `known` : Kasbah a forcé
   * cette borne, sinon seul le vert est rendu. Vrai quand le mode d'avant reste à réécrire (`owed`).
   */
  async function leaveOverride(siteId: string | number, sn: string, known: boolean): Promise<boolean> {
    const path = modePath(siteId, sn)
    const preferred = enabledChargingMode(await enlighten!.getJson(path, ctx!.signal))
    if (!preferred || preferred === 'MANUAL_CHARGING') { forced.delete(sn); return false }
    if (!known && preferred !== 'GREEN_CHARGING') return false
    await enlighten!.send('PUT', path, { mode: 'MANUAL_CHARGING' }, ctx!.signal)
    owed.set(sn, preferred)
    return true
  }

  /** Second temps : réécrire le mode d'avant. Un échec le laisse dû : la relecture suivante le retente. */
  async function giveModeBack(siteId: string | number, sn: string): Promise<void> {
    const mode = owed.get(sn)
    if (!mode) return
    await enlighten!.send('PUT', modePath(siteId, sn), { mode }, ctx!.signal)
    owed.delete(sn)
    forced.delete(sn)
    log().info({ sn, mode }, 'Enphase charger back to its mode after a forced session')
  }

  /**
   * `ev_charger.resume_mode` : le serveur la demande quand la voiture forcée atteint sa limite,
   * encore branchée. Rien si la borne n'est plus sous annulation (`mode` 1 relu). Le retour au mode
   * d'avant part 5 s plus tard, hors du délai de la commande (`KASBAH_COMMAND_TIMEOUT_MS`, 10 s).
   */
  async function resumeMode(sn: string): Promise<void> {
    if (!chargersOn() || !enlighten?.hasSession) throw new PluginError('NEEDS_PAIRING', 'no Enlighten session: pair with the Enphase account')
    const siteId = await ensureSiteId()
    if (!siteId) throw new PluginError('NEEDS_PAIRING', 'no Enlighten site')
    const charger = chargers?.find((c) => c.sn === sn)
    if (!charger) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Enphase charger ${sn}`)
    if (charger.manualOverride === false) { forced.delete(sn); return }
    if (!owed.has(sn) && !await leaveOverride(siteId, sn, true)) return
    void (async () => {
      await sleep(ctx!.clock, MODE_RESTORE_GAP_MS, ctx!.signal)
      if (ctx!.signal.aborted) return
      try { await giveModeBack(siteId, sn) }
      catch (err) { log().warn({ err }, 'Enphase charger mode not given back: retried at the next read') }
    })()
  }

  /**
   * Démarrer ou arrêter la borne. Essayé sur la vraie borne le 2026-10-01 : en charge verte, l'un
   * comme l'autre pose une ANNULATION MANUELLE « jusqu'au prochain débranchement » (le `mode` de
   * l'état passe de 1 à 0, la préférence reste `GREEN_CHARGING`), puis la borne reprend seule son
   * mode au débranchement. Un `stop` ne rend donc PAS la charge verte : il coupe la charge jusqu'au
   * débranchement, soleil ou pas.
   *
   * L'intensité est celle de l'appli : son « Charger maintenant » envoie le `defaultChargeLevel` du
   * résumé (24 A ici). Sans intensité, le cloud prenait 32 A et la borne n'avait rien donné en 90 s.
   * L'état suit par une relecture `EV_FOLLOW_UP_MS` plus tard : le courant arrive en 20 s à 1 min.
   */
  async function chargerCommand(sn: string, start: boolean): Promise<void> {
    if (!chargersOn() || !enlighten?.hasSession) throw new PluginError('NEEDS_PAIRING', 'no Enlighten session: pair with the Enphase account')
    const siteId = await ensureSiteId()
    if (!siteId) throw new PluginError('NEEDS_PAIRING', 'no Enlighten site')
    if (!chargers?.some((c) => c.sn === sn)) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Enphase charger ${sn}`)
    const base = `/service/evse_controller/${siteId}/ev_chargers/${encodeURIComponent(sn)}`
    if (start) {
      const sum = chargerSummaries.find((s) => s.serialNumber === sn)
      const level = sum?.defaultChargeLevel ?? sum?.maxCurrent
      await enlighten.send('POST', `${base}/start_charging`, {
        ...(level !== undefined ? { chargingLevel: Math.round(level) } : {}), connectorId: 1,
      }, ctx!.signal)
    } else {
      await enlighten.send('PUT', `${base}/stop_charging`, undefined, ctx!.signal)
    }
    forced.add(sn)
    lastRestore.delete(sn)
    log().info({ start }, start ? 'Enphase charger forced to charge' : 'Enphase charger stopped')
    void (async () => {
      await sleep(ctx!.clock, EV_FOLLOW_UP_MS, ctx!.signal)
      if (ctx!.signal.aborted) return
      try { await pollChargers() }
      catch (err) { log().debug({ err }, 'Enphase charger follow-up read failed') }
    })()
  }

  return {
    id: 'enphase',
    configSchema: enphaseConfigSchema,
    parts: [{ id: 'ev_charger', labelKey: 'kinds.ev_charger', enabledByDefault: true }],

    async init(context) {
      ctx = context
      config = context.config as EnphaseConfig
      store = deps.store ?? (config.ENPHASE_TOKEN_FILE ? createTokenFile(config.ENPHASE_TOKEN_FILE, context.logger) : null)
      cloudStore = deps.cloudStore ?? (config.ENPHASE_CLOUD_FILE ? createCloudFile(config.ENPHASE_CLOUD_FILE, context.logger) : null)
      enlighten = new EnlightenClient({
        ...(deps.cloudFetch ? { fetchImpl: deps.cloudFetch } : {}),
        logger: context.logger,
      })
      const cloud = cloudStore ? await cloudStore.load() : null
      if (cloud) {
        enlighten.setSession(cloud)
        log().info({ siteId: cloud.siteId }, 'Enlighten session restored')
      }
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

    /** Sans jeton local ET sans session cloud, rien à publier. */
    async discover(): Promise<DeviceDescriptor[]> {
      const list: DeviceDescriptor[] = []
      if (client?.hasToken) {
        inventory = await readInventory()
        log().info({ inverters: inventory.inverters.length, batteries: inventory.batteries.length }, 'Enphase inventory read')
        list.push(...toDescriptors(inventory))
      }
      if (chargersOn() && enlighten?.hasSession) {
        try {
          await fetchChargers()
          if (chargers) list.push(...toChargerDescriptors(chargers, chargerSummaries))
        } catch (err) {
          log().warn({ err }, 'Enphase EV charger inventory unread')
        }
      }
      return list
    },

    async start() {
      pollers = []
      if (client?.hasToken) {
        pollers.push(
          createPoller({ name: 'enphase:meters', intervalMs: config!.ENPHASE_POLL_MS, fn: pollMeters, clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger }),
          createPoller({ name: 'enphase:devices', intervalMs: config!.ENPHASE_SLOW_POLL_MS, fn: pollDevices, clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger }),
        )
      }
      if (chargersOn() && enlighten?.hasSession) {
        pollers.push(createPoller({
          name: 'enphase:ev', intervalMs: config!.ENPHASE_SLOW_POLL_MS, fn: pollChargers,
          clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
        }))
      }
    },

    async execute(externalId, command: Command) {
      if (command.type === 'ev_charger.start' || command.type === 'ev_charger.stop') {
        await chargerCommand(externalId, command.type === 'ev_charger.start')
        return
      }
      if (command.type === 'ev_charger.resume_mode') {
        await resumeMode(externalId)
        return
      }
      throw new PluginError('UNSUPPORTED_COMMAND', `Enphase devices are read-only (${command.type})`)
    },

    async stop() {
      for (const p of pollers) p.stop()
      pollers = []
      client = null
      token = null
      gateway = null
      inventory = null
      chargers = null
      chargerSummaries = []
      enlighten = null
    },

    registerRoutes(app: FastifyInstance) {
      // État de l'appairage, pour la carte des Réglages. Jamais le jeton, seulement son échéance.
      app.get('/token', async () => status())

      /**
       * Appairage. Deux corps acceptés :
       *  - `{ token }` : un jeton obtenu à la main sur entrez.enphaseenergy.com — ouvre la
       *    passerelle, PAS le cloud de la borne ;
       *  - `{ user, password }` : identifiants du compte. Ils ouvrent d'abord une session
       *    Enlighten (gardée, c'est elle qui lit la borne), puis frappent un jeton local s'il
       *    manque ou expire. Le mot de passe est OUBLIÉ — ni journalisé, ni écrit, ni renvoyé.
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
            const session = await openCloudSession({
              user: parsed.data.user, password: parsed.data.password,
              ...(deps.cloudFetch ? { fetchImpl: deps.cloudFetch } : {}),
              signal: ctx.signal, logger: ctx.logger,
            })
            enlighten?.setSession(session)
            await cloudStore?.save(session)
            if (!gateway) {
              return sendError(reply, 502, 'UPSTREAM_ERROR', `cannot reach the gateway at ${config!.ENPHASE_HOST}: its serial number is needed to mint a token`)
            }
            // garde-fou : un jeton encore confortablement valable n'a pas à être remplacé. Sans
            // cela, chaque validation du compte pourrait créer un jeton de plus chez Enphase,
            // tous valables un an et tous inutilisés sauf le dernier. La session cloud, elle,
            // EST déjà enregistrée : on répond 200 (compte lié, JWT intact). `force` reste le
            // seul moyen de le remplacer avant l'avertissement des 30 jours.
            if (token && token.stage === 'ok' && !parsed.data.force) {
              log().info({ daysLeft: token.daysLeft, cloud: true }, 'Enphase Enlighten session linked, gateway token kept')
              return status()
            }
            const minted = await exchangeEnphaseToken({
              sessionId: session.sessionId, serial: gateway.serial, username: parsed.data.user,
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
        log().info({ daysLeft: token?.daysLeft, role: token?.claims.role, cloud: !!enlighten?.hasSession }, 'Enphase gateway paired')
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

      /**
       * Relevé BRUT du cloud EVSE, pour écrire les fixtures de la borne depuis de vraies réponses.
       * Indépendant du jeton local : coller un JWT de passerelle ne suffit pas, il faut le compte.
       * Une route en échec est rendue avec son erreur au lieu de faire tomber tout le relevé.
       */
      app.get('/ev/raw', async (_req, reply) => {
        if (!enlighten?.hasSession) return sendError(reply, 409, 'NEEDS_PAIRING', 'pair with the Enphase account first (a pasted gateway token is not enough)')
        return probeEvRaw(enlighten, enlighten.current?.siteId, ctx?.signal)
      })
    },

    health(): PluginHealth {
      const keys = ['ENPHASE_HOST', 'ENPHASE_TOKEN', 'ENPHASE_TOKEN_FILE', 'ENPHASE_CLOUD_FILE']
      if (!token) {
        return { status: 'needs_pairing', detail: lastError ?? 'no Enphase token: pair the gateway from Settings', keys }
      }
      if (token.stage === 'expiring') {
        // `degraded` et non `ok` : c'est ce qui fait passer la pastille des Réglages à l'orange
        // AVANT la panne. Un jeton d'installateur (12 h) naît dans cet état, et c'est voulu.
        return { status: 'degraded', detail: `Enphase token expires in ${token.daysLeft} day(s): renew it`, keys, deviceCount: (inventory ? toDescriptors(inventory).length : 0) + (chargers?.length ?? 0) }
      }
      const chargerCount = chargers?.length ?? 0
      const deviceCount = (inventory ? toDescriptors(inventory).length : 0) + chargerCount
      if (lastError) return { status: 'degraded', detail: lastError, keys, deviceCount }
      const parc = inventory ? ` · ${inventory.inverters.length} onduleurs, ${inventory.batteries.length} batteries` : ''
      const borne = chargerCount ? ` · ${chargerCount} borne` : ''
      return { status: 'ok', detail: `IQ Gateway ${gateway?.software ?? ''}${parc}${borne}`.trim(), keys, deviceCount }
    },
  }
}
