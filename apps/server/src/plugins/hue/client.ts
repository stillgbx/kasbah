import { fetch as undiciFetch, type Agent } from 'undici'
import type { Logger } from 'pino'
import type { z } from 'zod'
import type { Clock } from '../../core/clock'
import { PluginError } from '../../core/plugin'
import { TokenBucket } from '../../core/rate-limit'
import { pinnedAgent, type TlsPin } from '../../core/tls-pin'
import type { FetchLike } from '../../core/sse'
import { huePairResponseSchema, hueResponseSchema, type HueWriteBody } from './types'

// CLIP v2 HTTP client. The bridge presents a certificate signed by the Signify CA (CN = bridge id):
// TLS verification is disabled through a dedicated undici Agent (never globally), and the
// certificate pinned on first use instead (`core/tls-pin.ts`): the application key never goes to
// another one.
// Documented limits: ~10 PUT/s on `light`, ~1/s on `grouped_light` and on `scene` → token bucket; a
// pending command for the same light is SUPERSEDED by the next one (slider drag).

export interface HueClientOptions {
  host: string
  appKey?: string
  insecureTls?: boolean
  /** Without CA verification, the bridge certificate must match it. Without a pin, verification stays on. */
  pin?: TlsPin
  fetchImpl?: FetchLike
  clock: Clock
  logger?: Logger
}

type HueWriteType = 'light' | 'grouped_light' | 'scene'

interface Pending { type: HueWriteType; id: string; body: HueWriteBody; resolve: () => void; reject: (e: unknown) => void }

export class HueClient {
  readonly host: string
  readonly appKey: string | undefined
  readonly dispatcher: Agent | undefined
  readonly fetchImpl: FetchLike
  private readonly clock: Clock
  private readonly logger: Logger | undefined
  private readonly buckets: Record<HueWriteType, TokenBucket>
  private readonly pending = new Map<string, Pending>()
  private draining = false

  constructor(opts: HueClientOptions) {
    this.host = opts.host
    this.appKey = opts.appKey
    this.clock = opts.clock
    this.logger = opts.logger
    this.dispatcher = opts.insecureTls === false || !opts.pin ? undefined : pinnedAgent(opts.pin)
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
    this.buckets = {
      light: new TokenBucket(10, 10, opts.clock),
      grouped_light: new TokenBucket(1, 1, opts.clock),
      scene: new TokenBucket(1, 1, opts.clock),
    }
  }

  get baseUrl(): string { return `https://${this.host}` }
  get eventStreamUrl(): string { return `${this.baseUrl}/eventstream/clip/v2` }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.appKey ? { 'hue-application-key': this.appKey } : {}), ...extra }
  }

  private init(init: RequestInit & { dispatcher?: unknown }): RequestInit & { dispatcher?: unknown } {
    return { ...init, ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}) }
  }

  private async request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, this.init({
        method,
        headers: this.headers({ 'content-type': 'application/json' }),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      }))
    } catch (err) {
      throw new PluginError('UPSTREAM_ERROR', `Hue bridge unreachable (${(err as Error).message})`, { cause: err })
    }
    if (res.status === 401 || res.status === 403) throw new PluginError('NEEDS_PAIRING', 'Hue application key rejected')
    if (res.status === 429) throw new PluginError('RATE_LIMITED', 'Hue bridge rate limit')
    if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `Hue bridge HTTP ${res.status}`)
    return res.json()
  }

  async getResources<T>(type: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T[]> {
    const raw = hueResponseSchema.parse(await this.request('GET', `/clip/v2/resource/${type}`, undefined, signal))
    if (raw.errors.length) this.logger?.warn({ type, errors: raw.errors }, 'Hue resource errors')
    const out: T[] = []
    for (const item of raw.data) {
      const r = schema.safeParse(item)
      if (r.success) out.push(r.data)
      else this.logger?.debug({ type, id: item.id, issues: r.error.issues }, 'Hue resource skipped')
    }
    return out
  }

  async putResource(type: HueWriteType, id: string, body: HueWriteBody): Promise<void> {
    await this.request('PUT', `/clip/v2/resource/${type}/${id}`, body)
  }

  /**
   * Rate-limited PUT: the last write for a given resource replaces the previous one.
   * `intent` separates two writes of a different NATURE on the same resource — a scene recall must
   * not supersede a setting change: they then get two separate queues.
   */
  putLimited(type: HueWriteType, id: string, body: HueWriteBody, intent = 'set'): Promise<void> {
    const key = `${type}/${id}#${intent}`
    return new Promise<void>((resolve, reject) => {
      const prev = this.pending.get(key)
      if (prev) prev.resolve()                         // superseded: the final intent is sent anyway
      this.pending.set(key, { type, id, body, resolve, reject })
      void this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.pending.size > 0) {
        const [key, p] = this.pending.entries().next().value as [string, Pending]
        const bucket = this.buckets[p.type]
        const wait = bucket.waitMs()
        if (wait > 0) await new Promise<void>((r) => { this.clock.setTimeout(r, wait) })
        // the command may have been replaced during the wait → read the latest one again
        const latest = this.pending.get(key)
        if (!latest) continue
        this.pending.delete(key)
        bucket.tryTake()
        try { await this.putResource(latest.type, latest.id, latest.body); latest.resolve() }
        catch (err) { latest.reject(err) }
        if (latest !== p) p.resolve()
      }
    } finally { this.draining = false }
  }

  /** Creates a resource (scene): response `{ data: [{ rid }] }`. Not rate-limited: it is a single
   *  gesture, never a burst. */
  async createResource(type: 'scene', body: unknown): Promise<string | undefined> {
    const raw = hueResponseSchema.parse(await this.request('POST', `/clip/v2/resource/${type}`, body))
    if (raw.errors.length) throw new PluginError('UPSTREAM_ERROR', raw.errors[0]?.description ?? `Hue rejected the new ${type}`)
    return (raw.data[0] as { rid?: string } | undefined)?.rid
  }

  async deleteResource(type: 'scene', id: string): Promise<void> {
    const raw = hueResponseSchema.parse(await this.request('DELETE', `/clip/v2/resource/${type}/${id}`))
    if (raw.errors.length) throw new PluginError('UPSTREAM_ERROR', raw.errors[0]?.description ?? `Hue rejected deleting the ${type}`)
  }

  /** Pairing (API v1): requires a press on the bridge's button within 30 s. */
  async pair(deviceType = 'kasbah#server'): Promise<{ appKey: string; clientKey?: string }> {
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api`, this.init({
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ devicetype: deviceType, generateclientkey: true }),
      }))
    } catch (err) {
      throw new PluginError('UPSTREAM_ERROR', `Hue bridge unreachable (${(err as Error).message})`, { cause: err })
    }
    if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `Hue bridge HTTP ${res.status}`)
    const parsed = huePairResponseSchema.parse(await res.json())
    const first = parsed[0]
    if (first?.success) return { appKey: first.success.username, ...(first.success.clientkey ? { clientKey: first.success.clientkey } : {}) }
    if (first?.error?.type === 101) throw new PluginError('NEEDS_PAIRING', 'link button not pressed')
    throw new PluginError('UPSTREAM_ERROR', first?.error?.description ?? 'unexpected pairing response')
  }

  close(): void { void this.dispatcher?.close() }
}
