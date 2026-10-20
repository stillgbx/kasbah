import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import type { MelcloudAuth } from './auth'

// MELCloud HTTP client. What it translates:
//  - 401 → the `ContextKey` is dead. Nothing to refresh (there is no refresh token), so it is
//    THROWN AWAY and `NEEDS_PAIRING` goes up: the Settings card will ask for the password again,
//    rather than letting the plugin hammer a key that MELCloud refuses;
//  - 429 → `RATE_LIMITED`;
//  - the rest as `UPSTREAM_ERROR`.
//
// No token bucket here, unlike Renault: MELCloud publishes no quota, and the only known bound is
// physical — an Ecodan only talks to the cloud every few minutes (`NextCommunication` says so),
// so polling faster re-reads the same thing. It is the PACE that protects, not a counter. To be
// revisited if the vendor starts answering 429.

/** MELCloud queries the machine through its Wi-Fi module: several seconds are normal. */
export const REQUEST_TIMEOUT_MS = 30_000

export interface MelcloudClientOptions {
  baseUrl: string
  auth: MelcloudAuth
  fetchImpl: FetchLike
  logger?: Logger
  requestTimeoutMs?: number
}

export class MelcloudClient {
  constructor(private readonly opts: MelcloudClientOptions) {}

  /** The account's inventory: buildings, floors, zones and devices, in a single call. */
  listDevices(signal?: AbortSignal): Promise<unknown> {
    return this.request('GET', '/User/ListDevices', { signal })
  }

  /**
   * A machine's full state. `buildingID` is required on top of the id: MELCloud answers with an
   * error if it is omitted, even when the device is unambiguous.
   */
  device(o: { deviceId: string; buildingId: string; signal?: AbortSignal }): Promise<unknown> {
    return this.request('GET', '/Device/Get', {
      query: { id: o.deviceId, buildingID: o.buildingId },
      signal: o.signal,
    })
  }

  /**
   * A machine's energy report over a period (kWh consumed and produced, per day and per use:
   * heating, hot water, cooling). Many installations WITHOUT an energy meter answer zeros — that
   * is an answer, not a failure, and only the capture will tell what your machines really return.
   */
  energyReport(o: { deviceId: string; from: string; to: string; signal?: AbortSignal }): Promise<unknown> {
    return this.request('POST', '/EnergyCost/Report', {
      body: { DeviceId: Number(o.deviceId), FromDate: o.from, ToDate: o.to, UseCurrency: false },
      signal: o.signal,
    })
  }

  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  /** An authenticated request. The session key appears in no error message. */
  async request(method: 'GET' | 'POST', path: string, o: { query?: Record<string, string>; body?: unknown; signal?: AbortSignal } = {}): Promise<unknown> {
    const key = this.opts.auth.key()
    const url = new URL(`${this.opts.baseUrl}${path}`)
    for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v)

    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(url.toString(), {
        method,
        headers: {
          'X-MitsContextKey': key,
          accept: 'application/json',
          ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
        signal: this.deadline(o.signal),
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `MELCloud unreachable on ${path}`, { cause: err })
    }

    const text = await res.text()
    if (res.status === 401) {
      await this.opts.auth.invalidate()
      throw new PluginError('NEEDS_PAIRING', `MELCloud refused the session key (HTTP 401 on ${path}): link the account again`)
    }
    if (res.status === 429) throw new PluginError('RATE_LIMITED', `MELCloud rate limit hit on ${path}`)
    if (res.status >= 400) throw new PluginError('UPSTREAM_ERROR', `MELCloud returned HTTP ${res.status} on ${path}`)

    const body = ((): unknown => { try { return JSON.parse(text) } catch { return null } })()
    if (body === null) throw new PluginError('UPSTREAM_ERROR', `MELCloud sent invalid JSON on ${path}`)
    return body
  }
}
