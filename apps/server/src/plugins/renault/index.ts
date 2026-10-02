import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Command, DeviceDescriptor, PluginHealth, StatePatch, VehicleSeat } from '@kasbah/shared'
import { createBackoff } from '../../core/backoff'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { sleep } from '../../core/clock'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import {
  DEFAULT_GIGYA_API_KEY, DEFAULT_GIGYA_URL, DEFAULT_KAMEREON_API_KEY, DEFAULT_KAMEREON_URL,
  RenaultAuth, createSessionFile, type SessionStore,
} from './auth'
import { DEFAULT_RATE_PER_HOUR, RenaultClient, carDataPath, isDeferred, isEndpointUnavailable } from './client'
import {
  chargeStartPayload, climateSettingsPayload, commandSummary, hvacSocThreshold, hvacStartPayload, inWindow, socTargetPayload, toAccounts, toDescriptor, toStatePatch, batteryFrame, levelRising, trackLevel, type LevelTrack,
  toVehicleLinks, wakePayload, type VehicleReadings,
} from './mapping'
import type { VehicleLink } from './types'

// Plugin Renault (véhicules) — API privée Gigya + Kamereon, celle de l'appli MY Renault.
//
// Il n'existe AUCUNE voie officielle pour un particulier : le portail développeur d'Ampere ne sert
// qu'à écrire des applications Android qui tournent DANS la voiture, et les données véhicule sont
// revendues en B2B par un agrégateur. Reste l'API privée, avec ce que cela implique :
//
//  1. Un MOT DE PASSE, pas un OAuth. Il traverse le serveur une fois (`POST /login`) et n'est
//     jamais gardé ; seul le `login_token` de Gigya survit (voir `auth.ts`).
//  2. Des CLÉS D'API que Renault fait tourner sans prévenir — mai 2026 a mis en panne toutes les
//     intégrations tierces le même jour. D'où leur présence en configuration, avec un défaut.
//  3. Un DÉBIT serré (60 appels par heure), tenu par le client, pas par la cadence du sondage.
//
// Et une particularité de la R5 E-Tech, qui vaut pour toute la plateforme récente : plusieurs
// lectures historiques répondent 403 `err.func.wired.forbidden` (verrouillage, pression des pneus,
// mode de charge). Ce n'est pas une panne, c'est « pas pour ce véhicule » : le plugin les raye de
// sa liste au lieu de les redemander.
//
// ÉTAT DE CE FICHIER : liaison du compte, inventaire des véhicules et relevé brut. Le mappage des
// lectures et le sondage attendent la capture du vrai compte (`GET /api/plugins/renault/raw`) —
// écrire des fixtures d'après la documentation est l'erreur que ce projet a déjà commise deux fois.

const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()

export const renaultConfigSchema = z.object({
  /** Pays du compte, exigé en paramètre sur TOUTES les routes Kamereon. */
  RENAULT_COUNTRY: z.string().trim().length(2).toUpperCase().default('FR'),
  /**
   * Point d'entrée et clé Gigya (authentification) puis Kamereon (données). Les défauts sont ceux
   * de `fr_FR` ; ils sont en configuration parce que Renault les fait tourner — une clé neuve se
   * pose dans `.env` sans toucher au code.
   */
  RENAULT_GIGYA_URL: z.string().url().default(DEFAULT_GIGYA_URL),
  RENAULT_GIGYA_API_KEY: z.string().trim().min(1).default(DEFAULT_GIGYA_API_KEY),
  RENAULT_KAMEREON_URL: z.string().url().default(DEFAULT_KAMEREON_URL),
  RENAULT_KAMEREON_API_KEY: z.string().trim().min(1).default(DEFAULT_KAMEREON_API_KEY),
  /** Compte Kamereon à lire, quand la personne en a plusieurs. Absent = le premier compte actif. */
  RENAULT_ACCOUNT_ID: optionalKey,
  /** Où garder le jeton de session Gigya. Le mot de passe, lui, n'y est JAMAIS écrit. */
  RENAULT_SESSION_FILE: z.string().trim().default(stateFile('renault-session.json')),
  /**
   * Cadence de lecture, 10 min comme Tesla. Cinq lectures par véhicule et par tour, soit une
   * trentaine d'appels par heure — confortablement sous les 60 que Renault tolère.
   */
  RENAULT_POLL_MS: z.coerce.number().int().min(120_000).max(3_600_000).default(600_000),
  /** Plafond d'appels par heure que le plugin s'impose, avant que Renault ne réponde 429. */
  RENAULT_RATE_PER_HOUR: z.coerce.number().int().min(1).max(600).default(DEFAULT_RATE_PER_HOUR),
  /**
   * Fenêtre horaire du réveil de charge (heure LOCALE du serveur). Hors de cette plage, une
   * voiture branchée qui ne charge pas attend le plus souvent sa charge programmée : la secouer
   * serait se battre contre son propre réglage. Bornes égales = jamais.
   */
  RENAULT_WAKE_FROM: z.string().trim().default('08:00'),
  RENAULT_WAKE_TO: z.string().trim().default('20:00'),
  /** Délai minimal entre deux réveils du MÊME véhicule. */
  RENAULT_WAKE_EVERY_MS: z.coerce.number().int().min(300_000).max(21_600_000).default(900_000),
})
export type RenaultConfig = z.infer<typeof renaultConfigSchema>

/**
 * Lectures tentées par le relevé brut : tout ce que la plateforme sait servir, y compris ce qu'on
 * s'attend à voir refusé. C'est justement l'intérêt — la capture dira ce que CE véhicule répond,
 * et c'est elle qui décidera la liste du sondage.
 */
export const PROBE_ENDPOINTS = [
  { endpoint: 'battery-status', version: 2, adapter: 'kca' },
  { endpoint: 'cockpit', version: 1, adapter: 'kca' },
  { endpoint: 'cockpit', version: 2, adapter: 'kca' },
  { endpoint: 'location', version: 1, adapter: 'kca' },
  { endpoint: 'hvac-status', version: 1, adapter: 'kca' },
  { endpoint: 'charging-settings', version: 1, adapter: 'kca' },
  { endpoint: 'charge-mode', version: 1, adapter: 'kca' },
  { endpoint: 'lock-status', version: 1, adapter: 'kca' },
  { endpoint: 'pressure', version: 1, adapter: 'kca' },
  { endpoint: 'res-state', version: 1, adapter: 'kca' },
  { endpoint: 'ev/soc-levels', version: 1, adapter: 'kcm' },
  { endpoint: 'ev/settings', version: 1, adapter: 'kcm' },
] as const

/**
 * Les lectures du sondage : celles que la R5 a acceptées à la capture, chacune rangée sous la clé
 * que `toStatePatch` attend. `cockpit` est en **v1** — la v2 répond un HTTP 200 sans données.
 *
 * Six appels par véhicule et par tour (`ev/settings` porte les réglages de la climatisation). Au
 * défaut de 10 minutes cela fait 36 appels par heure pour un véhicule, sous les 60 que Renault tolère ; la liste des véhicules n'est PAS relue à chaque tour
 * (contrairement à Tesla, il n'y a pas de veille à surveiller). Avec deux véhicules le plafond
 * serait franchi : c'est le seau à jetons du client qui refuse alors, sans appeler.
 */
export const READ_ENDPOINTS = [
  { key: 'battery', endpoint: 'battery-status', version: 2, adapter: 'kca' },
  { key: 'cockpit', endpoint: 'cockpit', version: 1, adapter: 'kca' },
  { key: 'location', endpoint: 'location', version: 1, adapter: 'kca' },
  { key: 'hvac', endpoint: 'hvac-status', version: 1, adapter: 'kca' },
  { key: 'socLevels', endpoint: 'ev/soc-levels', version: 1, adapter: 'kcm' },
  { key: 'settings', endpoint: 'ev/settings', version: 1, adapter: 'kcm' },
] as const satisfies readonly { key: keyof VehicleReadings; endpoint: string; version: number; adapter: 'kca' | 'kcm' }[]

/**
 * Le réveil de charge est un SOUS-ITEM cochable, pas une variable d'environnement : il écrit dans
 * la voiture, et l'utilisateur doit pouvoir le couper depuis l'interface sans toucher au serveur.
 */
/** Relecture après une commande de climatisation : le temps que le boîtier la prenne et le dise. */
const CLIMATE_FOLLOW_UP_MS = 60_000

export const CHARGE_WAKE = 'charge_wake'
const CHARGE_WAKE_PART = [{ id: CHARGE_WAKE, labelKey: 'vehicle.chargeWake', enabledByDefault: true }] as const

/**
 * Ce qu'est devenu le dernier réveil. Sans cela, un réveil qui échoue ne se voit NULLE PART sauf
 * dans la console du serveur : le 2026-09-19, cinq heures de refus ont passé inaperçues pendant
 * qu'une journée de surplus solaire se perdait. C'est le vrai défaut que cette séance a trouvé.
 */
export interface WakeOutcome {
  at: number
  /** `sent` la commande est déposée ; `deferred` Renault dit « pas maintenant » ; `failed` le reste. */
  result: 'sent' | 'deferred' | 'failed'
  /** La commande rendue (`type status commandId`), ou le message du refus. */
  detail: string | null
}

/** Ce que la carte des Réglages affiche. Ne porte jamais le mot de passe ni un jeton. */
export interface RenaultStatus {
  linked: boolean
  country: string
  /** Compte Kamereon retenu, et ceux que la personne possède. */
  accountId: string | null
  accounts: { accountId: string; accountType: string | null }[]
  vehicles: { vin: string; name: string }[]
  pollMs: number
  ratePerHour: number
  /** Délai (s) avant que le budget de débit laisse passer un appel ; 0 = tout de suite. */
  rateWaitS: number
  sessionFile: string | null
  lastError: string | null
  /** Le dernier réveil de charge tenté, et ce qu'il est devenu. `null` : aucun depuis le démarrage. */
  lastWake: WakeOutcome | null
}

export interface RenaultPluginDeps {
  /** Injecté par les tests : toutes les requêtes (Gigya et Kamereon). */
  fetchImpl?: FetchLike
  sessionStore?: SessionStore
}

export function createRenaultPlugin(deps: RenaultPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: RenaultConfig | null = null
  let auth: RenaultAuth | null = null
  let client: RenaultClient | null = null
  let accountId: string | null = null
  let accounts: { accountId: string; accountType: string | null }[] = []
  let links: VehicleLink[] = []
  let lastError: string | null = null
  let poller: { stop(): void } | null = null
  /**
   * Lectures que CE véhicule ne sert pas (`vin:endpoint`). La R5 en refuse plusieurs, définitivement :
   * les redemander toutes les sept minutes gaspillerait le budget de débit pour toujours la même
   * réponse. Vidé au redémarrage — un modèle peut gagner un endpoint par mise à jour logicielle.
   */
  const unavailable = new Set<string>()
  /** Dernier réveil envoyé par VIN : un véhicule ne se secoue pas en boucle. */
  const lastWake = new Map<string, number>()
  /** Ce qu'est devenu le dernier réveil tenté, tous véhicules confondus. */
  let lastWakeOutcome: WakeOutcome | null = null
  /** Dernier niveau et dernier seuil de climatisation lus, par VIN : de quoi refuser AVANT l'action. */
  const lastHvac = new Map<string, { soc?: number; threshold?: number }>()
  /** Les sièges tels que publiés, par VIN : la fusion d'état est superficielle, `seatHeat` part entier. */
  const lastSeats = new Map<string, Partial<Record<VehicleSeat, number>>>()
  /** Niveau suivi trame après trame, par VIN : le second témoin de la charge ne vaut que s'il monte. */
  const levels = new Map<string, LevelTrack>()

  const log = () => ctx!.logger

  /** Le compte Kamereon à lire : celui de la configuration, sinon le premier compte actif. */
  async function resolveAccount(signal?: AbortSignal): Promise<string | null> {
    if (config!.RENAULT_ACCOUNT_ID) return (accountId = config!.RENAULT_ACCOUNT_ID)
    const personId = auth!.personId
    if (!personId) return null
    const found = toAccounts(await client!.person(personId, signal))
    accounts = found.map((a) => ({ accountId: a.accountId, accountType: a.accountType ?? null }))
    // à défaut d'un compte Renault explicite, le premier actif : c'est le cas du foyer à un compte
    const preferred = found.find((a) => a.accountType?.toUpperCase() === 'MYRENAULT') ?? found[0]
    return (accountId = preferred?.accountId ?? null)
  }

  /** Liste les véhicules du compte, en retenant les liens pour le statut et les descripteurs. */
  async function listVehicles(signal?: AbortSignal): Promise<VehicleLink[]> {
    const id = accountId ?? await resolveAccount(signal)
    if (!id) return (links = [])
    return (links = toVehicleLinks(await client!.vehicles(id, signal)))
  }

  /**
   * Lit un véhicule et publie son état. Chaque lecture est tentée séparément : une lecture refusée
   * (403 ou 404) est rayée pour de bon, une lecture en panne n'empêche pas les autres de publier.
   * On émet même partiellement — la moitié d'un état vaut mieux que rien, et `readAt` la date.
   */
  async function readVehicle(vin: string, signal?: AbortSignal): Promise<void> {
    const id = accountId ?? await resolveAccount(signal)
    if (!id) throw new PluginError('NEEDS_PAIRING', 'no Kamereon account for this person')
    const readings: VehicleReadings = {}
    for (const r of READ_ENDPOINTS) {
      if (unavailable.has(`${vin}:${r.endpoint}`)) continue
      try {
        readings[r.key] = await client!.carData({ accountId: id, vin, endpoint: r.endpoint, version: r.version, adapter: r.adapter, signal })
      } catch (err) {
        if (isEndpointUnavailable(err)) {
          unavailable.add(`${vin}:${r.endpoint}`)
          log().info({ endpoint: r.endpoint }, 'Renault does not serve this reading for this vehicle, not asking again')
          continue
        }
        throw err
      }
    }
    const frame = batteryFrame(readings.battery)
    if (frame) levels.set(vin, trackLevel(levels.get(vin), frame.at, frame.soc))
    const patch = toStatePatch(readings, ctx!.clock.now(), { levelRising: levelRising(levels.get(vin)) })
    ctx!.emitState(vin, patch)
    lastHvac.set(vin, { soc: patch.soc ?? lastHvac.get(vin)?.soc, threshold: hvacSocThreshold(readings.hvac) ?? lastHvac.get(vin)?.threshold })
    if (patch.seatHeat) lastSeats.set(vin, { ...patch.seatHeat })
    // un réveil raté ne doit pas faire échouer la lecture : l'état est déjà publié
    try { await maybeWake(vin, patch, signal) }
    catch (err) {
      // « Pas maintenant » n'est pas une panne : une commande déjà en attente (409) ou le quota des
      // actions (429) sont la vie normale de cette API. Les journaliser en `warn` comme le reste
      // noyait le vrai signal.
      const deferred = isDeferred(err)
      lastWakeOutcome = { at: ctx!.clock.now(), result: deferred ? 'deferred' : 'failed', detail: (err as Error).message }
      if (deferred) log().info({ vin, err }, 'Renault is not taking a charge wake-up right now')
      else log().warn({ err, vin }, 'Renault charge wake-up failed')
    }
  }

  /**
   * Le réveil de charge. La R5 NE REPREND PAS la charge d'elle-même après une coupure de courant
   * (borne pilotée par le surplus solaire, nuage qui passe) : c'est un défaut du véhicule, non
   * corrigé depuis plus d'un an. Le geste manuel équivalent est de la verrouiller/déverrouiller à
   * la télécommande ; par l'API, ce qui la réveille est de RÉÉCRIRE ses réglages VE.
   *
   * Cinq conditions, toutes nécessaires : le sous-item est coché, on SAIT qu'elle est branchée et
   * qu'elle ne charge pas (un champ manquant n'autorise rien), **la limite de charge n'est pas
   * atteinte**, l'heure est dans la fenêtre, et le dernier réveil est assez ancien. Le plugin ne
   * voit PAS le surplus solaire — aucun moteur d'automatisation ne relie encore deux plugins — mais
   * il n'en a pas besoin : « branchée et pas en charge » est exactement ce que l'utilisateur
   * constate avant d'aller secouer la voiture.
   *
   * La limite atteinte est le cas ORDINAIRE d'une voiture branchée qui ne charge pas : la nuit
   * suivant une charge terminée, elle ne charge plus parce qu'elle est PLEINE. La secouer n'y
   * changerait rien, et ce réveil ÉCRIT dans la voiture — le faire tous les quarts d'heure toute la
   * journée serait la déranger pour rien.
   */
  async function maybeWake(vin: string, patch: StatePatch<'vehicle'>, signal?: AbortSignal): Promise<void> {
    if (!ctx!.parts[CHARGE_WAKE]) return
    if (patch.pluggedIn !== true || patch.charging !== false) return
    // niveau ou cible inconnus : on ne peut pas PROUVER que la charge est finie, et une voiture
    // branchée qui ne charge pas reste le signe qu'on cherche — on réveille (contrairement à
    // `pluggedIn` / `charging`, dont l'absence interdit tout)
    const target = patch.chargeLimit
    if (patch.soc !== undefined && target != null && patch.soc >= target) return
    const now = ctx!.clock.now()
    if (!inWindow(new Date(now), config!.RENAULT_WAKE_FROM, config!.RENAULT_WAKE_TO)) return
    const since = now - (lastWake.get(vin) ?? 0)
    if (since < config!.RENAULT_WAKE_EVERY_MS) return
    const id = accountId
    if (!id) return
    // les réglages à rejouer se LISENT d'abord : on ne réécrit que ce que la voiture nous a donné
    const body = wakePayload(await client!.carData({ accountId: id, vin, endpoint: 'ev/settings', version: 1, adapter: 'kcm', signal }), now)
    if (!body) return
    // la réponse est une COMMANDE déposée, pas un enregistrement : c'est elle, et elle seule, qui
    // dit si le réveil a été pris — on la jetait
    const command = commandSummary(await client!.writeEvSettings({ accountId: id, vin, body, signal }))
    lastWake.set(vin, now)
    lastWakeOutcome = { at: now, result: 'sent', detail: command }
    log().info({ vin, soc: patch.soc, target: patch.chargeLimit, command, dataAgeMs: patch.readAt ? now - patch.readAt : null },
      'Renault charge wake-up sent (plugged in, not charging, below target)')
  }

  /** Un tour : tous les véhicules connus. Une erreur remonte au poller, qui la journalise. */
  async function pollOnce(signal?: AbortSignal): Promise<void> {
    for (const link of links) await readVehicle(link.vin, signal)
    lastError = null
  }

  function status(): RenaultStatus {
    return {
      linked: auth?.linked ?? false,
      country: config?.RENAULT_COUNTRY ?? 'FR',
      accountId,
      accounts,
      vehicles: links.map((l) => ({ vin: l.vin, name: toDescriptor(l).name })),
      pollMs: config?.RENAULT_POLL_MS ?? 0,
      ratePerHour: config?.RENAULT_RATE_PER_HOUR ?? 0,
      rateWaitS: Math.ceil((client?.waitMs() ?? 0) / 1000),
      sessionFile: config?.RENAULT_SESSION_FILE ?? null,
      lastError,
      lastWake: lastWakeOutcome,
    }
  }

  return {
    id: 'renault',
    configSchema: renaultConfigSchema,
    parts: CHARGE_WAKE_PART,

    async init(context: PluginContext): Promise<void> {
      ctx = context
      config = context.config as RenaultConfig
      const store = deps.sessionStore ?? createSessionFile(config.RENAULT_SESSION_FILE, context.logger)
      auth = new RenaultAuth({
        gigyaUrl: config.RENAULT_GIGYA_URL,
        gigyaApiKey: config.RENAULT_GIGYA_API_KEY,
        fetchImpl: deps.fetchImpl ?? fetch,
        store,
        now: () => context.clock.now(),
        logger: context.logger,
      })
      client = new RenaultClient({
        baseUrl: config.RENAULT_KAMEREON_URL,
        apiKey: config.RENAULT_KAMEREON_API_KEY,
        country: config.RENAULT_COUNTRY,
        auth,
        fetchImpl: deps.fetchImpl ?? fetch,
        clock: context.clock,
        logger: context.logger,
        ratePerHour: config.RENAULT_RATE_PER_HOUR,
      })
      if (await auth.restore()) log().info('Renault account restored from the session cache')
      else log().info('no Renault account linked yet: POST /api/plugins/renault/login')
    },

    async discover(): Promise<DeviceDescriptor[]> {
      if (!auth?.linked) return []
      try {
        return (await listVehicles(ctx!.signal)).map((l) => toDescriptor(l))
      } catch (err) {
        lastError = (err as Error).message
        log().warn({ err }, 'could not list Renault vehicles')
        return []
      }
    },

    async start(): Promise<void> {
      if (!auth?.linked) return
      const intervalMs = config!.RENAULT_POLL_MS
      poller = createPoller({
        name: 'renault',
        intervalMs,
        clock: ctx!.clock,
        signal: ctx!.signal,
        logger: ctx!.logger,
        // pas de reprise serrée après un échec : le débit est la ressource rare, et réessayer dans
        // deux secondes ne ferait que vider le seau à jetons sur une API déjà fâchée
        backoff: createBackoff({ initialMs: intervalMs, maxMs: intervalMs }),
        fn: () => pollOnce(ctx!.signal),
      })
      log().info({ vehicles: links.length, intervalMs }, 'Renault polling started')
    },

    /**
     * `vehicle.refresh` (relire MAINTENANT), la CIBLE de charge, la climatisation et le DÉMARRAGE de
     * la charge. Chacune vient avec une capacité que le plugin déclare ; ne pas l'honorer ferait
     * proposer par l'UI un bouton que le plugin refuserait. L'arrêt de la charge, la R5 ne le sait
     * pas : le serveur arrête la borne à sa place (`meta.vehicle.stopViaCharger`).
     */
    async execute(externalId: string, command: Command): Promise<void> {
      if (command.type === 'vehicle.set_charge_limit') {
        const id = accountId
        if (!id) throw new PluginError('NEEDS_PAIRING', 'no Kamereon account for this person')
        // les niveaux se LISENT d'abord : le plancher est le réglage de l'utilisateur, on le rejoue tel quel
        const levels = await client!.carData({ accountId: id, vin: externalId, endpoint: 'ev/soc-levels', version: 1, adapter: 'kcm', signal: ctx?.signal })
        const body = socTargetPayload(levels, command.percent, ctx!.clock.now())
        if (!body) throw new PluginError('UPSTREAM_ERROR', 'Renault gave no EV levels back to rewrite')
        await client!.writeSocLevels({ accountId: id, vin: externalId, body, signal: ctx?.signal })
        // la cible est publiée tout de suite : le prochain tour de sondage la confirmera
        ctx!.emitState(externalId, { chargeLimit: command.percent })
        log().info({ vin: externalId, percent: command.percent }, 'Renault charge target set')
        return
      }
      if (command.type === 'vehicle.climate_start' || command.type === 'vehicle.climate_stop') {
        const id = accountId
        if (!id) throw new PluginError('NEEDS_PAIRING', 'no Kamereon account for this person')
        const start = command.type === 'vehicle.climate_start'
        // la R5 dit elle-même sous quel niveau elle refuse : on ne dépense pas une action, rare, pour un refus certain
        const known = lastHvac.get(externalId)
        if (start && known?.soc !== undefined && known.threshold !== undefined && known.soc < known.threshold) {
          throw new PluginError('LOW_BATTERY', `battery at ${known.soc} %, below the ${known.threshold} % climate threshold of this vehicle`)
        }
        const res = await client!.hvacStart({
          accountId: id, vin: externalId, signal: ctx?.signal,
          body: hvacStartPayload(start ? 'start' : 'cancel', start ? command.targetTempC : undefined),
        })
        log().info({ vin: externalId, action: start ? 'start' : 'cancel', command: commandSummary(res) }, 'Renault climate command sent')
        // une COMMANDE déposée, pas un effet : on relit une minute plus tard pour CONSTATER (`hvacStatus`)
        void (async () => {
          await sleep(ctx!.clock, CLIMATE_FOLLOW_UP_MS, ctx!.signal)
          if (!ctx || ctx.signal.aborted) return
          try { await readVehicle(externalId, ctx.signal) }
          catch (err) { log().debug({ err, vin: externalId }, 'Renault follow-up read after a climate command failed') }
        })()
        return
      }
      if (command.type === 'vehicle.climate_set') {
        const id = accountId
        if (!id) throw new PluginError('NEEDS_PAIRING', 'no Kamereon account for this person')
        // les réglages se LISENT d'abord : heure de départ et programmes sont ceux de l'utilisateur
        const settings = await client!.carData({ accountId: id, vin: externalId, endpoint: 'ev/settings', version: 1, adapter: 'kcm', signal: ctx?.signal })
        const body = climateSettingsPayload(settings, command, ctx!.clock.now())
        if (!body) throw new PluginError('UPSTREAM_ERROR', 'Renault gave no EV settings back to rewrite')
        const res = await client!.writeEvSettings({ accountId: id, vin: externalId, body, signal: ctx?.signal })
        const seats = Object.fromEntries(Object.entries(command.seatHeat ?? {}).filter(([, v]) => v !== undefined))
        if (Object.keys(seats).length) lastSeats.set(externalId, { ...lastSeats.get(externalId), ...seats })
        ctx!.emitState(externalId, {
          ...(command.targetTempC !== undefined ? { climateTargetC: command.targetTempC } : {}),
          ...(Object.keys(seats).length ? { seatHeat: lastSeats.get(externalId) } : {}),
          ...(command.steeringWheelHeat !== undefined ? { steeringWheelHeat: command.steeringWheelHeat } : {}),
        })
        log().info({ vin: externalId, command: commandSummary(res) }, 'Renault climate settings written')
        return
      }
      if (command.type === 'vehicle.start_charge') {
        const id = accountId
        if (!id) throw new PluginError('NEEDS_PAIRING', 'no Kamereon account for this person')
        // les réglages se LISENT d'abord : seuls les programmes de charge actifs changent (cf. `chargeStartPayload`)
        const settings = await client!.carData({ accountId: id, vin: externalId, endpoint: 'ev/settings', version: 1, adapter: 'kcm', signal: ctx?.signal })
        const now = ctx!.clock.now()
        const payload = chargeStartPayload(settings, now)
        if (!payload) throw new PluginError('UPSTREAM_ERROR', 'Renault gave no EV settings back to rewrite')
        let res: unknown
        try { res = await client!.writeEvSettings({ accountId: id, vin: externalId, body: payload.body, signal: ctx?.signal }) }
        catch (err) {
          // une commande de réglages déjà en attente (409) : pas une panne, mais rien n'est parti
          if (isDeferred(err)) throw new PluginError('RATE_LIMITED', 'a Renault settings command is already pending for this vehicle: try again in a few minutes', { cause: err })
          throw err
        }
        // c'est aussi une écriture de réglages : le réveil de charge ne doit pas en reposter une derrière (409)
        lastWake.set(externalId, now)
        log().info({ vin: externalId, deactivatedPrograms: payload.deactivated, command: commandSummary(res) }, 'Renault charge start sent')
        // une COMMANDE déposée, pas un effet : on relit une minute plus tard pour CONSTATER la charge
        void (async () => {
          await sleep(ctx!.clock, CLIMATE_FOLLOW_UP_MS, ctx!.signal)
          if (!ctx || ctx.signal.aborted) return
          try { await readVehicle(externalId, ctx.signal) }
          catch (err) { log().debug({ err, vin: externalId }, 'Renault follow-up read after a charge start failed') }
        })()
        return
      }
      if (command.type === 'vehicle.stop_charge') {
        // le serveur arrête la BORNE à la place (`meta.vehicle.stopViaCharger`) ; on n'arrive ici que
        // s'il n'en a trouvé aucune, unique, en train de charger à la maison
        throw new PluginError('UNSUPPORTED_COMMAND', 'this Renault cannot stop its charge remotely, and no single charger is charging it at home: stop it from the charger')
      }
      if (command.type !== 'vehicle.refresh') {
        throw new PluginError('UNSUPPORTED_COMMAND', `Renault plugin does not support ${command.type} yet`)
      }
      await readVehicle(externalId, ctx?.signal)
    },

    async stop(): Promise<void> {
      poller?.stop()
      poller = null
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/status', async () => status())

      /**
       * Relier le compte. Le mot de passe ne vit que le temps de cette requête : il n'est ni gardé,
       * ni journalisé, ni renvoyé. Ce qui en sort est un `login_token` dans le fichier de session.
       */
      app.post<{ Body: { email?: string; password?: string } }>('/login', async (req, reply) => {
        const body = z.object({ email: z.string().trim().min(1), password: z.string().min(1) }).safeParse(req.body)
        if (!body.success) return reply.code(400).send({ error: 'email and password are required' })
        try {
          await auth!.login(body.data.email, body.data.password, ctx?.signal)
          accountId = null
          accounts = []
          await listVehicles(ctx?.signal)
          lastError = null
          log().info({ vehicles: links.length }, 'Renault account linked')
          return status()
        } catch (err) {
          lastError = (err as Error).message
          const code = err instanceof PluginError && err.code === 'NEEDS_PAIRING' ? 401 : 502
          return reply.code(code).send({ error: lastError })
        }
      })

      /** Délier : le jeton de session est effacé, rien d'autre n'a jamais été gardé. */
      app.post('/logout', async () => {
        await auth!.forget()
        accountId = null
        accounts = []
        links = []
        return status()
      })

      /**
       * Relevé brut, à capturer dès le compte lié : c'est lui qui décidera le mappage et les
       * fixtures. Chaque lecture est tentée séparément et son échec est RENDU plutôt que levé —
       * savoir ce que le véhicule refuse vaut autant que savoir ce qu'il donne.
       */
      app.get('/raw', async (_req, reply) => {
        if (!auth?.linked) return reply.code(409).send({ error: 'no Renault account linked' })
        try {
          const id = accountId ?? await resolveAccount(ctx?.signal)
          if (!id) return reply.code(409).send({ error: 'no Kamereon account found for this person' })
          const vehicles = await listVehicles(ctx?.signal)
          const readings: unknown[] = []
          const details: unknown[] = []
          for (const link of vehicles) {
            try { details.push({ vin: link.vin, ok: true, body: await client!.vehicleDetails(id, link.vin, ctx?.signal) }) }
            catch (err) { details.push({ vin: link.vin, ok: false, error: (err as Error).message }) }
            for (const probe of PROBE_ENDPOINTS) {
              const path = carDataPath({ accountId: id, vin: link.vin, ...probe })
              try {
                readings.push({ vin: link.vin, ...probe, ok: true, body: await client!.carData({ accountId: id, vin: link.vin, ...probe, signal: ctx?.signal }) })
              } catch (err) {
                readings.push({ vin: link.vin, ...probe, ok: false, unavailable: isEndpointUnavailable(err), error: (err as Error).message, path })
              }
            }
          }
          return { accountId: id, accounts, vehicles, details, readings }
        } catch (err) {
          lastError = (err as Error).message
          return reply.code(502).send({ error: lastError })
        }
      })
    },

    health(): PluginHealth {
      const keys = ['RENAULT_COUNTRY', 'RENAULT_ACCOUNT_ID', 'RENAULT_SESSION_FILE', 'RENAULT_POLL_MS', 'RENAULT_RATE_PER_HOUR']
      if (!auth?.linked) return { status: 'needs_pairing', detail: 'no MY Renault account linked', keys, deviceCount: 0 }
      if (lastError) return { status: 'degraded', detail: lastError, keys, deviceCount: links.length }
      // « lecture seule » n'est plus vrai quand le reveil de charge est coche : il ECRIT dans la
      // voiture. La sante doit le dire, c'est la seule ligne ou l'utilisateur peut s'en apercevoir.
      const wake = ctx?.parts[CHARGE_WAKE]
        ? `charge wake-up ${config!.RENAULT_WAKE_FROM}-${config!.RENAULT_WAKE_TO}`
        : 'read-only'
      return { status: 'ok', detail: `${links.length} vehicle(s) · ${wake}`, keys, deviceCount: links.length }
    },
  }
}
