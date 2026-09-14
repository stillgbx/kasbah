import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import {
  BATTERY_WAITING, COCKPIT_V1, COCKPIT_V2_EASTER_EGG, FORBIDDEN, HVAC_STATUS, LOCATION, NOT_FOUND, SOC_LEVELS,
} from './__fixtures__/kamereon'
import { JWT_TTL_S, type SessionStore, type StoredSession } from './auth'
import { createRenaultPlugin, renaultConfigSchema } from './index'

// Ce que le plugin doit tenir face à Renault, et que seule une API privée impose :
//
//  - GIGYA RÉPOND EN HTTP 200 MÊME QUAND ELLE REFUSE. Un mot de passe faux, une session périmée,
//    une double authentification en attente : tout arrive en 200 avec un `errorCode`. C'est LE
//    piège de cette API, et la moitié des tests ci-dessous ne sert qu'à le garder fermé.
//  - Le MOT DE PASSE ne doit rien laisser derrière lui : ni dans le cache de session, ni ailleurs.
//  - Le DÉBIT est serré (60 appels par heure) : le plugin doit refuser lui-même, sans appeler.
//  - Un endpoint REFUSÉ pour ce véhicule (403 `err.func.wired.forbidden`, le cas de la R5 sur le
//    verrouillage et la pression des pneus) n'est pas une panne et ne doit pas gâcher une capture.
//
// Aucun compte ni véhicule réel n'est touché.

const NOW = Date.UTC(2026, 8, 14, 10)
const GIGYA = 'https://accounts.eu1.gigya.com'
const KAMEREON = 'https://api-wired-prod-1-euw1.wrd-aws.com'
const VIN = 'VF1RJE00000000001'
const PERSON = 'person-0001'
const ACCOUNT = 'account-0001'
const LOGIN_TOKEN = 'login-token-abc'
const PASSWORD = 'un-mot-de-passe-qui-ne-doit-pas-fuir'

const response = (body: unknown, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

const VEHICLES = {
  accountId: ACCOUNT,
  vehicleLinks: [{
    vin: VIN,
    status: 'ACTIVE',
    vehicleDetails: {
      vin: VIN,
      registrationNumber: 'GA-123-BX',
      brand: { label: 'RENAULT' },
      model: { code: 'R5E1VE', label: 'R5 E-Tech' },
      energy: { code: 'ELEC', label: 'Electrique' },
    },
  }],
}

/** Faux Renault : Gigya (authentification) et Kamereon (données), pilotés par un état mutable. */
function fakeRenault(over: { gigyaError?: number } = {}) {
  const world = {
    /** Le JWT que Kamereon accepte ; un autre → 401. Change à chaque `accounts.getJWT`. */
    jwt: 'jwt-1',
    minted: 0,
    /** Kamereon répond 401 une fois avant d'accepter (JWT révoqué avant son échéance). */
    revokeOnce: false,
    /** `hvac-status` répond 403 tant que vrai : une lecture que ce véhicule ne sert pas. */
    hvacForbidden: false,
  }
  const calls: { method: string; path: string }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = init?.body === undefined ? undefined : String(init.body)

    if (url.startsWith(GIGYA)) {
      const method_ = url.slice(GIGYA.length + 1)
      calls.push({ method, path: `gigya:${method_}` })
      const params = new URLSearchParams(body)
      // TOUT sort en HTTP 200, y compris les refus : c'est `errorCode` qui tranche
      if (over.gigyaError) return response({ errorCode: over.gigyaError, errorMessage: 'refused' })
      if (method_ === 'accounts.login') {
        if (params.get('password') !== PASSWORD) return response({ errorCode: 403042, errorMessage: 'Invalid LoginID' })
        return response({ errorCode: 0, sessionInfo: { cookieValue: LOGIN_TOKEN } })
      }
      if (params.get('login_token') !== LOGIN_TOKEN) return response({ errorCode: 403005, errorMessage: 'Unauthorized user' })
      if (method_ === 'accounts.getAccountInfo') return response({ errorCode: 0, data: { personId: PERSON } })
      if (method_ === 'accounts.getJWT') {
        world.jwt = `jwt-${++world.minted + 1}`
        return response({ errorCode: 0, id_token: world.jwt })
      }
      return response({ errorCode: 400002, errorMessage: 'unknown method' })
    }

    const path = url.slice(KAMEREON.length).split('?')[0]!
    calls.push({ method, path })
    if (headers.apikey !== 'YjkKtHmGfaceeuExUDKGxrLZGGvtVS0J') return response({ errors: [{ errorCode: 'err.tech.500' }] }, 500)
    if (world.revokeOnce) { world.revokeOnce = false; return response({ errors: [{ errorCode: 'err.func.wired.unauthorized' }] }, 401) }
    if (headers['x-gigya-id_token'] !== world.jwt) return response({ errors: [{ errorCode: 'err.func.wired.unauthorized' }] }, 401)
    if (path === `/commerce/v1/persons/${PERSON}`) {
      return response({ accounts: [{ accountId: ACCOUNT, accountType: 'MYRENAULT', accountStatus: 'ACTIVE' }] })
    }
    if (path === `/commerce/v1/accounts/${ACCOUNT}/vehicles`) return response(VEHICLES)
    // ce que la R5 a répondu à la capture, refus compris
    if (path.endsWith('/battery-status')) return response(BATTERY_WAITING)
    if (path.endsWith('/cockpit')) return response(path.includes('/v2/') ? COCKPIT_V2_EASTER_EGG : COCKPIT_V1)
    if (path.endsWith('/location')) return response(LOCATION)
    if (path.endsWith('/hvac-status')) return world.hvacForbidden ? response(FORBIDDEN, 403) : response(HVAC_STATUS)
    if (path.endsWith('/ev/soc-levels')) return response(SOC_LEVELS)
    // les deux saveurs de refus : 403 « interdit » et 404 « inconnu »
    if (path.endsWith('/lock-status') || path.endsWith('/pressure')) return response(NOT_FOUND, 404)
    return response({ data: { attributes: {} } })
  })
  return { world, calls, fetchImpl }
}

function memoryStore(initial: StoredSession | null = null): SessionStore & { value: StoredSession | null } {
  const store = {
    value: initial,
    async load() { return store.value },
    async save(s: StoredSession) { store.value = s },
    async clear() { store.value = null },
  }
  return store
}

async function setup(over: { env?: Record<string, string>; session?: StoredSession | null; gigyaError?: number } = {}) {
  const renault = fakeRenault(over.gigyaError !== undefined ? { gigyaError: over.gigyaError } : {})
  const sessionStore = memoryStore(over.session ?? null)
  const clock = new ManualClock(NOW)
  const plugin = createRenaultPlugin({ fetchImpl: renault.fetchImpl, sessionStore })
  const ctx: PluginContext = {
    pluginId: 'renault',
    config: renaultConfigSchema.parse({ ...over.env }),
    logger: pino({ level: 'silent' }), clock, signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {},
  }
  await plugin.init(ctx)
  const app = Fastify()
  app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/renault' })
  await app.ready()
  return { plugin, app, renault, sessionStore, ctx, clock }
}

const login = (app: Awaited<ReturnType<typeof setup>>['app'], password = PASSWORD) =>
  app.inject({ method: 'POST', url: '/api/plugins/renault/login', payload: { email: 'moi@exemple.fr', password } })

describe('Renault — liaison du compte', () => {
  it('relie le compte et ne garde que le jeton, jamais le mot de passe', async () => {
    const { app, sessionStore } = await setup()
    const r = await login(app)
    expect(r.statusCode).toBe(200)
    expect(sessionStore.value).toEqual({ loginToken: LOGIN_TOKEN, personId: PERSON })
    // le mot de passe ne doit se retrouver NULLE PART dans ce qui survit à la requête
    expect(JSON.stringify(sessionStore.value)).not.toContain(PASSWORD)
    expect(r.json().vehicles).toEqual([{ vin: VIN, name: 'GA-123-BX' }])
  })

  it('refuse un mot de passe faux, que Gigya rend pourtant en HTTP 200', async () => {
    const { app, sessionStore } = await setup()
    const r = await login(app, 'pas-le-bon')
    expect(r.statusCode).toBe(401)
    expect(sessionStore.value).toBeNull()
  })

  it('dit explicitement qu’une double authentification bloque la liaison', async () => {
    const { app } = await setup({ gigyaError: 403101 })
    const r = await login(app)
    expect(r.statusCode).toBe(401)
    expect(r.json().error).toMatch(/two-factor/i)
  })

  it('délier efface la session', async () => {
    const { app, sessionStore } = await setup()
    await login(app)
    const r = await app.inject({ method: 'POST', url: '/api/plugins/renault/logout' })
    expect(r.statusCode).toBe(200)
    expect(sessionStore.value).toBeNull()
    expect(r.json().linked).toBe(false)
  })
})

describe('Renault — inventaire', () => {
  it('reprend la session du cache et publie un appareil par VIN', async () => {
    const { plugin } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON } })
    const devices = await plugin.discover()
    expect(devices).toEqual([{
      id: `renault:${VIN}`, pluginId: 'renault', externalId: VIN, kind: 'vehicle',
      name: 'GA-123-BX', capabilities: ['soc', 'range', 'location'], meta: {},
    }])
  })

  it('ne déclare aucune capacité de commande : l’UI ne proposera rien que le plugin refuserait', async () => {
    const { plugin } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON } })
    const [device] = await plugin.discover()
    expect(device!.capabilities).not.toContain('lock')
    expect(device!.capabilities).not.toContain('charging')
  })

  it('sans compte lié, aucun appareil et une santé qui le dit', async () => {
    const { plugin } = await setup()
    expect(await plugin.discover()).toEqual([])
    expect(plugin.health!().status).toBe('needs_pairing')
  })
})

describe('Renault — jetons', () => {
  it('réutilise le JWT tant qu’il est frais, et en redemande un une fois périmé', async () => {
    const { plugin, renault, clock } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON } })
    await plugin.discover()
    expect(renault.world.minted).toBe(1)
    await plugin.discover()
    expect(renault.world.minted).toBe(1)          // même JWT : rien redemandé
    clock.advance(JWT_TTL_S * 1000)
    await plugin.discover()
    expect(renault.world.minted).toBe(2)
  })

  it('rejoue la requête une fois après un 401 de Kamereon', async () => {
    const { plugin, renault } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON } })
    renault.world.revokeOnce = true
    const devices = await plugin.discover()
    expect(devices).toHaveLength(1)               // le 401 a été rattrapé, pas remonté
    expect(renault.world.minted).toBe(2)
  })
})

describe('Renault — débit', () => {
  it('refuse lui-même au-delà du budget horaire, sans appeler Renault', async () => {
    const { plugin, renault } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON }, env: { RENAULT_RATE_PER_HOUR: '2' } })
    await plugin.discover()                        // 2 appels : comptes puis véhicules
    const before = renault.calls.filter((c) => c.path.startsWith('/commerce')).length
    expect(await plugin.discover()).toEqual([])    // budget épuisé : la liste échoue proprement
    expect(renault.calls.filter((c) => c.path.startsWith('/commerce'))).toHaveLength(before)
    expect(plugin.health!().status).toBe('degraded')
  })
})

describe('Renault — relevé brut', () => {
  it('rend ce que le véhicule donne ET ce qu’il refuse, sans faire échouer la capture', async () => {
    const { app } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON }, env: { RENAULT_RATE_PER_HOUR: '200' } })
    const r = await app.inject({ method: 'GET', url: '/api/plugins/renault/raw' })
    expect(r.statusCode).toBe(200)
    const readings = r.json().readings as { endpoint: string; ok: boolean; unavailable?: boolean }[]
    expect(readings.find((x) => x.endpoint === 'battery-status')).toMatchObject({ ok: true })
    // le verrouillage refusé est RENDU comme tel : c'est une information, pas une panne
    expect(readings.find((x) => x.endpoint === 'lock-status')).toMatchObject({ ok: false, unavailable: true })
    expect(readings.find((x) => x.endpoint === 'pressure')).toMatchObject({ ok: false, unavailable: true })
  })

  it('refuse la capture tant que le compte n’est pas lié', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/api/plugins/renault/raw' })).statusCode).toBe(409)
  })
})

describe('Renault — sondage', () => {
  /** Cadence de ces tests, indépendante du défaut du plugin. */
  const POLL_MS = 5 * 60_000
  /** Le poller enchaîne des promesses : quelques tours de boucle d'événements suffisent à les vider. */
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
  const patches = (ctx: PluginContext) => (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])
  const dataCalls = (renault: ReturnType<typeof fakeRenault>, endpoint: string) =>
    renault.calls.filter((c) => c.path.endsWith(endpoint)).length

  async function running(over: { hvacForbidden?: boolean } = {}) {
    const s = await setup({
      session: { loginToken: LOGIN_TOKEN, personId: PERSON },
      env: { RENAULT_RATE_PER_HOUR: '600', RENAULT_POLL_MS: String(POLL_MS) },
    })
    if (over.hvacForbidden) s.renault.world.hvacForbidden = true
    await s.plugin.discover()
    await s.plugin.start()
    await flush()
    return s
  }

  it('publie l’état du véhicule dès le premier tour', async () => {
    const { ctx, plugin } = await running()
    expect(patches(ctx).at(-1)).toMatchObject({
      soc: 58, rangeKm: 218, pluggedIn: true, charging: false, odometerKm: 12500, insideTempC: 37, chargeLimit: 80,
    })
    await plugin.stop()
  })

  it('ne redemande JAMAIS une lecture que le véhicule refuse', async () => {
    const { plugin, renault, clock } = await running({ hvacForbidden: true })
    expect(dataCalls(renault, '/hvac-status')).toBe(1)
    clock.advance(POLL_MS + 60_000)
    await flush()
    expect(dataCalls(renault, '/battery-status')).toBeGreaterThan(1)   // le tour a bien eu lieu
    expect(dataCalls(renault, '/hvac-status')).toBe(1)                 // mais celle-là est rayée
    await plugin.stop()
  })

  it('le refus d’une lecture n’empêche pas les autres de publier', async () => {
    const { ctx, plugin } = await running({ hvacForbidden: true })
    const last = patches(ctx).at(-1)!
    expect(last).toMatchObject({ soc: 58, odometerKm: 12500 })
    expect(last).not.toHaveProperty('insideTempC')
    await plugin.stop()
  })

  it('vehicle.refresh relit tout de suite', async () => {
    const { plugin, renault, ctx } = await running()
    const before = dataCalls(renault, '/battery-status')
    await plugin.execute(VIN, { type: 'vehicle.refresh' })
    expect(dataCalls(renault, '/battery-status')).toBe(before + 1)
    expect(patches(ctx).at(-1)).toMatchObject({ soc: 58 })
    await plugin.stop()
  })

  it('refuse toute autre commande plutôt que de faire semblant', async () => {
    const { plugin } = await running()
    await expect(plugin.execute(VIN, { type: 'vehicle.lock' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await plugin.stop()
  })

  it('arrêter le plugin arrête le sondage', async () => {
    const { plugin, renault, clock } = await running()
    await plugin.stop()
    const before = dataCalls(renault, '/battery-status')
    clock.advance(6 * POLL_MS)
    await flush()
    expect(dataCalls(renault, '/battery-status')).toBe(before)
  })
})
