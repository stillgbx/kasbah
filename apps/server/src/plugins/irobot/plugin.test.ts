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

// Ce que le plugin doit tenir : ne rien publier tant que le compte n'est pas relié, obtenir les
// mots de passe LOCAUX en une fois puis ne plus toucher au réseau extérieur, marquer indisponible
// un robot du compte absent du LAN plutôt que de l'oublier, et traduire les quatre gestes.
// Aucun compte ni robot réel n'est touché.

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

/** Faux cloud iRobot : découverte publique, Gigya, puis l'échange qui rend les mots de passe. */
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
      // Gigya répond TOUJOURS en HTTP 200, même pour refuser
      return response(overrides.gigya ?? { errorCode: 0, UID: 'uid-1', UIDSignature: 'sig-1', signatureTimestamp: '1789820609' })
    }
    if (String(url).includes('/v2/login')) {
      return response({ robots: { [BLID]: { password: ':1:mot-de-passe-local', name: 'Robby', sku: 'c755840' } } })
    }
    return response({ error: 'not found' }, 404)
  })
  return { fetchImpl, calls }
}

/** Faux lien MQTT : on pousse les ombres à la main et on note les commandes publiées. */
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
        // comme le vrai robot : un `pause` le sort de la mission, et c'est ce que `settle` guette
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

describe('plugin iRobot — compte non relié', () => {
  it('ne publie aucun appareil et demande l appairage', async () => {
    const h = harness()
    await h.plugin.init(h.ctx)
    expect(await h.plugin.discover()).toEqual([])
    expect(h.plugin.health!().status).toBe('needs_pairing')
  })

  it('ne balaie pas le réseau au démarrage', async () => {
    const h = harness()
    const discoverImpl = vi.fn(async () => [ROBOT])
    const plugin = createIrobotPlugin({ fetchImpl: h.cloud.fetchImpl, sessionStore: memoryStore(), discoverImpl, connectImpl: h.link.connectImpl as never })
    await plugin.init(h.ctx)
    await plugin.start()
    expect(discoverImpl).not.toHaveBeenCalled()
  })
})

describe('plugin iRobot — liaison du compte', () => {
  it('obtient le mot de passe LOCAL puis ouvre le lien du robot', async () => {
    const h = harness()
    await h.plugin.init(h.ctx)
    const app = Fastify()
    h.plugin.registerRoutes!(app)

    const res = await app.inject({ method: 'POST', url: '/login', payload: { email: 'moi@exemple.fr', password: 'secret' } })
    expect(res.statusCode).toBe(200)
    const status = res.json<IrobotStatus>()
    expect(status.linked).toBe(true)
    expect(status.robots).toEqual([expect.objectContaining({ blid: BLID, name: 'Robby', ip: '192.168.1.81' })])

    // trois appels vers le cloud, et plus jamais ensuite
    expect(h.cloud.calls).toHaveLength(3)
    expect(h.link.connectImpl).toHaveBeenCalledWith(expect.objectContaining({ blid: BLID, password: ':1:mot-de-passe-local', ip: '192.168.1.81' }))
  })

  it('ne renvoie JAMAIS un mot de passe dans le statut', async () => {
    const h = harness()
    await h.plugin.init(h.ctx)
    const app = Fastify()
    h.plugin.registerRoutes!(app)
    await app.inject({ method: 'POST', url: '/login', payload: { email: 'moi@exemple.fr', password: 'secret' } })
    const body = (await app.inject({ method: 'GET', url: '/status' })).body
    expect(body).not.toContain('mot-de-passe-local')
    expect(body).not.toContain('secret')
  })

  it('distingue un refus d identifiants d une panne', async () => {
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

  it('reprend les identifiants du fichier au redémarrage, sans toucher au cloud', async () => {
    const store = memoryStore({ robots: [{ blid: BLID, password: ':1:pw', name: 'Robby', sku: 'c755840' }], linkedAt: 1 })
    const h = harness({ store })
    await h.plugin.init(h.ctx)
    expect(await h.plugin.discover()).toEqual([expect.objectContaining({ id: `irobot:${BLID}`, kind: 'vacuum', name: 'Robby' })])
    expect(h.cloud.calls).toHaveLength(0)
  })
})

describe('plugin iRobot — état et gestes', () => {
  async function linked() {
    const store = memoryStore({ robots: [{ blid: BLID, password: ':1:pw', name: 'Robby', sku: 'c755840' }], linkedAt: 1 })
    const h = harness({ store })
    await h.plugin.init(h.ctx)
    await h.plugin.discover()
    h.link.up()
    return h
  }

  it('publie l état à chaque ombre reçue', async () => {
    const h = await linked()
    h.link.push(DOCKED)
    expect(h.emitted.at(-1)).toEqual({ id: BLID, patch: { activity: 'docked', battery: 100, binFull: false, errorMessage: null } })
    h.link.push(PAUSED)
    expect(h.emitted.at(-1)!.patch).toMatchObject({ activity: 'paused' })
  })

  it('traduit le bouton unique en `start` ou `resume` selon l activité', async () => {
    const h = await linked()
    h.link.push(DOCKED)
    await h.plugin.execute(BLID, { type: 'vacuum.start' })
    expect(h.link.published.at(-1)).toBe('start')

    h.link.push(PAUSED)
    await h.plugin.execute(BLID, { type: 'vacuum.start' })
    expect(h.link.published.at(-1)).toBe('resume')
  })

  it('traduit les trois autres gestes', async () => {
    const h = await linked()
    h.link.push(DOCKED)
    await h.plugin.execute(BLID, { type: 'vacuum.pause' })
    h.link.push(DOCKED)
    await h.plugin.execute(BLID, { type: 'vacuum.dock' })
    await h.plugin.execute(BLID, { type: 'vacuum.locate' })
    expect(h.link.published).toEqual(['pause', 'dock', 'find'])
  })

  /**
   * Le robot ACCEPTE un `dock` en pleine mission et ne fait rien (mesuré sur Robby le 19/09 :
   * `lastCommand` enregistré, `phase: "run"` deux minutes et demie après). Le plugin doit donc
   * l'arrêter d'abord — sinon le bouton « Retour base » ne fait rien, en silence.
   */
  it('arrête le robot avant de le renvoyer à sa base quand il nettoie', async () => {
    const h = await linked()
    h.link.push(CLEANING)
    const geste = h.plugin.execute(BLID, { type: 'vacuum.dock' })
    // le plugin laisse au robot le temps de s'arrêter POUR DE BON : on avance l'horloge à sa place
    for (let i = 0; i < 40 && h.link.published.length < 2; i++) {
      h.clock.advance(500)
      await Promise.resolve()
    }
    await geste
    expect(h.link.published).toEqual(['pause', 'dock'])
  })

  /**
   * Le délai de grâce n'est pas cosmétique : un `dock` envoyé trop tôt après le `pause` est avalé
   * par le robot sans erreur et jamais rejoué. Le plugin ne doit donc PAS l'envoyer tant qu'il n'a
   * pas laissé passer ce délai — ce test échouerait si on retirait l'attente.
   */
  it('n envoie pas le `dock` dans la foulée du `pause`', async () => {
    const h = await linked()
    h.link.push(CLEANING)
    const geste = h.plugin.execute(BLID, { type: 'vacuum.dock' })
    // le robot s'arrête tout de suite (le faux lien le simule), et on avance JUSTE SOUS le délai
    // de grâce : si le plugin ne l'observait pas, le `dock` serait déjà parti ici
    for (let i = 0; i < 5; i++) { h.clock.advance(500); await Promise.resolve() }
    expect(h.link.published).toEqual(['pause'])
    for (let i = 0; i < 40 && h.link.published.length < 2; i++) {
      h.clock.advance(500)
      await Promise.resolve()
    }
    await geste
    expect(h.link.published).toEqual(['pause', 'dock'])
  })

  it('refuse une commande d un autre kind', async () => {
    const h = await linked()
    await expect(h.plugin.execute(BLID, { type: 'light.on' } as never)).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
  })

  it('refuse un geste vers un robot injoignable', async () => {
    const h = harness({ store: memoryStore({ robots: [{ blid: BLID, password: ':1:pw', name: 'Robby', sku: null }], linkedAt: 1 }), found: [] })
    await h.plugin.init(h.ctx)
    await h.plugin.discover()
    await expect(h.plugin.execute(BLID, { type: 'vacuum.dock' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
  })

  it('garde dans l inventaire un robot du compte absent du réseau, en le disant indisponible', async () => {
    const h = harness({ store: memoryStore({ robots: [{ blid: BLID, password: ':1:pw', name: 'Robby', sku: null }], linkedAt: 1 }), found: [] })
    await h.plugin.init(h.ctx)
    const list = await h.plugin.discover()
    expect(list).toHaveLength(1)
    expect(h.available).toContainEqual({ id: BLID, value: false })
    expect(h.plugin.health!().status).toBe('degraded')
  })

  it('oublie tout à la déliaison', async () => {
    const h = await linked()
    const app = Fastify()
    h.plugin.registerRoutes!(app)
    const res = await app.inject({ method: 'POST', url: '/logout' })
    expect(res.json<IrobotStatus>()).toMatchObject({ linked: false, robots: [] })
    expect(h.link.closed).toBe(true)
  })
})
