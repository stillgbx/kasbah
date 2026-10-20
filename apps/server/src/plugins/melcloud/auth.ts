import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { melcloudLoginSchema } from './types'
import { writeFileAtomic } from '../../core/atomic-file'

// MELCloud authentication — Mitsubishi Electric's cloud portal.
//
// Like Renault, and for the same reason (no official route for an individual), there is NO
// OAuth: the only way in is the account's login and password. The decision made with the user
// limits the damage, exactly as for Renault:
//
//   the password crosses the server ONCE (POST /api/plugins/melcloud/login), it is never written
//   to disk, never logged, never stored in an environment variable. Only the `ContextKey` that
//   MELCloud returns in exchange survives — revocable by changing the account's password, and it
//   does not allow changing it.
//
// Central trap, the same as Gigya: **MELCloud ALWAYS ANSWERS HTTP 200**. A wrong password, a
// stale key — everything arrives as a 200 with an `ErrorId` in the body.

export const DEFAULT_BASE_URL = 'https://app.melcloud.com/Mitsubishi.Wifi.Client'
/**
 * Application version announced at sign-in. MELCloud requires it; its exact value has never
 * blocked anyone, but it is in the configuration because the vendor may start checking it — a new
 * value would go into `.env` without touching the code.
 */
export const DEFAULT_APP_VERSION = '1.34.12.0'
const REQUEST_TIMEOUT_MS = 20_000

/** `ErrorId` that MELCloud returns for a refused login or password. */
const MELCLOUD_INVALID_CREDENTIALS = 1

export interface StoredSession {
  /** `LoginData.ContextKey`: the session key. The password, for its part, is never kept. */
  contextKey: string
  /** Account name, only to display it in Settings. */
  name: string | null
}

const storedSessionSchema = z.object({
  contextKey: z.string().min(1),
  name: z.string().nullable().default(null),
})

export interface SessionStore {
  load(): Promise<StoredSession | null>
  save(session: StoredSession): Promise<void>
  clear(): Promise<void>
}

/**
 * Atomic JSON file (`.tmp` then `rename`), mode 0600. Missing or unreadable file = no session,
 * never a fatal error: the plugin must start even if the disk refuses.
 */
export function createSessionFile(path: string, logger?: Logger): SessionStore {
  return {
    async load(): Promise<StoredSession | null> {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return null }
      const parsed = storedSessionSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger?.warn({ path }, 'unreadable MELCloud session cache, ignoring it'); return null }
      return parsed.data
    },
    async save(session: StoredSession): Promise<void> {
      try { await writeFileAtomic(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, 'could not write MELCloud session cache') }
    },
    async clear(): Promise<void> {
      try { await writeFileAtomic(path, '{}\n', { mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, 'could not clear MELCloud session cache') }
    },
  }
}

export interface MelcloudAuthOptions {
  baseUrl: string
  appVersion: string
  fetchImpl: FetchLike
  store: SessionStore | null
  logger?: Logger
  requestTimeoutMs?: number
}

/**
 * MELCloud session: sign-in by password (once), then a durable `ContextKey`.
 *
 * Simpler than Renault: there is only ONE token, not two. Nothing to renew as long as MELCloud
 * does not refuse it — and when it does, there is nothing to refresh, the password is needed. Hence
 * `invalidate()`: the key is thrown away so that `health()` says `needs_pairing` right away, instead
 * of letting the plugin retry a dead key forever.
 */
export class MelcloudAuth {
  private session: StoredSession | null = null

  constructor(private readonly opts: MelcloudAuthOptions) {}

  get linked(): boolean { return this.session !== null }
  get contextKey(): string | null { return this.session?.contextKey ?? null }
  get accountName(): string | null { return this.session?.name ?? null }

  /** At startup: resumes the cached session if there is one. */
  async restore(): Promise<boolean> {
    this.session = (await this.opts.store?.load()) ?? null
    return this.linked
  }

  /**
   * Links the account. The password is used ONLY in this call: it is neither kept in memory
   * beyond it, nor written, nor logged. What survives is the `ContextKey`.
   */
  async login(email: string, password: string, signal?: AbortSignal): Promise<StoredSession> {
    const body = {
      Email: email,
      Password: password,
      Language: 0,
      AppVersion: this.opts.appVersion,
      // the key is durable: that is what avoids asking for the password again on every start
      Persist: true,
      CaptchaResponse: null,
    }
    const res = await this.post('Login/ClientLogin', body, signal)
    const parsed = melcloudLoginSchema.safeParse(res)
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'unexpected response from MELCloud sign-in')

    const errorId = parsed.data.ErrorId
    if (typeof errorId === 'number' && errorId !== 0) {
      if (errorId === MELCLOUD_INVALID_CREDENTIALS) {
        throw new PluginError('NEEDS_PAIRING', 'MELCloud refused the e-mail or password')
      }
      throw new PluginError('UPSTREAM_ERROR', `MELCloud sign-in refused the account (error ${errorId})`)
    }
    const data = parsed.data.LoginData
    if (!data) throw new PluginError('UPSTREAM_ERROR', 'MELCloud sign-in returned no context key')

    this.session = { contextKey: data.ContextKey, name: typeof data.Name === 'string' ? data.Name : null }
    await this.opts.store?.save(this.session)
    return this.session
  }

  /** Forgets the account (the user unlinks, or MELCloud rejected the key). */
  async forget(): Promise<void> {
    this.session = null
    await this.opts.store?.clear()
  }

  /**
   * The session key to put in the header. A missing key is not a failure: it is an account not
   * linked yet, and the UI has a card for that.
   */
  key(): string {
    const key = this.session?.contextKey
    if (!key) throw new PluginError('NEEDS_PAIRING', 'no MELCloud account linked: POST /api/plugins/melcloud/login')
    return key
  }

  /**
   * MELCloud rejected the key. There is nothing to refresh — only the password can make a new
   * one — so it is thrown away, and the Settings card asks for linking again instead of letting the
   * plugin hammer a dead key.
   */
  async invalidate(): Promise<void> {
    await this.forget()
  }

  /** An unauthenticated JSON call (the sign-in). The password appears in no message. */
  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(`${this.opts.baseUrl}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `MELCloud unreachable on ${path}`, { cause: err })
    }
    const text = await res.text()
    // the status says almost nothing (everything arrives as 200), but a 5xx is still a 5xx
    if (res.status >= 400) throw new PluginError('UPSTREAM_ERROR', `MELCloud returned HTTP ${res.status} on ${path}`)
    const parsed = ((): unknown => { try { return JSON.parse(text) } catch { return null } })()
    if (parsed === null) throw new PluginError('UPSTREAM_ERROR', `MELCloud sent invalid JSON on ${path}`)
    return parsed
  }
}
