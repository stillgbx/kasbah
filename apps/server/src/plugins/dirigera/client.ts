import { createHash, randomBytes } from 'node:crypto'
import type { Logger } from 'pino'
import { fetch as undiciFetch, type Agent } from 'undici'
import type { Clock } from '../../core/clock'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { pinnedAgent, type TlsPin } from '../../core/tls-pin'
import { authorizeResponseSchema, dirigeraDeviceSchema, tokenResponseSchema, type DirigeraDevice, type DirigeraWrite } from './types'

// HTTP client of the DIRIGERA hub (https://<hub>:8443/v1). The hub presents a self-signed
// certificate: no CA to check it against, so it is pinned on first use (`core/tls-pin.ts`) and the
// token never goes to another one. The token is obtained once by pairing (PKCE + a press on the
// hub's action button) and does not expire.

export const DIRIGERA_PORT = 8443
const REQUEST_TIMEOUT_MS = 10_000

const VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

/** PKCE code verifier: 128 characters of the unreserved alphabet (RFC 7636). */
export function makeCodeVerifier(random: (n: number) => Buffer = randomBytes): string {
  return [...random(128)].map((b) => VERIFIER_ALPHABET[b % VERIFIER_ALPHABET.length]).join('')
}

/** S256 challenge: base64url of the SHA-256 of the verifier, without padding. */
export function codeChallengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export interface DirigeraClientOptions {
  host: string
  token?: string
  pin?: TlsPin
  clock: Clock
  logger?: Logger
  fetchImpl?: FetchLike
  requestTimeoutMs?: number
}

export class DirigeraClient {
  readonly host: string
  readonly token: string | undefined
  readonly dispatcher: Agent | undefined
  private readonly fetchImpl: FetchLike
  private readonly opts: DirigeraClientOptions

  constructor(opts: DirigeraClientOptions) {
    this.opts = opts
    this.host = opts.host
    this.token = opts.token
    this.dispatcher = opts.pin ? pinnedAgent(opts.pin) : undefined
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
  }

  get baseUrl(): string { return `https://${this.host}:${DIRIGERA_PORT}/v1` }
  get socketUrl(): string { return `wss://${this.host}:${DIRIGERA_PORT}/v1` }

  private async send(method: string, path: string, init: { headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}) {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...init.headers },
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      })
    } catch (err) {
      if (timeout.aborted) throw new PluginError('TIMEOUT', `DIRIGERA hub did not answer ${method} ${path}`, { cause: err })
      throw new PluginError('UPSTREAM_ERROR', `DIRIGERA hub unreachable (${(err as Error).message})`, { cause: err })
    }
  }

  private async request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const res = await this.send(method, path, {
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    })
    if (res.status === 401 || res.status === 403) throw new PluginError('NEEDS_PAIRING', 'DIRIGERA token rejected')
    if (res.status === 429) throw new PluginError('RATE_LIMITED', 'DIRIGERA hub rate limit')
    if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `DIRIGERA hub HTTP ${res.status}`)
    // a PATCH answers 202 with an empty body
    const text = await res.text()
    return text ? JSON.parse(text) as unknown : null
  }

  /** Every device of the hub; one of an unexpected shape is skipped alone. */
  async getDevices(signal?: AbortSignal): Promise<DirigeraDevice[]> {
    const raw = await this.request('GET', '/devices', undefined, signal)
    if (!Array.isArray(raw)) throw new PluginError('UPSTREAM_ERROR', 'DIRIGERA /devices did not return a list')
    const out: DirigeraDevice[] = []
    for (const item of raw) {
      const parsed = dirigeraDeviceSchema.safeParse(item)
      if (parsed.success) out.push(parsed.data)
      else this.opts.logger?.debug({ id: (item as { id?: unknown })?.id, issues: parsed.error.issues }, 'DIRIGERA device skipped')
    }
    return out
  }

  async patchDevice(id: string, writes: DirigeraWrite[]): Promise<void> {
    await this.request('PATCH', `/devices/${encodeURIComponent(id)}`, writes)
  }

  /**
   * Pairing. The hub hands out a code, then exchanges it for a token only once its action button has
   * been pressed: the exchange is retried every `pollMs` until it succeeds or `windowMs` runs out, so
   * the user can press the button at any moment of that window.
   */
  async pair(opts: { name: string; signal: AbortSignal; windowMs?: number; pollMs?: number; random?: (n: number) => Buffer }): Promise<string> {
    const verifier = makeCodeVerifier(opts.random)
    const query = new URLSearchParams({
      audience: 'homesmart.local', response_type: 'code',
      code_challenge: codeChallengeOf(verifier), code_challenge_method: 'S256',
    })
    const auth = await this.send('GET', `/oauth/authorize?${query}`, { signal: opts.signal })
    if (!auth.ok) throw new PluginError('UPSTREAM_ERROR', `DIRIGERA authorize HTTP ${auth.status}`)
    const { code } = authorizeResponseSchema.parse(await auth.json())

    const form = new URLSearchParams({ code, name: opts.name, grant_type: 'authorization_code', code_verifier: verifier }).toString()
    const deadline = this.opts.clock.now() + (opts.windowMs ?? 60_000)
    for (;;) {
      const res = await this.send('POST', '/oauth/token', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: opts.signal,
      })
      if (res.ok) return tokenResponseSchema.parse(await res.json()).access_token
      // refused until the button is pressed, with a status nobody documents: the `dirigera` library
      // retries on any error for 60 s, and so does this
      if (this.opts.clock.now() >= deadline) throw new PluginError('NEEDS_PAIRING', `action button not pressed (last answer HTTP ${res.status})`)
      await new Promise<void>((resolve) => { this.opts.clock.setTimeout(resolve, opts.pollMs ?? 2_000) })
      if (opts.signal.aborted) throw new PluginError('NEEDS_PAIRING', 'pairing cancelled')
    }
  }

  close(): void { void this.dispatcher?.close() }
}
