import { fetch as undiciFetch, type Agent } from 'undici'
import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { pinnedAgent, type TlsPin } from '../../core/tls-pin'
import {
  overkizApiVersionSchema, overkizDeviceSchema, overkizErrorSchema, overkizEventsSchema, overkizListenerSchema,
  overkizSetupEnvelopeSchema, type OverkizAction, type OverkizDevice, type OverkizEvent,
} from './types'

// Client for the Overkiz local API (developer mode of the TaHoma box). Three peculiarities:
//  - the box certificate is signed by the Overkiz CA for the name `gateway-XXXX-XXXX-XXXX.local`:
//    reaching the box by its IP fails TLS verification → dedicated undici Agent (never globally,
//    same choice as the Hue bridge), the certificate pinned on first use instead (`core/tls-pin.ts`):
//    the token never goes to a box presenting another one;
//  - there is no pushed event stream: we register a listener then poll it;
//  - EACH request carries its own timeout. The box usually answers in 50 to 300 ms, but it has been
//    seen blocking a command beyond 10 s without logging anything. undici's default being 300 s, a
//    stuck request would freeze event polling for good — the plugin would stay "ok" while being
//    blind. Hence the explicit abort below.

/** Beyond this, we abort the request: the box is on the LAN and answers in hundreds of ms. */
export const REQUEST_TIMEOUT_MS = 8000

export interface TahomaClientOptions {
  host: string
  port: number
  token?: string
  insecureTls?: boolean
  /** Without CA verification, the box certificate must match it. Without a pin, verification stays on. */
  pin?: TlsPin
  fetchImpl?: FetchLike
  logger?: Logger
  /** Shortened in tests; in production it is `REQUEST_TIMEOUT_MS`. */
  requestTimeoutMs?: number
}

export class TahomaClient {
  readonly dispatcher: Agent | undefined
  readonly fetchImpl: FetchLike
  private readonly logger: Logger | undefined

  constructor(private readonly opts: TahomaClientOptions) {
    this.dispatcher = opts.insecureTls === false || !opts.pin ? undefined : pinnedAgent(opts.pin)
    this.fetchImpl = opts.fetchImpl
      ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
    this.logger = opts.logger
  }

  get baseUrl(): string {
    return `https://${this.opts.host}:${this.opts.port}/enduser-mobile-web/1/enduserAPI`
  }

  /** The request's signal: the caller's (plugin stop) OR the abort on timeout. */
  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private async request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}),
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: this.deadline(signal),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      })
    } catch (err) {
      // `signal` already aborted = plugin stop; otherwise it is our own timeout that expired
      if ((err as Error).name === 'TimeoutError' && signal?.aborted !== true) {
        const ms = this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
        throw new PluginError('TIMEOUT', `TaHoma box did not answer ${method} ${path} within ${ms} ms`, { cause: err })
      }
      throw new PluginError('UPSTREAM_ERROR', `TaHoma box unreachable (${(err as Error).message})`, { cause: err })
    }
    // The body is diagnostic and worth passing up: "Missing authorization token." blames OUR header,
    // "Not authenticated." blames the token (unknown to the box, or not yet synced from the Somfy
    // account). It never contains the token.
    if (res.status === 401 || res.status === 403) {
      throw new PluginError('NEEDS_PAIRING', `TaHoma local token rejected${await this.describe(res)}`)
    }
    if (res.status === 429) throw new PluginError('RATE_LIMITED', 'TaHoma box rate limit')
    if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `TaHoma box HTTP ${res.status}${await this.describe(res)}`)
    return res.json()
  }

  /** Readable detail of a box error, never copying the token. */
  private async describe(res: Awaited<ReturnType<FetchLike>>): Promise<string> {
    try {
      const parsed = overkizErrorSchema.safeParse(JSON.parse(await res.text()))
      const detail = parsed.success ? parsed.data.error ?? parsed.data.errorCode : undefined
      return detail ? ` (${detail})` : ''
    } catch { return '' }
  }

  /** Reachability and token validity probe: `{ protocolVersion }`. */
  async getApiVersion(signal?: AbortSignal): Promise<string | undefined> {
    return overkizApiVersionSchema.parse(await this.request('GET', '/apiVersion', undefined, signal)).protocolVersion
  }

  /**
   * Device list. Each device is validated SEPARATELY: a single device with an unexpected shape must
   * not deprive the house of all the others (same choice as the Hue bridge).
   */
  async getSetup(signal?: AbortSignal): Promise<OverkizDevice[]> {
    const raw = overkizSetupEnvelopeSchema.parse(await this.request('GET', '/setup', undefined, signal))
    const out: OverkizDevice[] = []
    for (const item of raw.devices) {
      const parsed = overkizDeviceSchema.safeParse(item)
      if (parsed.success) out.push(parsed.data)
      else this.logger?.debug({ issues: parsed.error.issues }, 'TaHoma device skipped')
    }
    return out
  }

  async registerListener(signal?: AbortSignal): Promise<string> {
    return overkizListenerSchema.parse(await this.request('POST', '/events/register', undefined, signal)).id
  }

  /**
   * Polls the listener. `null` when the box no longer knows it (expired, box restarted): the caller
   * must register a new one and resync.
   */
  async fetchEvents(listenerId: string, signal?: AbortSignal): Promise<OverkizEvent[] | null> {
    try {
      return overkizEventsSchema.parse(await this.request('POST', `/events/${listenerId}/fetch`, undefined, signal))
    } catch (err) {
      const message = (err as Error).message
      if (err instanceof PluginError && err.code === 'UPSTREAM_ERROR' && /400|404|listener/i.test(message)) {
        this.logger?.info({ listenerId }, 'TaHoma event listener gone, re-registering')
        return null
      }
      throw err
    }
  }

  async unregisterListener(listenerId: string): Promise<void> {
    await this.request('POST', `/events/${listenerId}/unregister`)
  }

  /**
   * Executes actions (one per device) in ONE execution, like a TaHoma scenario; the box answers
   * `{ execId }` as soon as it has taken the command.
   */
  async apply(label: string, actions: OverkizAction[], signal?: AbortSignal): Promise<void> {
    await this.request('POST', '/exec/apply', { label, actions }, signal)
  }

  close(): void { void this.dispatcher?.close() }
}
