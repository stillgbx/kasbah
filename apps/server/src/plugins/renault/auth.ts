import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { gigyaAccountInfoSchema, gigyaJwtSchema, gigyaLoginSchema, gigyaResponseSchema } from './types'
import { writeFileAtomic } from '../../core/atomic-file'

// Authentification Renault — Gigya (SAP Customer Data Cloud), celle de l'appli MY Renault.
//
// Il n'y a PAS d'OAuth : le seul moyen d'entrer est l'identifiant et le mot de passe du compte.
// C'est la première fois dans Kasbah, et la décision prise avec l'utilisateur borne le dégât :
//
//   le mot de passe traverse le serveur UNE fois (POST /api/plugins/renault/login), il n'est
//   jamais écrit sur disque, jamais journalisé, jamais rangé dans une variable d'environnement.
//   Seul survit le `login_token` que Gigya rend en échange — révocable en se déconnectant de
//   l'appli, et qui ne permet pas de changer le mot de passe du compte.
//
// Deux jetons, à ne pas confondre :
//   - le LOGIN TOKEN (`sessionInfo.cookieValue`) : durable, c'est lui qu'on garde ;
//   - le JWT (`accounts.getJWT`) : 15 minutes, c'est lui que Kamereon accepte. Redemandé au besoin.
//
// Piège central : GIGYA RÉPOND TOUJOURS EN HTTP 200. Un mot de passe faux, un jeton périmé, une
// double authentification en attente — tout arrive en 200 avec un `errorCode` dans le corps. Un
// client qui ne regarde que le statut croit avoir réussi à chaque fois.

/**
 * Valeurs par défaut pour `fr_FR`. Elles sont **surchargeables par l'environnement**, et ce n'est
 * pas du zèle : Renault a changé ses clés en mai 2026 et a mis en panne, le même jour, toutes les
 * intégrations tierces qui les avaient en dur. Ici, une clé neuve se pose dans `.env` sans toucher
 * au code ni republier quoi que ce soit.
 */
export const DEFAULT_GIGYA_URL = 'https://accounts.eu1.gigya.com'
export const DEFAULT_GIGYA_API_KEY = '3_VgdkgtIRH3AdHvJm-cjV2ug2EFE0lxt0IJzMC4MFqZjFpn_GYFXVdNZ19L7wZX0N'
export const DEFAULT_KAMEREON_URL = 'https://api-wired-prod-1-euw1.wrd-aws.com'
export const DEFAULT_KAMEREON_API_KEY = 'YjkKtHmGfaceeuExUDKGxrLZGGvtVS0J'

/** Durée demandée pour le JWT (secondes) : le maximum que Gigya accorde ici. */
export const JWT_TTL_S = 900
/** Marge avant l'échéance du JWT au-delà de laquelle on en redemande un d'avance. */
const JWT_MARGIN_MS = 60_000
const REQUEST_TIMEOUT_MS = 20_000

/**
 * Codes Gigya qu'il faut distinguer d'une panne. Tous arrivent en HTTP 200.
 * `403101` mérite son message : un compte avec double authentification ne peut PAS être relié ici,
 * et l'utilisateur doit le savoir tout de suite plutôt que de croire à un mot de passe mal tapé.
 */
const GIGYA_INVALID_CREDENTIALS = 403042
const GIGYA_PENDING_2FA = 403101
const GIGYA_INVALID_TOKEN = 403005

export interface StoredSession {
  /** `sessionInfo.cookieValue` : le jeton durable. Le mot de passe, lui, n'est jamais gardé. */
  loginToken: string
  personId: string
}

const storedSessionSchema = z.object({
  loginToken: z.string().min(1),
  personId: z.string().min(1),
})

export interface SessionStore {
  load(): Promise<StoredSession | null>
  save(session: StoredSession): Promise<void>
  clear(): Promise<void>
}

/**
 * Fichier JSON atomique (`.tmp` puis `rename`), en 0600. Fichier absent ou illisible = pas de
 * session, jamais une erreur fatale : le plugin doit démarrer même si le disque refuse.
 */
export function createSessionFile(path: string, logger?: Logger): SessionStore {
  return {
    async load(): Promise<StoredSession | null> {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return null }
      const parsed = storedSessionSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger?.warn({ path }, 'unreadable Renault session cache, ignoring it'); return null }
      return parsed.data
    },
    async save(session: StoredSession): Promise<void> {
      try { await writeFileAtomic(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, 'could not write Renault session cache') }
    },
    async clear(): Promise<void> {
      try { await writeFileAtomic(path, '{}\n', { mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, 'could not clear Renault session cache') }
    },
  }
}

export interface RenaultAuthOptions {
  gigyaUrl: string
  gigyaApiKey: string
  fetchImpl: FetchLike
  store: SessionStore | null
  now: () => number
  logger?: Logger
  requestTimeoutMs?: number
}

/** Session Gigya : connexion par mot de passe (une fois), puis JWT courts à la demande. */
export class RenaultAuth {
  private session: StoredSession | null = null
  private jwtToken: string | null = null
  private jwtExpiresAt = 0
  /** Un seul renouvellement à la fois : Gigya limite le débit, deux en parallèle sont perdus. */
  private minting: Promise<string> | null = null

  constructor(private readonly opts: RenaultAuthOptions) {}

  get linked(): boolean { return this.session !== null }
  get personId(): string | null { return this.session?.personId ?? null }

  /** Au démarrage : reprend la session du cache s'il y en a une. */
  async restore(): Promise<boolean> {
    this.session = (await this.opts.store?.load()) ?? null
    return this.linked
  }

  /**
   * Relie le compte. Le mot de passe ne sert QUE dans cet appel : il n'est ni gardé en mémoire
   * au-delà, ni écrit, ni journalisé. Ce qui survit est le `login_token` et le `personId`.
   */
  async login(email: string, password: string, signal?: AbortSignal): Promise<StoredSession> {
    const login = await this.gigya('accounts.login', { loginID: email, password }, signal)
    const parsedLogin = gigyaLoginSchema.safeParse(login)
    if (!parsedLogin.success) throw new PluginError('UPSTREAM_ERROR', 'Renault sign-in returned no session token')
    const loginToken = parsedLogin.data.sessionInfo.cookieValue

    const info = await this.gigya('accounts.getAccountInfo', { login_token: loginToken }, signal)
    const parsedInfo = gigyaAccountInfoSchema.safeParse(info)
    if (!parsedInfo.success) throw new PluginError('UPSTREAM_ERROR', 'Renault account has no personId')

    this.session = { loginToken, personId: parsedInfo.data.data.personId }
    this.jwtToken = null
    this.jwtExpiresAt = 0
    await this.opts.store?.save(this.session)
    return this.session
  }

  /** Oublie le compte (l'utilisateur délie, ou Gigya a révoqué la session). */
  async forget(): Promise<void> {
    this.session = null
    this.jwtToken = null
    this.jwtExpiresAt = 0
    await this.opts.store?.clear()
  }

  /** JWT valable pour Kamereon, renouvelé d'avance si l'échéance approche. */
  async jwt(signal?: AbortSignal): Promise<string> {
    if (!this.session) throw new PluginError('NEEDS_PAIRING', 'no Renault account linked: POST /api/plugins/renault/login')
    if (this.jwtToken && this.jwtExpiresAt - this.opts.now() > JWT_MARGIN_MS) return this.jwtToken
    return this.mintJwt(signal)
  }

  /** Renouvelle maintenant (aussi après un 401 de Kamereon : le JWT a pu être révoqué d'avance). */
  mintJwt(signal?: AbortSignal): Promise<string> {
    if (this.minting) return this.minting
    this.minting = (async () => {
      try {
        if (!this.session) throw new PluginError('NEEDS_PAIRING', 'no Renault account linked')
        const res = await this.gigya('accounts.getJWT', {
          login_token: this.session.loginToken,
          fields: 'data.personId,data.gigyaDataCenter',
          expiration: String(JWT_TTL_S),
        }, signal)
        const parsed = gigyaJwtSchema.safeParse(res)
        if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'Renault returned no JWT')
        this.jwtToken = parsed.data.id_token
        this.jwtExpiresAt = this.opts.now() + JWT_TTL_S * 1000
        return this.jwtToken
      } finally { this.minting = null }
    })()
    return this.minting
  }

  /**
   * Un appel Gigya. Le corps est en `application/x-www-form-urlencoded`, la réponse en JSON avec
   * son `errorCode` — c'est lui qu'on interprète, pas le statut HTTP.
   */
  private async gigya(method: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(`${this.opts.gigyaUrl}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ ApiKey: this.opts.gigyaApiKey, ...params }).toString(),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `Renault sign-in server unreachable on ${method}`, { cause: err })
    }
    const text = await res.text()
    const body = ((): unknown => { try { return JSON.parse(text) } catch { return null } })()
    const framed = gigyaResponseSchema.safeParse(body)
    // pas de cadre lisible : ni succès ni échec identifiable, c'est une panne
    if (!framed.success) {
      throw new PluginError('UPSTREAM_ERROR', `unexpected response from Renault sign-in on ${method} (HTTP ${res.status})`)
    }
    if (framed.data.errorCode !== 0) this.throwGigya(method, framed.data)
    return body
  }

  /** Traduit un `errorCode` Gigya. Jamais le mot de passe ni le jeton dans le message. */
  private throwGigya(method: string, r: { errorCode: number; errorMessage?: string | undefined; errorDetails?: string | undefined }): never {
    const detail = [r.errorMessage, r.errorDetails].filter(Boolean).join(' — ')
    if (r.errorCode === GIGYA_PENDING_2FA) {
      throw new PluginError('NEEDS_PAIRING',
        'Renault account requires two-factor authentication, which this plugin cannot complete: disable it in the MY Renault app, or use an account without it')
    }
    if (r.errorCode === GIGYA_INVALID_CREDENTIALS) {
      throw new PluginError('NEEDS_PAIRING', 'Renault refused the e-mail or password')
    }
    // jeton périmé ou révoqué : le compte est à relier, ce n'est pas un incident réseau. La session
    // est jetée ici pour que `health()` dise `needs_pairing` sans attendre le tour suivant.
    if (r.errorCode === GIGYA_INVALID_TOKEN) {
      this.session = null
      this.jwtToken = null
      throw new PluginError('NEEDS_PAIRING', 'Renault session expired: link the account again')
    }
    throw new PluginError('UPSTREAM_ERROR', `Renault sign-in refused ${method} (error ${r.errorCode})${detail ? `: ${detail}` : ''}`)
  }
}
