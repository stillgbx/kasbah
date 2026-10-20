import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import type { TeslaAuth } from './auth'

// HTTP client for the Fleet API. What it translates:
//  - 401 → we refresh ONCE and replay; 401 again → `NEEDS_PAIRING` (account to link again);
//  - 408 → the vehicle is ASLEEP. It's not an error: it's the normal response of `vehicle_data` on
//    a sleeping vehicle, returned as `DEVICE_UNAVAILABLE` so the plugin can recognize it;
//  - 429 → `RATE_LIMITED` (60 reads / min, 3 wake-ups / min, 30 commands / min per vehicle);
//  - the rest as `UPSTREAM_ERROR`.
// Every call that gets through (status < 500) is BILLED by Tesla: it's up to the plugin to count
// them, not to the client to refuse them.

/**
 * `vehicle_data` queries the car over the mobile network: the vendor itself takes several
 * seconds, and up to about ten when the vehicle comes out of sleep.
 */
export const REQUEST_TIMEOUT_MS = 30_000

export interface TeslaClientOptions {
  baseUrl: string
  auth: TeslaAuth
  fetchImpl: FetchLike
  logger?: Logger
  requestTimeoutMs?: number
  /**
   * Called for each ACCOUNT request that got a response, with its path. Tesla bills everything that
   * answers below 500 — a 408 "car asleep" included —, and it's through this that the plugin keeps
   * track of its monthly usage. Partner requests are not part of it.
   */
  onCall?: (path: string, status: number) => void
}

export class TeslaClient {
  constructor(private readonly opts: TeslaClientOptions) {}

  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  /** Request on behalf of the ACCOUNT (token refreshed as needed). */
  async request(method: 'GET' | 'POST', path: string, o: { body?: unknown; signal?: AbortSignal } = {}): Promise<unknown> {
    let token = await this.opts.auth.accessToken(o.signal)
    let res = await this.send(method, path, token, o)
    if (res.status === 401) {
      token = await this.opts.auth.refresh(o.signal)
      res = await this.send(method, path, token, o)
    }
    // before interpreting: a 408 or a 4xx was indeed billed, and must count
    if (res.status < 500) this.opts.onCall?.(path, res.status)
    return this.interpret(res, path)
  }

  /** Request on behalf of the PARTNER (domain registration): token provided by the caller. */
  async partnerRequest(method: 'GET' | 'POST', path: string, token: string, o: { body?: unknown; signal?: AbortSignal } = {}): Promise<unknown> {
    return this.interpret(await this.send(method, path, token, o), path)
  }

  private async send(method: string, path: string, token: string, o: { body?: unknown; signal?: AbortSignal }): Promise<{ status: number; text: string }> {
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(`${this.opts.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`, accept: 'application/json',
          ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
        signal: this.deadline(o.signal),
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `Tesla Fleet API unreachable on ${path}`, { cause: err })
    }
    return { status: res.status, text: await res.text() }
  }

  private interpret(res: { status: number; text: string }, path: string): unknown {
    if (res.status === 401) {
      throw new PluginError('NEEDS_PAIRING', `Tesla refused the token (HTTP 401 on ${path}): link the account again`)
    }
    // 403: the token is good but lacks the RIGHT — missing scope, application not registered,
    // vehicle not shared. The body says which, and it's the only useful thing to surface; linking
    // the account again wouldn't change anything
    if (res.status === 403) throw new PluginError('UPSTREAM_ERROR', `Tesla forbids ${path} (HTTP 403)${detail(res.text)}`)
    if (res.status === 408) throw new PluginError('DEVICE_UNAVAILABLE', `vehicle is asleep or offline (HTTP 408 on ${path})`)
    if (res.status === 429) throw new PluginError('RATE_LIMITED', `Tesla rate limit hit on ${path}`)
    if (res.status >= 400) {
      throw new PluginError('UPSTREAM_ERROR', `Tesla Fleet API returned HTTP ${res.status} on ${path}${detail(res.text)}`)
    }
    try { return JSON.parse(res.text) as unknown }
    catch (err) { throw new PluginError('UPSTREAM_ERROR', `Tesla Fleet API sent invalid JSON on ${path}`, { cause: err }) }
  }
}

/** The body's `error`, when Tesla puts one there: it's what explains a 4xx. */
function detail(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: unknown; error_description?: unknown }
    const e = [j.error, j.error_description].filter((s) => typeof s === 'string' && s).join(' — ')
    return e ? `: ${e}` : ''
  } catch { return '' }
}
