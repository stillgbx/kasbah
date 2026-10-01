import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { cloudLoginSchema, endpointDiscoverySchema, gigyaLoginSchema, gigyaResponseSchema, storedSessionSchema, type StoredRobot, type StoredSession } from './types'
import { writeFileAtomic } from '../../core/atomic-file'

// Obtention des identifiants LOCAUX d'un robot iRobot — la seule partie du plugin qui touche
// Internet, et elle ne sert qu'une fois.
//
// POURQUOI PASSER PAR LE CLOUD POUR PARLER EN LOCAL. Les Roomba ont longtemps rendu leur mot de
// passe local à qui le demandait sur le réseau : un datagramme magique sur le port 8883, après un
// appui long sur HOME. Sur le Combo du parc (firmware `stingray+24.29.5`, 22/11/2024) ce mécanisme
// RÉPOND ENCORE mais pour refuser — 115 tentatives, toujours `f005efcc3b29`**`03`** là où un robot
// coopératif renvoie le mot de passe. Le robot l'annonce d'ailleurs dans sa découverte : `cap.pw: 0`.
//
// Reste la voie du compte, en trois temps :
//   1. `GET /v1/discover/endpoints` (PUBLIC) → la clé Gigya du moment et la base HTTP du déploiement ;
//   2. `POST accounts.login` chez Gigya → une signature d'identité (UID + signature + horodatage) ;
//   3. `POST {httpBase}/v2/login` → pour chaque robot du compte, son MOT DE PASSE LOCAL.
//
// Ce qui survit : le mot de passe LOCAL de chaque robot, dans le fichier de session en 0600. Le mot
// de passe du COMPTE traverse le serveur le temps de l'étape 2 — jamais écrit, jamais journalisé,
// jamais en variable d'environnement. Même arbitrage que Renault et MELCloud.
//
// Piège commun à Gigya, déjà payé chez Renault : **HTTP 200 même quand il refuse**. C'est
// `errorCode` qui tranche, pas le statut.

export const DEFAULT_DISCOVERY_URL = 'https://disc-prod.iot.irobotapi.com/v1/discover/endpoints'
/**
 * Identifiant d'application de l'appli Android iRobot, attendu tel quel par `/v2/login`. En
 * configuration pour la raison qui a servi chez Renault : le fabricant peut le changer, et une
 * valeur neuve doit se poser dans `.env` sans toucher au code.
 */
export const DEFAULT_APP_ID = 'ANDROID-C7FB240E-DF34-42D7-AE4E-A8C17079A294'
/** L'appli mobile se présente ainsi ; l'endpoint de découverte refuse les clients anonymes. */
export const DEFAULT_USER_AGENT = 'aspen%20production/2618 CFNetwork/1209 Darwin/20.2.0'

const REQUEST_TIMEOUT_MS = 20_000

/** Codes Gigya à distinguer d'une panne. Tous arrivent en HTTP 200. */
const GIGYA_INVALID_CREDENTIALS = 403042
const GIGYA_PENDING_2FA = 403101

export interface SessionStore {
  load(): Promise<StoredSession | null>
  save(session: StoredSession): Promise<void>
  clear(): Promise<void>
}

/**
 * Fichier JSON atomique (`.tmp` puis `rename`) en 0600, comme Renault. Fichier absent ou illisible
 * = pas de session, jamais une erreur fatale : le plugin doit démarrer même si le disque refuse.
 */
export function createSessionFile(path: string, logger?: Logger): SessionStore {
  return {
    async load(): Promise<StoredSession | null> {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return null }
      const parsed = storedSessionSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger?.warn({ path }, 'unreadable iRobot session cache, ignoring it'); return null }
      return parsed.data
    },
    async save(session: StoredSession): Promise<void> {
      try { await writeFileAtomic(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, 'could not write iRobot session cache') }
    },
    async clear(): Promise<void> {
      try { await writeFileAtomic(path, '{"robots":[]}\n', { mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, 'could not clear iRobot session cache') }
    },
  }
}

export interface IrobotAuthOptions {
  discoveryUrl: string
  appId: string
  /** Code pays ISO envoyé à la découverte. Il choisit le centre Gigya, pas le déploiement. */
  country: string
  userAgent: string
  fetchImpl: FetchLike
  store: SessionStore | null
  logger?: Logger
  requestTimeoutMs?: number
}

/** Le compte iRobot : relié une fois, il ne sert plus qu'à retrouver des mots de passe locaux. */
export class IrobotAuth {
  private session: StoredSession | null = null

  constructor(private readonly opts: IrobotAuthOptions) {}

  get linked(): boolean { return (this.session?.robots.length ?? 0) > 0 }
  get robots(): StoredRobot[] { return this.session?.robots ?? [] }
  get linkedAt(): number | null { return this.session?.linkedAt ?? null }

  /** Mot de passe local d'un robot trouvé sur le réseau, ou `null` si le compte ne le connaît pas. */
  passwordFor(blid: string): string | null {
    return this.session?.robots.find((r) => r.blid === blid)?.password ?? null
  }

  /** Au démarrage : reprend les identifiants du fichier s'il y en a. */
  async restore(): Promise<boolean> {
    this.session = (await this.opts.store?.load()) ?? null
    return this.linked
  }

  /**
   * Relie le compte et récupère les mots de passe locaux. Le mot de passe du compte ne sert QUE
   * dans cet appel : ni gardé en mémoire au-delà, ni écrit, ni journalisé.
   */
  async login(email: string, password: string, signal?: AbortSignal): Promise<StoredRobot[]> {
    const { httpBase, gigyaUrl, gigyaApiKey } = await this.discover(signal)

    const gigya = await this.json('Gigya sign-in', `${gigyaUrl}/accounts.login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        apiKey: gigyaApiKey,
        loginID: email,
        password,
        targetEnv: 'mobile',
        format: 'json',
      }).toString(),
    }, signal)

    // le cadre AVANT le contenu : Gigya refuse en HTTP 200
    const framed = gigyaResponseSchema.safeParse(gigya)
    if (framed.success && framed.data.errorCode !== 0) this.throwGigya(framed.data)
    const login = gigyaLoginSchema.safeParse(gigya)
    if (!login.success) throw new PluginError('UPSTREAM_ERROR', 'iRobot sign-in returned no identity signature')

    const cloud = await this.json('iRobot login', `${httpBase}/v2/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app_id: this.opts.appId,
        assume_robot_ownership: 0,
        gigya: {
          signature: login.data.UIDSignature,
          timestamp: login.data.signatureTimestamp,
          uid: login.data.UID,
        },
      }),
    }, signal)

    const parsed = cloudLoginSchema.safeParse(cloud)
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'iRobot account returned no robots')

    const robots: StoredRobot[] = Object.entries(parsed.data.robots).map(([blid, r]) => ({
      blid,
      password: r.password,
      name: r.name ?? null,
      sku: r.sku ?? null,
    }))
    if (robots.length === 0) throw new PluginError('NEEDS_PAIRING', 'this iRobot account has no robot')

    this.session = { robots, linkedAt: Date.now() }
    await this.opts.store?.save(this.session)
    return robots
  }

  /** Délier : les mots de passe locaux sont effacés, rien d'autre n'a jamais été gardé. */
  async forget(): Promise<void> {
    this.session = null
    await this.opts.store?.clear()
  }

  /** Endpoint PUBLIC : la clé Gigya du moment et la base du déploiement courant. */
  private async discover(signal?: AbortSignal): Promise<{ httpBase: string; gigyaUrl: string; gigyaApiKey: string }> {
    const url = `${this.opts.discoveryUrl}?country_code=${encodeURIComponent(this.opts.country)}`
    const body = await this.json('iRobot endpoint discovery', url, { method: 'GET' }, signal)
    const parsed = endpointDiscoverySchema.safeParse(body)
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'iRobot endpoint discovery returned an unexpected shape')
    const deployments = parsed.data.deployments
    const current = parsed.data.current_deployment
    // `current_deployment` désigne le déploiement à utiliser ; à défaut, le dernier déclaré (le plus récent)
    const chosen = (current ? deployments[current] : undefined) ?? Object.values(deployments).at(-1)
    if (!chosen) throw new PluginError('UPSTREAM_ERROR', 'iRobot endpoint discovery listed no deployment')
    return {
      httpBase: chosen.httpBase,
      gigyaUrl: `https://accounts.${parsed.data.gigya.datacenter_domain}`,
      gigyaApiKey: parsed.data.gigya.api_key,
    }
  }

  /** Une requête bornée. Le corps est rendu tel quel : c'est l'appelant qui sait le lire. */
  private async json(what: string, url: string, init: Parameters<FetchLike>[1], signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(url, {
        ...init,
        headers: { 'user-agent': this.opts.userAgent, accept: 'application/json', ...init?.headers },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `${what} unreachable`, { cause: err })
    }
    const text = await res.text()
    const body = ((): unknown => { try { return JSON.parse(text) } catch { return null } })()
    // Gigya refuse en 200 : un statut d'erreur ici est une vraie panne, pas un refus d'identifiants
    if (body === null) throw new PluginError('UPSTREAM_ERROR', `${what} returned no JSON (HTTP ${res.status})`)
    if (res.status >= 400 && !gigyaResponseSchema.safeParse(body).success) {
      throw new PluginError('UPSTREAM_ERROR', `${what} refused the request (HTTP ${res.status})`)
    }
    return body
  }

  /** Traduit un `errorCode` Gigya. Jamais le mot de passe dans le message. */
  private throwGigya(r: { errorCode: number; errorMessage?: string | undefined; errorDetails?: string | undefined }): never {
    if (r.errorCode === GIGYA_PENDING_2FA) {
      throw new PluginError('NEEDS_PAIRING',
        'this iRobot account requires two-factor authentication, which this plugin cannot complete')
    }
    if (r.errorCode === GIGYA_INVALID_CREDENTIALS) {
      throw new PluginError('NEEDS_PAIRING', 'iRobot refused the e-mail or password')
    }
    const detail = [r.errorMessage, r.errorDetails].filter(Boolean).join(' — ')
    throw new PluginError('UPSTREAM_ERROR', `iRobot sign-in refused (error ${r.errorCode})${detail ? `: ${detail}` : ''}`)
  }
}
