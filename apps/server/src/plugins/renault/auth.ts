import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { gigyaAccountInfoSchema, gigyaJwtSchema, gigyaLoginSchema, gigyaResponseSchema } from './types'
import { writeFileAtomic } from '../../core/atomic-file'

// Renault authentication — Gigya (SAP Customer Data Cloud), the one used by the MY Renault app.
//
// There is NO OAuth: the only way in is the account's identifier and password. It's a first in
// Kasbah, and the decision made with the user limits the damage:
//
//   the password passes through the server ONCE (POST /api/plugins/renault/login), it is never
//   written to disk, never logged, never stored in an environment variable. Only the
//   `login_token` that Gigya returns in exchange survives — revocable by signing out of the app,
//   and it doesn't allow changing the account's password.
//
// Two tokens, not to be confused:
//   - the LOGIN TOKEN (`sessionInfo.cookieValue`): long-lived, it's the one we keep;
//   - the JWT (`accounts.getJWT`): 15 minutes, it's the one Kamereon accepts. Requested again as needed.
//
// Central pitfall: GIGYA ALWAYS ANSWERS WITH HTTP 200. A wrong password, an expired token, a
// pending two-factor authentication — everything arrives as 200 with an `errorCode` in the body. A
// client that only looks at the status believes it succeeded every time.

/**
 * Default values for `fr_FR`. They can be **overridden by the environment**, and that's not
 * overzealousness: Renault changed its keys in May 2026 and broke, on the same day, every
 * third-party integration that had them hard-coded. Here, a new key goes into `.env` without
 * touching the code or republishing anything.
 */
export const DEFAULT_GIGYA_URL = 'https://accounts.eu1.gigya.com'
export const DEFAULT_GIGYA_API_KEY = '3_VgdkgtIRH3AdHvJm-cjV2ug2EFE0lxt0IJzMC4MFqZjFpn_GYFXVdNZ19L7wZX0N'
export const DEFAULT_KAMEREON_URL = 'https://api-wired-prod-1-euw1.wrd-aws.com'
export const DEFAULT_KAMEREON_API_KEY = 'YjkKtHmGfaceeuExUDKGxrLZGGvtVS0J'

/** Lifetime requested for the JWT (seconds): the maximum Gigya grants here. */
export const JWT_TTL_S = 900
/** Margin before the JWT's expiry beyond which a new one is requested in advance. */
const JWT_MARGIN_MS = 60_000
const REQUEST_TIMEOUT_MS = 20_000

/**
 * Gigya codes to tell apart from an outage. All arrive as HTTP 200.
 * `403101` deserves its own message: an account with two-factor authentication can NOT be linked
 * here, and the user must know it right away rather than believe they mistyped a password.
 */
const GIGYA_INVALID_CREDENTIALS = 403042
const GIGYA_PENDING_2FA = 403101
const GIGYA_INVALID_TOKEN = 403005

export interface StoredSession {
  /** `sessionInfo.cookieValue`: the long-lived token. The password, for its part, is never kept. */
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
 * Atomic JSON file (`.tmp` then `rename`), at 0600. Missing or unreadable file = no session, never
 * a fatal error: the plugin must start even if the disk refuses.
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

/** Gigya session: sign-in by password (once), then short JWTs on demand. */
export class RenaultAuth {
  private session: StoredSession | null = null
  private jwtToken: string | null = null
  private jwtExpiresAt = 0
  /** A single renewal at a time: Gigya rate-limits, two in parallel are lost. */
  private minting: Promise<string> | null = null

  constructor(private readonly opts: RenaultAuthOptions) {}

  get linked(): boolean { return this.session !== null }
  get personId(): string | null { return this.session?.personId ?? null }

  /** At startup: picks up the session from the cache if there is one. */
  async restore(): Promise<boolean> {
    this.session = (await this.opts.store?.load()) ?? null
    return this.linked
  }

  /**
   * Links the account. The password is used ONLY in this call: it is not kept in memory beyond
   * it, not written, not logged. What survives is the `login_token` and the `personId`.
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

  /** Forgets the account (the user unlinks, or Gigya revoked the session). */
  async forget(): Promise<void> {
    this.session = null
    this.jwtToken = null
    this.jwtExpiresAt = 0
    await this.opts.store?.clear()
  }

  /** JWT valid for Kamereon, renewed in advance if expiry is approaching. */
  async jwt(signal?: AbortSignal): Promise<string> {
    if (!this.session) throw new PluginError('NEEDS_PAIRING', 'no Renault account linked: POST /api/plugins/renault/login')
    if (this.jwtToken && this.jwtExpiresAt - this.opts.now() > JWT_MARGIN_MS) return this.jwtToken
    return this.mintJwt(signal)
  }

  /** Renews now (also after a 401 from Kamereon: the JWT may have been revoked early). */
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
   * One Gigya call. The body is `application/x-www-form-urlencoded`, the response JSON with its
   * `errorCode` — that's what we interpret, not the HTTP status.
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
    // no readable frame: neither identifiable success nor failure, it's an outage
    if (!framed.success) {
      throw new PluginError('UPSTREAM_ERROR', `unexpected response from Renault sign-in on ${method} (HTTP ${res.status})`)
    }
    if (framed.data.errorCode !== 0) this.throwGigya(method, framed.data)
    return body
  }

  /** Translates a Gigya `errorCode`. Never the password or the token in the message. */
  private throwGigya(method: string, r: { errorCode: number; errorMessage?: string | undefined; errorDetails?: string | undefined }): never {
    const detail = [r.errorMessage, r.errorDetails].filter(Boolean).join(' — ')
    if (r.errorCode === GIGYA_PENDING_2FA) {
      throw new PluginError('NEEDS_PAIRING',
        'Renault account requires two-factor authentication, which this plugin cannot complete: disable it in the MY Renault app, or use an account without it')
    }
    if (r.errorCode === GIGYA_INVALID_CREDENTIALS) {
      throw new PluginError('NEEDS_PAIRING', 'Renault refused the e-mail or password')
    }
    // expired or revoked token: the account has to be linked again, it's not a network incident. The
    // session is discarded here so that `health()` says `needs_pairing` without waiting for the next round.
    if (r.errorCode === GIGYA_INVALID_TOKEN) {
      this.session = null
      this.jwtToken = null
      throw new PluginError('NEEDS_PAIRING', 'Renault session expired: link the account again')
    }
    throw new PluginError('UPSTREAM_ERROR', `Renault sign-in refused ${method} (error ${r.errorCode})${detail ? `: ${detail}` : ''}`)
  }
}
