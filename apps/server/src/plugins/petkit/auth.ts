import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { loginSchema, petkitEnvelopeSchema, regionServersSchema } from './types'
import { writeFileAtomic } from '../../core/atomic-file'

// PetKit authentication — the mobile app's private cloud, the only way in: the devices talk to
// nothing else, and the fountains don't even have Wi-Fi.
//
// WHAT SETS THIS PLUGIN APART FROM MELCLOUD AND RENAULT: there is no password. The user's account
// signs in by CODE — we ask PetKit to send a six-digit code by e-mail, valid for ten minutes, and
// that's what we exchange for a session. Good news for security (no password ever passes through
// the server) and a strong constraint for operation, which drives the rest of this file:
//
//   **a lost session doesn't come back on its own.** It takes a human, their mailbox and ten
//   minutes. So we extend the session WELL BEFORE it expires (`REFRESH_AT_RATIO`), and when it is
//   lost anyway we say so plainly (`needs_pairing`) instead of hammering.
//
// Two pitfalls noted in the third-party libraries, handled here:
//
//  1. **A new sign-in invalidates the previous one.** The server and the user's phone would keep
//     signing each other out on the same account. Hence the pairing instruction: a DEDICATED
//     PetKit account, with which the devices are shared.
//  2. **Two concurrent sign-ins doom the session for the length of its lease** (~36 h): both see
//     the expired token, both sign in again, one of the two tokens is stillborn and every request
//     then fails silently. Hence the lock allowing a single sign-in in flight at a time
//     (`inFlight`) — it's not an optimization, it's the fix for a known and costly bug.

/** Where the list of regional gateways is requested; it isn't regional itself. */
export const DEFAULT_PASSPORT_URL = 'https://passport.petkt.com/'
/** Fallback if discovery fails: the European gateway, this house's. */
export const DEFAULT_GATEWAY = 'https://api.eu-pet.com/latest/'
const REQUEST_TIMEOUT_MS = 20_000

/**
 * The session is renewed at half its lease. A third would be more cautious, half is enough: even a
 * server stopped overnight wakes up with a still-valid session on a 36 h lease, and that's exactly
 * the case to avoid — the one where the user has to be woken up for a code.
 */
export const REFRESH_AT_RATIO = 0.5

/** What PetKit is told about the client. In configuration: the vendor may start checking it. */
export const DEFAULT_APP_VERSION = '13.2.1'

// The phone we pretend to be. PetKit checks the CONSISTENCY of these three between the `X-Client`
// header and the sign-in's `client` field; so they are set in a single place.
const ANDROID_OS_VERSION = '16.1'
const ANDROID_MODEL = '23127PN0CG'
const USER_AGENT = 'okhttp/3.14.9'

export interface StoredSession {
  /** Session token, set as `X-Session` AND `F-Session` on every call. */
  id: string
  /** Regional gateway chosen at sign-in: the session is only valid on that one. */
  gateway: string
  /** Epoch milliseconds: issue and expiry, to decide on renewal. */
  createdAt: number
  expiresAt: number
  /** The account's address, only to display it in Settings. */
  account: string | null
}

const storedSessionSchema = z.object({
  id: z.string().min(1),
  gateway: z.string().min(1),
  createdAt: z.number(),
  expiresAt: z.number(),
  account: z.string().nullable().default(null),
})

export interface SessionStore {
  load(): Promise<StoredSession | null>
  save(session: StoredSession): Promise<void>
  clear(): Promise<void>
}

/** Atomic JSON file at 0600 (same shape as MELCloud): unreadable = no session, never a fatal error. */
export function createSessionFile(path: string, logger?: Logger): SessionStore {
  return {
    async load(): Promise<StoredSession | null> {
      let raw: string
      try { raw = await readFile(path, 'utf8') } catch { return null }
      const parsed = storedSessionSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger?.warn({ path }, 'unreadable PetKit session cache, ignoring it'); return null }
      return parsed.data
    },
    async save(session: StoredSession): Promise<void> {
      try { await writeFileAtomic(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, 'could not write PetKit session cache') }
    },
    async clear(): Promise<void> {
      try { await writeFileAtomic(path, '{}\n', { mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, 'could not clear PetKit session cache') }
    },
  }
}

export interface PetkitAuthOptions {
  passportUrl: string
  /** Gateway forced by configuration; otherwise discovered from the region. */
  gateway: string | null
  region: string
  timezone: string
  appVersion: string
  fetchImpl: FetchLike
  store: SessionStore | null
  logger?: Logger
  now?: () => number
  requestTimeoutMs?: number
}

/** What the API returns when the session is no longer accepted — seen as HTTP 200, in the body. */
const SESSION_ERROR_CODES = new Set([5, '5'])

export class PetkitAuth {
  private session: StoredSession | null = null
  /** A single sign-in in flight: see pitfall no. 2 at the top of the file. */
  private inFlight: Promise<StoredSession> | null = null
  /** Gateway and region resolved once and for all (the server list doesn't change). */
  private resolved: { gateway: string; region: string } | null = null

  constructor(private readonly opts: PetkitAuthOptions) {}

  get linked(): boolean { return this.session !== null }
  get sessionId(): string | null { return this.session?.id ?? null }
  get account(): string | null { return this.session?.account ?? null }
  get gateway(): string { return this.session?.gateway ?? this.opts.gateway ?? DEFAULT_GATEWAY }
  get expiresAt(): number | null { return this.session?.expiresAt ?? null }

  private now(): number { return this.opts.now?.() ?? Date.now() }

  /** At startup: picks up the session from the cache, if it hasn't already expired. */
  async restore(): Promise<boolean> {
    const cached = (await this.opts.store?.load()) ?? null
    this.session = cached && cached.expiresAt > this.now() ? cached : null
    if (cached && !this.session) this.opts.logger?.info('cached PetKit session expired, pairing needed')
    return this.linked
  }

  /**
   * Chosen gateway AND region. Two things not to confuse, and that's what cost a first 502: the
   * configured REGION ("FR") is used to find the server, but what PetKit then expects in `region`
   * is that server's IDENTIFIER, in lowercase.
   *
   * `v1/regionservers` is a **GET** — calling it with POST failed, and since the failure was
   * caught, we silently fell back to the European gateway without ever resolving the region.
   *
   * Discovery failure = fallback rather than blocking: an unavailable server list doesn't mean the
   * account is unusable.
   */
  async resolveEndpoint(signal?: AbortSignal): Promise<{ gateway: string; region: string }> {
    const wanted = this.opts.region.toLowerCase()
    if (this.opts.gateway) return { gateway: this.opts.gateway, region: wanted }
    if (this.resolved) return this.resolved
    try {
      const body = await this.get(`${this.opts.passportUrl.replace(/\/$/, '')}/v1/regionservers`, {}, {}, signal)
      const parsed = regionServersSchema.safeParse(body)
      const hit = parsed.success
        ? parsed.data.list?.find((srv) => [srv.id, srv.name].some((v) => String(v ?? '').toLowerCase() === wanted))
        : undefined
      this.resolved = hit
        ? { gateway: hit.gateway, region: String(hit.id ?? wanted).toLowerCase() }
        : { gateway: DEFAULT_GATEWAY, region: wanted }
    } catch (err) {
      this.opts.logger?.warn({ err }, 'PetKit region server lookup failed, falling back to the European gateway')
      this.resolved = { gateway: DEFAULT_GATEWAY, region: wanted }
    }
    return this.resolved
  }

  /**
   * Pairing step 1: ask PetKit to send a code to the account's address. The code is valid for ten
   * minutes — the vendor says so, not us, and nothing here extends it.
   *
   * **It's a GET, with the address as a URL parameter**, and not a form POST like the rest of the
   * API. Sent as POST, PetKit refuses — the 502 of the first attempt.
   */
  async requestCode(email: string, signal?: AbortSignal): Promise<void> {
    const { gateway } = await this.resolveEndpoint(signal)
    await this.get(`${gateway.replace(/\/$/, '')}/user/sendcodeforquicklogin`, { username: email }, {}, signal)
  }

  /**
   * Step 2: exchange the code for a session. No password comes in here, the account doesn't use
   * one.
   */
  async loginWithCode(email: string, code: string, signal?: AbortSignal): Promise<StoredSession> {
    const { gateway, region } = await this.resolveEndpoint(signal)
    const body = await this.post(`${gateway.replace(/\/$/, '')}/user/login`, {
      username: email, validCode: code.trim(), encrypt: '1', region, oldVersion: this.opts.appVersion,
      // Client description, in ONE serialized field — it's the shape the mobile app sends. As
      // JSON rather than as a pseudo Python dictionary like the reference library does: a lenient
      // parser accepts both, a strict parser only accepts JSON.
      client: JSON.stringify(this.clientFields()),
    }, {}, signal)
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'PetKit login: unexpected response shape')
    const created = this.now()
    // Cautious default lease (12 h) if PetKit doesn't say: better to renew for nothing than to
    // discover a dead session when it's time to serve a meal.
    const lifetimeS = parsed.data.session.expiresIn ?? 12 * 3600
    const session: StoredSession = {
      id: parsed.data.session.id,
      gateway,
      createdAt: created,
      expiresAt: created + lifetimeS * 1000,
      account: email,
    }
    this.session = session
    await this.opts.store?.save(session)
    return session
  }

  /**
   * Extends the session if it has passed half its lease. NEVER signs in on its own: with no
   * password, signing in again would require a code only the user can read.
   */
  async ensureFresh(signal?: AbortSignal): Promise<void> {
    const s = this.session
    if (!s) throw new PluginError('NEEDS_PAIRING', 'PetKit account not linked')
    if (this.now() < s.createdAt + (s.expiresAt - s.createdAt) * REFRESH_AT_RATIO) return
    if (this.inFlight) { await this.inFlight; return }
    this.inFlight = this.refresh(s, signal).finally(() => { this.inFlight = null })
    await this.inFlight
  }

  private async refresh(s: StoredSession, signal?: AbortSignal): Promise<StoredSession> {
    let body: unknown
    try {
      body = await this.post(`${s.gateway.replace(/\/$/, '')}/user/refreshsession`, this.clientFields(), this.headers(s.id), signal)
    } catch (err) {
      // A failed renewal isn't necessarily a dead session (networks exist): we keep the session,
      // the next call will retry. It's `invalidate()` that decides, on a clear refusal.
      this.opts.logger?.warn({ err }, 'PetKit session refresh failed, keeping the current session')
      return s
    }
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) return s
    const created = this.now()
    const lifetimeS = parsed.data.session.expiresIn ?? (s.expiresAt - s.createdAt) / 1000
    const next: StoredSession = { ...s, id: parsed.data.session.id, createdAt: created, expiresAt: created + lifetimeS * 1000 }
    this.session = next
    await this.opts.store?.save(next)
    return next
  }

  /**
   * The session is refused: we DISCARD it. With no password there's nothing to retry, and keeping
   * a dead session would make every call fail silently — the exact bug we're trying to avoid.
   */
  async invalidate(): Promise<void> {
    this.session = null
    this.inFlight = null
    await this.opts.store?.clear()
  }

  async unlink(): Promise<void> { await this.invalidate() }

  /** Session headers: PetKit wants the SAME token under two names. */
  headers(id = this.sessionId): Record<string, string> {
    if (!id) throw new PluginError('NEEDS_PAIRING', 'PetKit account not linked')
    return { 'X-Session': id, 'F-Session': id }
  }

  /** True if this response body says "dead session" (the API answers 200 and puts the failure inside). */
  static isSessionError(body: unknown): boolean {
    const parsed = petkitEnvelopeSchema.safeParse(body)
    const code = parsed.success ? parsed.data.error?.code : undefined
    return code !== undefined && SESSION_ERROR_CODES.has(code as number | string)
  }

  /**
   * Client description, as the mobile app serializes it in the sign-in's `client` field. The keys
   * and their SPELLING come from the two third-party implementations that work in production;
   * `token` is empty there and `timezone` is an offset in HOURS, not a named time zone
   * (`timezoneId` carries that one).
   */
  private clientFields(): Record<string, string> {
    return {
      locale: 'fr-FR',
      source: 'app.petkit-android',
      platform: 'android',
      osVersion: ANDROID_OS_VERSION,
      timezone: tzOffsetHours(this.opts.timezone),
      timezoneId: this.opts.timezone,
      version: this.opts.appVersion,
      token: '',
      name: ANDROID_MODEL,
    }
  }

  /**
   * Headers sent on EVERY request, authenticated or not. They're not decoration: without them,
   * PetKit answers "Request is incorrect. (code 3)" — the refusal obtained at the first real
   * pairing, on 09/21, with headers cut down to the bare minimum. The set below is the one used by
   * two third-party implementations in production.
   */
  baseHeaders(): Record<string, string> {
    return {
      'Accept': '*/*',
      'Accept-Language': 'fr-FR;q=1, en-US;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
      'X-Api-Version': this.opts.appVersion,
      'X-Client': `android(${ANDROID_OS_VERSION};${ANDROID_MODEL})`,
      'X-Locale': 'fr-FR',
      'X-Hour': '24',
      'X-TimezoneId': this.opts.timezone,
      'X-Timezone': tzOffsetHours(this.opts.timezone),
      'User-Agent': USER_AGENT,
    }
  }

  private get(url: string, query: Record<string, string>, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const qs = new URLSearchParams(query).toString()
    return this.send('GET', qs ? `${url}?${qs}` : url, undefined, headers, signal)
  }

  private post(url: string, form: Record<string, string>, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    return this.send('POST', url, new URLSearchParams(form).toString(), headers, signal)
  }

  /**
   * One round trip, and the translation of what PetKit answers. The error message carries the
   * PATH, the status and an excerpt of the body: without them, a refusal reaches the interface as
   * a "502" that says nothing and points nowhere.
   */
  private async send(method: 'GET' | 'POST', url: string, body: string | undefined, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => { ctrl.abort() }, this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    const where = url.split('?')[0]!
    try {
      const res = await this.opts.fetchImpl(url, {
        method,
        headers: {
          ...this.baseHeaders(),
          ...(body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body }),
        signal: signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal,
      })
      const text = await res.text()
      if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `PetKit ${where}: HTTP ${res.status} ${excerpt(text)}`)
      // A response that isn't JSON (error page, captive portal) must be readable in the message,
      // not lost in a parse exception.
      let parsedBody: unknown
      try { parsedBody = JSON.parse(text) }
      catch { throw new PluginError('UPSTREAM_ERROR', `PetKit ${where}: non-JSON response ${excerpt(text)}`) }
      const env = petkitEnvelopeSchema.safeParse(parsedBody)
      if (env.success && env.data.error) {
        const msg = String(env.data.error.msg ?? 'refused')
        const code = env.data.error.code === undefined ? '' : ` (code ${String(env.data.error.code)})`
        // Session refusal: it's the pairing that's at fault, not the network.
        throw new PluginError(PetkitAuth.isSessionError(parsedBody) ? 'NEEDS_PAIRING' : 'UPSTREAM_ERROR', `PetKit ${where}: ${msg}${code}`)
      }
      return env.success && env.data.result !== undefined ? env.data.result : parsedBody
    } finally { clearTimeout(timer) }
  }
}

/** Short excerpt of a response, for a readable error message without flooding the log. */
const excerpt = (text: string): string => (text.length > 200 ? `${text.slice(0, 200)}…` : text).replace(/\s+/g, ' ').trim()

/**
 * A time zone's UTC offset, in hours with one decimal ("2.0", "-5.0") — the shape PetKit expects,
 * which is not that of a named time zone. Computed now, so daylight saving time included. An
 * unknown time zone counts as UTC rather than failing the whole sign-in.
 */
function tzOffsetHours(timeZone: string, at = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(at)
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name)
    if (!m) return '0.0'
    const hours = Number(m[2]) + Number(m[3] ?? 0) / 60
    return `${m[1] === '-' ? '-' : ''}${hours.toFixed(1)}`
  } catch { return '0.0' }
}
