import { fetch as undiciFetch } from 'undici'
import type { Logger } from 'pino'
import type { Clock } from '../../core/clock'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { authorizationUrl } from './mapping'
import {
  oauthErrorSchema, oauthTokenResponseSchema, sdmCommandResponseSchema, sdmDeviceSchema, sdmDevicesResponseSchema, sdmErrorSchema,
  sdmExtendStreamSchema, sdmRtspStreamSchema, type SdmDevice, type SdmRtspStream,
  pubsubPullResponseSchema,
} from './types'

// Client for the Google Smart Device Management API. Everything goes through the Google cloud (Nest
// devices have no local API) and through OAuth: a refresh token, obtained once when linking the
// account, gives one-hour access tokens renewed here on demand. The refresh token is the only
// lasting secret; it never leaves this class except through `exchangeCode`, which returns it to the
// user so they can paste it into `.env`.

export const SDM_BASE_URL = 'https://smartdevicemanagement.googleapis.com/v1'
export const PUBSUB_BASE_URL = 'https://pubsub.googleapis.com/v1'
export const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
/** Google usually answers within a second; beyond this delay we give up (cf. TaHoma). */
export const REQUEST_TIMEOUT_MS = 15_000
/** We renew the access token a little before its actual expiry. */
const EXPIRY_MARGIN_MS = 60_000

export interface NestClientOptions {
  projectId: string
  clientId: string
  clientSecret: string
  redirectUri: string
  refreshToken?: string
  clock: Clock
  fetchImpl?: FetchLike
  logger?: Logger
  /** Shortened in tests; in production it is `REQUEST_TIMEOUT_MS`. */
  requestTimeoutMs?: number
}

/** The same stream URL with another `auth` token (the one returned by `ExtendRtspStream`). */
export function rtspUrlWithToken(rtspUrl: string, streamToken: string): string {
  const u = new URL(rtspUrl)
  u.searchParams.set('auth', streamToken)
  return u.toString()
}

export class NestClient {
  readonly fetchImpl: FetchLike
  private refreshToken: string | undefined
  private accessToken: string | undefined
  private accessTokenExpiresAt = 0
  /** Send times of the commands, for the caller to stay under Google's per-minute quota. */
  private commandTimes: number[] = []

  constructor(private readonly opts: NestClientOptions) {
    this.refreshToken = opts.refreshToken
    this.fetchImpl = opts.fetchImpl
      ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
  }

  /** A Google account is linked (refresh token known). */
  get linked(): boolean { return this.refreshToken !== undefined }

  authorizationUrl(state: string): string {
    return authorizationUrl({ projectId: this.opts.projectId, clientId: this.opts.clientId, redirectUri: this.opts.redirectUri, state })
  }

  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private async send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Awaited<ReturnType<FetchLike>>> {
    try {
      return await this.fetchImpl(url, { ...init, signal: this.deadline(signal) })
    } catch (err) {
      if ((err as Error).name === 'TimeoutError' && signal?.aborted !== true) {
        throw new PluginError('TIMEOUT', `Google did not answer within ${this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS} ms`, { cause: err })
      }
      throw new PluginError('UPSTREAM_ERROR', `Google unreachable (${(err as Error).message})`, { cause: err })
    }
  }

  /**
   * Exchanges the authorization code received on the redirect for a refresh token, adopted right
   * away. Also returns it to the caller: the server does not write `.env`.
   */
  async exchangeCode(code: string, signal?: AbortSignal): Promise<{ refreshToken: string }> {
    const token = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.opts.redirectUri }, signal)
    if (!token.refresh_token) {
      throw new PluginError('UPSTREAM_ERROR', 'Google returned no refresh token (the consent screen must be shown with access_type=offline)')
    }
    this.refreshToken = token.refresh_token
    return { refreshToken: token.refresh_token }
  }

  private async tokenRequest(params: Record<string, string>, signal?: AbortSignal) {
    const body = new URLSearchParams({ client_id: this.opts.clientId, client_secret: this.opts.clientSecret, ...params })
    const res = await this.send(OAUTH_TOKEN_URL, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString(),
    }, signal)
    const json = await res.json().catch(() => undefined)
    if (!res.ok) {
      const e = oauthErrorSchema.safeParse(json)
      const code = e.success ? e.data.error : undefined
      const detail = e.success && e.data.error_description ? ` (${e.data.error_description})` : ''
      // `invalid_grant`: code already used, or refresh token revoked / expired → the account must
      // be linked again. The rest (wrong client_id / secret) is a config error.
      if (code === 'invalid_grant') throw new PluginError('NEEDS_PAIRING', `Google refused the grant${detail}: link the account again`)
      throw new PluginError('UPSTREAM_ERROR', `Google OAuth HTTP ${res.status}${code ? ` ${code}` : ''}${detail}`)
    }
    const parsed = oauthTokenResponseSchema.safeParse(json)
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'unexpected token response from Google')
    this.accessToken = parsed.data.access_token
    this.accessTokenExpiresAt = this.opts.clock.now() + (parsed.data.expires_in ?? 3600) * 1000
    return parsed.data
  }

  /** Valid access token, renewed if needed. */
  private async accessTokenFor(signal?: AbortSignal): Promise<string> {
    if (!this.refreshToken) throw new PluginError('NEEDS_PAIRING', 'no Google account linked (NEST_REFRESH_TOKEN)')
    if (this.accessToken && this.opts.clock.now() < this.accessTokenExpiresAt - EXPIRY_MARGIN_MS) return this.accessToken
    await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.refreshToken }, signal)
    return this.accessToken!
  }

  /**
   * Authenticated SDM request. Google's statuses are translated into plugin errors: 400 comes from a
   * command the device refuses in its state (`FAILED_PRECONDITION`: setpoint while in eco…), 404
   * from a device no longer shared, 403 from a badly configured project — its message is passed up
   * as is, it says exactly what is missing.
   */
  private async request(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const token = await this.accessTokenFor(signal)
    const res = await this.send(`${SDM_BASE_URL}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }, signal)
    const json = await res.json().catch(() => undefined)
    if (res.ok) return json
    const e = sdmErrorSchema.safeParse(json)
    const message = e.success ? e.data.error?.message : undefined
    const suffix = message ? ` (${message})` : ''
    if (res.status === 401) {
      this.accessToken = undefined                     // we will retry with a fresh token on the next call
      throw new PluginError('NEEDS_PAIRING', `Google rejected the access token${suffix}`)
    }
    if (res.status === 400) throw new PluginError('UNSUPPORTED_COMMAND', `Google refused the command${suffix}`)
    if (res.status === 404) throw new PluginError('DEVICE_UNAVAILABLE', `device unknown to Google${suffix}`)
    if (res.status === 429) throw new PluginError('RATE_LIMITED', `Google SDM rate limit${suffix}`)
    throw new PluginError('UPSTREAM_ERROR', `Google SDM HTTP ${res.status}${suffix}`)
  }

  private devicesPath(): string { return `/enterprises/${encodeURIComponent(this.opts.projectId)}/devices` }

  /**
   * All devices shared with the project. Validated one by one: a device with an unexpected shape
   * does not deprive the house of the others. `raw` is the response as received, to capture a real
   * fixture (`GET /api/plugins/nest/devices/raw`).
   */
  async listDevices(signal?: AbortSignal): Promise<{ raw: unknown; devices: SdmDevice[] }> {
    const raw = await this.request('GET', this.devicesPath(), undefined, signal)
    const envelope = sdmDevicesResponseSchema.safeParse(raw)
    if (!envelope.success) throw new PluginError('UPSTREAM_ERROR', 'unexpected device list from Google')
    const devices: SdmDevice[] = []
    for (const item of envelope.data.devices) {
      const r = sdmDeviceSchema.safeParse(item)
      if (r.success) devices.push(r.data)
      else this.opts.logger?.debug({ issues: r.error.issues }, 'Nest device skipped')
    }
    return { raw, devices }
  }

  /** One device, read again after a command to publish the state Google actually kept. */
  async getDevice(externalId: string, signal?: AbortSignal): Promise<SdmDevice> {
    const raw = await this.request('GET', `${this.devicesPath()}/${encodeURIComponent(externalId)}`, undefined, signal)
    const r = sdmDeviceSchema.safeParse(raw)
    if (!r.success) throw new PluginError('UPSTREAM_ERROR', 'unexpected device from Google')
    return r.data
  }

  /**
   * How many commands were sent in the last `ms`, refused ones included: every kind (streams,
   * thermostat) shares Google's quota of 10 commands per minute and per user.
   */
  commandsWithin(ms: number): number {
    const since = this.opts.clock.now() - ms
    return this.commandTimes.filter((t) => t > since).length
  }

  /** `POST …/devices/<id>:executeCommand`. Resolves on Google's ack (200) with its `results`, if any. */
  async executeCommand(externalId: string, command: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const now = this.opts.clock.now()
    this.commandTimes = this.commandTimes.filter((t) => t > now - 10 * 60_000)
    this.commandTimes.push(now)
    const raw = await this.request('POST', `${this.devicesPath()}/${encodeURIComponent(externalId)}:executeCommand`, { command, params }, signal)
    const r = sdmCommandResponseSchema.safeParse(raw)
    return r.success ? r.data.results : undefined
  }

  // ---- RTSP stream (1st-generation cameras) ------------------------------------------------
  // Google opens an RTSP session on demand: the URL lasts five minutes, and it is the extension
  // token that keeps it alive — the caller must extend BEFORE the deadline, then stop the session
  // when nobody is watching anymore (otherwise it runs until it expires).

  async generateRtspStream(externalId: string, signal?: AbortSignal): Promise<SdmRtspStream> {
    const results = await this.executeCommand(externalId, 'sdm.devices.commands.CameraLiveStream.GenerateRtspStream', {}, signal)
    const r = sdmRtspStreamSchema.safeParse(results)
    if (!r.success) {
      this.opts.logger?.warn({ results }, 'unexpected GenerateRtspStream results')
      throw new PluginError('UPSTREAM_ERROR', 'unexpected RTSP stream response from Google')
    }
    return r.data
  }

  /**
   * Extends the session: new extension token AND new `streamToken`. The latter is not decorative —
   * the current RTSP connection is cut at the initial deadline (observed), one must reconnect on the
   * URL carrying the new token (`?auth=`), see `rtspUrlWithToken`.
   */
  async extendRtspStream(externalId: string, streamExtensionToken: string, signal?: AbortSignal): Promise<{ streamExtensionToken: string; streamToken?: string; expiresAt?: string }> {
    const results = await this.executeCommand(externalId, 'sdm.devices.commands.CameraLiveStream.ExtendRtspStream', { streamExtensionToken }, signal)
    const r = sdmExtendStreamSchema.safeParse(results)
    if (!r.success) throw new PluginError('UPSTREAM_ERROR', 'unexpected ExtendRtspStream response from Google')
    return {
      streamExtensionToken: r.data.streamExtensionToken,
      ...(r.data.streamToken ? { streamToken: r.data.streamToken } : {}),
      ...(r.data.expiresAt ? { expiresAt: r.data.expiresAt } : {}),
    }
  }

  async stopRtspStream(externalId: string, streamExtensionToken: string, signal?: AbortSignal): Promise<void> {
    await this.executeCommand(externalId, 'sdm.devices.commands.CameraLiveStream.StopRtspStream', { streamExtensionToken }, signal)
  }

  /**
   * Pulls the pending events of a Pub/Sub subscription (ring, motion…), with the SAME OAuth token as
   * SDM (`pubsub` scope). The subscription is of the "pull" type: the server goes and fetches, no
   * public endpoint to expose. Returns the unacknowledged messages; the caller decodes and
   * `acknowledge`s those it has handled, otherwise Google will deliver them again.
   */
  async pullEvents(subscription: string, maxMessages: number, signal?: AbortSignal): Promise<{ ackId: string; data?: string }[]> {
    // `returnImmediately`: Google answers right away (empty list if nothing) instead of HOLDING the
    // request while waiting for a message (long-polling) — otherwise an empty subscription hangs until
    // our timeout and logs a TIMEOUT in a loop. We come back every NEST_PUBSUB_POLL_MS, a ring arrives fast.
    const json = await this.pubsub('POST', `/${subscription}:pull`, { maxMessages, returnImmediately: true }, signal)
    const r = pubsubPullResponseSchema.safeParse(json)
    if (!r.success) throw new PluginError('UPSTREAM_ERROR', 'unexpected Pub/Sub pull response from Google')
    return (r.data.receivedMessages ?? []).map((m) => ({ ackId: m.ackId, ...(m.message?.data !== undefined ? { data: m.message.data } : {}) }))
  }

  /** Acknowledges the handled messages: without it, Google redelivers them after the retention delay. */
  async acknowledge(subscription: string, ackIds: string[], signal?: AbortSignal): Promise<void> {
    if (ackIds.length === 0) return
    await this.pubsub('POST', `/${subscription}:acknowledge`, { ackIds }, signal)
  }

  private async pubsub(method: 'POST', path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const token = await this.accessTokenFor(signal)
    const res = await this.send(`${PUBSUB_BASE_URL}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, signal)
    const json = await res.json().catch(() => undefined)
    if (res.ok) return json
    const e = sdmErrorSchema.safeParse(json)
    const suffix = e.success && e.data.error?.message ? ` (${e.data.error.message})` : ''
    if (res.status === 401) { this.accessToken = undefined; throw new PluginError('NEEDS_PAIRING', `Google rejected the Pub/Sub token${suffix}`) }
    if (res.status === 403) throw new PluginError('NEEDS_PAIRING', `Pub/Sub access refused${suffix}: re-link with the pubsub scope, and grant the subscription to this account`)
    if (res.status === 404) throw new PluginError('UPSTREAM_ERROR', `Pub/Sub subscription unknown${suffix}: check NEST_PUBSUB_SUBSCRIPTION`)
    if (res.status === 429) throw new PluginError('RATE_LIMITED', `Pub/Sub rate limit${suffix}`)
    throw new PluginError('UPSTREAM_ERROR', `Pub/Sub HTTP ${res.status}${suffix}`)
  }
}
