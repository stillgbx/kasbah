import { fetch as undiciFetch, type Agent } from 'undici'
import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { pinnedAgent, type TlsPin } from '../../core/tls-pin'

// Client for the IQ Gateway's local API. Three peculiarities:
//  - HTTPS ONLY: the gateway's port 80 refuses the connection (verified on the real one), and its
//    certificate is self-signed → dedicated undici Agent, never global (same choice as Hue and
//    TaHoma), and the certificate pinned on first use (`core/tls-pin.ts`): the token never goes to
//    a gateway presenting another one;
//  - `/info` answers WITHOUT a token and gives the serial number: that is how the plugin knows the
//    gateway without asking the user. Everything else requires `Authorization: Bearer`;
//  - a rejected token does not return a JSON 401 but an HTML page redirecting to /login.html.
//    So we translate the HTTP code, not the body.

/**
 * Beyond this, we give up. Generous for a LAN, and it is measured: the gateway answers in 0.2 s on
 * almost everything, but `/production.json?details=1` took 1.5 s, 3.2 s, 6.6 s then 10.8 s over
 * four calls in a row. Eight seconds therefore cut one read out of two.
 */
export const REQUEST_TIMEOUT_MS = 20_000

export interface EnphaseClientOptions {
  host: string
  token?: string | undefined
  fetchImpl?: FetchLike
  logger?: Logger
  /** Shortened in tests; in production it is `REQUEST_TIMEOUT_MS`. */
  requestTimeoutMs?: number
  /** Verify the certificate (never in production: it is self-signed). */
  secureTls?: boolean
  /** The gateway certificate must match it when it is not verified. */
  pin: TlsPin
}

export interface GatewayInfo {
  serial: string
  /** Software version (`D8.3.5289`): it decides whether the token is required (7.0 and above). */
  software?: string
}

/** Value of a tag in the `/info` XML. Two fields to read: no reason to ship an XML parser. */
function tag(xml: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]+)</${name}>`).exec(xml)?.[1]?.trim()
}

export class EnphaseClient {
  readonly dispatcher: Agent | undefined
  private readonly fetchImpl: FetchLike
  private token: string | undefined

  constructor(private readonly opts: EnphaseClientOptions) {
    this.dispatcher = opts.secureTls ? undefined : pinnedAgent(opts.pin)
    this.fetchImpl = opts.fetchImpl
      ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
    this.token = opts.token
  }

  get baseUrl(): string { return `https://${this.opts.host}` }
  get hasToken(): boolean { return !!this.token }
  /** After a (re)pairing: the token changes without rebuilding the client or restarting the plugin. */
  setToken(token: string): void { this.token = token }

  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private async request(path: string, opts: { auth: boolean; signal?: AbortSignal }): Promise<{ status: number; text: string }> {
    if (opts.auth && !this.token) throw new PluginError('NEEDS_PAIRING', `no Enphase token: cannot read ${path}`)
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: {
          accept: 'application/json',
          ...(opts.auth && this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        signal: this.deadline(opts.signal),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `IQ Gateway unreachable at ${this.opts.host}${path}`, { cause: err })
    }
    const text = await res.text()
    // 401 / 403: token missing, expired or from another gateway — a user action, not an incident
    if (res.status === 401 || res.status === 403) {
      throw new PluginError('NEEDS_PAIRING', `IQ Gateway refused the token (HTTP ${res.status} on ${path}): renew it`)
    }
    if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `IQ Gateway returned HTTP ${res.status} on ${path}`)
    return { status: res.status, text }
  }

  /** Gateway identity. The only route that needs no token: used to recognize it first. */
  async info(signal?: AbortSignal): Promise<GatewayInfo> {
    const { text } = await this.request('/info', { auth: false, ...(signal ? { signal } : {}) })
    const serial = tag(text, 'sn')
    if (!serial) throw new PluginError('UPSTREAM_ERROR', `no serial number in /info from ${this.opts.host}`)
    const software = tag(text, 'software')
    return { serial, ...(software ? { software } : {}) }
  }

  /** Authenticated GET, JSON body. The schema is applied by the caller (mapping). */
  async getJson(path: string, signal?: AbortSignal): Promise<unknown> {
    const { text } = await this.request(path, { auth: true, ...(signal ? { signal } : {}) })
    try { return JSON.parse(text) as unknown }
    catch (err) { throw new PluginError('UPSTREAM_ERROR', `IQ Gateway sent invalid JSON on ${path}`, { cause: err }) }
  }
}
