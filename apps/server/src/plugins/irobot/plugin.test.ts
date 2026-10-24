import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import type { SessionStore } from './auth'
import type { DiscoveredRobot } from './discovery'
import type { RobotConnection, RobotConnectionOptions, RobotShadow } from './mqtt'
import { createIrobotPlugin, irobotConfigSchema, type IrobotStatus } from './index'
import type { StoredSession } from './types'
import { CLEANING, DOCKED, PAUSED } from './__fixtures__/shadows'

// What the plugin must guarantee: publish nothing until the account is linked, obtain the LOCAL
// passwords in one go then never touch the outside network again, mark unavailable a robot of the
// account missing from the LAN rather than forgetting it, and translate the four actions.
// No real account or robot is touched.

const BLID = '1111111111111111111111111111AAAA'
const ROBOT: DiscoveredRobot = {
  blid: BLID, ip: '192.168.1.81', name: 'Robby', sku: 'c755840',
  sw: 'stingray+24.29.5', proto: 'mqtt', cap: { pw: 0, scrub: 1 },
}

const response = (body: unknown, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => body,
  text: async () => (body === null ? '' : JSON.stringify(body)),
})

/** Fake iRobot cloud: public discovery, Gigya, then the exchange that returns the passwords. */
function fakeCloud(overrides: { gigya?: unknown } = {}) {
  const calls: string[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url) => {
    calls.push(String(url))
    if (String(url).includes('/discover/endpoints')) {
      return response({
        current_deployment: 'v011',
        deployments: { v005: { httpBase: 'https://unauth1.test' }, v011: { httpBase: 'https://unauth3.test' } },
        gigya: { api_key: 'clé-test', datacenter_domain: 'us1.gigya.test' },
      })
    }
    if (String(url).includes('accounts.login')) {
      // Gigya ALWAYS answers with HTTP 200, even to refuse
      return response(overrides.gigya ?? { errorCode: 0, UID: 'uid-1', UIDSignature: 'sig-1', signatureTimestamp: '1789820609' })
    }
    if (String(url).includes('/v2/login')) {
      return response({ robots: { [BLID]: { password: ':1:mot-de-passe-local', name: 'Robby', sku: 'c755840' } } })
    }
    return response({ error: 'not found' }, 404)
  })
  return { fetchImpl, calls }
}

/** Fake MQTT link: shadows are pushed by hand and published commands are recorded. */
function fakeLink() {
  const published: string[] = []
  let handlers: { onShadow?: (s: RobotShadow) => void; onConnected?: () => void; onDisconnected?: (r: string) => void } = {}
  let shadow: RobotShadow = {}
  let connected = false
  let closed = false
  const connectImpl = vi.fn((opts: RobotConnectionOptions): RobotConnection => {
    handlers = opts
    return {
      blid: opts.blid,
      get connected() { return connected },
      shadow: () => shadow,
      async command(name: string) {
        if (!connected) throw new Error('not connected')
        published.push(name)
        // like the real robot: a `pause` takes it out of the mission, and that's what `settle` watches for
        if (name === 'pause') { shadow = PAUSED; handlers.onShadow?.(shadow) }
      },
      async close() { closed = true; connected = false },
    }
  })
  return {
    connectImpl, published,
    get closed() { return closed },
    up() { connected = true; handlers.onConnected?.() },
    down() { connected = false; handlers.onDisconnected?.('closed') },
    push(next: RobotShadow) { shadow = next; handlers.onShadow?.(next) },
  }
}

function memoryStore(initial: StoredSession | null = null): SessionStore {
  let held = initial
  return {
    load: async () => held,
    save: async (s) => { held = s },
    clear: async () => { held = null },
  }
}

function harness(opts: { store?: SessionStore; found?: DiscoveredRobot[] } = {}) {
  const cloud = fakeCloud()
  const link = fakeLink()
  const clock = new ManualClock(Date.UTC(2026, 8, 19, 12))
  const emitted: { id: string; patch: unknown }[] = []
  const available: { id: string; value: boolean }[] = []
  let devices: unknown[] = []
  const ctx: PluginContext = {
    pluginId: 'irobot',
    config: irobotConfigSchema.parse({ IROBOT_SESSION_FILE: '' }),
    logger: pino({ level: 'silent' }),
    clock: clock as never,
    signal: new AbortController().signal,
    emitState: (id, patch) => { emitted.push({ id, patch }) },
    setAvailable: (id, value) => { available.push({ id: String(id), value }) },
    emitDevices: (d) => { devices = d },
    emitScenes: () => {},
    emitSceneState: () => {},
    emitEvent: () => {},
    parts: {},
    site: { lat: 47, lon: 5, alt: 200 },
  }
  const plugin = createIrobotPlugin({
    fetchImpl: cloud.fetchImpl,
    sessionStore: opts.store ?? memoryStore(),
    discoverImpl: async () => opts.found ?? [ROBOT],
    connectImpl: link.connectImpl as never,
  })
  return { plugin, ctx, cloud, link, clock, emitted, available, get devices() { return devices } }
}

describe('iRobot plugin — account not linked', () => {
  it('publishes no device and asks for pairing', async () => {
    const h = harness()
    await h.plugin.init(h.ctx)
    expect(await h.plugin.discover()).toEqual([])
    expect(h.plugin.health!().status).toBe('needs_pairing')
  })

  it('does not scan the network at startup', async () => {
    const h = harness()
    const discoverImpl = vi.fn(async () => [ROBOT])
    const plugin = createIrobotPlugin({ fetchImpl: h.cloud.fetchImpl, sessionStore: memoryStore(), discoverImpl, connectImpl: h.link.connectImpl as never })
    await plugin.init(h.ctx)
    await plugin.start()
    expect(discoverImpl).not.toHaveBeenCalled()
  })
})

describe('iRobot plugin — account linking', () => {
  it('obtains the LOCAL password then opens the robot link', async () => {
    const h = harness()
    await h.plugin.init(h.ctx)
    const app = Fastify()
    h.plugin.registerRoutes!(app)

    const res = await app.inject({ method: 'POST', url: '/login', payload: { email: 'moi@exemple.fr', password: 'secret' } })
    expect(res.statusCode).toBe(200)
    const status = res.json<IrobotStatus>()
    expect(status.linked).toBe(true)
    expect(status.robots).toEqual([expect.objectContaining({ blid: BLID, name: 'Robby', ip: '192.168.1.81' })])

    // three calls to the cloud, and never again afterwards
    expect(h.cloud.calls).toHaveLength(3)
    expect(h.link.connectImpl).toHaveBeenCalledWith(expect.objectContaining({ blid: BLID, password: ':1:mot-de-passe-local', ip: '192.168.1.81' }))
  })

  it('NEVER returns a password in the status', async () => {
    const h = harness()
    await h.plugin.init(h.ctx)
    const app = Fastify()
    h.plugin.registerRoutes!(app)
    await app.inject({ method: 'POST', url: '/login', payload: { email: 'moi@exemple.fr', password: 'secret' } })
    const body = (await app.inject({ method: 'GET', url: '/status' })).body
    expect(body).not.toContain('mot-de-passe-local')
    expect(body).not.toContain('secret')
  })

  it('tells a credentials refusal from an outage', async () => {
    const cloud = fakeCloud({ gigya: { errorCode: 403042, errorMessage: 'Invalid LoginID' } })
    const plugin = createIrobotPlugin({ fetchImpl: cloud.fetchImpl, sessionStore: memoryStore(), discoverImpl: async () => [ROBOT], connectImpl: fakeLink().connectImpl as never })
    const h = harness()
    await plugin.init(h.ctx)
    const app = Fastify()
    plugin.registerRoutes!(app)
    const res = await app.inject({ method: 'POST', url: '/login', payload: { email: 'moi@exemple.fr', password: 'faux' } })
    expect(res.statusCode).toBe(401)
    expect(res.json<{ error: string }>().error).toMatch(/refused the e-mail or password/)
  })

  it('picks up the credentials from the file on restart, without touching the cloud', async () => {
    const store = memoryStore({ robots: [{ blid: BLID, password: ':1:pw', name: 'Robby', sku: 'c755840' }], linkedAt: 1 })
    const h = harness({ store })
    await h.plugin.init(h.ctx)
    expect(await h.plugin.discover()).toEqual([expect.objectContaining({ id: `irobot:${BLID}`, kind: 'vacuum', name: 'Robby' })])
    expect(h.cloud.calls).toHaveLength(0)
  })
})

describe('iRobot plugin — state and actions', () => {
  async function linked() {
    const store = memoryStore({ robots: [{ blid: BLID, password: ':1:pw', name: 'Robby', sku: 'c755840' }], linkedAt: 1 })
    const h = harness({ store })
    await h.plugin.init(h.ctx)
    await h.plugin.discover()
    h.link.up()
    return h
  }

  it('publishes the state on every shadow received', async () => {
    const h = await linked()
    h.link.push(DOCKED)
    expect(h.emitted.at(-1)).toEqual({ id: BLID, patch: { activity: 'docked', battery: 100, binFull: false, errorMessage: null, mopAttached: false, tankLevel: 10 } })
    h.link.push(PAUSED)
    expect(h.emitted.at(-1)!.patch).toMatchObject({ activity: 'paused' })
  })

  it('translates the single button into `start` or `resume` depending on the activity', async () => {
    const h = await linked()
    h.link.push(DOCKED)
    await h.plugin.execute(BLID, { type: 'vacuum.start' })
    expect(h.link.published.at(-1)).toBe('start')

    h.link.push(PAUSED)
    await h.plugin.execute(BLID, { type: 'vacuum.start' })
    expect(h.link.published.at(-1)).toBe('resume')
  })

  it('translates the three other actions', async () => {
    const h = await linked()
    h.link.push(DOCKED)
    await h.plugin.execute(BLID, { type: 'vacuum.pause' })
    h.link.push(DOCKED)
    await h.plugin.execute(BLID, { type: 'vacuum.dock' })
    await h.plugin.execute(BLID, { type: 'vacuum.locate' })
    expect(h.link.published).toEqual(['pause', 'dock', 'find'])
  })

  /**
   * The robot ACCEPTS a `dock` mid-mission and does nothing (measured on Robby on 09/19:
   * `lastCommand` recorded, `phase: "run"` two and a half minutes later). So the plugin must stop
   * it first — otherwise the "Return to dock" button does nothing, silently.
   */
  it('stops the robot before sending it back to its dock while it is cleaning', async () => {
    const h = await linked()
    h.link.push(CLEANING)
    const geste = h.plugin.execute(BLID, { type: 'vacuum.dock' })
    // the plugin gives the robot time to stop FOR GOOD: we advance the clock in its place
    for (let i = 0; i < 40 && h.link.published.length < 2; i++) {
      h.clock.advance(500)
      await Promise.resolve()
    }
    await geste
    expect(h.link.published).toEqual(['pause', 'dock'])
  })

  /**
   * The grace delay is not cosmetic: a `dock` sent too soon after the `pause` is swallowed by the
   * robot without error and never replayed. So the plugin must NOT send it until it has let that
   * delay pass — this test would fail if the wait were removed.
   */
  it('does not send the `dock` right on the heels of the `pause`', async () => {
    const h = await linked()
    h.link.push(CLEANING)
    const geste = h.plugin.execute(BLID, { type: 'vacuum.dock' })
    // the robot stops right away (the fake link simulates it), and we advance JUST UNDER the grace
    // delay: if the plugin didn't observe it, the `dock` would already have gone out here
    for (let i = 0; i < 5; i++) { h.clock.advance(500); await Promise.resolve() }
    expect(h.link.published).toEqual(['pause'])
    for (let i = 0; i < 40 && h.link.published.length < 2; i++) {
      h.clock.advance(500)
      await Promise.resolve()
    }
    await geste
    expect(h.link.published).toEqual(['pause', 'dock'])
  })

  it('refuses a command of another kind', async () => {
    const h = await linked()
    await expect(h.plugin.execute(BLID, { type: 'light.on' } as never)).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
  })

  it('refuses an action toward an unreachable robot', async () => {
    const h = harness({ store: memoryStore({ robots: [{ blid: BLID, password: ':1:pw', name: 'Robby', sku: null }], linkedAt: 1 }), found: [] })
    await h.plugin.init(h.ctx)
    await h.plugin.discover()
    await expect(h.plugin.execute(BLID, { type: 'vacuum.dock' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
  })

  it('keeps in the inventory an account robot missing from the network, marking it unavailable', async () => {
    const h = harness({ store: memoryStore({ robots: [{ blid: BLID, password: ':1:pw', name: 'Robby', sku: null }], linkedAt: 1 }), found: [] })
    await h.plugin.init(h.ctx)
    const list = await h.plugin.discover()
    expect(list).toHaveLength(1)
    expect(h.available).toContainEqual({ id: BLID, value: false })
    expect(h.plugin.health!().status).toBe('degraded')
  })

  it('forgets everything on unlinking', async () => {
    const h = await linked()
    const app = Fastify()
    h.plugin.registerRoutes!(app)
    const res = await app.inject({ method: 'POST', url: '/logout' })
    expect(res.json<IrobotStatus>()).toMatchObject({ linked: false, robots: [] })
    expect(h.link.closed).toBe(true)
  })
})

describe('iRobot plugin — robot certificate pin', () => {
  /** What the pin reads from a socket whose handshake completed. */
  const socket = (fingerprint: string) => ({ getPeerCertificate: () => ({ fingerprint256: fingerprint }) }) as never

  it('keeps the pin with the password, reports a changed certificate, and linking again accepts it', async () => {
    const store = memoryStore()
    const h = harness({ store })
    await h.plugin.init(h.ctx)
    const app = Fastify()
    h.plugin.registerRoutes!(app)
    await app.inject({ method: 'POST', url: '/login', payload: { email: 'moi@exemple.fr', password: 'secret' } })
    const pin = h.link.connectImpl.mock.calls[0]![0].pin

    expect(pin.check(socket('AA:01'))).toBeNull()                      // first connection: pinned
    expect((await store.load())?.robots[0]?.pin).toBe('AA:01')
    expect(pin.check(socket('BB:02'))).not.toBeNull()                  // another certificate: refused
    expect(h.plugin.health!()).toEqual({ status: 'error', detail: expect.stringContaining('Le certificat de Robby a changé') })

    await app.inject({ method: 'POST', url: '/login', payload: { email: 'moi@exemple.fr', password: 'secret' } })
    expect(h.plugin.health!().status).not.toBe('error')
    expect((await store.load())?.robots[0]?.pin).toBeUndefined()
    expect(pin.check(socket('BB:02'))).toBeNull()                      // the next connection pins the new one
    expect((await store.load())?.robots[0]?.pin).toBe('BB:02')
  })

  it('opens the next link with the pin kept in the session file', async () => {
    const h = harness({ store: memoryStore({ robots: [{ blid: BLID, password: ':1:pw', name: 'Robby', sku: null, pin: 'AA:01' }], linkedAt: 1 }) })
    await h.plugin.init(h.ctx)
    await h.plugin.discover()
    expect(h.link.connectImpl.mock.calls[0]![0].pin.check(socket('BB:02'))).not.toBeNull()
  })

  it('keeps a working link when a datagram names another address, and tries it once that link drops', async () => {
    const found = [ROBOT]
    const h = harness({ store: memoryStore({ robots: [{ blid: BLID, password: ':1:pw', name: 'Robby', sku: null }], linkedAt: 1 }), found })
    await h.plugin.init(h.ctx)
    await h.plugin.discover()
    h.link.up()
    found[0] = { ...ROBOT, ip: '192.168.1.99' }
    await h.plugin.discover()
    expect(h.link.connectImpl).toHaveBeenCalledTimes(1)
    expect(h.link.closed).toBe(false)

    h.link.down()
    await h.plugin.discover()
    expect(h.link.connectImpl).toHaveBeenLastCalledWith(expect.objectContaining({ ip: '192.168.1.99' }))
  })
})
