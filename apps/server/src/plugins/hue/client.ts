import { Agent, fetch as undiciFetch } from 'undici'
import type { Logger } from 'pino'
import type { z } from 'zod'
import type { Clock } from '../../core/clock'
import { PluginError } from '../../core/plugin'
import { TokenBucket } from '../../core/rate-limit'
import type { FetchLike } from '../../core/sse'
import { huePairResponseSchema, hueResponseSchema, type HueWriteBody } from './types'

// Client HTTP CLIP v2. Le bridge présente un certificat signé par l'AC Signify (CN = id du bridge) :
// on désactive la vérification TLS via un Agent undici dédié (jamais globalement).
// Limites documentées : ~10 PUT/s sur `light`, ~1/s sur `grouped_light` et sur `scene` → seau à jetons ; une
// commande en attente pour la même lampe est SUPPLANTÉE par la suivante (glissement de slider).

export interface HueClientOptions {
  host: string
  appKey?: string
  insecureTls?: boolean
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
    this.dispatcher = opts.insecureTls === false ? undefined : new Agent({ connect: { rejectUnauthorized: false } })
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
   * PUT limité en débit : la dernière écriture pour une même ressource remplace la précédente.
   * `intent` sépare deux écritures de NATURE différente sur la même ressource — un rappel de scène
   * ne doit pas supplanter un changement de réglage : elles ont alors deux files distinctes.
   */
  putLimited(type: HueWriteType, id: string, body: HueWriteBody, intent = 'set'): Promise<void> {
    const key = `${type}/${id}#${intent}`
    return new Promise<void>((resolve, reject) => {
      const prev = this.pending.get(key)
      if (prev) prev.resolve()                         // supplanté : l'intention finale part quand même
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
        // la commande a pu être remplacée pendant l'attente → on relit la dernière
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

  /** Appairage (API v1) : nécessite un appui sur le bouton du bridge dans les 30 s. */
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
