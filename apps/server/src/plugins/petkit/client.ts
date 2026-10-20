import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { PetkitAuth } from './auth'
import { detailPath } from './mapping'
import { petkitEnvelopeSchema } from './types'

// PetKit HTTP client. What it translates:
//  - a session refusal (code 5, as HTTP 200) → the session is DISCARDED and the error surfaces as
//    `NEEDS_PAIRING`. With no password, there's nothing to retry on its own: the Settings card
//    must ask for a code again. Keeping a dead session would make every call fail silently, for
//    the whole length of the lease — the known bug we refuse to reproduce;
//  - 429 → `RATE_LIMITED`;
//  - the rest as `UPSTREAM_ERROR`.
//
// No token bucket: PetKit publishes no quota. What protects us here is the RATE (five minutes for
// the feeders, ten for the fountains), not a counter. To be revisited the day the vendor starts
// answering 429 — which `RATE_LIMITED` will make visible in Settings.

export const REQUEST_TIMEOUT_MS = 30_000

export interface PetkitClientOptions {
  auth: PetkitAuth
  fetchImpl: FetchLike
  logger?: Logger
  requestTimeoutMs?: number
}

export class PetkitClient {
  constructor(private readonly opts: PetkitClientOptions) {}

  /**
   * The account's "families". A REQUIRED step before the inventory: the roster is requested per
   * group, there is no "whole account" view. It's also the route taken by devices shared by
   * another account — this house's case, since the account is dedicated.
   */
  families(signal?: AbortSignal): Promise<unknown> {
    return this.post('group/family/list', {}, signal)
  }

  /**
   * The inventory of ONE group. `day` and `groupId` are required: without them, PetKit answers
   * "Request is incorrect." — verified on the real account on 09/21.
   */
  roster(groupId: string, day: string, signal?: AbortSignal): Promise<unknown> {
    return this.post('discovery/device_roster_v2', { day, groupId }, signal)
  }

  /**
   * A device's state. The path depends on the FAMILY, not just the model: a feeder answers on
   * `<type>/device_detail`, a Bluetooth fountain on `<type>/deviceData` (see `detailPath`). For a
   * fountain, what the cloud returns is the LAST SYNC — opening a relay before this call is what
   * refreshes it.
   */
  deviceDetail(type: string, deviceId: string, signal?: AbortSignal): Promise<unknown> {
    return this.post(detailPath(type), { id: deviceId }, signal)
  }

  /**
   * Serve a portion. `amount` in grams for a single-hopper feeder (`d4`); two-hopper models want
   * `amount1`/`amount2`, and are not covered here.
   *
   * `day`: PetKit files the portion in the plan of the current DAY, in YYYYMMDD format. Without it,
   * the portion goes into an undetermined day according to the third-party libraries.
   */
  manualFeed(type: string, deviceId: string, grams: number, day: string, signal?: AbortSignal): Promise<unknown> {
    return this.post(`${type}/saveDailyFeed`, { deviceId, day, time: '-1', amount: String(grams) }, signal)
  }

  /**
   * The day's VISITS to a fountain. Three required parameters, including the identifier of the
   * owning USER — which the device itself carries (`userId` in its reading): without it,
   * "L'appareil n'a pas été trouvé. (code 703)".
   */
  workRecord(o: { type: string; deviceId: string; userId: string }, day: string, signal?: AbortSignal): Promise<unknown> {
    return this.post(`${o.type}/getWorkRecord`, { day, deviceId: o.deviceId, userId: o.userId }, signal)
  }

  /** Play the recorded sound to call the animal. */
  callPet(type: string, deviceId: string, signal?: AbortSignal): Promise<unknown> {
    return this.post(`${type}/callPet`, { deviceId }, signal)
  }

  /**
   * Authenticated request. `ensureFresh` first: the session is extended before being used, never
   * after a failure — with no password, a failure is already too late.
   */
  async post(path: string, form: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    await this.opts.auth.ensureFresh(signal)
    const url = `${this.opts.auth.gateway.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => { ctrl.abort() }, this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    try {
      const res = await this.opts.fetchImpl(url, {
        method: 'POST',
        headers: {
          // The FULL set, as on unauthenticated calls: `X-Api-Version`, `X-Client`,
          // `X-TimezoneId`… Omitting them here made `discovery/device_roster_v2` answer "Request is
          // incorrect." even though the session was valid (verified on 09/21).
          ...this.opts.auth.baseHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded',
          ...this.opts.auth.headers(),
        },
        body: new URLSearchParams(form).toString(),
        signal: signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal,
      })
      if (res.status === 429) throw new PluginError('RATE_LIMITED', `PetKit ${path}: rate limited`)
      if (res.status === 401 || res.status === 403) {
        await this.opts.auth.invalidate()
        throw new PluginError('NEEDS_PAIRING', `PetKit ${path}: session refused (HTTP ${res.status})`)
      }
      if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `PetKit ${path}: HTTP ${res.status}`)
      const body = (await res.json()) as unknown
      if (PetkitAuth.isSessionError(body)) {
        await this.opts.auth.invalidate()
        throw new PluginError('NEEDS_PAIRING', `PetKit ${path}: session expired`)
      }
      const env = petkitEnvelopeSchema.safeParse(body)
      if (env.success && env.data.error) {
        // The CODE in the message: "Request is incorrect." alone doesn't say what to fix, whereas
        // "(code 3)" means incomplete headers and "(code 5)" a dead session.
        const code = env.data.error.code === undefined ? '' : ` (code ${String(env.data.error.code)})`
        throw new PluginError('UPSTREAM_ERROR', `PetKit ${path}: ${String(env.data.error.msg ?? 'refused')}${code}`)
      }
      return env.success && env.data.result !== undefined ? env.data.result : body
    } finally { clearTimeout(timer) }
  }
}

/** The current day in the format PetKit expects to file a portion (YYYYMMDD, local time). */
export function petkitDay(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
