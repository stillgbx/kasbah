import { fetch as undiciFetch } from 'undici'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { hormannStatusSchema, type HormannStatus } from './types'

// HTTP client of one HCPBridgeMqtt bridge. Plain HTTP on port 80, Basic auth with the fixed user
// `admin` when the web password is set (`requireAuth` in the firmware), 401 otherwise.
//
// `/command?action=N` always answers 200 "OK", even when the firmware drops the command (a
// previous one not yet fetched by the bus, `stop` on a door at rest): the answer says "received",
// never "done". The plugin checks the effect on `/status`.

/**
 * Generous for a LAN: the bridge answered in 0.5 s at rest, but in 5 s while big Wi-Fi copies were
 * running (measured 2026-10-03), and its signal in the garage is only "fair" (-72 dBm).
 */
export const REQUEST_TIMEOUT_MS = 8_000

/** Action codes of `/command` (firmware switch). */
export const ACTIONS = {
  close: 0,
  open: 1,
  stop: 2,
  toggleLight: 5,
  setPosition: 7,
} as const

export interface HormannClientOptions {
  host: string
  password: string
  fetchImpl?: FetchLike
  /** Shortened in tests. */
  requestTimeoutMs?: number
}

export class HormannClient {
  private readonly fetchImpl: FetchLike

  constructor(private readonly opts: HormannClientOptions) {
    this.fetchImpl = opts.fetchImpl
      ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
  }

  private async request(path: string, signal?: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    const headers: Record<string, string> = {}
    if (this.opts.password) {
      headers.authorization = `Basic ${Buffer.from(`admin:${this.opts.password}`).toString('base64')}`
    }
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.fetchImpl(`http://${this.opts.host}${path}`, {
        headers,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `Hörmann bridge unreachable at ${this.opts.host}`, { cause: err })
    }
    const text = await res.text()
    if (res.status === 401) {
      throw new PluginError('NEEDS_PAIRING', `Hörmann bridge ${this.opts.host} refused the password (HTTP 401)`)
    }
    if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `Hörmann bridge ${this.opts.host} returned HTTP ${res.status} on ${path.split('?')[0]}`)
    return text
  }

  async status(signal?: AbortSignal): Promise<HormannStatus> {
    const text = await this.request('/status', signal)
    let json: unknown
    try { json = JSON.parse(text) } catch {
      throw new PluginError('UPSTREAM_ERROR', `Hörmann bridge ${this.opts.host}: /status is not JSON`)
    }
    const parsed = hormannStatusSchema.safeParse(json)
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', `Hörmann bridge ${this.opts.host}: unexpected /status`)
    return parsed.data
  }

  async command(action: number, params: Record<string, number> = {}, signal?: AbortSignal): Promise<void> {
    const query = new URLSearchParams({ action: String(action) })
    for (const [k, v] of Object.entries(params)) query.set(k, String(v))
    await this.request(`/command?${query}`, signal)
  }
}
