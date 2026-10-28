import { readFile } from 'node:fs/promises'
import { NOTIFY_CATEGORIES, PUSH_LANGS, pushSubscriptionSchema, type NotifyCategory, type PushLang, type PushMessage, type PushSubscribeBody } from '@kasbah/shared'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../atomic-file'
import { publicFetch } from '../outbound'
import { encryptPayload, generateVapidKeys, vapidAuthorization, type VapidKeys } from './webpush'

// The subscribed screens and the sending. One file in `.state/`: the server's VAPID keys and the
// subscriptions — they go together, a subscription is bound to the public key it was made with.
// An unreadable file starts over with new keys (the screens subscribe again when they open the app).
//
// A subscription remembers the account that made it (`null` = the local network): an account
// removed from `mcp-users.json` stops receiving the house's alerts, its subscriptions are dropped at
// the next sending. A push service answering 404 or 410 says the subscription no longer exists.

const storedSchema = pushSubscriptionSchema.extend({
  categories: z.array(z.enum(NOTIFY_CATEGORIES)),
  lang: z.enum(PUSH_LANGS),
  user: z.string().nullable(),
  createdAt: z.number().int(),
})
type StoredSubscription = z.infer<typeof storedSchema>

const fileSchema = z.object({
  vapid: z.object({ publicKey: z.string().min(1), privateKey: z.string().min(1) }),
  subscriptions: z.array(storedSchema),
})

/** Beyond this, the oldest subscription makes room: a screen reinstalled again and again does not grow the file forever. */
const MAX_SUBSCRIPTIONS = 50
/** A notification not delivered within a day is no longer worth showing. */
const TTL_S = 24 * 3600
const SEND_TIMEOUT_MS = 10_000

export type PushFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: Uint8Array; signal: AbortSignal; redirect: 'error' }) => Promise<{ status: number }>

export interface PushServiceDeps {
  path: string
  /** `sub` of the VAPID token: the public address, or a `mailto:`. */
  subject: string
  /** The accounts that exist now; a subscription of another account is dropped. */
  accounts: () => Promise<string[]>
  logger: Logger
  now?: () => number
  fetch?: PushFetch
}

export interface SendResult { sent: number; failed: number }

export class PushService {
  private vapid: VapidKeys = generateVapidKeys()
  private subs: StoredSubscription[] = []
  private readonly now: () => number
  private readonly fetch: PushFetch

  constructor(private readonly deps: PushServiceDeps) {
    this.now = deps.now ?? Date.now
    this.fetch = deps.fetch ?? publicFetch
  }

  async load(): Promise<void> {
    let raw: string | null = null
    try { raw = await readFile(this.deps.path, 'utf8') }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err }
    const parsed = raw === null ? null : fileSchema.safeParse(JSON.parse(raw))
    if (parsed?.success) { this.vapid = parsed.data.vapid; this.subs = parsed.data.subscriptions; return }
    if (parsed) this.deps.logger.warn('push subscriptions unreadable: new keys, the screens will subscribe again')
    await this.save()
  }

  publicKey(): string { return this.vapid.publicKey }

  /** Subscribes a screen, or changes its categories and language (same endpoint). */
  async subscribe(body: PushSubscribeBody, user: string | null): Promise<void> {
    const prev = this.subs.find((s) => s.endpoint === body.subscription.endpoint)
    const entry: StoredSubscription = {
      ...body.subscription, categories: [...new Set(body.categories)], lang: body.lang, user, createdAt: prev?.createdAt ?? this.now(),
    }
    this.subs = [...this.subs.filter((s) => s.endpoint !== entry.endpoint), entry].slice(-MAX_SUBSCRIPTIONS)
    await this.save()
  }

  /** `false` = no such subscription. */
  async unsubscribe(endpoint: string): Promise<boolean> {
    const before = this.subs.length
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint)
    if (this.subs.length === before) return false
    await this.save()
    return true
  }

  has(endpoint: string): boolean { return this.subs.some((s) => s.endpoint === endpoint) }

  /** To every screen subscribed to `category`, each in its language. */
  send(category: NotifyCategory, render: (lang: PushLang) => PushMessage): Promise<SendResult> {
    return this.deliver((s) => s.categories.includes(category), render)
  }

  /** To one screen, whatever its categories (the "Send a test" button). */
  sendTo(endpoint: string, render: (lang: PushLang) => PushMessage): Promise<SendResult> {
    return this.deliver((s) => s.endpoint === endpoint, render)
  }

  private async deliver(pick: (s: StoredSubscription) => boolean, render: (lang: PushLang) => PushMessage): Promise<SendResult> {
    const accounts = new Set(await this.deps.accounts())
    const orphans = this.subs.filter((s) => s.user !== null && !accounts.has(s.user))
    const targets = this.subs.filter((s) => pick(s) && !orphans.includes(s))
    const gone = new Set(orphans.map((s) => s.endpoint))
    let failed = 0
    await Promise.all(targets.map(async (s) => {
      try {
        const body = encryptPayload(s, Buffer.from(JSON.stringify(render(s.lang))))
        const res = await this.fetch(s.endpoint, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(SEND_TIMEOUT_MS), body,
          headers: {
            Authorization: vapidAuthorization(s.endpoint, this.vapid, this.deps.subject, this.now()),
            'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(TTL_S), Urgency: 'high',
          },
        })
        if (res.status === 404 || res.status === 410) { gone.add(s.endpoint); failed++; return }
        if (res.status >= 400) throw new Error(`push service answered ${res.status}`)
      } catch (err) {
        failed++
        this.deps.logger.warn({ err, host: new URL(s.endpoint).host }, 'push notification not sent')
      }
    }))
    if (gone.size) {
      this.subs = this.subs.filter((s) => !gone.has(s.endpoint))
      await this.save()
    }
    return { sent: targets.length - failed, failed }
  }

  private save(): Promise<void> {
    return writeFileAtomic(this.deps.path, `${JSON.stringify({ vapid: this.vapid, subscriptions: this.subs }, null, 2)}\n`)
  }
}
