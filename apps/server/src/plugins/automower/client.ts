import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { detail, type AutomowerAuth } from './auth'

// HTTP client for the Automower Connect API. Three mandatory headers on every call:
// `Authorization: Bearer`, `Authorization-Provider: husqvarna` and `X-Api-Key` (the application
// key, the same as the token's). The body is JSON:API (`application/vnd.api+json`).
//
// What it translates:
//  - 401 → the token is stale or revoked: request ONE new token and replay; 401 again →
//    `NEEDS_PAIRING` (key or secret to review);
//  - 403 → forbidden: that is also how the vendor answers when the key's QUOTA
//    (21 000 requests per 7-day window, see `state.ts`) is exhausted — `RATE_LIMITED`, the
//    body says which;
//  - 429 → more than one request per second: `RATE_LIMITED`;
//  - 404 → robot unknown to this account: `DEVICE_UNAVAILABLE`;
//  - the rest as `UPSTREAM_ERROR`.
// Every request is COUNTED (`onCall`): it is up to the plugin to keep within the month's quota.

export const API_BASE_URL = 'https://api.amc.husqvarna.dev/v1'
export const REQUEST_TIMEOUT_MS = 20_000

export interface AutomowerClientOptions {
  auth: AutomowerAuth
  appKey: string
  fetchImpl: FetchLike
  baseUrl?: string
  logger?: Logger
  requestTimeoutMs?: number
  /** A request that received a response, whatever it is: the vendor's quota counts it. */
  onCall?: (path: string, status: number) => void
}

export class AutomowerClient {
  constructor(private readonly opts: AutomowerClientOptions) {}

  /** `GET /mowers`: every robot of the account, full state included. */
  mowers(signal?: AbortSignal): Promise<unknown> { return this.request('GET', '/mowers', { signal }) }

  /** `GET /mowers/{id}/messages`: the robot's log (errors and warnings, dated and positioned). */
  messages(mowerId: string, signal?: AbortSignal): Promise<unknown> {
    return this.request('GET', `/mowers/${encodeURIComponent(mowerId)}/messages`, { signal })
  }

  /** `POST /mowers/{id}/actions`: Start, Pause, Park… The vendor acknowledges with a 202 without body. */
  action(mowerId: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.request('POST', `/mowers/${encodeURIComponent(mowerId)}/actions`, { body, signal })
  }

  /** `POST /mowers/{id}/errors/confirm`: clears the current error, if the robot says it is confirmable (202). */
  confirmError(mowerId: string, signal?: AbortSignal): Promise<unknown> {
    return this.request('POST', `/mowers/${encodeURIComponent(mowerId)}/errors/confirm`, { signal })
  }

  /** `PATCH /mowers/{id}/stayOutZones/{zoneId}`: enables or disables a stay-out zone (202). */
  stayOutZone(mowerId: string, zoneId: string, enable: boolean, signal?: AbortSignal): Promise<unknown> {
    const body = { data: { type: 'stayOutZone', id: zoneId, attributes: { enable } } }
    return this.request('PATCH', `/mowers/${encodeURIComponent(mowerId)}/stayOutZones/${encodeURIComponent(zoneId)}`, { body, signal })
  }

  /**
   * `GET /mowers/{id}/maps/{kind}`: a map as SVG (`generated` = the grounds surveyed by an AIM
   * robot, `zone` = its stay-out zones and hand-drawn paths, `site` = the map of an EPOS robot).
   * `null` when the robot has none (404: no zone drawn, or not that kind of robot).
   */
  async mapSvg(mowerId: string, kind: 'generated' | 'zone' | 'site', signal?: AbortSignal): Promise<string | null> {
    const path = `/mowers/${encodeURIComponent(mowerId)}/maps/${kind}`
    const res = await this.exchange('GET', path, { signal, accept: 'image/svg+xml, application/vnd.api+json' })
    if (res.status === 404) return null
    if (res.status >= 400) this.interpret(res, path)
    return res.text
  }

  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  async request(method: 'GET' | 'POST' | 'PATCH', path: string, o: { body?: unknown; signal?: AbortSignal } = {}): Promise<unknown> {
    return this.interpret(await this.exchange(method, path, o), path)
  }

  /** One round trip, replayed ONCE with a fresh token on 401; the raw response, not interpreted. */
  private async exchange(method: string, path: string, o: { body?: unknown; signal?: AbortSignal; accept?: string }): Promise<{ status: number; text: string }> {
    let token = await this.opts.auth.accessToken(o.signal)
    let res = await this.send(method, path, token, o)
    if (res.status === 401) {
      this.opts.auth.invalidate()
      token = await this.opts.auth.accessToken(o.signal)
      res = await this.send(method, path, token, o)
    }
    return res
  }

  private async send(method: string, path: string, token: string, o: { body?: unknown; signal?: AbortSignal; accept?: string }): Promise<{ status: number; text: string }> {
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(`${this.opts.baseUrl ?? API_BASE_URL}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'authorization-provider': 'husqvarna',
          'x-api-key': this.opts.appKey,
          accept: o.accept ?? 'application/vnd.api+json',
          ...(o.body !== undefined ? { 'content-type': 'application/vnd.api+json' } : {}),
        },
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
        signal: this.deadline(o.signal),
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `Automower Connect API unreachable on ${path}`, { cause: err })
    }
    this.opts.onCall?.(path, res.status)
    return { status: res.status, text: await res.text() }
  }

  private interpret(res: { status: number; text: string }, path: string): unknown {
    if (res.status === 401) throw new PluginError('NEEDS_PAIRING', `Husqvarna refused the token (HTTP 401 on ${path}): check the application key and secret`)
    if (res.status === 403) throw new PluginError('RATE_LIMITED', `Husqvarna forbids ${path} (HTTP 403, weekly quota of 21 000 requests exhausted?)${detail(res.text)}`)
    if (res.status === 429) throw new PluginError('RATE_LIMITED', `Husqvarna rate limit hit on ${path} (1 request per second)`)
    if (res.status === 404) throw new PluginError('DEVICE_UNAVAILABLE', `Husqvarna knows no such mower (HTTP 404 on ${path})`)
    if (res.status >= 400) throw new PluginError('UPSTREAM_ERROR', `Automower Connect API returned HTTP ${res.status} on ${path}${detail(res.text)}`)
    // 202 Accepted without body on an action: nothing to read
    if (!res.text.trim()) return null
    try { return JSON.parse(res.text) as unknown }
    catch (err) { throw new PluginError('UPSTREAM_ERROR', `Automower Connect API sent invalid JSON on ${path}`, { cause: err }) }
  }
}
