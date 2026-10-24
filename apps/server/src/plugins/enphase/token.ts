import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { writeFileAtomic } from '../../core/atomic-file'

// Access token for the IQ Gateway's local API (software 7.0 and above: no more password, a JWT
// signed by the Enphase cloud). Two ways to get it, described in the vendor's technical note
// ("Accessing IQ Gateway local APIs or local UI with token-based authentication"):
//
//  - by hand on entrez.enphaseenergy.com, then pasted here;
//  - PROGRAMMATICALLY, in two requests to the cloud: open a session with the Enphase account, then
//    exchange the session id for a token for a gateway serial number. This route gives an OWNER
//    token (one year) whereas, for an account that is both installer and owner — the case of a
//    self-installer —, the web form only gives a 12 h one.
//
// The Enphase account password opens far more than the local API: it is therefore NEITHER a config
// key, NOR kept. It crosses the pairing route once, is used to mint the token, and that is all —
// only the token is cached. Nothing here reads `process.env` for credentials.

/** Session opening (Enphase account) — first of the two requests to the cloud. */
const LOGIN_URL = 'https://enlighten.enphaseenergy.com/login/login.json'
/** Exchange of the session id for a token for a gateway — second request. */
const TOKENS_URL = 'https://entrez.enphaseenergy.com/tokens'
/** The cloud is on the Internet, not on the LAN: more generous than the 8 s given to the gateway. */
export const CLOUD_TIMEOUT_MS = 15_000
/** Below this, the UI asks for a renewal (an owner's token lasts one year). */
export const RENEW_WARNING_DAYS = 30

const loginResponseSchema = z.object({
  session_id: z.string().min(1),
  message: z.string().optional(),
})

/** Body of `/tokens`: JSON on some firmwares, the JWT as plain text on others. */
const tokenResponseSchema = z.object({ token: z.string().min(1) })

const claimsSchema = z.object({
  /** Gateway the token was issued for (serial number). */
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  /** `owner` (one year) or `installer` (twelve hours): explains a short expiry. */
  enphaseUser: z.string().optional(),
  username: z.string().optional(),
  /** Expiry, in epoch SECONDS (JWT convention). */
  exp: z.number(),
})

export interface EnphaseTokenClaims {
  /** Serial number of the target gateway, if the token carries it. */
  serial: string | undefined
  /** Role of the issuing account (`owner`, `installer`). */
  role: string | undefined
  username: string | undefined
  /** Expiry in epoch MILLISECONDS (the JWT carries it in seconds). */
  expiresAt: number
}

/**
 * Useful content of a token, without checking its signature: the verifier is the gateway, not us.
 * We only read what serves the user — for which gateway, until when, which role. `null` if it is
 * not a readable JWT: a token truncated when copied must say so plainly, not end up as an
 * unexplained 401 on the first request.
 */
export function decodeEnphaseToken(token: string): EnphaseTokenClaims | null {
  const parts = token.trim().split('.')
  if (parts.length !== 3) return null
  let payload: unknown
  try { payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) }
  catch { return null }
  const parsed = claimsSchema.safeParse(payload)
  if (!parsed.success) return null
  const { aud, enphaseUser, username, exp } = parsed.data
  return {
    serial: Array.isArray(aud) ? aud[0] : aud,
    role: enphaseUser,
    username,
    expiresAt: exp * 1000,
  }
}

export type TokenStage = 'ok' | 'expiring' | 'expired'

/**
 * Where the token stands: `expired` (the gateway will refuse everything), `expiring` (less than
 * `RENEW_WARNING_DAYS`: the UI flags it before the failure), `ok`. `daysLeft` is rounded down and
 * negative after the expiry.
 */
export function tokenStage(claims: EnphaseTokenClaims, now: number): { stage: TokenStage; daysLeft: number } {
  const daysLeft = Math.floor((claims.expiresAt - now) / 86_400_000)
  if (claims.expiresAt <= now) return { stage: 'expired', daysLeft }
  return { stage: daysLeft < RENEW_WARNING_DAYS ? 'expiring' : 'ok', daysLeft }
}

export interface CheckedToken {
  token: string
  claims: EnphaseTokenClaims
  stage: TokenStage
  daysLeft: number
}
export type TokenRejection = 'unreadable' | 'other-gateway' | 'expired'

/**
 * Is a token usable for this gateway? Three possible refusals, told apart because they are not
 * fixed the same way: unreadable (truncated copy), issued for ANOTHER gateway (two gateways on the
 * account), expired (to renew).
 */
export function checkToken(token: string, o: { serial?: string | undefined; now: number }):
{ ok: true; checked: CheckedToken } | { ok: false; reason: TokenRejection; claims: EnphaseTokenClaims | null } {
  const claims = decodeEnphaseToken(token)
  if (!claims) return { ok: false, reason: 'unreadable', claims: null }
  if (o.serial && claims.serial && claims.serial !== o.serial) return { ok: false, reason: 'other-gateway', claims }
  const { stage, daysLeft } = tokenStage(claims, o.now)
  if (stage === 'expired') return { ok: false, reason: 'expired', claims }
  return { ok: true, checked: { token: token.trim(), claims, stage, daysLeft } }
}

/** Sentence to show the user for a refusal (the UI does not have to translate a code into a cause). */
export function rejectionMessage(reason: TokenRejection, claims: EnphaseTokenClaims | null, serial?: string): string {
  switch (reason) {
    case 'unreadable': return 'this is not a readable Enphase token (truncated copy?)'
    case 'other-gateway': return `this token was issued for gateway ${claims?.serial}, not ${serial}`
    case 'expired': return `this token expired on ${new Date(claims!.expiresAt).toISOString().slice(0, 10)}`
  }
}

export interface CloudFetchOptions {
  fetchImpl?: FetchLike
  signal?: AbortSignal
  /** Shortened in tests; in production it is `CLOUD_TIMEOUT_MS`. */
  timeoutMs?: number
}

export interface LoginOptions extends CloudFetchOptions {
  /** Enphase account login (e-mail address). Never kept. */
  user: string
  /** Account password. Passes through this function, is neither logged nor written. */
  password: string
}

export interface MintOptions extends LoginOptions {
  /** Gateway serial number — read from `/info`, which needs no token. */
  serial: string
}

function deadline(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function cloudFetch(o: CloudFetchOptions): FetchLike {
  return o.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>)
}

async function postCloud(
  doFetch: FetchLike,
  url: string,
  init: Parameters<FetchLike>[1],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; text: string; headers?: MinimalHeaders }> {
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await doFetch(url, { ...init, method: 'POST', signal: deadline(timeoutMs, signal) })
  } catch (err) {
    const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
    throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `Enphase cloud unreachable (${url})`, { cause: err })
  }
  return { status: res.status, text: await res.text(), headers: headersOf(res) }
}

/** Subset of `Headers`: the real `fetch` has it, the test fakes often do not. */
interface MinimalHeaders {
  get(name: string): string | null
  getSetCookie?(): string[]
}

function headersOf(res: Awaited<ReturnType<FetchLike>>): MinimalHeaders | undefined {
  const h = (res as { headers?: MinimalHeaders }).headers
  return h && typeof h.get === 'function' ? h : undefined
}

function setCookieLines(headers?: MinimalHeaders): string[] {
  if (!headers) return []
  // undici: `get('set-cookie')` joins with commas (broken as soon as a cookie has an `Expires`),
  // `getSetCookie()` returns one line per cookie. That is what must be read.
  const lines = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
  if (lines.length) return lines
  const joined = headers.get('set-cookie')
  return joined ? [joined] : []
}

function cookieValue(setCookie: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|,\\s*)${name}=([^;]+)`).exec(setCookie)
  return m?.[1]?.trim()
}

function cookieFrom(headers: MinimalHeaders | undefined, name: string): string | undefined {
  for (const line of setCookieLines(headers)) {
    const v = cookieValue(line, name)
    if (v) return v
  }
  return undefined
}

/**
 * Opens an Enlighten session. Two distinct tokens, not to be confused:
 *  - JSON `session_id` → `POST entrez.enphaseenergy.com/tokens` (the gateway's local JWT);
 *  - `_enlighten_4_session` cookie → web/app API (sites, charger). A `session_id` pasted as a
 *    cookie gets a 401. Wrong credentials → `NEEDS_PAIRING`, not a failure.
 */
export async function loginEnlighten(o: LoginOptions): Promise<{ sessionId: string; cookie?: string }> {
  const timeoutMs = o.timeoutMs ?? CLOUD_TIMEOUT_MS
  const login = await postCloud(cloudFetch(o), LOGIN_URL, {
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ 'user[email]': o.user, 'user[password]': o.password }).toString(),
  }, timeoutMs, o.signal)
  const parsed = loginResponseSchema.safeParse(((): unknown => { try { return JSON.parse(login.text) } catch { return null } })())
  const sessionId = parsed.success ? parsed.data.session_id : undefined
  const cookie = cookieFrom(login.headers, '_enlighten_4_session')
  if (!sessionId) {
    throw new PluginError('NEEDS_PAIRING', `Enphase refused the sign-in (HTTP ${login.status}): wrong e-mail or password`)
  }
  return cookie ? { sessionId, cookie } : { sessionId }
}

/** Exchanges an already open Enlighten session for a LOCAL token of THIS gateway. */
export async function exchangeEnphaseToken(o: CloudFetchOptions & {
  sessionId: string
  serial: string
  username: string
}): Promise<{ token: string; claims: EnphaseTokenClaims }> {
  const timeoutMs = o.timeoutMs ?? CLOUD_TIMEOUT_MS
  const minted = await postCloud(cloudFetch(o), TOKENS_URL, {
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ session_id: o.sessionId, serial_num: o.serial, username: o.username }),
  }, timeoutMs, o.signal)
  const asJson = tokenResponseSchema.safeParse(((): unknown => { try { return JSON.parse(minted.text) } catch { return null } })())
  const token = (asJson.success ? asJson.data.token : minted.text).trim()
  const claims = decodeEnphaseToken(token)
  if (!claims) {
    throw new PluginError('UPSTREAM_ERROR', `Enphase returned no usable token for gateway ${o.serial} (HTTP ${minted.status})`)
  }
  return { token, claims }
}

/** Mints a token with the Enphase cloud (session then exchange). Throws `PluginError` otherwise. */
export async function mintEnphaseToken(o: MintOptions): Promise<{ token: string; claims: EnphaseTokenClaims }> {
  const { sessionId } = await loginEnlighten(o)
  return exchangeEnphaseToken({ ...o, sessionId, username: o.user })
}

export interface TokenStore {
  load(): Promise<string | null>
  save(token: string): Promise<void>
}

const tokenFileSchema = z.object({ token: z.string().min(1) })

/**
 * Where the token lives between two starts. It is what allows asking for the credentials only when
 * a token must be (re)minted, and never keeping them: the token itself serves for a year. File
 * missing or unreadable: empty cache, never a fatal error (the plugin must start even if the disk
 * refuses the write).
 */
export function createTokenFile(path: string, logger?: Logger): TokenStore {
  return {
    async load() {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return null }
      const parsed = tokenFileSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger?.warn({ path }, 'unreadable Enphase token cache, ignoring it'); return null }
      return parsed.data.token
    },
    async save(token) {
      try { await writeFileAtomic(path, `${JSON.stringify({ token }, null, 2)}\n`, { mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, 'could not write Enphase token cache') }
    },
  }
}

export interface ResolveTokenOptions {
  /** `ENPHASE_TOKEN`: a token set in the configuration wins over the cache as long as it is valid. */
  token?: string | undefined
  store?: TokenStore | undefined
  /** Target gateway (read from `/info`): used to refuse a token from ANOTHER gateway. */
  serial?: string | undefined
  now: number
  logger?: Logger
}

/** Where the token in use comes from: the configuration, the cache, or a mint just made. */
export type TokenSource = 'config' | 'cache' | 'minted'

export interface ResolvedToken extends CheckedToken {
  source: Extract<TokenSource, 'config' | 'cache'>
}

/**
 * The token to use at startup, between the configuration's and the cache's. NO call to the cloud
 * here — minting a token requires credentials, which only the user can give, when typing them
 * (pairing route). A refused candidate is logged and we move on to the next: an expired token in
 * the configuration must not hide a fresh token in the cache.
 *
 * Between two acceptable candidates, we keep the one that expires the LATEST, not the
 * configuration's. It is a real case: a 12 h installer token left in `.env` would have eclipsed,
 * for its whole lifetime, the one-year token freshly minted and cached.
 *
 * `null` when there is nothing usable: up to the plugin to declare itself `needs_pairing`.
 */
export async function resolveEnphaseToken(o: ResolveTokenOptions): Promise<ResolvedToken | null> {
  const candidates: { token: string; source: 'config' | 'cache' }[] = []
  if (o.token) candidates.push({ token: o.token, source: 'config' })
  const cached = o.store ? await o.store.load() : null
  if (cached) candidates.push({ token: cached, source: 'cache' })

  let best: ResolvedToken | null = null
  for (const candidate of candidates) {
    const result = checkToken(candidate.token, { serial: o.serial, now: o.now })
    if (!result.ok) {
      o.logger?.warn(
        { source: candidate.source, reason: result.reason },
        `Enphase token ignored: ${rejectionMessage(result.reason, result.claims, o.serial)}`,
      )
      continue
    }
    if (!best || result.checked.claims.expiresAt > best.claims.expiresAt) {
      best = { ...result.checked, source: candidate.source }
    }
  }
  return best
}
