import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { MOWERS_ERROR, MOWERS_MOWING, MOWER_ID, TOKEN_INVALID_CLIENT, TOKEN_RESPONSE, TOKEN_RESPONSE_2, WS_POSITION, WS_READY, WS_UNKNOWN_MOWER } from './__fixtures__/automower'
import { TOKEN_URL } from './auth'
import { API_BASE_URL } from './client'
import { automowerConfigSchema, createAutomowerPlugin, type AutomowerStatus } from './index'
import type { AutomowerUsage, UsageStore } from './state'
import type { WsFactory, WsLike } from './ws'

// Ce que le plugin doit tenir face au fabricant : lire l'état complet au démarrage et le publier,
// laisser le FLUX porter le vivant (position) sans dépenser le quota, compter chaque requête,
// redemander un jeton sur un 401 et se déclarer « à configurer » sur une clé refusée, traduire les
// trois gestes en actions JSON:API. Aucun compte ni robot réel n'est touché.

const NOW = Date.UTC(2026, 8, 16, 12)
const MIN = 60_000
const ENV = { AUTOMOWER_APP_KEY: 'app-key', AUTOMOWER_APP_SECRET: 'app-secret', AUTOMOWER_TIMEZONE: 'Europe/Paris', AUTOMOWER_POLL_MS: String(10 * MIN), AUTOMOWER_USAGE_FILE: '' }

const response = (body: unknown, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => body,
  text: async () => (body === null ? '' : JSON.stringify(body)),
})

/** Faux Husqvarna : serveur de jetons et API, pilotés par un état mutable. */
function fakeHusqvarna() {
  const world = {
    list: MOWERS_ERROR as unknown,
    /** Le jeton que l'API accepte ; un autre → 401. */
    accepts: TOKEN_RESPONSE.access_token,
    /** Ce que le serveur de jetons rend au prochain appel. */
    nextToken: TOKEN_RESPONSE as unknown,
    tokenStatus: 200,
  }
  const calls: { method: string; path: string; body?: string; headers: Record<string, string> }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const method = init?.method ?? 'GET'
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    const body = init?.body === undefined ? undefined : String(init.body)
    if (url === TOKEN_URL) {
      calls.push({ method, path: 'token', body, headers })
      return response(world.nextToken, world.tokenStatus)
    }
    const path = url.replace(API_BASE_URL, '')
    calls.push({ method, path, body, headers })
    if (headers.authorization !== `Bearer ${world.accepts}`) return response({ errors: [{ title: 'Unauthorized' }] }, 401)
    if (headers['x-api-key'] !== 'app-key' || headers['authorization-provider'] !== 'husqvarna') return response({ errors: [{ title: 'Forbidden' }] }, 403)
    if (path === '/mowers') return response(world.list)
    if (path.endsWith('/actions')) return response(null, 202)
    return response({ errors: [{ title: 'Not found' }] }, 404)
  })
  return { fetchImpl, calls, world }
}

/** Faux WebSocket : on tient les gestionnaires, et on joue les événements à la main. */
function fakeWs() {
  const sockets: (WsLike & { handlers: Record<string, ((...a: unknown[]) => void)[]>; headers: Record<string, string>; pings: number; closed: boolean })[] = []
  const factory: WsFactory = (_url, headers) => {
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {}
    const s = {
      handlers, headers, pings: 0, closed: false,
      on(event: string, fn: (...a: unknown[]) => void) { (handlers[event] ??= []).push(fn); return s },
      ping() { s.pings++ },
      close() { s.closed = true },
      terminate() { s.closed = true },
    }
    sockets.push(s as never)
    return s as never
  }
  const emit = (i: number, event: string, ...args: unknown[]) => { for (const fn of sockets[i]!.handlers[event] ?? []) fn(...args) }
  return { factory, sockets, emit }
}

function memoryUsage(initial: AutomowerUsage | null = null): UsageStore & { value: AutomowerUsage | null } {
  const s = { value: initial, load: async () => s.value, save: async (u: AutomowerUsage) => { s.value = { ...u } } }
  return s
}

async function started(over: { env?: Record<string, string>; hq?: ReturnType<typeof fakeHusqvarna>; usage?: ReturnType<typeof memoryUsage>; start?: boolean } = {}) {
  const hq = over.hq ?? fakeHusqvarna()
  const ws = fakeWs()
  const usage = over.usage ?? memoryUsage()
  const plugin = createAutomowerPlugin({ fetchImpl: hq.fetchImpl, wsFactory: ws.factory, usageStore: usage })
  const clock = new ManualClock(NOW)
  const ctrl = new AbortController()
  const ctx: PluginContext = {
    pluginId: 'automower',
    config: automowerConfigSchema.parse({ ...ENV, ...over.env }),
    logger: pino({ level: 'silent' }), clock, signal: ctrl.signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  await plugin.init(ctx)
  const app = Fastify()
  plugin.registerRoutes?.(app)
  await app.ready()
  expect(await plugin.discover()).toEqual([])
  if (over.start !== false) {
    await plugin.start()
    await flush()
  }
  const statusOf = async () => (await app.inject({ method: 'GET', url: '/status' })).json() as AutomowerStatus
  return { plugin, ctx, clock, hq, ws, usage, app, ctrl, statusOf }
}

/** Laisse passer les micro-tâches du poller et du flux. */
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe('automower — démarrage', () => {
  it('sans clé : idle, needs_pairing, aucun appel', async () => {
    const { plugin, hq } = await started({ env: { AUTOMOWER_APP_KEY: '', AUTOMOWER_APP_SECRET: '' } })
    expect(plugin.health!().status).toBe('needs_pairing')
    expect(hq.calls).toHaveLength(0)
    await expect(plugin.execute(MOWER_ID, { type: 'mower.pause' })).rejects.toMatchObject({ code: 'NEEDS_PAIRING' })
  })

  it('lit la liste au démarrage, publie le descripteur et l’état complet, puis ouvre le flux avec le jeton', async () => {
    const { ctx, hq, ws, plugin } = await started()
    // un jeton, puis la liste — avec les trois en-têtes du fabricant
    expect(hq.calls.map((c) => c.path)).toEqual(['token', '/mowers'])
    expect(hq.calls[0]!.body).toContain('grant_type=client_credentials')
    expect(hq.calls[1]!.headers).toMatchObject({ authorization: `Bearer ${TOKEN_RESPONSE.access_token}`, 'authorization-provider': 'husqvarna', 'x-api-key': 'app-key' })
    expect(ctx.emitDevices).toHaveBeenCalledTimes(1)
    expect((ctx.emitDevices as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject([{ id: `automower:${MOWER_ID}`, kind: 'mower', name: 'Tondeuse' }])
    expect(ctx.emitState).toHaveBeenCalledWith(MOWER_ID, expect.objectContaining({ activity: 'error', errorCode: 2, errorMessage: 'No loop signal', battery: 100 }))
    expect(ctx.setAvailable).toHaveBeenCalledWith(MOWER_ID, true)
    expect(ws.sockets).toHaveLength(1)
    expect(ws.sockets[0]!.headers).toEqual({ Authorization: `Bearer ${TOKEN_RESPONSE.access_token}` })
    expect(plugin.health!()).toMatchObject({ status: 'ok', deviceCount: 1, quota: { used: 2, limit: 10_000, labelKey: 'mower.quotaRequests' } })
    expect(plugin.health!().detail).toContain('polling only')
  })

  it('une clé refusée par le serveur de jetons : degraded, et la commande dit NEEDS_PAIRING', async () => {
    const hq = fakeHusqvarna()
    hq.world.nextToken = TOKEN_INVALID_CLIENT
    hq.world.tokenStatus = 400
    const { plugin, ctx } = await started({ hq })
    expect(ctx.emitDevices).not.toHaveBeenCalled()
    expect(plugin.health!().status).toBe('degraded')
    expect(plugin.health!().detail).toContain('refused the application key')
  })
})

describe('automower — le flux porte le vivant', () => {
  it('ready puis position : l’état gagne une location sans nouvelle requête ; la santé dit « live »', async () => {
    const { ctx, hq, ws, plugin, clock } = await started()
    ws.emit(0, 'open')
    ws.emit(0, 'message', JSON.stringify(WS_READY))
    ws.emit(0, 'message', JSON.stringify(WS_POSITION))
    expect(ctx.emitState).toHaveBeenLastCalledWith(MOWER_ID, { location: { lat: 47.309601, lon: 5.045802, at: NOW } })
    expect(hq.calls).toHaveLength(2)
    expect(plugin.health!().detail).toContain('live events')
    // le ping tient la connexion
    clock.advance(61_000)
    expect(ws.sockets[0]!.pings).toBe(1)
  })

  it('un événement pour un robot inconnu relit la liste (une fois par minute au plus)', async () => {
    const { hq, ws } = await started()
    ws.emit(0, 'open')
    ws.emit(0, 'message', JSON.stringify(WS_UNKNOWN_MOWER))
    ws.emit(0, 'message', JSON.stringify(WS_UNKNOWN_MOWER))
    await flush()
    expect(hq.calls.filter((c) => c.path === '/mowers')).toHaveLength(2)
  })

  it('le flux se ferme : reconnexion après backoff avec un jeton, et relecture complète', async () => {
    const { hq, ws, clock } = await started()
    ws.emit(0, 'open')
    ws.emit(0, 'close', 1006)
    clock.advance(6_500)
    await flush()
    expect(ws.sockets).toHaveLength(2)
    ws.emit(1, 'open')
    await flush()
    expect(hq.calls.filter((c) => c.path === '/mowers')).toHaveLength(2)
  })

  it('le sondage relit à sa cadence, et publie le nouvel état', async () => {
    const { ctx, hq, clock } = await started()
    hq.world.list = MOWERS_MOWING
    clock.advance(10 * MIN + 1)
    await flush()
    expect(hq.calls.filter((c) => c.path === '/mowers')).toHaveLength(2)
    expect(ctx.emitState).toHaveBeenLastCalledWith(MOWER_ID, expect.objectContaining({ activity: 'mowing', errorCode: null, battery: 83 }))
    // même robot, même nom : le descripteur n'est pas republié
    expect(ctx.emitDevices).toHaveBeenCalledTimes(1)
  })
})

describe('automower — jeton et quota', () => {
  it('un 401 fait redemander UN jeton et rejouer ; le compteur du mois compte tout et survit', async () => {
    const usage = memoryUsage({ month: '2026-09', requests: 40 })
    const { hq, clock, plugin, statusOf } = await started({ usage })
    // le jeton devient périmé côté fabricant
    hq.world.accepts = TOKEN_RESPONSE_2.access_token
    hq.world.nextToken = TOKEN_RESPONSE_2
    clock.advance(10 * MIN + 1)
    await flush()
    expect(hq.calls.map((c) => c.path)).toEqual(['token', '/mowers', '/mowers', 'token', '/mowers'])
    // 40 + jeton + liste + (liste 401 + jeton + liste) = 45, écrits au fur et à mesure
    expect(usage.value).toEqual({ month: '2026-09', requests: 45 })
    expect((await statusOf()).requestsThisMonth).toBe(45)
    expect(plugin.health!().quota).toMatchObject({ used: 45, since: Date.UTC(2026, 8, 1) })
  })

  it('un fichier d’un autre mois repart de zéro', async () => {
    const usage = memoryUsage({ month: '2026-08', requests: 9_000 })
    const { plugin } = await started({ usage })
    expect(plugin.health!().quota).toMatchObject({ used: 2 })
  })
})

describe('automower — commandes', () => {
  it('tondre une heure, pause, se garer : trois actions JSON:API, accusées en 202', async () => {
    const { plugin, hq } = await started()
    await plugin.execute(MOWER_ID, { type: 'mower.start', durationMin: 60 })
    await plugin.execute(MOWER_ID, { type: 'mower.pause' })
    await plugin.execute(MOWER_ID, { type: 'mower.park', untilNextSchedule: true })
    const actions = hq.calls.filter((c) => c.path.endsWith('/actions'))
    expect(actions.map((c) => c.path)).toEqual(Array(3).fill(`/mowers/${MOWER_ID}/actions`))
    expect(actions.map((c) => JSON.parse(c.body!))).toEqual([
      { data: { type: 'Start', attributes: { duration: 60 } } },
      { data: { type: 'Pause' } },
      { data: { type: 'ParkUntilNextSchedule' } },
    ])
    expect(actions[0]!.headers['content-type']).toBe('application/vnd.api+json')
  })

  it('refuse une commande d’un autre kind, un robot inconnu, un robot hors ligne', async () => {
    const { plugin, hq, clock } = await started()
    await expect(plugin.execute(MOWER_ID, { type: 'vacuum.start' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(plugin.execute('nope', { type: 'mower.pause' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    hq.world.list = { data: [{ ...MOWERS_ERROR.data[0]!, attributes: { ...MOWERS_ERROR.data[0]!.attributes, metadata: { connected: false, statusTimestamp: 1 } } }] }
    clock.advance(10 * MIN + 1)
    await flush()
    await expect(plugin.execute(MOWER_ID, { type: 'mower.pause' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
  })
})

describe('automower — redémarrage', () => {
  /**
   * Constaté sur le vrai serveur : après une bascule dans les Réglages, l'hôte vide les appareils du
   * plugin avec le résultat de `discover`, puis relance `start`. Le plugin croyait avoir déjà publié
   * ses descripteurs et ne les réémettait pas — robot lu, flux ouvert, et pourtant absent du registre.
   */
  it('stop puis init/discover/start : les robots connus sont redits par discover, et republiés après la relecture', async () => {
    const { plugin, ctx, hq } = await started()
    await plugin.stop()
    // deuxième vie : même instance, nouveau contexte (c'est ce que fait l'hôte)
    const ctx2: PluginContext = { ...ctx, emitDevices: vi.fn(), emitState: vi.fn(), setAvailable: vi.fn(), signal: new AbortController().signal }
    await plugin.init(ctx2)
    const known = await plugin.discover()
    expect(known).toHaveLength(1)
    await plugin.start()
    await flush()
    expect(hq.calls.filter((c) => c.path === '/mowers')).toHaveLength(2)
    expect(ctx2.emitState).toHaveBeenCalledWith(MOWER_ID, expect.objectContaining({ activity: 'error' }))
    // la liste n'a pas changé : ce que `discover` a déclaré tient, pas de republication inutile
    expect(ctx2.emitDevices).not.toHaveBeenCalled()
    await plugin.stop()
  })
})

describe('automower — routes et arrêt', () => {
  it('/status ne porte ni clé ni secret ; /raw relit la liste et la compte', async () => {
    const { app, statusOf, plugin } = await started()
    const s = await statusOf()
    expect(s).toMatchObject({ configured: true, live: false, timezone: 'Europe/Paris', monthlyLimit: 10_000, mowers: [{ id: MOWER_ID, name: 'Tondeuse', connected: true }] })
    expect(JSON.stringify(s)).not.toContain('app-secret')
    const raw = await app.inject({ method: 'GET', url: '/raw' })
    expect(raw.statusCode).toBe(200)
    expect(raw.json()).toEqual({ mowers: MOWERS_ERROR })
    expect(plugin.health!().quota?.used).toBe(3)
  })

  it('stop ferme le flux et arrête le sondage', async () => {
    const { plugin, ws, hq, clock } = await started()
    ws.emit(0, 'open')
    await plugin.stop()
    expect(ws.sockets[0]!.closed).toBe(true)
    clock.advance(30 * MIN)
    await flush()
    expect(hq.calls.filter((c) => c.path === '/mowers')).toHaveLength(1)
  })
})
