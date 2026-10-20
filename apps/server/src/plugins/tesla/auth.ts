import { generateKeyPairSync, createPublicKey } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { tokenResponseSchema } from './types'
import { writeFileAtomic } from '../../core/atomic-file'

// Identity and tokens of the Tesla Fleet API. Three distinct things live here:
//
//  1. The application's KEY PAIR. Tesla requires an EC public key (P-256 curve) to be served on
//     the application's domain (`/.well-known/appspecific/com.tesla.3p.public-key.pem`) before any
//     call: it's its proof of domain ownership. The private key stays on this server and, in phase 1,
//     has nothing to sign (a pre-2021 Model S accepts unsigned commands); it is generated here so
//     that the public key exists, and kept for later.
//  2. The PARTNER token (`client_credentials`): it represents nobody, it's used to register the
//     domain with Tesla and to check what Tesla read of the public key. Never cached.
//  3. The ACCOUNT token (authorization code then refresh). The refresh token is SINGLE-USE: each
//     refresh returns a new one that must be saved immediately, otherwise the next one fails and
//     the account has to be linked again. Hence the file cache written on every round.

export const AUTHORIZE_URL = 'https://auth.tesla.com/oauth2/v3/authorize'
export const TOKEN_URL = 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token'

/** API base per region: the Tesla account lives in one of them, and `audience` must name it. */
export const REGION_BASE_URLS = {
  eu: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
  na: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
} as const
export type TeslaRegion = keyof typeof REGION_BASE_URLS

/**
 * Scopes requested from the account. Commands are already included (read-only in phase 1, but
 * linking the account a second time for a "Lock" button would make no sense). `offline_access` is
 * what yields the refresh token.
 */
export const ACCOUNT_SCOPES = ['openid', 'offline_access', 'vehicle_device_data', 'vehicle_location', 'vehicle_cmds', 'vehicle_charging_cmds'] as const
/** Partner token scopes: no `offline_access`, it represents no account. */
export const PARTNER_SCOPES = ['openid', 'vehicle_device_data', 'vehicle_cmds', 'vehicle_charging_cmds'] as const

/** Path, on the application's domain, where Tesla reads the public key. */
export const PUBLIC_KEY_PATH = '/.well-known/appspecific/com.tesla.3p.public-key.pem'

/** Margin before the access token's expiry beyond which it is refreshed in advance. */
const REFRESH_MARGIN_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 20_000

export function authorizationUrl(o: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    response_type: 'code', client_id: o.clientId, redirect_uri: o.redirectUri,
    scope: ACCOUNT_SCOPES.join(' '), state: o.state,
    // Tesla asks again for the scopes the user may have unchecked, rather than failing silently later
    prompt_missing_scopes: 'true',
  })
  return `${AUTHORIZE_URL}?${q.toString()}`
}

// ---- Key pair --------------------------------------------------------------------------------

export interface KeyPair { privatePem: string; publicPem: string }

export interface KeyStore {
  load(): Promise<string | null>
  save(privatePem: string): Promise<void>
}

/** Public key (SPKI, PEM) derived from a PEM private key. */
export function publicKeyOf(privatePem: string): string {
  return createPublicKey(privatePem).export({ type: 'spki', format: 'pem' }).toString()
}

/**
 * The curve POINT, uncompressed, in hexadecimal: `04` then X then Y (65 bytes, 130 hex). It's IN
 * THIS FORM that Tesla returns the registered key (`partner_accounts.public_key`), and not as PEM —
 * observed on the real account, where a PEM comparison always gave "not ours".
 */
export function publicKeyPointHex(publicPem: string): string {
  const jwk = createPublicKey(publicPem).export({ format: 'jwk' }) as { x?: string; y?: string }
  const hex = (b64url: string) => Buffer.from(b64url, 'base64url').toString('hex').padStart(64, '0')
  return `04${hex(jwk.x ?? '')}${hex(jwk.y ?? '')}`
}

/** Is the key returned by Tesla ours? Accepts the hex point, the PEM, or the unarmored base64. */
export function samePublicKey(served: string, publicPem: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '')
  const s = norm(served)
  return s.toLowerCase() === publicKeyPointHex(publicPem)
    || s === norm(publicPem)
    || s === norm(publicPem.replace(/-----[A-Z ]+-----/g, ''))
}

/** A new EC P-256 pair (`prime256v1`, the one Tesla requires). */
export function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

/** Re-reads the private key from the cache, or generates one and keeps it. The public key always derives from it. */
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

// ---- Account tokens ------------------------------------------------------------------------

export interface StoredTokens {
  refreshToken: string
  accessToken?: string | undefined
  /** Expiry of the access token (epoch ms). */
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
 * Atomic JSON file (`.tmp` then `rename`) shared by the plugin's two caches. Missing or unreadable
 * file = empty, never a fatal error: the plugin must start even if the disk refuses.
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

/** Account tokens: code exchange, single-use refresh, cache. */
export class TeslaAuth {
  private tokens: StoredTokens | null = null
  /** A single refresh at a time: two in parallel would burn the same refresh token. */
  private refreshing: Promise<string> | null = null

  constructor(private readonly opts: TeslaAuthOptions) {}

  get audience(): string { return REGION_BASE_URLS[this.opts.region] }
  get linked(): boolean { return this.tokens !== null }

  /** At startup: picks up the tokens from the cache if there are any. */
  async restore(): Promise<boolean> {
    this.tokens = (await this.opts.store?.load()) ?? null
    return this.linked
  }

  /** After returning from consent: the code becomes a pair of tokens, kept. */
  async exchangeCode(code: string, signal?: AbortSignal): Promise<void> {
    const t = await this.tokenRequest({
      grant_type: 'authorization_code', client_id: this.opts.clientId, client_secret: this.opts.clientSecret,
      code, redirect_uri: this.opts.redirectUri, audience: this.audience,
    }, signal)
    if (!t.refresh_token) throw new PluginError('UPSTREAM_ERROR', 'Tesla returned no refresh token (offline_access scope missing?)')
    await this.adopt(t)
  }

  /** Forgets the account (the user relinks, or Tesla revoked). */
  async forget(): Promise<void> {
    this.tokens = null
  }

  /** Valid access token, refreshed in advance if expiry is approaching. */
  async accessToken(signal?: AbortSignal): Promise<string> {
    if (!this.tokens) throw new PluginError('NEEDS_PAIRING', 'no Tesla account linked: open /api/plugins/tesla/auth/url')
    const fresh = this.tokens.accessToken && this.tokens.accessExpiresAt && this.tokens.accessExpiresAt - this.opts.now() > REFRESH_MARGIN_MS
    if (fresh) return this.tokens.accessToken!
    return this.refresh(signal)
  }

  /** Refreshes now (also after a 401: the token may have been revoked before its expiry). */
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

  /** Partner token (`client_credentials`): domain registration and verification. */
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
    // saved BEFORE any use: a refresh token consumed and not written means an account to link again
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
      // a burned or revoked refresh token: the account has to be linked again, it's not a network incident
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
