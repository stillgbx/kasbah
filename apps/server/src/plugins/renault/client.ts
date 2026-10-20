import type { Logger } from 'pino'
import type { Clock } from '../../core/clock'
import { PluginError, type PluginErrorCode } from '../../core/plugin'
import { TokenBucket } from '../../core/rate-limit'
import type { FetchLike } from '../../core/sse'
import type { RenaultAuth } from './auth'
import { kamereonErrorsSchema } from './types'

// HTTP client for Kamereon, Renault's vehicle API. What it translates:
//  - 401 → we renew the JWT ONCE and replay; 401 again → `NEEDS_PAIRING`;
//  - 403 `err.func.wired.forbidden` → the endpoint DOES NOT EXIST FOR THIS VEHICLE. It's not an
//    outage: on an R5 E-Tech, `pressure`, `charge-mode` and `lock-status` always answer that.
//    The plugin must be able to recognize it to stop asking — hence `upstreamCode`;
//  - 429 → `RATE_LIMITED`;
//  - the rest as `UPSTREAM_ERROR`.
//
// The API is FREE (nothing like Tesla), but its rate is tight and Renault tightened it at the end
// of 2025: a token bucket bounds the plugin BEFORE calling, rather than waiting for the 429.

/** What Renault tolerates in practice, the value used by the other integrations: 60 per hour. */
export const DEFAULT_RATE_PER_HOUR = 60
/** Kamereon queries the car over the mobile network: several seconds are normal. */
export const REQUEST_TIMEOUT_MS = 30_000

/** Kamereon error that also carries the body's in-house code. */
export class RenaultApiError extends PluginError {
  constructor(code: PluginErrorCode, message: string, readonly upstreamCode?: string, options?: { cause?: unknown }) {
    super(code, message, options)
    this.name = 'RenaultApiError'
  }
}

/**
 * "This endpoint is not served for this vehicle" — permanent, not a passing outage. The plugin uses
 * it to strike a reading off its list instead of retrying it every seven minutes.
 */
export function isEndpointUnavailable(err: unknown): boolean {
  return err instanceof RenaultApiError
    && (err.upstreamCode === 'err.func.wired.forbidden' || err.upstreamCode === 'err.func.wired.notFound')
}

/**
 * "Not now" — and not an outage. Two distinct refusals, both normal:
 *   - HTTP 409 `err.func.vcps.ev.post-settings.error`: a settings command is ALREADY pending for
 *     this vehicle, the next one is refused until it is purged. Observed on 2026-09-19: the same
 *     body accepted at 14:21 was refused at 14:22, then again at 14:33;
 *   - `RATE_LIMITED` (429): actions have their own quota, tighter than readings'.
 * Confusing them with an outage is what made five hours of failures unreadable.
 */
export function isDeferred(err: unknown): boolean {
  return (err instanceof RenaultApiError && err.upstreamCode === 'err.func.vcps.ev.post-settings.error')
    || (err instanceof PluginError && err.code === 'RATE_LIMITED')
}

export type Adapter = 'kca' | 'kcm'

/**
 * Path of a vehicle reading. Two families coexist, and they don't look alike:
 *   - `kca`: `.../kamereon/kca/car-adapter/v{n}/cars/{vin}/{endpoint}` (battery, cockpit…);
 *   - `kcm`: `.../kamereon/kcm/v{n}/vehicles/{vin}/{endpoint}` (the EV settings of recent
 *     models — `ev/soc-levels`, `ev/settings`: that's the route the R5 takes).
 * Pure, hence reusable as is by the raw reading.
 */
export function carDataPath(o: { accountId: string; vin: string; endpoint: string; version?: number; adapter?: Adapter }): string {
  const account = encodeURIComponent(o.accountId)
  const vin = encodeURIComponent(o.vin)
  const v = o.version ?? 1
  return o.adapter === 'kcm'
    ? `/commerce/v1/accounts/${account}/kamereon/kcm/v${v}/vehicles/${vin}/${o.endpoint}`
    : `/commerce/v1/accounts/${account}/kamereon/kca/car-adapter/v${v}/cars/${vin}/${o.endpoint}`
}

export interface RenaultClientOptions {
  baseUrl: string
  apiKey: string
  /** Country code (`FR`), required as a query parameter on ALL routes. */
  country: string
  auth: RenaultAuth
  fetchImpl: FetchLike
  clock: Clock
  logger?: Logger
  requestTimeoutMs?: number
  ratePerHour?: number
}

export class RenaultClient {
  private readonly bucket: TokenBucket

  constructor(private readonly opts: RenaultClientOptions) {
    const perHour = opts.ratePerHour ?? DEFAULT_RATE_PER_HOUR
    this.bucket = new TokenBucket(perHour, perHour / 3600, opts.clock)
  }

  /** Delay (ms) before a call is allowed — 0 if the rate budget lets one through. */
  waitMs(): number { return this.bucket.waitMs() }

  /** A Kamereon request, token renewed as needed and rate respected. */
  async request(method: 'GET' | 'POST', path: string, o: { query?: Record<string, string>; body?: unknown; signal?: AbortSignal } = {}): Promise<unknown> {
    if (!this.bucket.tryTake()) {
      throw new PluginError('RATE_LIMITED', `Renault rate budget spent, next call in ${Math.ceil(this.bucket.waitMs() / 1000)} s`)
    }
    let jwt = await this.opts.auth.jwt(o.signal)
    let res = await this.send(method, path, jwt, o)
    if (res.status === 401) {
      jwt = await this.opts.auth.mintJwt(o.signal)
      res = await this.send(method, path, jwt, o)
    }
    return this.interpret(res, path)
  }

  /** The person's Kamereon accounts. */
  person(personId: string, signal?: AbortSignal): Promise<unknown> {
    return this.request('GET', `/commerce/v1/persons/${encodeURIComponent(personId)}`, { signal })
  }

  /** An account's vehicles. */
  vehicles(accountId: string, signal?: AbortSignal): Promise<unknown> {
    return this.request('GET', `/commerce/v1/accounts/${encodeURIComponent(accountId)}/vehicles`, { signal })
  }

  /** A vehicle's record: it's where what the account knows about it lives, beyond the car-adapter. */
  vehicleDetails(accountId: string, vin: string, signal?: AbortSignal): Promise<unknown> {
    return this.request('GET', `/commerce/v1/accounts/${encodeURIComponent(accountId)}/vehicles/${encodeURIComponent(vin)}/details`, { signal })
  }

  /**
   * The vehicle's contracts: warranties, connected services, maintenance. Read ON DEMAND only
   * ("Edit" panel button) — nothing there changes from one week to the next.
   */
  vehicleContracts(accountId: string, vin: string, locale: string, signal?: AbortSignal): Promise<unknown> {
    return this.request('GET', `/commerce/v1/accounts/${encodeURIComponent(accountId)}/vehicles/${encodeURIComponent(vin)}/contracts`, {
      query: { locale, brand: 'RENAULT', connectedServicesContracts: 'true', warranty: 'true', warrantyMaintenanceContracts: 'true' },
      signal,
    })
  }

  /**
   * Rewrites the EV settings. **It's the write that wakes the car**, not its content: on the recent
   * platform (R5, Scenic), `charge/pause-resume` answers 403 and only this POST makes the telematics
   * unit react. The body is the one we just READ, timestamp refreshed — certainly not invented
   * values, which would overwrite the chosen start time and temperature.
   */
  writeEvSettings(o: { accountId: string; vin: string; body: unknown; signal?: AbortSignal }): Promise<unknown> {
    const path = carDataPath({ accountId: o.accountId, vin: o.vin, endpoint: 'ev/settings', version: 1, adapter: 'kcm' })
    return this.request('POST', path, { body: o.body, signal: o.signal })
  }

  /**
   * Writes the EV LEVELS (`ev/soc-levels`, kcm): that's where the charge target lives, next to the
   * floor the user set in the car. Same precaution as `writeEvSettings`: the body is the one we
   * just read, only the target changes.
   */
  writeSocLevels(o: { accountId: string; vin: string; body: unknown; signal?: AbortSignal }): Promise<unknown> {
    const path = carDataPath({ accountId: o.accountId, vin: o.vin, endpoint: 'ev/soc-levels', version: 1, adapter: 'kcm' })
    return this.request('POST', path, { body: o.body, signal: o.signal })
  }

  /**
   * Precondition now (`start`, 10 min at most) or stop (`cancel`). A `kca` ACTION: its quota is much
   * tighter than the readings' (429 then account blocked for 1 h, on 2026-09-19).
   */
  hvacStart(o: { accountId: string; vin: string; body: unknown; signal?: AbortSignal }): Promise<unknown> {
    const path = carDataPath({ accountId: o.accountId, vin: o.vin, endpoint: 'actions/hvac-start', version: 1, adapter: 'kca' })
    return this.request('POST', path, { body: o.body, signal: o.signal })
  }

  /** A vehicle reading (see `carDataPath`). */
  carData(o: { accountId: string; vin: string; endpoint: string; version?: number; adapter?: Adapter; signal?: AbortSignal }): Promise<unknown> {
    return this.request('GET', carDataPath(o), { signal: o.signal })
  }

  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private async send(method: string, path: string, jwt: string, o: { query?: Record<string, string>; body?: unknown; signal?: AbortSignal }): Promise<{ status: number; text: string }> {
    const url = new URL(`${this.opts.baseUrl}${path}`)
    url.searchParams.set('country', this.opts.country)
    for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v)
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(url.toString(), {
        method,
        headers: {
          apikey: this.opts.apiKey,
          'x-gigya-id_token': jwt,
          accept: 'application/json',
          ...(o.body !== undefined ? { 'content-type': 'application/vnd.api+json' } : {}),
        },
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
        signal: this.deadline(o.signal),
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `Renault API unreachable on ${path}`, { cause: err })
    }
    return { status: res.status, text: await res.text() }
  }

  private interpret(res: { status: number; text: string }, path: string): unknown {
    const body = ((): unknown => { try { return JSON.parse(res.text) } catch { return null } })()
    const upstream = upstreamCode(body)
    if (res.status === 401) {
      throw new RenaultApiError('NEEDS_PAIRING', `Renault refused the token (HTTP 401 on ${path}): link the account again`, upstream)
    }
    if (res.status === 403) {
      throw new RenaultApiError('UPSTREAM_ERROR', `Renault forbids ${path} (HTTP 403${upstream ? `, ${upstream}` : ''})`, upstream)
    }
    if (res.status === 429) throw new RenaultApiError('RATE_LIMITED', `Renault rate limit hit on ${path}`, upstream)
    if (res.status >= 400) {
      throw new RenaultApiError('UPSTREAM_ERROR', `Renault API returned HTTP ${res.status} on ${path}${upstream ? `: ${upstream}` : ''}`, upstream)
    }
    if (body === null) throw new PluginError('UPSTREAM_ERROR', `Renault API sent invalid JSON on ${path}`)
    return body
  }
}

/** The body's first `errors[].errorCode`, when Kamereon puts one there. */
function upstreamCode(body: unknown): string | undefined {
  const parsed = kamereonErrorsSchema.safeParse(body)
  if (!parsed.success) return undefined
  return parsed.data.errors[0]?.errorCode
}
