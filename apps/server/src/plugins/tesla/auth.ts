import { generateKeyPairSync, createPublicKey } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { tokenResponseSchema } from './types'
import { writeFileAtomic } from '../../core/atomic-file'

// Identité et jetons de la Fleet API Tesla. Trois choses distinctes vivent ici :
//
//  1. La PAIRE DE CLÉS de l'application. Tesla exige qu'une clé publique EC (courbe P-256) soit
//     servie sur le domaine de l'application (`/.well-known/appspecific/com.tesla.3p.public-key.pem`)
//     avant tout appel : c'est sa preuve de propriété du domaine. La clé privée reste sur ce serveur
//     et n'a, en phase 1, rien à signer (un Model S d'avant 2021 accepte les commandes non signées) ;
//     elle est générée ici pour que la clé publique existe, et gardée pour la suite.
//  2. Le jeton PARTENAIRE (`client_credentials`) : il ne représente personne, sert à enregistrer le
//     domaine auprès de Tesla et à vérifier ce qu'il a lu de la clé publique. Jamais mis en cache.
//  3. Le jeton du COMPTE (code d'autorisation puis rafraîchissement). Le refresh token est À USAGE
//     UNIQUE : chaque rafraîchissement en rend un nouveau qu'il faut sauver aussitôt, sinon le
//     suivant échoue et il faut relier le compte. D'où le cache fichier écrit à chaque tour.

export const AUTHORIZE_URL = 'https://auth.tesla.com/oauth2/v3/authorize'
export const TOKEN_URL = 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token'

/** Base de l'API par région : le compte Tesla vit dans l'une d'elles, et `audience` doit la nommer. */
export const REGION_BASE_URLS = {
  eu: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
  na: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
} as const
export type TeslaRegion = keyof typeof REGION_BASE_URLS

/**
 * Portées demandées au compte. Les commandes y sont déjà (lecture seule en phase 1, mais relier le
 * compte une seconde fois pour un bouton « Verrouiller » n'aurait pas de sens). `offline_access`
 * est ce qui donne le refresh token.
 */
export const ACCOUNT_SCOPES = ['openid', 'offline_access', 'vehicle_device_data', 'vehicle_location', 'vehicle_cmds', 'vehicle_charging_cmds'] as const
/** Portées du jeton partenaire : pas d'`offline_access`, il ne représente aucun compte. */
export const PARTNER_SCOPES = ['openid', 'vehicle_device_data', 'vehicle_cmds', 'vehicle_charging_cmds'] as const

/** Chemin, sur le domaine de l'application, où Tesla va lire la clé publique. */
export const PUBLIC_KEY_PATH = '/.well-known/appspecific/com.tesla.3p.public-key.pem'

/** Marge avant l'échéance de l'access token au-delà de laquelle on le rafraîchit d'avance. */
const REFRESH_MARGIN_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 20_000

export function authorizationUrl(o: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    response_type: 'code', client_id: o.clientId, redirect_uri: o.redirectUri,
    scope: ACCOUNT_SCOPES.join(' '), state: o.state,
    // Tesla redemande les portées que l'utilisateur aurait décochées, plutôt que d'échouer en silence plus tard
    prompt_missing_scopes: 'true',
  })
  return `${AUTHORIZE_URL}?${q.toString()}`
}

// ---- Paire de clés ---------------------------------------------------------------------------

export interface KeyPair { privatePem: string; publicPem: string }

export interface KeyStore {
  load(): Promise<string | null>
  save(privatePem: string): Promise<void>
}

/** Clé publique (SPKI, PEM) dérivée d'une clé privée PEM. */
export function publicKeyOf(privatePem: string): string {
  return createPublicKey(privatePem).export({ type: 'spki', format: 'pem' }).toString()
}

/**
 * Le POINT de la courbe, non compressé, en hexadécimal : `04` puis X puis Y (65 octets, 130 hex).
 * C'est SOUS CETTE FORME que Tesla rend la clé enregistrée (`partner_accounts.public_key`), et non
 * en PEM — constaté sur le vrai compte, où une comparaison de PEM donnait toujours « pas la nôtre ».
 */
export function publicKeyPointHex(publicPem: string): string {
  const jwk = createPublicKey(publicPem).export({ format: 'jwk' }) as { x?: string; y?: string }
  const hex = (b64url: string) => Buffer.from(b64url, 'base64url').toString('hex').padStart(64, '0')
  return `04${hex(jwk.x ?? '')}${hex(jwk.y ?? '')}`
}

/** La clé rendue par Tesla est-elle la nôtre ? Accepte le point hex, le PEM, ou le base64 sans armure. */
export function samePublicKey(served: string, publicPem: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '')
  const s = norm(served)
  return s.toLowerCase() === publicKeyPointHex(publicPem)
    || s === norm(publicPem)
    || s === norm(publicPem.replace(/-----[A-Z ]+-----/g, ''))
}

/** Une nouvelle paire EC P-256 (`prime256v1`, celle que Tesla exige). */
export function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

/** Relit la clé privée du cache, ou en génère une et la garde. La clé publique en découle toujours. */
export async function ensureKeyPair(store: KeyStore, logger?: Logger): Promise<KeyPair> {
  const existing = await store.load()
  if (existing) {
    try { return { privatePem: existing, publicPem: publicKeyOf(existing) } }
    catch (err) { logger?.warn({ err }, 'unreadable Tesla private key, generating a new one') }
  }
  const pair = generateKeyPair()
  await store.save(pair.privatePem)
  logger?.info('generated a new Tesla application key pair')
  return pair
}

// ---- Jetons du compte ----------------------------------------------------------------------

export interface StoredTokens {
  refreshToken: string
  accessToken?: string | undefined
  /** Échéance de l'access token (ms epoch). */
  accessExpiresAt?: number | undefined
}
export interface TokenStore {
  load(): Promise<StoredTokens | null>
  save(tokens: StoredTokens): Promise<void>
}

const storedTokensSchema = z.object({
  refreshToken: z.string().min(1),
  accessToken: z.string().min(1).optional(),
  accessExpiresAt: z.number().optional(),
})

/**
 * Fichier JSON atomique (`.tmp` puis `rename`) partagé par les deux caches du plugin. Fichier absent
 * ou illisible = vide, jamais une erreur fatale : le plugin doit démarrer même si le disque refuse.
 */
function jsonFile<T>(path: string, schema: z.ZodType<T>, what: string, logger?: Logger) {
  return {
    async load(): Promise<T | null> {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return null }
      const parsed = schema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger?.warn({ path }, `unreadable Tesla ${what} cache, ignoring it`); return null }
      return parsed.data
    },
    async save(value: T): Promise<void> {
      try { await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, `could not write Tesla ${what} cache`) }
    },
  }
}

export function createTokenFile(path: string, logger?: Logger): TokenStore {
  return jsonFile(path, storedTokensSchema, 'token', logger)
}

export function createKeyFile(path: string, logger?: Logger): KeyStore {
  const file = jsonFile(path, z.object({ privateKeyPem: z.string().min(1) }), 'key', logger)
  return {
    load: async () => (await file.load())?.privateKeyPem ?? null,
    save: (privateKeyPem) => file.save({ privateKeyPem }),
  }
}

export interface TeslaAuthOptions {
  clientId: string
  clientSecret: string
  redirectUri: string
  region: TeslaRegion
  fetchImpl: FetchLike
  store: TokenStore | null
  now: () => number
  logger?: Logger
  requestTimeoutMs?: number
}

/** Jetons du compte : échange du code, rafraîchissement à usage unique, cache. */
export class TeslaAuth {
  private tokens: StoredTokens | null = null
  /** Un seul rafraîchissement à la fois : deux en parallèle brûleraient le même refresh token. */
  private refreshing: Promise<string> | null = null

  constructor(private readonly opts: TeslaAuthOptions) {}

  get audience(): string { return REGION_BASE_URLS[this.opts.region] }
  get linked(): boolean { return this.tokens !== null }

  /** Au démarrage : reprend les jetons du cache s'il y en a. */
  async restore(): Promise<boolean> {
    this.tokens = (await this.opts.store?.load()) ?? null
    return this.linked
  }

  /** Après le retour du consentement : le code devient un couple de jetons, gardé. */
  async exchangeCode(code: string, signal?: AbortSignal): Promise<void> {
    const t = await this.tokenRequest({
      grant_type: 'authorization_code', client_id: this.opts.clientId, client_secret: this.opts.clientSecret,
      code, redirect_uri: this.opts.redirectUri, audience: this.audience,
    }, signal)
    if (!t.refresh_token) throw new PluginError('UPSTREAM_ERROR', 'Tesla returned no refresh token (offline_access scope missing?)')
    await this.adopt(t)
  }

  /** Oublie le compte (l'utilisateur relie, ou Tesla a révoqué). */
  async forget(): Promise<void> {
    this.tokens = null
  }

  /** Access token valable, rafraîchi d'avance si l'échéance approche. */
  async accessToken(signal?: AbortSignal): Promise<string> {
    if (!this.tokens) throw new PluginError('NEEDS_PAIRING', 'no Tesla account linked: open /api/plugins/tesla/auth/url')
    const fresh = this.tokens.accessToken && this.tokens.accessExpiresAt && this.tokens.accessExpiresAt - this.opts.now() > REFRESH_MARGIN_MS
    if (fresh) return this.tokens.accessToken!
    return this.refresh(signal)
  }

  /** Rafraîchit maintenant (aussi après un 401 : le jeton a pu être révoqué avant son échéance). */
  refresh(signal?: AbortSignal): Promise<string> {
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      try {
        if (!this.tokens) throw new PluginError('NEEDS_PAIRING', 'no Tesla account linked')
        const t = await this.tokenRequest({
          grant_type: 'refresh_token', client_id: this.opts.clientId, refresh_token: this.tokens.refreshToken,
        }, signal)
        await this.adopt(t)
        return t.access_token
      } finally { this.refreshing = null }
    })()
    return this.refreshing
  }

  /** Jeton partenaire (`client_credentials`) : enregistrement et vérification du domaine. */
  async partnerToken(signal?: AbortSignal): Promise<string> {
    const t = await this.tokenRequest({
      grant_type: 'client_credentials', client_id: this.opts.clientId, client_secret: this.opts.clientSecret,
      scope: PARTNER_SCOPES.join(' '), audience: this.audience,
    }, signal)
    return t.access_token
  }

  private async adopt(t: { access_token: string; refresh_token?: string | undefined; expires_in?: number | undefined }): Promise<void> {
    const refreshToken = t.refresh_token ?? this.tokens?.refreshToken
    if (!refreshToken) throw new PluginError('UPSTREAM_ERROR', 'Tesla returned no refresh token')
    this.tokens = {
      refreshToken, accessToken: t.access_token,
      accessExpiresAt: this.opts.now() + (t.expires_in ?? 3600) * 1000,
    }
    // sauvé AVANT tout usage : un refresh token consommé et non écrit, c'est un compte à relier
    await this.opts.store?.save(this.tokens)
  }

  private async tokenRequest(params: Record<string, string>, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams(params).toString(),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (err) {
      throw new PluginError('UPSTREAM_ERROR', 'Tesla auth server unreachable', { cause: err })
    }
    const text = await res.text()
    if (!res.ok) {
      // un refresh token brûlé ou révoqué : le compte est à relier, ce n'est pas un incident réseau
      const gone = res.status === 400 || res.status === 401
      if (gone && params.grant_type === 'refresh_token') {
        this.tokens = null
        throw new PluginError('NEEDS_PAIRING', `Tesla refused the refresh token (HTTP ${res.status}): link the account again`)
      }
      throw new PluginError(gone ? 'NEEDS_PAIRING' : 'UPSTREAM_ERROR', `Tesla auth server returned HTTP ${res.status} on ${params.grant_type}`)
    }
    const parsed = tokenResponseSchema.safeParse(((): unknown => { try { return JSON.parse(text) } catch { return null } })())
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'unexpected token response from Tesla')
    return parsed.data
  }
}
