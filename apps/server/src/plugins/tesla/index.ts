import { randomBytes } from 'node:crypto'
import type { Command, CommandOf, DeviceDescriptor, PluginHealth, ReleaseNote, StateFor, VehicleFinish, VehicleSeat, VehicleSleepState } from '@kasbah/shared'
import { RELEASE_NOTES_FALLBACK_LANG } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { fetch as undiciFetch } from 'undici'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext, type PluginReleaseNotes } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { sleep } from '../../core/clock'
import type { FetchLike } from '../../core/sse'
import { describeError, sendError } from '../../http/errors'
import {
  PUBLIC_KEY_PATH, REGION_BASE_URLS, TeslaAuth, authorizationUrl, createKeyFile, createTokenFile, ensureKeyPair, generateKeyPair,
  samePublicKey, type KeyPair, type KeyStore, type TeslaRegion, type TokenStore,
} from './auth'
import { TeslaClient } from './client'
import {
  bodyColor, bodyFinish, compareVersions, imagesExpireAt, isResting, notesByVersion, parseReleaseNotes, SEAT_HEATER_INDEX, toDataPatch,
  toDescriptor, toSleepPatch, toSleepState, withoutExpiredImages,
} from './mapping'
import {
  MONTHLY_CREDIT_USD, billableKind, countCall, createStateFile, currentCycle, cycleCostUsd, cycleStart, emptyState,
  type TeslaState, type TeslaStateStore,
} from './state'
import { commandResultSchema, partnerPublicKeySchema, releaseNotesResponseSchema, vehicleDataSchema, vehicleSummarySchema, vehiclesListSchema, type VehicleSummary } from './types'

// Plugin Tesla : véhicules lus par la Fleet API (cloud du fabricant, il n'existe rien en local).
// Lu : charge, autonomie, câble, verrouillage, position, kilométrage, vitesse et rapport, pression
// des pneus, températures, et la VEILLE. Écrit : la limite de charge, seul réglage accepté pour
// l'instant — plus le réveil et la relecture, à la demande.
//
// Trois contraintes du fabricant dictent la forme du plugin :
//
//  1. Une application déclarée sur developer.tesla.com, et un DOMAINE public en HTTPS qui sert la
//     clé publique de l'application (`auth.ts`). Kasbah tourne sur le LAN : la clé publique est
//     générée ici, affichée dans les Réglages, et c'est l'utilisateur qui la pose sur son domaine
//     (un NAS). Le plugin enregistre ensuite le domaine auprès de Tesla et vérifie ce qu'il a lu.
//
//  2. L'API est FACTURÉE à l'usage depuis 2025, avec 10 $ de crédit mensuel par compte : une lecture
//     complète (`vehicle_data`) coûte 1 $ pour 500, un réveil 1 $ pour 50. D'où un budget journalier
//     de lectures (`TESLA_DAILY_DATA_BUDGET`), au-delà duquel on ne lit plus jusqu'au lendemain — sans
//     carte bancaire enregistrée, Tesla coupe de toute façon au bout du crédit.
//
//  3. Le véhicule DORT. Un quart d'heure après s'être garé, il coupe son ordinateur et répond 408 à
//     toute lecture. La liste des véhicules donne sa veille sans le réveiller : on ne lit
//     `vehicle_data` que s'il est éveillé, et jamais on ne le réveille de nous-mêmes (un Model S
//     d'avant 2021 vide sa batterie à rester éveillé). Une fois lu au REPOS — garé, personne à bord,
//     pas en charge — on le laisse tranquille `TESLA_REST_MS`, le temps qu'il s'endorme.
//
// Les fixtures de `__fixtures__/fleet.ts` sont écrites d'après la documentation, faute de compte lié
// au moment d'écrire : `GET /api/plugins/tesla/raw` sert à les remplacer par une vraie capture.

const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()

export const teslaConfigSchema = z.object({
  /** Identifiants de l'application créée sur developer.tesla.com. */
  TESLA_CLIENT_ID: optionalKey,
  TESLA_CLIENT_SECRET: optionalKey,
  /** Domaine (hôte seul) qui sert la clé publique, celui déclaré dans l'application. */
  TESLA_DOMAIN: optionalKey,
  /** Région du compte Tesla : décide la base de l'API. */
  TESLA_REGION: z.enum(['eu', 'na']).default('eu'),
  /** Doit être déclarée telle quelle dans l'application (« Allowed Redirect URI »). */
  TESLA_REDIRECT_URI: z.string().url().default('http://localhost:8787/api/plugins/tesla/auth/callback'),
  /** Où garder les jetons du compte (le refresh token est à usage unique : on le réécrit à chaque tour). */
  TESLA_TOKEN_FILE: z.string().trim().default(stateFile('tesla-token.json')),
  /** Où garder la clé privée de l'application (sa clé publique est celle qu'on pose sur le domaine). */
  TESLA_KEY_FILE: z.string().trim().default(stateFile('tesla-key.json')),
  /**
   * Où garder le DERNIER ÉTAT de chaque véhicule et la consommation du mois (voir `state.ts`). Sans
   * lui, un redémarrage repart d'une carte vide jusqu'à la prochaine lecture — qui peut attendre des
   * heures — et la jauge de quota perd le compte. Chaîne vide = ne rien garder.
   */
  TESLA_STATE_FILE: z.string().trim().default(stateFile('tesla-state.json')),
  /** Cadence de la liste des véhicules (veille) et, quand un véhicule est éveillé, de sa lecture complète. */
  TESLA_POLL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(600_000),
  /** Après une lecture au repos, durée sans relecture : c'est le temps que le véhicule s'endorme. 0 = jamais de repos. */
  TESLA_REST_MS: z.coerce.number().int().min(0).max(7_200_000).default(900_000),
  /** Lectures complètes par jour, au plus (1 $ pour 500 chez Tesla). 0 = aucune lecture, veille seule. */
  TESLA_DAILY_DATA_BUDGET: z.coerce.number().int().min(0).max(10_000).default(100),
})
export type TeslaConfig = z.infer<typeof teslaConfigSchema>

/** Après un réveil demandé, délai avant de relire : le véhicule met quelques secondes à répondre. */
const WAKE_FOLLOW_UP_MS = 15_000
/** Préconditionnement d'une voiture endormie : la veille relue (liste, gratuite) à ce pas, jusqu'à ce plafond. */
const CLIMATE_WAKE_POLL_MS = 5_000
const CLIMATE_WAKE_MAX_MS = 90_000
/**
 * Mise à jour logicielle : relire `UPDATE_FOLLOW_UP_MS` après l'accusé — Tesla fixe LUI-MÊME l'heure
 * d'un « maintenant » (un décompte, vu sur la vraie voiture le 2026-10-02) —, puis
 * `UPDATE_START_GRACE_MS` après l'heure prévue, pour constater que l'installation a démarré.
 */
const UPDATE_FOLLOW_UP_MS = 15_000
const UPDATE_START_GRACE_MS = 60_000
/** Au-delà, pas de minuterie : le sondage ordinaire constatera le démarrage. */
const UPDATE_WATCH_MAX_MS = 6 * 3_600_000
/** Après un démarrage ou un arrêt de charge, délai avant de relire : la borne met 20 s à 1 min à donner du courant. */
const CHARGE_FOLLOW_UP_MS = 60_000
/** Refus passager `could_not_wake_buses` : nouvelles tentatives, au pas de `CLIMATE_WAKE_POLL_MS`. */
const BUSES_RETRIES = 3
/**
 * Le même refus sur la limite de charge : retenté DANS la commande (l'UI attend le résultat, le
 * curseur tient la valeur demandée), donc plus court — 2 essais à 2,5 s tiennent, requêtes comprises,
 * sous le délai d'une commande (`KASBAH_COMMAND_TIMEOUT_MS`, 10 s par défaut).
 */
const LIMIT_BUSES_RETRIES = 2
const LIMIT_BUSES_PAUSE_MS = 2_500
/** Sous ce niveau, Tesla refuse `auto_conditioning_start` (`low_soc`). */
const LOW_SOC_PCT = 20
/** Notes de version relues un jour avant que leurs illustrations (URL signées, ~14 jours) n'expirent. */
const NOTES_REFRESH_BEFORE_MS = 86_400_000
/** Après un échec de lecture des notes, pas de nouvel essai avant : sinon chaque lecture complète le rejouerait. */
const NOTES_RETRY_MS = 6 * 3_600_000
/** Règle de lecture des notes, dans la clé du cache : la changer fait relire les caches une fois. */
const NOTES_RULE = 'language+installed'
/** Langues d'app retenues pour les notes, au plus (l'anglais en plus) : une requête ne peut pas en faire grossir la liste sans fin. */
const NOTES_MAX_LANGS = 4
/** Sections de `vehicle_data` lues. `location_data` est OBLIGATOIRE pour la position depuis le logiciel 2023.38. */
const DATA_ENDPOINTS = ['charge_state', 'drive_state', 'vehicle_state', 'climate_state', 'location_data', 'vehicle_config'].join(';')


/** Ce que la carte des Réglages affiche. Ne porte jamais un secret, ni la clé privée. */
export interface TeslaStatus {
  /** Identifiants de l'application présents en configuration. */
  configured: boolean
  domain: string | null
  region: TeslaRegion
  redirectUri: string
  /** Clé publique à poser sur le domaine, et l'URL exacte où Tesla la lira. */
  publicKeyPem: string | null
  publicKeyUrl: string | null
  /** Dernière vérification de l'enregistrement du domaine ; `undefined` = jamais vérifié. */
  registered: boolean | undefined
  linked: boolean
  vehicles: { vin: string; name: string; sleepState: VehicleSleepState }[]
  budget: { used: number; limit: number }
  pollMs: number
  restMs: number
  tokenFile: string | null
  lastError: string | null
}

export interface TeslaPluginDeps {
  /** Injecté par les tests : toutes les requêtes (serveur d'authentification et API). */
  fetchImpl?: FetchLike
  tokenStore?: TokenStore
  keyStore?: KeyStore
  stateStore?: TeslaStateStore
}

interface VehicleTrack {
  summary: VehicleSummary
  sleepState: VehicleSleepState
  /** Ne pas relire avant (véhicule vu au repos). */
  restUntil: number
  /**
   * Peinture lue dans `vehicle_config` : teinte et aspect. Elle n'est PAS dans la liste des
   * véhicules — elle n'arrive qu'avec une lecture complète, donc le descripteur naît sans peinture
   * et la gagne ensuite.
   */
  paint?: { color?: string; finish?: VehicleFinish }
}

export function createTeslaPlugin(deps: TeslaPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: TeslaConfig | null = null
  let auth: TeslaAuth | null = null
  let client: TeslaClient | null = null
  let keys: KeyPair | null = null
  let keyStore: KeyStore | null = null
  let registered: boolean | undefined
  let lastError: string | null = null
  /** Sondage : un timer reposé après chaque tour, et après chaque lecture manuelle (le délai repart). */
  let polling = false
  let timer: unknown = null
  const vehicles = new Map<string, VehicleTrack>()
  /** `state` émis par /auth/url et attendus au retour : une liaison ne s'accepte que si on l'a lancée. */
  const pendingStates = new Set<string>()
  /** Lectures complètes du jour (date locale du serveur) : c'est ce que le budget borne. */
  let budget = { day: '', used: 0 }
  let budgetWarned = false
  /** Ce qui survit à un redémarrage : dernier état par véhicule, consommation du mois (`state.ts`). */
  let store: TeslaStateStore | null = null
  let saved: TeslaState = emptyState()

  const log = () => ctx!.logger
  /** Écrit le fichier d'état sans faire attendre l'appelant : le perdre n'empêche jamais de lire. */
  const persist = () => { void store?.save(saved) }
  const fetchImpl: FetchLike = deps.fetchImpl
    ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
  const configured = () => !!(config?.TESLA_CLIENT_ID && config.TESLA_CLIENT_SECRET)
  const publicKeyUrl = () => (config?.TESLA_DOMAIN ? `https://${config.TESLA_DOMAIN}${PUBLIC_KEY_PATH}` : null)

  function status(): TeslaStatus {
    return {
      configured: configured(),
      domain: config?.TESLA_DOMAIN ?? null,
      region: config?.TESLA_REGION ?? 'eu',
      redirectUri: config?.TESLA_REDIRECT_URI ?? '',
      publicKeyPem: keys?.publicPem ?? null,
      publicKeyUrl: publicKeyUrl(),
      registered,
      linked: !!auth?.linked,
      vehicles: [...vehicles.values()].map((v) => ({ vin: v.summary.vin, name: toDescriptor(v.summary).name, sleepState: v.sleepState })),
      budget: { used: budgetUsedToday(), limit: config?.TESLA_DAILY_DATA_BUDGET ?? 0 },
      pollMs: config?.TESLA_POLL_MS ?? 0,
      restMs: config?.TESLA_REST_MS ?? 0,
      tokenFile: config?.TESLA_TOKEN_FILE || null,
      lastError,
    }
  }

  // ---- budget -------------------------------------------------------------------------------

  const today = () => new Date(ctx!.clock.now()).toDateString()
  function budgetUsedToday(): number {
    if (!ctx) return 0
    if (budget.day !== today()) { budget = { day: today(), used: 0 }; budgetWarned = false }
    return budget.used
  }
  /** Réserve une lecture ; `false` quand le budget du jour est épuisé (journalisé une fois par jour). */
  function takeBudget(): boolean {
    const used = budgetUsedToday()
    if (used >= config!.TESLA_DAILY_DATA_BUDGET) {
      if (!budgetWarned) {
        log().warn({ used, limit: config!.TESLA_DAILY_DATA_BUDGET }, 'Tesla daily vehicle_data budget spent: only sleep state until tomorrow')
        budgetWarned = true
      }
      return false
    }
    budget.used = used + 1
    return true
  }

  // ---- lectures -----------------------------------------------------------------------------

  const descriptors = (): DeviceDescriptor[] => [...vehicles.values()].map((v) => toDescriptor(v.summary, v.paint))
  const vins = () => [...vehicles.keys()].sort().join(',')

  /** Liste des véhicules : la veille de chacun, sans le réveiller. Valide véhicule par véhicule. */
  async function listVehicles(): Promise<VehicleSummary[]> {
    const raw = vehiclesListSchema.parse(await client!.request('GET', '/api/1/vehicles', { signal: ctx!.signal }))
    const out: VehicleSummary[] = []
    for (const item of raw.response) {
      const parsed = vehicleSummarySchema.safeParse(item)
      if (parsed.success) out.push(parsed.data)
      else log().warn({ issues: parsed.error.issues }, 'Tesla vehicle entry has an unexpected shape, skipping it')
    }
    return out
  }

  /**
   * Met la liste à jour et republie les descripteurs si un véhicule apparaît ou disparaît.
   * `emit: false` pendant `discover` : c'est la valeur de retour qui compte alors, pas une émission.
   */
  function adoptList(list: VehicleSummary[], emit = true): void {
    const before = vins()
    const seen = new Set<string>()
    for (const s of list) {
      seen.add(s.vin)
      const track = vehicles.get(s.vin)
      const paint = saved.paints[s.vin]
      if (track) {
        track.summary = s
        // redémarrage : la piste renaît sans peinture, le fichier d'état la rend
        if (!track.paint && paint) track.paint = paint
      } else {
        vehicles.set(s.vin, {
          summary: s, sleepState: toSleepState(s.state), restUntil: 0,
          ...(paint ? { paint } : {}),
        })
      }
    }
    for (const vin of [...vehicles.keys()]) if (!seen.has(vin)) vehicles.delete(vin)
    if (vins() !== before && emit) {
      log().info({ vehicles: vehicles.size }, 'Tesla vehicle list changed')
      ctx!.emitDevices(descriptors())
    }
  }

  /** Lecture complète d'UN véhicule, comptée au budget. Lève `DEVICE_UNAVAILABLE` s'il dort. */
  async function readVehicle(vin: string): Promise<void> {
    const track = vehicles.get(vin)
    if (!track) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Tesla vehicle ${vin}`)
    const path = `/api/1/vehicles/${encodeURIComponent(vin)}/vehicle_data?endpoints=${encodeURIComponent(DATA_ENDPOINTS)}`
    const data = vehicleDataSchema.parse(await client!.request('GET', path, { signal: ctx!.signal })).response
    const patch = { ...toDataPatch(data), readAt: ctx!.clock.now() }
    ctx!.emitState(vin, patch)
    // gardé pour le prochain démarrage : la carte retrouve ces valeurs au lieu de repartir vide
    saved.vehicles[vin] = { ...saved.vehicles[vin], ...patch } as Record<string, unknown>
    track.sleepState = toSleepState(data.state)
    // La peinture n'arrive qu'ici, et elle peut CHANGER sans qu'on y soit pour rien : le « Coloriseur »
    // de l'écran de bord choisit couleur ET aspect. On republie alors le descripteur —
    // c'est le seul moment où il bouge sans que la liste des véhicules ait bougé.
    const paint = { color: bodyColor(data), finish: bodyFinish(data) }
    if (paint.color || paint.finish) {
      const changed = paint.color !== track.paint?.color || paint.finish !== track.paint?.finish
      track.paint = paint
      saved.paints[vin] = paint
      if (changed) ctx!.emitDevices(descriptors())
    }
    persist()
    // la voiture est éveillée, c'est le moment : notes de version relues si une version a changé
    void refreshNotes(vin)
    watchUpdateStart(vin)
    // au repos : on le laisse s'endormir, la prochaine lecture attendra
    track.restUntil = isResting(data) && config!.TESLA_REST_MS > 0 ? ctx!.clock.now() + config!.TESLA_REST_MS : 0
    // une lecture, d'où qu'elle vienne (sondage, réveil, rafraîchissement demandé), remet le compteur
    // du sondage à zéro : relire dix minutes après la dernière lecture, pas selon un calendrier fixe
    if (polling) scheduleNext(config!.TESLA_POLL_MS)
  }

  async function poll(): Promise<void> {
    const now = ctx!.clock.now()
    adoptList(await listVehicles())
    for (const track of vehicles.values()) {
      const vin = track.summary.vin
      track.sleepState = toSleepState(track.summary.state)
      ctx!.emitState(vin, toSleepPatch(track.summary))
      if (track.sleepState !== 'online') { track.restUntil = 0; continue }
      if (track.restUntil > now) continue
      if (!takeBudget()) continue
      try {
        await readVehicle(vin)
      } catch (err) {
        // endormi entre la liste et la lecture : réponse normale, pas un incident
        if (err instanceof PluginError && err.code === 'DEVICE_UNAVAILABLE') {
          track.sleepState = 'asleep'
          ctx!.emitState(vin, { sleepState: 'asleep' })
          continue
        }
        throw err
      }
    }
    lastError = null
  }

  /**
   * Sondage maison plutôt que `createPoller` : il faut pouvoir REPOSER le timer après une lecture
   * manuelle. Un échec ne fait pas de backoff serré — l'API est facturée, dix minutes plus tard suffit.
   */
  function scheduleNext(ms: number): void {
    if (timer !== null) ctx!.clock.clearTimeout(timer)
    timer = ctx!.clock.setTimeout(() => { timer = null; void runPoll() }, ms)
  }
  let failing = false
  async function runPoll(): Promise<void> {
    if (!polling || ctx!.signal.aborted) return
    try {
      await poll()
      if (failing) log().info('Tesla polling recovered')
      failing = false
    } catch (err) {
      lastError = (err as Error).message
      const l = failing ? log().debug.bind(log()) : log().warn.bind(log())
      l({ err }, 'Tesla poll failed')
      failing = true
    }
    if (polling) scheduleNext(config!.TESLA_POLL_MS)
  }
  function startPolling(): void {
    if (polling || !auth?.linked) return
    polling = true
    void runPoll()
  }

  // ---- climatisation ------------------------------------------------------------------------

  /** Une commande REST, refusée en HTTP 200 par `result: false` (cf. la limite de charge). */
  async function vehicleCommand(vin: string, name: string, body?: unknown): Promise<void> {
    const res = commandResultSchema.parse(await client!.request(
      'POST', `/api/1/vehicles/${encodeURIComponent(vin)}/command/${name}`, { body, signal: ctx!.signal },
    ))
    if (res.response?.result !== true) {
      const reason = res.response?.reason
      throw new PluginError('UPSTREAM_ERROR', `Tesla refused ${name}${reason ? `: ${reason}` : ''}`)
    }
  }

  /** La consigne d'abord (même valeur des deux côtés), puis la marche ou l'arrêt ; l'état suit sans relecture. */
  async function climateCommand(vin: string, command: CommandOf<'vehicle.climate_start'> | CommandOf<'vehicle.climate_stop'>): Promise<void> {
    if (command.type === 'vehicle.climate_stop') {
      await vehicleCommand(vin, 'auto_conditioning_stop')
      ctx!.emitState(vin, { climateOn: false })
      log().info({ vin }, 'Tesla climate stopped')
      return
    }
    if (command.targetTempC !== undefined) {
      await vehicleCommand(vin, 'set_temps', { driver_temp: command.targetTempC, passenger_temp: command.targetTempC })
    }
    try {
      // Sous 20 %, Tesla refuse (`low_soc`). Son appli fait confirmer puis force ; l'API REST, NON :
      // le proxy officiel (vehicle-command, `pkg/proxy/command.go`) ne lit aucun `manual_override`
      // pour `auto_conditioning_start` (seulement keeper / max / bioweapon), et l'envoyer quand même
      // était ignoré — constaté sur la vraie voiture le 2026-10-01
      await vehicleCommand(vin, 'auto_conditioning_start')
    } catch (err) {
      if (err instanceof PluginError && err.message.endsWith(': low_soc')) {
        throw new PluginError('LOW_BATTERY', 'Tesla refuses to start the climate on a low battery (low_soc)')
      }
      throw err
    }
    ctx!.emitState(vin, { climateOn: true, ...(command.targetTempC !== undefined ? { climateTargetC: command.targetTempC } : {}) })
    log().info({ vin, targetTempC: command.targetTempC }, 'Tesla climate started')
  }

  /**
   * Régler consigne, sièges et volant d'une voiture ÉVEILLÉE — jamais de réveil pour un réglage,
   * comme pour la limite de charge (endormie : 408, `DEVICE_UNAVAILABLE`). Une commande par réglage,
   * l'état publié au fil des accusés : un refus au milieu laisse la carte juste sur ce qui est passé.
   */
  async function setClimate(vin: string, command: CommandOf<'vehicle.climate_set'>): Promise<void> {
    if (command.targetTempC !== undefined) {
      await vehicleCommand(vin, 'set_temps', { driver_temp: command.targetTempC, passenger_temp: command.targetTempC })
      ctx!.emitState(vin, { climateTargetC: command.targetTempC })
    }
    // la fusion de l'état est SUPERFICIELLE : `seatHeat` se publie entier, à partir du dernier connu
    const last = (saved.vehicles[vin] ??= {}) as { seatHeat?: Partial<Record<VehicleSeat, number>> }
    for (const [seat, level] of Object.entries(command.seatHeat ?? {}) as [VehicleSeat, number | undefined][]) {
      if (level === undefined) continue
      await vehicleCommand(vin, 'remote_seat_heater_request', { heater: SEAT_HEATER_INDEX[seat], level })
      last.seatHeat = { ...last.seatHeat, [seat]: level }
      ctx!.emitState(vin, { seatHeat: last.seatHeat })
    }
    if (command.steeringWheelHeat !== undefined) {
      await vehicleCommand(vin, 'remote_steering_wheel_heater_request', { on: command.steeringWheelHeat })
      ctx!.emitState(vin, { steeringWheelHeat: command.steeringWheelHeat })
    }
    log().info({ vin, command }, 'Tesla climate settings changed')
  }

  /**
   * Préconditionner. Éveillée, la commande part tout de suite. Endormie — le cas normal d'un matin —,
   * on la RÉVEILLE : c'est l'objet même de la commande, et l'utilisateur l'a voulu ainsi (accord du
   * 2026-10-01, y compris depuis une automatisation). Le réveil met une dizaine de secondes, bien plus
   * que le délai d'une commande : `execute` rend la main à l'accusé du réveil, la suite tourne derrière
   * (veille relue par la liste, gratuite, toutes les `CLIMATE_WAKE_POLL_MS`), puis une lecture
   * complète CONSTATE l'effet. Un échec en arrière-plan se lit dans le journal du serveur.
   */
  async function startClimate(vin: string, command: CommandOf<'vehicle.climate_start'>): Promise<void> {
    const track = vehicles.get(vin)!
    // le refus `low_soc` est CONNU d'avance : sous le seuil, on refuse AVANT de payer un réveil, qui
    // serait suivi d'un refus que personne ne verrait (il arrive en arrière-plan)
    const soc = saved.vehicles[vin]?.soc
    if (typeof soc === 'number' && soc < LOW_SOC_PCT) {
      throw new PluginError('LOW_BATTERY', `battery at ${soc} %, below Tesla's ${LOW_SOC_PCT} % climate threshold (low_soc)`)
    }
    if (track.sleepState === 'online') {
      try { await climateCommand(vin, command); return }
      catch (err) { if (!(err instanceof PluginError && err.code === 'DEVICE_UNAVAILABLE')) throw err }
    }
    await wakeThen(vin, 'start its climate', () => climateCommand(vin, command), WAKE_FOLLOW_UP_MS)
  }

  /**
   * Réveiller, puis lancer `run` dès que la liste (gratuite) dit la voiture en ligne, et la relire
   * `followUpMs` plus tard pour CONSTATER l'effet. `execute` rend la main à l'accusé du réveil : la
   * suite tourne derrière, et son échec se lit dans le journal du serveur.
   */
  async function wakeThen(vin: string, what: string, run: () => Promise<void>, followUpMs: number): Promise<void> {
    await client!.request('POST', `/api/1/vehicles/${encodeURIComponent(vin)}/wake_up`, { signal: ctx!.signal })
    log().info({ vin }, `Tesla vehicle woken to ${what}`)
    vehicles.get(vin)!.restUntil = 0
    void (async () => {
      const deadline = ctx!.clock.now() + CLIMATE_WAKE_MAX_MS
      try {
        while (ctx!.clock.now() < deadline) {
          await sleep(ctx!.clock, CLIMATE_WAKE_POLL_MS, ctx!.signal)
          if (ctx!.signal.aborted) return
          adoptList(await listVehicles())
          const t = vehicles.get(vin)
          if (!t) return
          t.sleepState = toSleepState(t.summary.state)
          ctx!.emitState(vin, toSleepPatch(t.summary))
          if (t.sleepState !== 'online') continue
          await run()
          await sleep(ctx!.clock, followUpMs, ctx!.signal)
          if (!ctx!.signal.aborted && takeBudget()) await readVehicle(vin)
          return
        }
        log().warn({ vin, waitedMs: CLIMATE_WAKE_MAX_MS }, `Tesla vehicle did not wake up: could not ${what}`)
      } catch (err) {
        if (!ctx!.signal.aborted) log().warn({ err, vin }, `Tesla could not ${what} after wake`)
      }
    })()
  }

  // ---- charge -------------------------------------------------------------------------------

  /**
   * `charge_start` / `charge_stop`, non signés comme la limite de charge. Déjà dans l'état voulu
   * (`is_charging`, `not_charging`) n'est pas un échec. `charging` n'est PAS publié sur l'accusé : la
   * voiture accepte avant que le courant coule (la borne met 20 s à 1 min, constaté le 2026-10-01),
   * c'est une relecture `CHARGE_FOLLOW_UP_MS` plus tard qui le constate.
   */
  async function chargeCommand(vin: string, start: boolean): Promise<void> {
    try { await vehicleCommand(vin, start ? 'charge_start' : 'charge_stop') }
    catch (err) {
      if (!(err instanceof PluginError && err.message.endsWith(start ? ': is_charging' : ': not_charging'))) throw err
    }
    log().info({ vin }, start ? 'Tesla charge started' : 'Tesla charge stopped')
  }

  /**
   * Lancer ou arrêter la charge. Débranchée d'après le dernier état connu : refusé AVANT tout réveil.
   * Endormie, l'arrêt n'a rien à faire (une voiture qui charge ne dort pas) ; le démarrage, lui, la
   * RÉVEILLE, comme la climatisation : c'est un geste de l'utilisateur ou d'une règle qu'il a écrite.
   */
  async function charge(vin: string, start: boolean): Promise<void> {
    const track = vehicles.get(vin)!
    if (start && saved.vehicles[vin]?.pluggedIn === false) throw new PluginError('DEVICE_UNAVAILABLE', 'vehicle not plugged in')
    if (track.sleepState !== 'online') {
      if (!start) { ctx!.emitState(vin, { charging: false }); return }
      await wakeThen(vin, 'start charging', () => chargeCommand(vin, true), CHARGE_FOLLOW_UP_MS)
      return
    }
    try { await chargeCommand(vin, start) }
    catch (err) {
      if (start && err instanceof PluginError && err.code === 'DEVICE_UNAVAILABLE') {
        await wakeThen(vin, 'start charging', () => chargeCommand(vin, true), CHARGE_FOLLOW_UP_MS)
        return
      }
      // « en ligne » d'après la liste, mais ses bus internes dorment encore : refus PASSAGER, constaté
      // sur la vraie voiture le 2026-10-01 juste après la borne forcée. On retente derrière.
      if (!(err instanceof PluginError && err.message.endsWith(': could_not_wake_buses'))) throw err
      log().info({ vin }, 'Tesla buses still asleep: retrying the charge command')
      void retryThenFollowUp(vin, start)
      return
    }
    if (!start) ctx!.emitState(vin, { charging: false })
    void followUp(vin)
  }

  async function retryThenFollowUp(vin: string, start: boolean): Promise<void> {
    for (let attempt = 1; attempt <= BUSES_RETRIES; attempt++) {
      await sleep(ctx!.clock, CLIMATE_WAKE_POLL_MS, ctx!.signal)
      if (ctx!.signal.aborted) return
      try {
        await chargeCommand(vin, start)
        if (!start) ctx!.emitState(vin, { charging: false })
        break
      } catch (err) {
        if (!(err instanceof PluginError && err.message.endsWith(': could_not_wake_buses')) || attempt === BUSES_RETRIES) {
          log().warn({ err, vin }, 'Tesla charge command failed after retries')
          break
        }
      }
    }
    await followUp(vin)
  }

  /** Relire `CHARGE_FOLLOW_UP_MS` plus tard : c'est la lecture qui dit si le courant coule. */
  async function followUp(vin: string): Promise<void> {
    await sleep(ctx!.clock, CHARGE_FOLLOW_UP_MS, ctx!.signal)
    if (ctx!.signal.aborted || !takeBudget()) return
    try { await readVehicle(vin) }
    catch (err) { log().debug({ err, vin }, 'Tesla charge follow-up read failed') }
  }

  // ---- logiciel : notes de version et mise à jour ---------------------------------------------

  type SoftwareUpdate = NonNullable<StateFor<'vehicle'>['softwareUpdate']>
  const lastSoftware = (vin: string) => saved.vehicles[vin] as { softwareVersion?: string; softwareUpdate?: SoftwareUpdate | null } | undefined
  /** Lecture des notes en vol, par VIN : deux lectures complètes rapprochées n'en lancent qu'une. */
  const notesInFlight = new Set<string>()
  /** Pas de nouvel essai avant cette date (ms epoch), par VIN, après un échec. */
  const notesRetryAt = new Map<string, number>()

  /**
   * Relire les notes de version — UNIQUEMENT quand la version installée ou celle en attente a changé
   * depuis la dernière lecture, ou quand leurs illustrations vont expirer. Appelé après une lecture
   * complète (voiture éveillée), sans la faire attendre : un échec ne coûte qu'un message de journal,
   * et la prochaine lecture retentera.
   */
  async function refreshNotes(vin: string): Promise<void> {
    const installed = lastSoftware(vin)?.softwareVersion
    if (!installed || notesInFlight.has(vin)) return
    if ((notesRetryAt.get(vin) ?? 0) > ctx!.clock.now()) return
    notesInFlight.add(vin)
    try {
      // l'anglais d'abord : c'est le repli, et la référence qui dit si Tesla publie l'autre langue
      for (const lang of [RELEASE_NOTES_FALLBACK_LANG, ...saved.releaseNotesLangs.filter((l) => l !== RELEASE_NOTES_FALLBACK_LANG)]) {
        await refreshNotesIn(vin, lang)
      }
    } catch (err) {
      if (ctx!.signal.aborted) return
      notesRetryAt.set(vin, ctx!.clock.now() + NOTES_RETRY_MS)
      log().warn({ err, vin }, 'could not read Tesla release notes')
    } finally {
      notesInFlight.delete(vin)
    }
  }

  /**
   * Les notes d'UNE langue, demandée à Tesla par le paramètre `language` (deux lettres). Essayé sur la
   * vraie voiture le 2026-10-02 : `language=fr` rend le français de l'appli Tesla (« Cartes de sites
   * Superchargeur ») ; `Accept-Language`, `locale=fr_FR` et `locale=fr-FR` sont ignorés (anglais).
   * Rien n'est traduit ici : si Tesla rend les mêmes textes qu'en anglais, il ne publie pas cette
   * langue (`ignored`), et on sert l'anglais.
   */
  async function refreshNotesIn(vin: string, lang: string): Promise<void> {
    const last = lastSoftware(vin)
    const installed = last?.softwareVersion
    if (!installed) return
    const staged = last.softwareUpdate?.version
    // la clé dit aussi COMMENT on a lu : façon de demander (`language=` ; `Accept-Language` est ignoré
    // par Tesla) et règle de tri (`NOTES_RULE`). Un cache lu autrement est relu une fois
    const key = `${NOTES_RULE}|${installed}|${staged ?? ''}`
    const byLang = (saved.releaseNotes[vin] ??= {})
    const cache = byLang[lang]
    if (cache?.key === key && (cache.expiresAt === undefined || cache.expiresAt - NOTES_REFRESH_BEFORE_MS > ctx!.clock.now())) return
    {
      const base = `/api/1/vehicles/${encodeURIComponent(vin)}/release_notes`
      const current = releaseNotesResponseSchema.parse(await client!.request('GET', `${base}?language=${lang}`, { signal: ctx!.signal })).response
      // l'historique : ce que Tesla montre lui-même dans « Notes de mise à jour » (`show_in_history`),
      // PLUS les nouveautés de la version installée — que Tesla rend en `show_in_history: false` juste
      // après l'installation (relevé du 2026-10-02, 2026.38) —, sans l'entrée générique d'une version
      // mineure (« Minor Fixes », `is_fallback`). Ajouté à ce qu'on gardait : Tesla ne remonte pas avant
      // la dernière grosse mise à jour
      const deployed = current.deployed_version ?? installed
      const shown = notesByVersion(parseReleaseNotes(current.release_notes).filter((e) =>
        e.show_in_history !== false || (e.customer_version === deployed && e.is_fallback !== true)))
      let pending: { version: string; notes: ReleaseNote[] } | undefined
      if (staged) {
        const next = releaseNotesResponseSchema.parse(await client!.request('GET', `${base}?staged=true&language=${lang}`, { signal: ctx!.signal })).response
        // la réponse « en attente » mêle d'anciennes notes : seules celles de la version attendue comptent
        const notes = notesByVersion(parseReleaseNotes(next.release_notes))[staged]
        if (notes?.length) pending = { version: staged, notes }
      }
      const fetched = [...Object.values(shown).flat(), ...(pending?.notes ?? [])]
      const expiresAt = imagesExpireAt(fetched)
      // mêmes titres qu'en anglais, lus à l'instant : Tesla ignore la langue demandée
      const en = byLang[RELEASE_NOTES_FALLBACK_LANG]
      const enTitles = new Set([...Object.values(en?.history ?? {}).flat(), ...(en?.pending?.notes ?? [])].map((n) => n.title))
      const ignored = lang !== RELEASE_NOTES_FALLBACK_LANG && fetched.length > 0 && fetched.every((n) => enTitles.has(n.title))
      byLang[lang] = {
        key, fetchedAt: ctx!.clock.now(), history: { ...cache?.history, ...shown },
        installedVersion: current.deployed_version ?? installed,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(pending ? { pending } : {}),
        ...(ignored ? { ignored } : {}),
      }
      persist()
      log().info({ vin, lang, installed, staged, ignored, versions: Object.keys(byLang[lang].history).length }, 'Tesla release notes read')
    }
  }

  /** Le cache, tel quel : jamais d'appel ici. Les notes en attente ne valent que pour la version encore attendue. */
  function releaseNotesOf(vin: string, wanted: string): PluginReleaseNotes {
    const byLang = saved.releaseNotes[vin] ?? {}
    const own = byLang[wanted]
    const lang = own && !own.ignored ? wanted : RELEASE_NOTES_FALLBACK_LANG
    const cache = byLang[lang]
    const last = lastSoftware(vin)
    const now = ctx!.clock.now()
    const clean = (notes: ReleaseNote[]) => notes.map((n) => withoutExpiredImages(n, now))
    const installedVersion = last?.softwareVersion ?? cache?.installedVersion
    const pending = cache?.pending && cache.pending.version === last?.softwareUpdate?.version ? cache.pending : undefined
    return {
      ...(cache ? { lang } : {}),
      ...(installedVersion ? { installedVersion } : {}),
      ...(pending ? { pending: { version: pending.version, notes: clean(pending.notes) } } : {}),
      history: Object.entries(cache?.history ?? {})
        .sort(([a], [b]) => compareVersions(b, a))
        .map(([version, notes]) => ({ version, notes: clean(notes) })),
      ...(cache ? { fetchedAt: cache.fetchedAt } : {}),
    }
  }

  /**
   * Programmer ou annuler l'installation d'une mise à jour DÉJÀ téléchargée. Voiture éveillée
   * seulement (jamais de réveil implicite pour un réglage, comme la limite de charge), et refusé
   * d'avance quand rien n'est prêt : Tesla n'installe pas ce qu'il n'a pas fini de télécharger.
   * L'état suit l'accusé, sans relecture (facturée) : la prochaine lecture le confirmera.
   */
  /** Une lecture prévue par VIN pour constater le démarrage d'une installation programmée. */
  const updateWatch = new Map<string, unknown>()
  function clearUpdateWatch(vin: string): void {
    const t = updateWatch.get(vin)
    if (t !== undefined) ctx!.clock.clearTimeout(t)
    updateWatch.delete(vin)
  }
  /** Lire `delayMs` plus tard (comptée au budget) ; une voiture endormie entre-temps ne coûte qu'un journal. */
  function readLater(vin: string, delayMs: number): unknown {
    return ctx!.clock.setTimeout(() => {
      updateWatch.delete(vin)
      if (ctx!.signal.aborted || !vehicles.has(vin) || !takeBudget()) return
      readVehicle(vin).catch((err) => log().debug({ err, vin }, 'Tesla software update follow-up read failed'))
    }, delayMs)
  }
  /**
   * Installation programmée : une lecture juste après l'heure prévue, pour la voir DÉMARRER (sinon la
   * voiture vue au repos ne serait relue qu'après `TESLA_REST_MS`, et la carte annoncerait une heure
   * passée). Pendant l'installation, `isResting` est faux : chaque tour du sondage relit.
   */
  function watchUpdateStart(vin: string): void {
    clearUpdateWatch(vin)
    const su = lastSoftware(vin)?.softwareUpdate
    if (su?.status !== 'scheduled' || su.scheduledAt === undefined) return
    const delay = su.scheduledAt - ctx!.clock.now() + UPDATE_START_GRACE_MS
    if (delay <= 0 || delay > UPDATE_WATCH_MAX_MS) return
    updateWatch.set(vin, readLater(vin, delay))
  }

  async function softwareCommand(vin: string, command: CommandOf<'vehicle.schedule_update'> | CommandOf<'vehicle.cancel_update'>): Promise<void> {
    if (vehicles.get(vin)!.sleepState !== 'online') throw new PluginError('DEVICE_UNAVAILABLE', 'vehicle is asleep: wake it first')
    const last = lastSoftware(vin)?.softwareUpdate ?? undefined
    let next: SoftwareUpdate
    if (command.type === 'vehicle.schedule_update') {
      if (last?.status !== 'available' && last?.status !== 'scheduled') {
        throw new PluginError('DEVICE_UNAVAILABLE', `no downloaded software update to install${last ? ` (${last.status})` : ''}`)
      }
      await vehicleCommand(vin, 'schedule_software_update', { offset_sec: command.delayS })
      next = { ...last, status: 'scheduled', scheduledAt: ctx!.clock.now() + command.delayS * 1000 }
      log().info({ vin, version: last.version, delayS: command.delayS }, 'Tesla software update scheduled')
    } else {
      // rien de programmé : rien à annuler, et rien à payer
      if (last?.status !== 'scheduled') return
      await vehicleCommand(vin, 'cancel_software_update')
      const { scheduledAt: _dropped, ...rest } = last
      next = { ...rest, status: 'available' }
      log().info({ vin, version: last.version }, 'Tesla software update cancelled')
    }
    ctx!.emitState(vin, { softwareUpdate: next })
    saved.vehicles[vin] = { ...saved.vehicles[vin], softwareUpdate: next }
    persist()
    // l'heure publiée est la NÔTRE ; Tesla fixe la sienne (décompte d'un « maintenant ») : on la relit.
    // Annulé, plus rien à surveiller
    clearUpdateWatch(vin)
    if (command.type === 'vehicle.schedule_update') updateWatch.set(vin, readLater(vin, UPDATE_FOLLOW_UP_MS))
  }

  // ---- enregistrement du domaine ------------------------------------------------------------

  /**
   * Tesla a-t-il lu NOTRE clé publique sur le domaine ? Il la rend en POINT EC hexadécimal (`04…`),
   * pas en PEM (`samePublicKey` accepte les deux). Réenregistrer le domaine avec une clé changée
   * MET À JOUR ce que Tesla tient (`updated_at` bouge) : une rotation se rattrape ainsi.
   */
  async function verifyRegistration(partnerToken: string): Promise<boolean> {
    const raw = await client!.partnerRequest('GET', `/api/1/partner_accounts/public_key?domain=${encodeURIComponent(config!.TESLA_DOMAIN!)}`, partnerToken, { signal: ctx!.signal })
    const served = partnerPublicKeySchema.parse(raw).response?.public_key
    registered = !!served && !!keys && samePublicKey(served, keys.publicPem)
    return registered
  }

  return {
    id: 'tesla',
    configSchema: teslaConfigSchema,

    async init(context) {
      ctx = context
      config = context.config as TeslaConfig
      // la paire de clés ne dépend de rien : générée dès le premier démarrage, la carte des Réglages
      // peut afficher la clé publique à poser sur le domaine avant même que l'application existe
      keyStore = deps.keyStore ?? (config.TESLA_KEY_FILE ? createKeyFile(config.TESLA_KEY_FILE, context.logger) : null)
      if (keyStore) keys = await ensureKeyPair(keyStore, context.logger)

      if (!configured()) {
        log().warn('Tesla application not configured: set TESLA_CLIENT_ID, TESLA_CLIENT_SECRET and TESLA_DOMAIN')
        return
      }
      store = deps.stateStore ?? (config.TESLA_STATE_FILE ? createStateFile(config.TESLA_STATE_FILE, context.logger) : null)
      saved = (await store?.load()) ?? emptyState()
      if (saved.cycle) log().info({ month: saved.cycle.month, usd: cycleCostUsd(saved.cycle) }, 'Tesla usage of the current billing cycle restored')

      const tokens = deps.tokenStore ?? (config.TESLA_TOKEN_FILE ? createTokenFile(config.TESLA_TOKEN_FILE, context.logger) : null)
      auth = new TeslaAuth({
        clientId: config.TESLA_CLIENT_ID!, clientSecret: config.TESLA_CLIENT_SECRET!, redirectUri: config.TESLA_REDIRECT_URI,
        region: config.TESLA_REGION, fetchImpl, store: tokens, now: () => context.clock.now(), logger: context.logger,
      })
      client = new TeslaClient({
        baseUrl: REGION_BASE_URLS[config.TESLA_REGION], auth, fetchImpl, logger: context.logger,
        onCall: (path) => {
          const kind = billableKind(path)
          if (!kind) return
          countCall(saved, kind, context.clock.now())
          persist()
        },
      })
      if (await auth.restore()) log().info('Tesla account tokens restored from cache')
      else log().warn('no Tesla account linked: open the Settings card (GET /api/plugins/tesla/auth/url)')
    },

    /** Sans compte, rien à publier : la carte des Réglages dit quoi faire. */
    async discover(): Promise<DeviceDescriptor[]> {
      if (!auth?.linked) return []
      try {
        adoptList(await listVehicles(), false)
        log().info({ vehicles: vehicles.size }, 'Tesla vehicles listed')
      } catch (err) {
        lastError = (err as Error).message
        log().warn({ err }, 'could not list Tesla vehicles')
      }
      return descriptors()
    },

    async start() {
      // les dernières valeurs connues AVANT toute lecture : sinon la carte reste vide (« Jamais lu »)
      // jusqu'à ce que la voiture se réveille, ce qui peut prendre des heures
      for (const [vin, patch] of Object.entries(saved.vehicles)) {
        if (vehicles.has(vin)) ctx!.emitState(vin, patch as never)
      }
      startPolling()
    },

    async execute(externalId, command: Command) {
      if (!client) throw new PluginError('NEEDS_PAIRING', 'Tesla plugin not configured')
      if (!vehicles.has(externalId)) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Tesla vehicle ${externalId}`)
      if (command.type === 'vehicle.refresh') {
        // relire MAINTENANT : la liste d'abord (le véhicule a pu s'endormir depuis l'affichage), puis la
        // lecture complète s'il est éveillé, comptée au budget. Endormi, on ne le réveille pas : c'est
        // l'autre bouton, et il coûte dix fois plus
        adoptList(await listVehicles())
        const track = vehicles.get(externalId)!
        track.sleepState = toSleepState(track.summary.state)
        ctx!.emitState(externalId, toSleepPatch(track.summary))
        if (track.sleepState !== 'online') return
        if (!takeBudget()) throw new PluginError('RATE_LIMITED', `Tesla daily vehicle_data budget spent (${config!.TESLA_DAILY_DATA_BUDGET}): try again tomorrow`)
        try { await readVehicle(externalId) }
        catch (err) {
          if (err instanceof PluginError && err.code === 'DEVICE_UNAVAILABLE') { track.sleepState = 'asleep'; ctx!.emitState(externalId, { sleepState: 'asleep' }); return }
          throw err
        }
        return
      }
      /**
       * Régler la limite de charge. Une COMMANDE coûte 0,001 $ — dix fois moins qu'une lecture — mais
       * exige la voiture ÉVEILLÉE : endormie, Tesla répond 408, et c'est le bouton « Réveiller »,
       * payant et explicite, qui la ramène. Jamais de réveil implicite pour un réglage.
       *
       * La cible est publiée TOUT DE SUITE : sans relecture (facturée, et la voiture peut se rendormir
       * dans la minute), c'est notre écho qui tient la carte à jour jusqu'au prochain tour.
       */
      if (command.type === 'vehicle.set_charge_limit') {
        // « en ligne » d'après la liste, mais ses bus internes dorment encore : refus PASSAGER, vu sur
        // la vraie voiture le 2026-10-01 (la première limite réglée échouait, la suivante passait)
        for (let attempt = 0; ; attempt++) {
          const body = commandResultSchema.parse(await client.request(
            'POST', `/api/1/vehicles/${encodeURIComponent(externalId)}/command/set_charge_limit`,
            { body: { percent: command.percent }, signal: ctx!.signal },
          ))
          if (body.response?.result === true) break
          const reason = body.response?.reason
          if (reason === 'could_not_wake_buses' && attempt < LIMIT_BUSES_RETRIES) {
            log().info({ vin: externalId }, 'Tesla buses still asleep: retrying the charge limit')
            await sleep(ctx!.clock, LIMIT_BUSES_PAUSE_MS, ctx!.signal)
            continue
          }
          throw new PluginError('UPSTREAM_ERROR', `Tesla refused the charge limit${reason ? `: ${reason}` : ''}`)
        }
        ctx!.emitState(externalId, { chargeLimit: command.percent })
        log().info({ vin: externalId, percent: command.percent }, 'Tesla charge limit set')
        return
      }
      if (command.type === 'vehicle.climate_stop') {
        // endormie, la voiture n'a pas sa clim en marche : rien à arrêter, et surtout rien à réveiller
        if (vehicles.get(externalId)!.sleepState !== 'online') { ctx!.emitState(externalId, { climateOn: false }); return }
        await climateCommand(externalId, command)
        return
      }
      if (command.type === 'vehicle.climate_set') {
        await setClimate(externalId, command)
        return
      }
      if (command.type === 'vehicle.climate_start') {
        await startClimate(externalId, command)
        return
      }
      if (command.type === 'vehicle.start_charge' || command.type === 'vehicle.stop_charge') {
        await charge(externalId, command.type === 'vehicle.start_charge')
        return
      }
      if (command.type === 'vehicle.schedule_update' || command.type === 'vehicle.cancel_update') {
        await softwareCommand(externalId, command)
        return
      }
      if (command.type !== 'vehicle.wake') {
        throw new PluginError('UNSUPPORTED_COMMAND', `Tesla plugin does not support ${command.type} yet`)
      }
      // un réveil coûte dix lectures chez Tesla, et c'est un GESTE de l'utilisateur : jamais automatique
      await client.request('POST', `/api/1/vehicles/${encodeURIComponent(externalId)}/wake_up`, { signal: ctx!.signal })
      log().info({ vin: externalId }, 'Tesla vehicle wake requested')
      const track = vehicles.get(externalId)!
      track.restUntil = 0
      // relecture différée : c'est pour VOIR le véhicule qu'on l'a réveillé
      void (async () => {
        await sleep(ctx!.clock, WAKE_FOLLOW_UP_MS, ctx!.signal)
        if (ctx!.signal.aborted || !takeBudget()) return
        try { await readVehicle(externalId) }
        catch (err) { log().debug({ err, vin: externalId }, 'vehicle still asleep after wake') }
      })()
    },

    async stop() {
      persist()
      if (ctx) for (const vin of [...updateWatch.keys()]) clearUpdateWatch(vin)
      polling = false
      if (timer !== null && ctx) ctx.clock.clearTimeout(timer)
      timer = null
      client = null
      auth = null
      vehicles.clear()
      pendingStates.clear()
    },

    registerRoutes(app: FastifyInstance) {
      // Où en est la mise en route, pour la carte des Réglages. Jamais un secret.
      app.get('/status', async () => status())

      // La clé publique de l'application, telle qu'elle doit être servie sur le domaine.
      app.get('/public-key', async (_req, reply) => {
        if (!keys) return sendError(reply, 409, 'NEEDS_PAIRING', 'no key pair yet (TESLA_KEY_FILE is empty?)')
        return reply.type('application/x-pem-file').send(keys.publicPem)
      })

      /**
       * Nouvelle paire de clés. Tesla n'accepte une clé publique que pour UNE application : recréer
       * l'application (autre compte développeur) rend l'ancienne clé inutilisable. Après rotation, la
       * clé publique est à REPOSER sur le domaine, puis le domaine à réenregistrer.
       */
      app.post('/public-key/rotate', async (_req, reply) => {
        if (!keyStore) return sendError(reply, 409, 'NEEDS_PAIRING', 'no key store (TESLA_KEY_FILE is empty)')
        const pair = generateKeyPair()
        await keyStore.save(pair.privatePem)
        keys = pair
        registered = undefined
        lastError = null
        log().warn('Tesla application key pair rotated: publish the new public key on the domain, then register again')
        return status()
      })

      /**
       * Enregistre le domaine auprès de Tesla (jeton partenaire), puis vérifie ce que Tesla a lu de
       * la clé publique. À faire une fois la clé posée sur le domaine ; à refaire si elle change.
       */
      app.post('/register', async (_req, reply) => {
        if (!client || !auth) return sendError(reply, 409, 'NEEDS_PAIRING', 'set TESLA_CLIENT_ID and TESLA_CLIENT_SECRET first')
        if (!config!.TESLA_DOMAIN) return sendError(reply, 409, 'NEEDS_PAIRING', 'set TESLA_DOMAIN: the domain that serves the public key')
        try {
          const token = await auth.partnerToken(ctx!.signal)
          // vérifier d'abord : un domaine déjà enregistré avec CETTE clé n'a rien à refaire, et Tesla
          // refuse d'ailleurs de le réenregistrer (422 « Public key hash has already been taken »,
          // constaté sur le vrai compte). Ce 422-là veut donc dire « déjà fait », pas « raté ».
          // la vérification elle-même peut être refusée (403 « This account does not have access to
          // <domaine> » sur le vrai compte, alors que l'API de la région répond) : ce n'est pas une
          // preuve de non-enregistrement, on la tente sans en dépendre
          let taken: string | null = null
          const verify = () => verifyRegistration(token).catch((err) => { log().warn({ err }, 'could not verify the Tesla registration'); return undefined })
          if ((await verify()) !== true) {
            let alreadyTaken: string | null = null
            try {
              await client.partnerRequest('POST', '/api/1/partner_accounts', token, { body: { domain: config!.TESLA_DOMAIN }, signal: ctx!.signal })
            } catch (err) {
              const m = /(Domain|Public key hash) has already been taken/i.exec((err as Error).message)
              if (!m) throw err
              alreadyTaken = m[0]
              log().info({ domain: config!.TESLA_DOMAIN, reason: alreadyTaken }, 'Tesla says the registration already exists')
            }
            // Tesla connaît la clé (422) et ne peut pas nous dire laquelle il sert : on le croit
            if ((await verify()) === undefined) registered = alreadyTaken ? true : undefined
            taken = alreadyTaken
          }
          lastError = registered ? null : `Tesla did not read our public key at ${publicKeyUrl()}`
          log().info({ domain: config!.TESLA_DOMAIN, registered }, 'Tesla partner account registered')
          // un compte lié avant l'enregistrement n'avait pas pu lister ses véhicules : maintenant si.
          // Et c'est la VRAIE épreuve de l'enregistrement : un 412 « must be registered » après un
          // 422 « key already taken » veut dire que la clé est enregistrée par une AUTRE application
          // (constaté : application recréée sous un second compte, même clé). Il faut alors une
          // nouvelle paire de clés (`POST /public-key/rotate`), à reposer sur le domaine.
          if (auth.linked) {
            try { adoptList(await listVehicles()); ctx!.emitDevices(descriptors()); startPolling() }
            catch (err) {
              const msg = (err as Error).message
              if (/must be registered/i.test(msg)) {
                // « déjà pris » + « pas enregistré » = pris par une AUTRE application (autre client id).
                // Constaté : application recréée sous un second compte développeur, même domaine — un
                // domaine n'appartient qu'à UNE application. La clé, elle, se change ; le domaine, non.
                registered = false
                lastError = /Domain/i.test(taken ?? '')
                  ? `Tesla refuses this application in region ${config!.TESLA_REGION}: the domain ${config!.TESLA_DOMAIN} is registered by ANOTHER application (another client id). Reuse that application's TESLA_CLIENT_ID / TESLA_CLIENT_SECRET (any Tesla account can then consent), or delete it on developer.tesla.com, then register again`
                  : `Tesla refuses this application in region ${config!.TESLA_REGION}: the public key is registered by another application. Generate a new key (POST /api/plugins/tesla/public-key/rotate), publish it on ${publicKeyUrl()}, then register again`
              } else lastError = msg
              log().warn({ err }, 'Tesla vehicle list still failing after registration')
            }
          }
        } catch (err) {
          lastError = (err as Error).message
          const d = describeError(err)
          return sendError(reply, d.status, d.code, d.message)
        }
        return status()
      })

      // Lien à ouvrir dans un navigateur pour lier le compte Tesla à l'application.
      app.get('/auth/url', async (_req, reply) => {
        if (!auth) return sendError(reply, 409, 'NEEDS_PAIRING', 'set TESLA_CLIENT_ID and TESLA_CLIENT_SECRET first')
        const state = randomBytes(16).toString('hex')
        pendingStates.add(state)
        return { url: authorizationUrl({ clientId: config!.TESLA_CLIENT_ID!, redirectUri: config!.TESLA_REDIRECT_URI, state }), redirectUri: config!.TESLA_REDIRECT_URI }
      })

      // Retour de Tesla après consentement : le code devient des jetons, gardés par le serveur.
      app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>('/auth/callback', async (req, reply) => {
        if (!auth) return sendError(reply, 409, 'NEEDS_PAIRING', 'plugin not configured')
        const { code, state, error } = req.query
        if (error) return sendError(reply, 400, 'OAUTH_DENIED', `Tesla returned "${error}"${req.query.error_description ? `: ${req.query.error_description}` : ''}`)
        if (!state || !pendingStates.has(state)) return sendError(reply, 400, 'INVALID_STATE', 'unknown or missing state: start again from /auth/url')
        if (!code) return sendError(reply, 400, 'INVALID_BODY', 'missing code')
        pendingStates.delete(state)
        try {
          await auth.exchangeCode(code, ctx!.signal)
        } catch (err) {
          lastError = (err as Error).message
          const d = describeError(err)
          return sendError(reply, d.status, d.code, d.message)
        }
        // le compte est lié et ses jetons gardés : ce qui suit peut échouer sans défaire la liaison
        // (constaté : 412 « must be registered in the current region » quand l'application n'est
        // pas encore enregistrée pour CE compte — le sondage réessaiera, l'enregistrement se fait
        // depuis la carte)
        let listError: string | null = null
        try {
          adoptList(await listVehicles())
          ctx!.emitDevices(descriptors())
          lastError = null
        } catch (err) {
          listError = (err as Error).message
          lastError = listError
          log().warn({ err }, 'Tesla account linked but the vehicle list failed')
        }
        startPolling()
        log().info({ vehicles: vehicles.size }, 'Tesla account linked')
        return reply.type('text/html; charset=utf-8').send(linkedPage(descriptors().map((d) => d.name), !!config!.TESLA_TOKEN_FILE, listError))
      })

      /**
       * Recale le compteur du mois sur la CONSOLE du fabricant, qui seule facture. L'estimation dérive
       * forcément : catégories tarifaires non publiées, arrondis, et appels faits hors de Kasbah (une
       * autre application tierce partage le même crédit). Corps : `{ data, wakes, commands }` — la
       * DATE ne se recale pas : le cycle commence le 1er du mois, la console le dit aussi.
       */
      app.post('/usage', async (req, reply) => {
        if (!ctx) return sendError(reply, 409, 'NEEDS_PAIRING', 'plugin not started')
        const body = z.object({
          data: z.number().int().min(0), wakes: z.number().int().min(0), commands: z.number().int().min(0),
        }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'send { data, wakes, commands }')
        const cycle = currentCycle(saved, ctx.clock.now())
        saved.cycle = { ...cycle, ...body.data }
        persist()
        log().info({ cycle: saved.cycle, usd: cycleCostUsd(saved.cycle) }, 'Tesla usage realigned on the vendor console')
        return { cycle: saved.cycle, estimatedUsd: cycleCostUsd(saved.cycle) }
      })

      /**
       * Relevé BRUT : la liste, puis `vehicle_data` de chaque véhicule ÉVEILLÉ. Pour écrire les fixtures d'après de vraies réponses. Chaque lecture est facturée et comptée au budget ; un
       * véhicule endormi n'est PAS réveillé, il figure avec son 408.
       */
      app.get('/raw', async (_req, reply) => {
        if (!client || !auth?.linked) return sendError(reply, 409, 'NEEDS_PAIRING', 'link the Tesla account first')
        const out: Record<string, unknown> = {}
        try {
          // dans quelle région Tesla range ce compte : une liste VIDE vient souvent d'une base d'API qui
          // n'est pas la bonne (`/users/me`, lui, exige la portée `user_data` qu'on ne demande pas)
          try { out['/api/1/users/region'] = await client.request('GET', '/api/1/users/region', { signal: ctx!.signal }) }
          catch (err) { out['/api/1/users/region'] = { error: (err as Error).message } }
          const list = await client.request('GET', '/api/1/vehicles', { signal: ctx!.signal })
          out['/api/1/vehicles'] = list
          for (const item of vehiclesListSchema.parse(list).response) {
            const v = vehicleSummarySchema.safeParse(item)
            if (!v.success || toSleepState(v.data.state) !== 'online') continue
            const path = `/api/1/vehicles/${v.data.vin}/vehicle_data?endpoints=${encodeURIComponent(DATA_ENDPOINTS)}`
            if (!takeBudget()) { out[path] = { skipped: 'daily budget spent' }; continue }
            try { out[path] = await client.request('GET', path, { signal: ctx!.signal }) }
            catch (err) { out[path] = { error: (err as Error).message } }
            // notes de version : documentées sans format ni paramètres ; `staged=true` (cité par la
            // communauté) viserait la version EN ATTENTE. Capturées ici pour en tirer le schéma
            for (const notes of [`/api/1/vehicles/${v.data.vin}/release_notes`, `/api/1/vehicles/${v.data.vin}/release_notes?staged=true`]) {
              try { out[notes] = await client.request('GET', notes, { signal: ctx!.signal }) }
              catch (err) { out[notes] = { error: (err as Error).message } }
            }
          }
        } catch (err) {
          const d = describeError(err)
          return sendError(reply, d.status, d.code, d.message)
        }
        return out
      })
    },

    async releaseNotes(externalId, lang) {
      const track = vehicles.get(externalId)
      if (!track) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Tesla vehicle ${externalId}`)
      // une langue jamais demandée : retenue pour les prochaines lectures (l'anglais est servi d'ici là),
      // et lue tout de suite si la voiture est éveillée — jamais de réveil pour des notes
      if (lang !== RELEASE_NOTES_FALLBACK_LANG && !saved.releaseNotesLangs.includes(lang) && saved.releaseNotesLangs.length < NOTES_MAX_LANGS) {
        saved.releaseNotesLangs = [...saved.releaseNotesLangs, lang]
        persist()
        if (track.sleepState === 'online') void refreshNotes(externalId)
      }
      return releaseNotesOf(externalId, lang)
    },

    health(): PluginHealth {
      const keysList = ['TESLA_CLIENT_ID', 'TESLA_CLIENT_SECRET', 'TESLA_DOMAIN', 'TESLA_REGION', 'TESLA_REDIRECT_URI', 'TESLA_TOKEN_FILE', 'TESLA_KEY_FILE', 'TESLA_STATE_FILE', 'TESLA_POLL_MS', 'TESLA_REST_MS', 'TESLA_DAILY_DATA_BUDGET']
      if (!configured()) return { status: 'needs_pairing', detail: 'set TESLA_CLIENT_ID, TESLA_CLIENT_SECRET and TESLA_DOMAIN, then follow the Settings card', keys: keysList }
      if (!auth?.linked) return { status: 'needs_pairing', detail: lastError ?? 'link the Tesla account from Settings', keys: keysList }
      const deviceCount = vehicles.size
      const asleep = [...vehicles.values()].filter((v) => v.sleepState !== 'online').length
      const used = budgetUsedToday()
      const limit = config!.TESLA_DAILY_DATA_BUDGET
      const parc = `${deviceCount} véhicule(s), ${asleep} en veille · ${used}/${limit} lectures aujourd'hui`
      // Le quota publié pour l'UI est le CRÉDIT MENSUEL du fabricant (10 $, cycle calendaire), pas le
      // budget journalier que le plugin s'impose : c'est celui-là qu'on ne veut pas dépasser, et c'est
      // ce que l'utilisateur veut voir. Une ESTIMATION, calculée sur les prix affichés : seul Tesla
      // facture, et sa console reste la référence.
      const cycle = currentCycle(saved, ctx!.clock.now())
      const quota = {
        quota: {
          used: cycleCostUsd(cycle), limit: MONTHLY_CREDIT_USD,
          labelKey: 'vehicle.quotaCredit', unit: 'usd' as const, since: cycleStart(cycle.month),
        },
      }
      if (registered === false) return { status: 'degraded', detail: `domain ${config!.TESLA_DOMAIN} not registered with Tesla · ${parc}`, keys: keysList, deviceCount, ...quota }
      if (lastError) return { status: 'degraded', detail: lastError, keys: keysList, deviceCount, ...quota }
      return { status: 'ok', detail: parc, keys: keysList, deviceCount, ...quota }
    },
  }
}

function linkedPage(names: string[], kept: boolean, listError: string | null): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  return `<!doctype html><meta charset="utf-8"><title>Kasbah · Tesla</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#222}.warn{color:#a35a00}</style>
<h1>Compte Tesla lié</h1>
${listError
    ? `<p class="warn">La liste des véhicules a échoué : ${esc(listError)}.<br>Si Tesla demande d’enregistrer l’application dans la région, faites « Enregistrer le domaine » dans la carte Tesla des Réglages ; le compte reste lié.</p>`
    : `<p>${names.length} véhicule(s) : ${names.map(esc).join(', ') || 'aucun pour l’instant'}.</p>`}
<p>${kept ? 'Le serveur garde les jetons : il n’y a rien à recopier, la liaison survit aux redémarrages.' : 'Aucun fichier de jetons n’est configuré (TESLA_TOKEN_FILE est vide) : la liaison sera perdue au redémarrage du serveur.'}</p>
<p>Vous pouvez fermer cet onglet.</p>`
}
