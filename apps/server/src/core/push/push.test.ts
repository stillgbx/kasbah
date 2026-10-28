import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ManualClock } from '@kasbah/mock-sim'
import type { DeviceDescriptor, PluginHealth, PushMessage, PushSubscriptionJson } from '@kasbah/shared'
import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Bus } from '../bus'
import { DeviceRegistry } from '../registry'
import { ABSENT_FORGET_MS, AlertNotifier, DEGRADED_GRACE_MS, FORGET_AFTER_MS } from './alerts'
import { PushService, type PushFetch } from './service'
import { encryptPayload, generateVapidKeys, vapidAuthorization } from './webpush'

const logger = pino({ level: 'silent' })

/** A browser's side of a subscription: its key pair and secret, as `pushManager.subscribe` makes them. */
function browser(endpoint = `https://push.example.org/send/${randomBytes(4).toString('hex')}`) {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const auth = randomBytes(16)
  const sub: PushSubscriptionJson = { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } }
  /** Decrypts as the browser does (RFC 8291), written apart from the server's code. */
  const decrypt = (body: Buffer): string => {
    const salt = body.subarray(0, 16)
    const idlen = body[20]!
    const asPublic = body.subarray(21, 21 + idlen)
    const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(asPublic), auth,
      Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]), 32))
    const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
    const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
    const record = body.subarray(21 + idlen)
    const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
    decipher.setAuthTag(record.subarray(record.length - 16))
    const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()])
    expect(plain[plain.length - 1]).toBe(2)          // last record, no padding
    return plain.subarray(0, -1).toString()
  }
  return { sub, decrypt }
}

describe('webpush', () => {
  it('encrypts a payload the browser can decrypt (aes128gcm, RFC 8291)', () => {
    const b = browser()
    const body = encryptPayload(b.sub, Buffer.from('{"title":"Tondeuse"}'))
    expect(body.readUInt32BE(16)).toBe(4096)
    expect(b.decrypt(body)).toBe('{"title":"Tondeuse"}')
  })

  it('signs a VAPID token for the origin of the endpoint, checkable with the public key', () => {
    const keys = generateVapidKeys()
    const now = Date.UTC(2026, 9, 28, 12)
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'https://kasbah.example.org', now)
    const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!
    expect(k).toBe(keys.publicKey)
    const [h, c, s] = token!.split('.')
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com', exp: Math.floor(now / 1000) + 12 * 3600, sub: 'https://kasbah.example.org',
    })
    const pub = Buffer.from(keys.publicKey, 'base64url')
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' })
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s!, 'base64url'))).toBe(true)
  })
})

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'kasbah-push-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

/** A push service that records what it receives, and answers `status` per endpoint. */
function pushHarness(opts: { accounts?: string[]; status?: Record<string, number> } = {}) {
  const received: { endpoint: string; headers: Record<string, string>; body: Uint8Array }[] = []
  const fetch: PushFetch = async (url, init) => {
    received.push({ endpoint: url, headers: init.headers, body: init.body })
    return { status: opts.status?.[url] ?? 201 }
  }
  const service = new PushService({
    path: join(dir, 'push.json'), subject: 'mailto:kasbah@example.org', logger, fetch,
    accounts: async () => opts.accounts ?? [],
  })
  return { service, received }
}

const message = (title: string): PushMessage => ({ title, body: 'b', tag: 't', url: '/' })

describe('PushService', () => {
  it('sends to the screens of the category only, each in its language', async () => {
    const { service, received } = pushHarness()
    await service.load()
    const fr = browser(); const en = browser(); const other = browser()
    await service.subscribe({ subscription: fr.sub, categories: ['robots'], lang: 'fr' }, null)
    await service.subscribe({ subscription: en.sub, categories: ['robots', 'pets'], lang: 'en' }, null)
    await service.subscribe({ subscription: other.sub, categories: ['pets'], lang: 'fr' }, null)

    expect(await service.send('robots', (lang) => message(lang))).toEqual({ sent: 2, failed: 0 })
    expect(received.map((r) => r.endpoint).sort()).toEqual([fr.sub.endpoint, en.sub.endpoint].sort())
    const to = (b: ReturnType<typeof browser>) => JSON.parse(b.decrypt(Buffer.from(received.find((r) => r.endpoint === b.sub.endpoint)!.body)))
    expect(to(fr).title).toBe('fr')
    expect(to(en).title).toBe('en')
    expect(received[0]!.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '86400' })
  })

  it('keeps its keys and subscriptions across a restart, and changes categories in place', async () => {
    const first = pushHarness()
    await first.service.load()
    const b = browser()
    await first.service.subscribe({ subscription: b.sub, categories: ['robots'], lang: 'fr' }, null)
    await first.service.subscribe({ subscription: b.sub, categories: ['weather'], lang: 'fr' }, null)

    const second = pushHarness()
    await second.service.load()
    expect(second.service.publicKey()).toBe(first.service.publicKey())
    expect((await second.service.send('robots', () => message('x'))).sent).toBe(0)
    expect((await second.service.send('weather', () => message('x'))).sent).toBe(1)
  })

  it('drops a subscription the push service says is gone (410), and one of a removed account', async () => {
    const gone = browser(); const removed = browser(); const kept = browser()
    const { service } = pushHarness({ accounts: ['alice'], status: { [gone.sub.endpoint]: 410 } })
    await service.load()
    await service.subscribe({ subscription: gone.sub, categories: ['pets'], lang: 'fr' }, null)
    await service.subscribe({ subscription: removed.sub, categories: ['pets'], lang: 'fr' }, 'bob')
    await service.subscribe({ subscription: kept.sub, categories: ['pets'], lang: 'fr' }, 'alice')

    expect(await service.send('pets', () => message('x'))).toEqual({ sent: 1, failed: 1 })
    expect([gone, removed, kept].map((b) => service.has(b.sub.endpoint))).toEqual([false, false, true])
    const file = JSON.parse(await readFile(join(dir, 'push.json'), 'utf8'))
    expect(file.subscriptions.map((s: { user: string | null }) => s.user)).toEqual(['alice'])
  })
})

describe('AlertNotifier', () => {
  const mower: DeviceDescriptor = { id: 'mock:mower', pluginId: 'mock', externalId: 'mower', kind: 'mower', name: 'Tondeuse', capabilities: [], meta: {} }

  function harness(health: () => Record<string, PluginHealth> = () => ({})) {
    const clock = new ManualClock(Date.UTC(2026, 9, 28, 10))
    const bus = new Bus()
    const registry = new DeviceRegistry(bus, clock)
    registry.register('mock', [mower])
    const sent: { category: string; message: PushMessage }[] = []
    const push = { send: async (category: Parameters<PushService['send']>[0], render: (lang: 'fr') => PushMessage) => { sent.push({ category, message: render('fr') }); return { sent: 1, failed: 0 } } }
    const notifier = () => new AlertNotifier({ bus, registry, health: async () => health(), push, clock, path: join(dir, 'alerts.json'), logger })
    return { clock, registry, sent, notifier }
  }

  it('notifies an alert once, in the words of the house panel, and not again after a restart', async () => {
    const h = harness()
    const first = h.notifier()
    await first.start()
    h.registry.applyPatch(mower.id, { activity: 'error', errorCode: 13, errorAt: 1, errorMessage: 'Coincée' })
    h.registry.applyPatch(mower.id, { battery: 40 })                 // same alert, nothing new
    expect(h.sent).toEqual([{ category: 'robots', message: { title: 'Tondeuse', body: 'Coincée', tag: 'mock:mower|device_error|13@1', url: '/robots' } }])
    await first.close()

    const second = h.notifier()
    await second.start()
    h.registry.applyPatch(mower.id, { battery: 41 })
    expect(h.sent).toHaveLength(1)
    await second.close()
  })

  it('forgets an alert only once it has been gone for a while: a flicker is not a new alert', async () => {
    const h = harness()
    const n = h.notifier()
    await n.start()
    h.registry.applyPatch(mower.id, { activity: 'error', errorCode: 13, errorAt: 1 })
    h.registry.applyPatch(mower.id, { activity: 'parked', errorCode: null, errorAt: null })
    h.clock.advance(FORGET_AFTER_MS / 2)
    await n.tick()
    h.registry.applyPatch(mower.id, { activity: 'error', errorCode: 13, errorAt: 1 })
    expect(h.sent).toHaveLength(1)

    h.registry.applyPatch(mower.id, { activity: 'parked', errorCode: null, errorAt: null })
    h.clock.advance(FORGET_AFTER_MS)
    await n.tick()
    h.registry.applyPatch(mower.id, { activity: 'error', errorCode: 13, errorAt: 1 })
    expect(h.sent).toHaveLength(2)
    await n.close()
  })

  it('keeps the alerts of a device gone from the registry for 7 days, then forgets them', async () => {
    const h = harness()
    const n = h.notifier()
    await n.start()
    const fault = { activity: 'error', errorCode: 13, errorAt: 1 } as const
    h.registry.applyPatch(mower.id, fault)
    h.registry.register('mock', [])                                  // plugin turned off
    h.clock.advance(ABSENT_FORGET_MS - 3600_000)
    await n.tick()
    h.registry.register('mock', [mower])                             // back: same fault, nothing new
    h.registry.applyPatch(mower.id, fault)
    expect(h.sent).toHaveLength(1)

    h.registry.register('mock', [])
    h.clock.advance(ABSENT_FORGET_MS)
    await n.tick()
    h.registry.register('mock', [mower])
    h.registry.applyPatch(mower.id, fault)
    expect(h.sent).toHaveLength(2)
    await n.close()
  })

  it('notifies a plugin to pair at once, a degraded one only after 5 min', async () => {
    let health: Record<string, PluginHealth> = { nest: { status: 'needs_pairing', detail: 'link the account' }, tesla: { status: 'degraded' } }
    const h = harness(() => health)
    const n = h.notifier()
    await n.start()
    await n.tick()
    expect(h.sent.map((s) => [s.category, s.message.title, s.message.body])).toEqual([['plugins', 'Plugin nest', 'Appairage requis · link the account']])
    h.clock.advance(DEGRADED_GRACE_MS)
    await n.tick()
    expect(h.sent.map((s) => s.message.title)).toEqual(['Plugin nest', 'Plugin tesla'])
    health = { nest: { status: 'ok' }, tesla: { status: 'ok' } }
    await n.tick()
    expect(h.sent).toHaveLength(2)
    await n.close()
  })
})
