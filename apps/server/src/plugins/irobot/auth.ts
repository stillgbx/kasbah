import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { cloudLoginSchema, endpointDiscoverySchema, gigyaLoginSchema, gigyaResponseSchema, storedSessionSchema, type StoredRobot, type StoredSession } from './types'
import { writeFileAtomic } from '../../core/atomic-file'

// Obtaining the LOCAL credentials of an iRobot robot — the only part of the plugin that touches
// the Internet, and it is only used once.
//
// WHY GO THROUGH THE CLOUD TO TALK LOCALLY. Roombas long handed their local password to anyone who
// asked on the network: a magic datagram on port 8883, after a long press on HOME. On the Combo in
// the device set (firmware `stingray+24.29.5`, 11/22/2024) this mechanism STILL ANSWERS but only to
// refuse — 115 attempts, always `f005efcc3b29`**`03`** where a cooperative robot sends back the
// password. The robot even announces it in its discovery: `cap.pw: 0`.
//
// What remains is the account route, in three steps:
//   1. `GET /v1/discover/endpoints` (PUBLIC) → the current Gigya key and the deployment's HTTP base;
//   2. `POST accounts.login` at Gigya → an identity signature (UID + signature + timestamp);
//   3. `POST {httpBase}/v2/login` → for each robot on the account, its LOCAL PASSWORD.
//
// What survives: each robot's LOCAL password, in the session file at 0600. The ACCOUNT password
// passes through the server for the duration of step 2 — never written, never logged, never in an
// environment variable. Same tradeoff as Renault and MELCloud.
//
// Pitfall common to Gigya, already paid for with Renault: **HTTP 200 even when it refuses**. It's
// `errorCode` that decides, not the status.

export const DEFAULT_DISCOVERY_URL = 'https://disc-prod.iot.irobotapi.com/v1/discover/endpoints'
/**
 * Application identifier of the iRobot Android app, expected as is by `/v2/login`. In
 * configuration for the same reason as with Renault: the vendor may change it, and a new value
 * must be settable in `.env` without touching the code.
 */
export const DEFAULT_APP_ID = 'ANDROID-C7FB240E-DF34-42D7-AE4E-A8C17079A294'
/** The mobile app introduces itself this way; the discovery endpoint refuses anonymous clients. */
export const DEFAULT_USER_AGENT = 'aspen%20production/2618 CFNetwork/1209 Darwin/20.2.0'

const REQUEST_TIMEOUT_MS = 20_000

/** Gigya codes to tell apart from an outage. All arrive as HTTP 200. */
const GIGYA_INVALID_CREDENTIALS = 403042
const GIGYA_PENDING_2FA = 403101

export interface SessionStore {
  load(): Promise<StoredSession | null>
  save(session: StoredSession): Promise<void>
  clear(): Promise<void>
}

/**
 * Atomic JSON file (`.tmp` then `rename`) at 0600, like Renault. Missing or unreadable file = no
 * session, never a fatal error: the plugin must start even if the disk refuses.
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
  /** ISO country code sent to discovery. It picks the Gigya data center, not the deployment. */
  country: string
  userAgent: string
  fetchImpl: FetchLike
  store: SessionStore | null
  logger?: Logger
  requestTimeoutMs?: number
}

/** The iRobot account: once linked, it only serves to retrieve local passwords. */
export class IrobotAuth {
  private session: StoredSession | null = null

  constructor(private readonly opts: IrobotAuthOptions) {}

  get linked(): boolean { return (this.session?.robots.length ?? 0) > 0 }
  get robots(): StoredRobot[] { return this.session?.robots ?? [] }
  get linkedAt(): number | null { return this.session?.linkedAt ?? null }

  /** Local password of a robot found on the network, or `null` if the account doesn't know it. */
  passwordFor(blid: string): string | null {
    return this.session?.robots.find((r) => r.blid === blid)?.password ?? null
  }

  /** At startup: picks up the credentials from the file if there are any. */
  async restore(): Promise<boolean> {
    this.session = (await this.opts.store?.load()) ?? null
    return this.linked
  }

  /**
   * Links the account and retrieves the local passwords. The account password is used ONLY in
   * this call: not kept in memory beyond it, not written, not logged.
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

    // the frame BEFORE the content: Gigya refuses with HTTP 200
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

  /** Unlink: the local passwords are erased, nothing else was ever kept. */
  async forget(): Promise<void> {
    this.session = null
    await this.opts.store?.clear()
  }

  /** PUBLIC endpoint: the current Gigya key and the base of the current deployment. */
  private async discover(signal?: AbortSignal): Promise<{ httpBase: string; gigyaUrl: string; gigyaApiKey: string }> {
    const url = `${this.opts.discoveryUrl}?country_code=${encodeURIComponent(this.opts.country)}`
    const body = await this.json('iRobot endpoint discovery', url, { method: 'GET' }, signal)
    const parsed = endpointDiscoverySchema.safeParse(body)
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'iRobot endpoint discovery returned an unexpected shape')
    const deployments = parsed.data.deployments
    const current = parsed.data.current_deployment
    // `current_deployment` names the deployment to use; failing that, the last one declared (the most recent)
    const chosen = (current ? deployments[current] : undefined) ?? Object.values(deployments).at(-1)
    if (!chosen) throw new PluginError('UPSTREAM_ERROR', 'iRobot endpoint discovery listed no deployment')
    return {
      httpBase: chosen.httpBase,
      gigyaUrl: `https://accounts.${parsed.data.gigya.datacenter_domain}`,
      gigyaApiKey: parsed.data.gigya.api_key,
    }
  }

  /** A bounded request. The body is returned as is: it's the caller who knows how to read it. */
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
    // Gigya refuses with 200: an error status here is a real outage, not a credentials refusal
    if (body === null) throw new PluginError('UPSTREAM_ERROR', `${what} returned no JSON (HTTP ${res.status})`)
    if (res.status >= 400 && !gigyaResponseSchema.safeParse(body).success) {
      throw new PluginError('UPSTREAM_ERROR', `${what} refused the request (HTTP ${res.status})`)
    }
    return body
  }

  /** Translates a Gigya `errorCode`. Never the password in the message. */
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
