import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import {
  ASLEEP_408, PARTNER_TOKEN, TOKEN_REFRESHED, TOKEN_RESPONSE, VEHICLES_ASLEEP, VEHICLES_ONLINE, VEHICLE_DATA_CHARGING,
  VEHICLE_DATA_DRIVING, VEHICLE_DATA_PARKED,
} from './__fixtures__/fleet'
import { REGION_BASE_URLS, TOKEN_URL, generateKeyPair, publicKeyOf, publicKeyPointHex, samePublicKey, type KeyStore, type StoredTokens, type TokenStore } from './auth'
import { createTeslaPlugin, teslaConfigSchema } from './index'
import type { TeslaState, TeslaStateStore } from './state'

// Ce que le plugin doit tenir face au fabricant : ne JAMAIS lire un véhicule endormi, le laisser
// s'endormir une fois vu au repos, ne pas dépasser le budget de lectures du jour, et survivre à la
// rotation du refresh token (à usage unique chez Tesla). Aucun compte ni véhicule réel n'est touché.

const NOW = Date.UTC(2026, 8, 13, 10)
const MIN = 60_000
const VIN = '5YJSA7E20HF000001'
const BASE = REGION_BASE_URLS.eu
const ENV = { TESLA_CLIENT_ID: 'app-id', TESLA_CLIENT_SECRET: 'app-secret', TESLA_DOMAIN: 'nas.exemple.fr', TESLA_POLL_MS: String(10 * MIN), TESLA_REST_MS: String(15 * MIN) }

const response = (body: unknown, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

/** Faux Tesla : serveur d'authentification et API, pilotés par un état mutable. */
function fakeTesla(over: { registeredKey?: string; servedKey?: string; publicKeyForbidden?: boolean } = {}) {
  const world = {
    list: VEHICLES_ASLEEP as unknown,
    data: VEHICLE_DATA_PARKED as unknown,
    /** `vehicle_data` répond 408 tant que vrai. */
    asleep: false,
    /** Le jeton d'accès que l'API accepte ; un autre → 401. */
    accepts: TOKEN_RESPONSE.access_token,
    /** Ce que Tesla a DÉJÀ enregistré pour le domaine ; `servedKey` est ce qu'il lirait en s'enregistrant. */
    registeredKey: over.registeredKey,
    servedKey: over.servedKey,
    /** L'API du compte répond 412 tant que vrai (application pas enregistrée pour ce compte). */
    unregistered: false,
    /** Ce qu'une commande accuse. Tesla REFUSE en HTTP 200 : `result: false` et une raison. */
    commandResult: { result: true } as { result: boolean; reason?: string },
  }
  const calls: { method: string; path: string; body?: string; auth?: string }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = init?.body === undefined ? undefined : String(init.body)
    if (url === TOKEN_URL) {
      const params = new URLSearchParams(body)
      calls.push({ method, path: `token:${params.get('grant_type')}`, body })
      if (params.get('grant_type') === 'client_credentials') return response(PARTNER_TOKEN)
      if (params.get('grant_type') === 'authorization_code') return response(TOKEN_RESPONSE)
      // rotation : seul le refresh token courant est accepté, et il en rend un autre
      if (params.get('refresh_token') === TOKEN_RESPONSE.refresh_token) { world.accepts = TOKEN_REFRESHED.access_token; return response(TOKEN_REFRESHED) }
      return response({ error: 'invalid_grant' }, 400)
    }
    const path = url.replace(BASE, '')
    calls.push({ method, path, body, auth: headers.authorization })
    if (path.startsWith('/api/1/partner_accounts')) {
      if (headers.authorization !== `Bearer ${PARTNER_TOKEN.access_token}`) return response({ error: 'unauthorized' }, 401)
      if (method === 'POST') {
        // constaté sur le vrai compte : un domaine déjà enregistré ne se réenregistre pas
        if (world.registeredKey) return response({ error: 'Validation failed: Public key hash has already been taken' }, 422)
        world.registeredKey = world.servedKey
        return response({ response: { domain: 'nas.exemple.fr' } })
      }
      // constaté sur le vrai compte : la vérification peut être refusée alors que l'API répond
      if (over.publicKeyForbidden) return response({ error: 'This account does not have access to nas.exemple.fr' }, 403)
      // Tesla rend le POINT hexadécimal, pas le PEM (constaté sur le vrai compte)
      return response({ response: { public_key: world.registeredKey ? publicKeyPointHex(world.registeredKey) : null } })
    }
    if (headers.authorization !== `Bearer ${world.accepts}`) return response({ error: 'unauthorized' }, 401)
    if (path === '/api/1/vehicles') {
      // constaté : application non enregistrée dans la région → 412, pas une liste vide
      if (world.unregistered) return response({ error: `Account 592035a8 must be registered in the current region ${BASE}` }, 412)
      return response(world.list)
    }
    if (path.includes('/vehicle_data')) return world.asleep ? response(ASLEEP_408, 408) : response(world.data)
    if (path.endsWith('/wake_up')) return response({ response: { ...(VEHICLES_ONLINE.response[0] as object), state: 'online' } })
    // une commande sur un véhicule endormi répond 408, comme une lecture
    if (path.includes('/command/')) return world.asleep ? response(ASLEEP_408, 408) : response({ response: world.commandResult })
    return response({ error: 'not found' }, 404)
  })
  return { fetchImpl, calls, world }
}

function memoryTokens(initial: StoredTokens | null = null): TokenStore & { value: StoredTokens | null } {
  const s = { value: initial, load: async () => s.value, save: async (t: StoredTokens) => { s.value = t } }
  return s
}
function memoryState(initial: TeslaState | null = null): TeslaStateStore & { value: TeslaState | null } {
  const s = { value: initial, load: async () => s.value, save: async (v: TeslaState) => { s.value = JSON.parse(JSON.stringify(v)) as TeslaState } }
  return s
}
function memoryKey(pem: string | null = null): KeyStore & { value: string | null } {
  const s = { value: pem, load: async () => s.value, save: async (p: string) => { s.value = p } }
  return s
}
const linkedTokens = (): StoredTokens => ({ refreshToken: TOKEN_RESPONSE.refresh_token, accessToken: TOKEN_RESPONSE.access_token, accessExpiresAt: NOW + 8 * 3600_000 })

async function started(over: { env?: Record<string, string>; tesla?: ReturnType<typeof fakeTesla>; tokens?: StoredTokens | null; key?: string | null; state?: ReturnType<typeof memoryState> } = {}) {
  const tesla = over.tesla ?? fakeTesla()
  const tokenStore = memoryTokens(over.tokens ?? null)
  const keyStore = memoryKey(over.key ?? null)
  const stateStore = over.state ?? memoryState()
  const plugin = createTeslaPlugin({ fetchImpl: tesla.fetchImpl, tokenStore, keyStore, stateStore })
  const clock = new ManualClock(NOW)
  const ctx: PluginContext = {
    pluginId: 'tesla',
    config: teslaConfigSchema.parse({ ...ENV, ...over.env }),
    logger: pino({ level: 'silent' }), clock, signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  await plugin.init(ctx)
  const app = Fastify()
  app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/tesla' })
  await app.ready()
  return { plugin, app, tesla, tokenStore, keyStore, stateStore, ctx, clock }
}

/** Laisse les promesses en vol se résoudre (le sondage tourne sur l'horloge injectée). */
const settle = () => new Promise((r) => setTimeout(r, 0))
/**
 * Avance de `n` tours de sondage. Un tour par avance : le poller ne repose son timer qu'après
 * avoir fini son travail (asynchrone), donc une seule grande avance ne déclencherait qu'un tour.
 */
async function ticks(clock: ManualClock, n: number, ms = 10 * MIN) {
  for (let i = 0; i < n; i++) { clock.advance(ms); await settle() }
}
const dataCalls = (t: ReturnType<typeof fakeTesla>) => t.calls.filter((c) => c.path.includes('/vehicle_data')).length
const listCalls = (t: ReturnType<typeof fakeTesla>) => t.calls.filter((c) => c.path === '/api/1/vehicles').length
const patches = (ctx: PluginContext) => (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as Record<string, unknown>)

describe('mise en route', () => {
  it('sans identifiants d’application : needs_pairing, mais la paire de clés existe déjà et la clé publique se sert', async () => {
    const { plugin, app, keyStore } = await started({ env: { TESLA_CLIENT_ID: '', TESLA_CLIENT_SECRET: '' } })
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing' })
    expect(keyStore.value).toMatch(/BEGIN PRIVATE KEY/)
    const status = await app.inject({ method: 'GET', url: '/api/plugins/tesla/status' }).then((r) => r.json())
    expect(status).toMatchObject({ configured: false, linked: false, publicKeyUrl: 'https://nas.exemple.fr/.well-known/appspecific/com.tesla.3p.public-key.pem' })
    expect(status.publicKeyPem).toMatch(/BEGIN PUBLIC KEY/)
    expect(status.publicKeyPem).toBe(publicKeyOf(keyStore.value!))
    const pem = await app.inject({ method: 'GET', url: '/api/plugins/tesla/public-key' })
    expect(pem.headers['content-type']).toContain('application/x-pem-file')
    expect(pem.body).toBe(status.publicKeyPem)
  })

  it('une clé privée déjà en cache est reprise : la clé publique posée sur le domaine reste la bonne', async () => {
    const pair = generateKeyPair()
    const { keyStore, app } = await started({ key: pair.privatePem })
    expect(keyStore.value).toBe(pair.privatePem)
    expect((await app.inject({ method: 'GET', url: '/api/plugins/tesla/status' }).then((r) => r.json())).publicKeyPem).toBe(pair.publicPem)
  })

  it('l’enregistrement du domaine passe par un jeton partenaire, puis vérifie ce que Tesla a lu de la clé', async () => {
    const pair = generateKeyPair()
    const tesla = fakeTesla({ servedKey: pair.publicPem })
    const { app, tesla: t } = await started({ tesla, key: pair.privatePem })
    const r = await app.inject({ method: 'POST', url: '/api/plugins/tesla/register' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ registered: true, lastError: null })
    const check = '/api/1/partner_accounts/public_key?domain=nas.exemple.fr'
    // vérifié AVANT (rien d'enregistré), enregistré, vérifié APRÈS
    expect(t.calls.map((c) => c.path)).toEqual(['token:client_credentials', check, '/api/1/partner_accounts', check])
    expect(JSON.parse(t.calls[2]!.body!)).toEqual({ domain: 'nas.exemple.fr' })
  })

  it('un domaine déjà enregistré n’est pas réenregistré ; et si Tesla refuse quand même (422), ce n’est pas une erreur', async () => {
    const pair = generateKeyPair()
    const done = await started({ tesla: fakeTesla({ registeredKey: pair.publicPem }), key: pair.privatePem })
    expect((await done.app.inject({ method: 'POST', url: '/api/plugins/tesla/register' })).json()).toMatchObject({ registered: true })
    expect(done.tesla.calls.map((c) => c.path)).toEqual(['token:client_credentials', '/api/1/partner_accounts/public_key?domain=nas.exemple.fr'])
    // Tesla connaît une AUTRE clé : on tente l'enregistrement, il répond 422, on revérifie et on le dit
    const other = await started({ tesla: fakeTesla({ registeredKey: generateKeyPair().publicPem, servedKey: pair.publicPem }), key: pair.privatePem })
    const r = await other.app.inject({ method: 'POST', url: '/api/plugins/tesla/register' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ registered: false })
    expect(other.tesla.calls.filter((c) => c.method === 'POST' && c.path === '/api/1/partner_accounts')).toHaveLength(1)
  })

  it('clé prise par une AUTRE application : le 412 qui suit dit « pas enregistré », et la rotation donne une clé neuve', async () => {
    const pair = generateKeyPair()
    const tesla = fakeTesla({ registeredKey: pair.publicPem, publicKeyForbidden: true })
    tesla.world.unregistered = true
    const { app, keyStore } = await started({ tesla, key: pair.privatePem, tokens: linkedTokens() })
    const r = await app.inject({ method: 'POST', url: '/api/plugins/tesla/register' }).then((x) => x.json())
    expect(r.registered).toBe(false)
    expect(r.lastError).toMatch(/registered by another application/)
    const rotated = await app.inject({ method: 'POST', url: '/api/plugins/tesla/public-key/rotate' }).then((x) => x.json())
    expect(rotated.publicKeyPem).toMatch(/BEGIN PUBLIC KEY/)
    expect(rotated.publicKeyPem).not.toBe(pair.publicPem)
    expect(rotated.registered).toBeUndefined()
    expect(publicKeyOf(keyStore.value!)).toBe(rotated.publicKeyPem)     // la clé privée neuve est gardée
  })

  it('vérification refusée (403) mais clé déjà connue de Tesla (422) : on le croit, enregistré', async () => {
    const pair = generateKeyPair()
    const { app, plugin } = await started({ tesla: fakeTesla({ registeredKey: pair.publicPem, publicKeyForbidden: true }), key: pair.privatePem, tokens: linkedTokens() })
    const r = await app.inject({ method: 'POST', url: '/api/plugins/tesla/register' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ registered: true, lastError: null })
    expect(plugin.health!()).toMatchObject({ status: 'ok' })
  })

  it('une clé lue par Tesla qui n’est pas la nôtre : enregistré mais pas reconnu, le plugin le dit', async () => {
    const other = generateKeyPair()
    const { app, plugin } = await started({ tesla: fakeTesla({ registeredKey: other.publicPem }), tokens: linkedTokens() })
    const r = await app.inject({ method: 'POST', url: '/api/plugins/tesla/register' })
    expect(r.json()).toMatchObject({ registered: false })
    expect(r.json().lastError).toMatch(/did not read our public key/)
    expect(plugin.health!()).toMatchObject({ status: 'degraded' })
  })
})

describe('forme de la clé chez Tesla', () => {
  it('le point EC hexadécimal (04 ‖ X ‖ Y) et le PEM désignent la même clé', () => {
    const pair = generateKeyPair()
    const hex = publicKeyPointHex(pair.publicPem)
    expect(hex).toMatch(/^04[0-9a-f]{128}$/)
    expect(samePublicKey(hex, pair.publicPem)).toBe(true)
    expect(samePublicKey(hex.toUpperCase(), pair.publicPem)).toBe(true)
    expect(samePublicKey(pair.publicPem, pair.publicPem)).toBe(true)
    expect(samePublicKey(publicKeyPointHex(generateKeyPair().publicPem), pair.publicPem)).toBe(false)
  })
})

describe('liaison du compte', () => {
  it('sans compte : needs_pairing, aucun appel à l’API, /auth/url porte le client et la redirection', async () => {
    const { plugin, app, tesla } = await started()
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing' })
    expect(await plugin.discover()).toEqual([])
    await plugin.start()
    await settle()
    expect(tesla.calls).toEqual([])
    const { url, redirectUri } = await app.inject({ method: 'GET', url: '/api/plugins/tesla/auth/url' }).then((r) => r.json())
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://auth.tesla.com/oauth2/v3/authorize')
    expect(u.searchParams.get('client_id')).toBe('app-id')
    expect(u.searchParams.get('redirect_uri')).toBe(redirectUri)
    expect(u.searchParams.get('scope')).toContain('offline_access')
    expect(u.searchParams.get('scope')).toContain('vehicle_location')
  })

  it('le retour n’est accepté qu’avec le `state` qu’on a émis ; le code devient des jetons GARDÉS, et le sondage part', async () => {
    const { plugin, app, tesla, tokenStore, ctx } = await started()
    expect((await app.inject({ method: 'GET', url: '/api/plugins/tesla/auth/callback?code=abc&state=forged' })).statusCode).toBe(400)
    const { url } = await app.inject({ method: 'GET', url: '/api/plugins/tesla/auth/url' }).then((r) => r.json())
    const state = new URL(url).searchParams.get('state')!
    const r = await app.inject({ method: 'GET', url: `/api/plugins/tesla/auth/callback?code=abc&state=${state}` })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('text/html')
    expect(r.body).toContain('Kasbah S')
    // l'échange porte le code, la redirection et l'`audience` de la région
    const exchange = new URLSearchParams(tesla.calls[0]!.body)
    expect(exchange.get('grant_type')).toBe('authorization_code')
    expect(exchange.get('code')).toBe('abc')
    expect(exchange.get('audience')).toBe(BASE)
    expect(tokenStore.value).toMatchObject({ refreshToken: TOKEN_RESPONSE.refresh_token, accessToken: TOKEN_RESPONSE.access_token })
    expect(ctx.emitDevices).toHaveBeenCalledWith([expect.objectContaining({ id: `tesla:${VIN}` })])
    await settle()
    expect(plugin.health!()).toMatchObject({ status: 'ok', deviceCount: 1 })
    // le sondage a démarré : la liste a été relue par le poller, et le véhicule dort → pas de vehicle_data
    expect(listCalls(tesla)).toBeGreaterThanOrEqual(2)
    expect(dataCalls(tesla)).toBe(0)
  })

  it('le refresh token est à usage unique : rafraîchir le remplace dans le cache, et un 401 déclenche un rafraîchissement puis rejoue', async () => {
    const tesla = fakeTesla()
    tesla.world.accepts = TOKEN_REFRESHED.access_token          // l'access token du cache n'est plus accepté
    const { plugin, tesla: t, tokenStore } = await started({ tesla, tokens: linkedTokens() })
    const devices = await plugin.discover()
    expect(devices).toHaveLength(1)
    expect(t.calls.map((c) => c.path)).toEqual(['/api/1/vehicles', 'token:refresh_token', '/api/1/vehicles'])
    expect(tokenStore.value?.refreshToken).toBe(TOKEN_REFRESHED.refresh_token)
    expect(tokenStore.value?.accessToken).toBe(TOKEN_REFRESHED.access_token)
  })

  it('un access token proche de l’échéance est rafraîchi d’avance, sans attendre le 401', async () => {
    const { plugin, tesla } = await started({ tokens: { ...linkedTokens(), accessExpiresAt: NOW + MIN } })
    await plugin.discover()
    expect(tesla.calls.map((c) => c.path)).toEqual(['token:refresh_token', '/api/1/vehicles'])
  })

  it('un refresh token refusé (brûlé, compte révoqué) ramène en needs_pairing au lieu d’un incident réseau', async () => {
    const { plugin, tesla } = await started({ tokens: { ...linkedTokens(), refreshToken: 'burnt', accessExpiresAt: NOW } })
    await plugin.discover()
    expect(tesla.calls.map((c) => c.path)).toEqual(['token:refresh_token'])
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing' })
  })
})

describe('sondage respectueux de la veille', () => {
  it('véhicule endormi : la liste seule, JAMAIS vehicle_data, et l’état dit `asleep`', async () => {
    const { plugin, tesla, ctx, clock } = await started({ tokens: linkedTokens() })
    await plugin.discover()
    await plugin.start()
    await settle()
    await ticks(clock, 3)
    expect(listCalls(tesla)).toBe(1 + 4)                          // discover + 4 tours (t0, +10, +20, +30)
    expect(dataCalls(tesla)).toBe(0)
    expect(patches(ctx)).toContainEqual({ sleepState: 'asleep' })
    expect(ctx.setAvailable).not.toHaveBeenCalled()               // dormir n'est pas être indisponible
  })

  it('éveillé et au repos : UNE lecture, puis on le laisse s’endormir pendant TESLA_REST_MS', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const { plugin, ctx, clock } = await started({ tesla, tokens: linkedTokens() })
    await plugin.start()
    await settle()
    expect(dataCalls(tesla)).toBe(1)
    expect(patches(ctx).at(-1)).toMatchObject({ soc: 54, gear: 'P', speedKmh: 0, sleepState: 'online', tirePressureBar: { fl: 3.18 } })
    // +10 min : toujours éveillé d'après la liste, mais au repos depuis 10 min < 15 → pas de relecture
    clock.advance(10 * MIN)
    await settle()
    expect(listCalls(tesla)).toBe(2)
    expect(dataCalls(tesla)).toBe(1)
    // +20 min : le repos est écoulé, on relit
    clock.advance(10 * MIN)
    await settle()
    expect(dataCalls(tesla)).toBe(2)
  })

  it('en train de rouler ou de charger : relu à chaque tour, ce n’est pas le moment de dormir', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.data = VEHICLE_DATA_DRIVING
    const { plugin, clock, ctx } = await started({ tesla, tokens: linkedTokens() })
    await plugin.start()
    await settle()
    clock.advance(10 * MIN)
    await settle()
    expect(dataCalls(tesla)).toBe(2)
    expect(patches(ctx).at(-1)).toMatchObject({ gear: 'D', pluggedIn: false, locked: false })
    tesla.world.data = VEHICLE_DATA_CHARGING
    clock.advance(10 * MIN)
    await settle()
    expect(dataCalls(tesla)).toBe(3)
    expect(patches(ctx).at(-1)).toMatchObject({ charging: true, chargePowerW: 7000 })
  })

  it('endormi entre la liste et la lecture (408) : l’état passe à `asleep`, sans erreur ni backoff', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.asleep = true
    const { plugin, ctx, clock } = await started({ tesla, tokens: linkedTokens() })
    await plugin.start()
    await settle()
    expect(dataCalls(tesla)).toBe(1)
    expect(patches(ctx).at(-1)).toEqual({ sleepState: 'asleep' })
    expect(plugin.health!()).toMatchObject({ status: 'ok' })
    // le tour suivant arrive à l'heure prévue (pas de backoff d'erreur) et retente puisque la liste le dit éveillé
    clock.advance(10 * MIN)
    await settle()
    expect(dataCalls(tesla)).toBe(2)
  })

  it('le budget du jour borne les lectures complètes, jamais la liste ; il repart le lendemain', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.data = VEHICLE_DATA_DRIVING
    const { plugin, clock, app } = await started({ tesla, tokens: linkedTokens(), env: { TESLA_DAILY_DATA_BUDGET: '2' } })
    await plugin.start()
    await settle()
    await ticks(clock, 4)
    expect(listCalls(tesla)).toBe(5)
    expect(dataCalls(tesla)).toBe(2)
    expect((await app.inject({ method: 'GET', url: '/api/plugins/tesla/status' }).then((r) => r.json())).budget).toEqual({ used: 2, limit: 2 })
    expect(plugin.health!().detail).toContain('2/2')
    // la jauge de l'UI montre le CRÉDIT MENSUEL du fabricant, pas ce budget journalier : une estimation
    // en dollars. Les LISTES n'y entrent pas — le fabricant ne les facture pas (constaté sur sa console)
    const q = plugin.health!().quota!
    expect(q).toMatchObject({ limit: 10, labelKey: 'vehicle.quotaCredit', unit: 'usd' })
    expect(listCalls(tesla)).toBeGreaterThan(dataCalls(tesla))
    expect(q.used).toBeCloseTo(dataCalls(tesla) * (1 / 500), 5)
    // le cycle commence le 1er du mois (la console du fabricant le dit), pas le jour de la liaison
    expect(q.since).toBe(Date.UTC(new Date(NOW).getUTCFullYear(), new Date(NOW).getUTCMonth(), 1))
    // le lendemain : un seul tour suffit à voir le budget repartir
    await ticks(clock, 1, 24 * 60 * MIN)
    expect(dataCalls(tesla)).toBe(3)
  })

  it('un véhicule qui apparaît ou disparaît de la liste republie les descripteurs', async () => {
    const tesla = fakeTesla()
    const { plugin, ctx, clock } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.start()
    await settle()
    expect(ctx.emitDevices).not.toHaveBeenCalled()
    tesla.world.list = { response: [], count: 0 }
    clock.advance(10 * MIN)
    await settle()
    expect(ctx.emitDevices).toHaveBeenCalledWith([])
    expect(plugin.health!()).toMatchObject({ deviceCount: 0 })
  })
})

describe('ce qui survit à un redémarrage', () => {
  it('le dernier état de chaque véhicule est gardé, et RÉÉMIS au démarrage suivant sans rien relire', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const state = memoryState()
    const first = await started({ tesla, tokens: linkedTokens(), state })
    await first.plugin.start()
    await settle()
    expect(state.value?.vehicles[VIN]).toMatchObject({ soc: 54, readAt: NOW })

    // second démarrage : la voiture s'est rendormie, aucune lecture n'est possible
    const asleep = fakeTesla()
    const second = await started({ tesla: asleep, tokens: linkedTokens(), state })
    await second.plugin.discover()
    await second.plugin.start()
    await settle()
    expect(dataCalls(asleep)).toBe(0)
    // la carte retrouve les valeurs de la veille au lieu de repartir vide
    expect(patches(second.ctx)).toContainEqual(expect.objectContaining({ soc: 54, readAt: NOW }))
  })

  it('la peinture survit au redémarrage : endormie, la voiture garde sa couleur sans relecture', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const state = memoryState()
    const first = await started({ tesla, tokens: linkedTokens(), state })
    await first.plugin.start()
    await settle()
    // paint_color_override de la fixture PARKED → #285ac8, aspect matte
    expect(state.value?.paints[VIN]).toMatchObject({ color: '#285ac8', finish: 'matte' })
    expect(first.ctx.emitDevices).toHaveBeenCalledWith([
      expect.objectContaining({ id: `tesla:${VIN}`, meta: expect.objectContaining({ vehicle: { color: '#285ac8', finish: 'matte' } }) }),
    ])

    const asleep = fakeTesla()
    const second = await started({ tesla: asleep, tokens: linkedTokens(), state })
    const devices = await second.plugin.discover()
    expect(dataCalls(asleep)).toBe(0)
    expect(devices[0]?.meta.vehicle).toEqual({ color: '#285ac8', finish: 'matte' })
  })

  it('la consommation du mois se poursuit après un redémarrage, et repart au mois suivant', async () => {
    const state = memoryState()
    const one = fakeTesla()
    one.world.list = VEHICLES_ONLINE
    const first = await started({ tesla: one, tokens: linkedTokens(), state })
    await first.plugin.start()
    await settle()
    expect(first.plugin.health!().quota!.used).toBeCloseTo(1 / 500, 5)      // une lecture complète
    // le tour suivant tombe avant la fin du repos : il ne fait que LISTER, et lister ne coûte rien
    await ticks(first.clock, 1)
    expect(listCalls(one)).toBeGreaterThan(1)
    expect(first.plugin.health!().quota!.used).toBeCloseTo(1 / 500, 5)

    // redémarrage : le compteur reprend où il en était (sondage non démarré, pour ne compter que
    // les appels demandés ici)
    const two = fakeTesla()
    two.world.list = VEHICLES_ONLINE
    const second = await started({ tesla: two, tokens: linkedTokens(), state })
    await second.plugin.discover()
    await second.plugin.execute(VIN, { type: 'vehicle.refresh' })
    expect(second.plugin.health!().quota!.used).toBeCloseTo(2 / 500, 5)

    // le mois suivant, le compteur repart de zéro (cycle calendaire, comme la facturation du fabricant)
    second.clock.advance(31 * 24 * 60 * MIN)
    await second.plugin.execute(VIN, { type: 'vehicle.refresh' })
    expect(second.plugin.health!().quota!.used).toBeCloseTo(1 / 500, 5)
  })

  it('le compteur se recale sur la console du fabricant, qui seule facture', async () => {
    const state = memoryState()
    const { app, plugin } = await started({ tesla: fakeTesla(), tokens: linkedTokens(), state })
    const r = await app.inject({ method: 'POST', url: '/api/plugins/tesla/usage', payload: { data: 6, wakes: 2, commands: 0 } })
    expect(r.statusCode).toBe(200)
    // 6 lectures a 0,2 c + 2 reveils a 2 c
    expect(r.json().estimatedUsd).toBeCloseTo(6 / 500 + 2 / 50, 5)
    expect(plugin.health!().quota!.used).toBeCloseTo(0.052, 5)
    expect(state.value?.cycle).toMatchObject({ data: 6, wakes: 2, commands: 0 })
    expect((await app.inject({ method: 'POST', url: '/api/plugins/tesla/usage', payload: { data: -1 } })).statusCode).toBe(400)
  })
})

describe('commandes', () => {
  it('rafraîchir relit maintenant, et le sondage REPART de cette lecture (pas du calendrier initial)', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.data = VEHICLE_DATA_DRIVING          // en route : pas de repos, chaque tour relit
    const { plugin, clock, ctx } = await started({ tesla, tokens: linkedTokens() })
    await plugin.start()
    await settle()
    expect(dataCalls(tesla)).toBe(1)
    expect(patches(ctx).at(-1)).toMatchObject({ readAt: NOW })
    // t+3 min : lecture manuelle
    clock.advance(3 * MIN); await settle()
    await plugin.execute(VIN, { type: 'vehicle.refresh' })
    expect(dataCalls(tesla)).toBe(2)
    expect(patches(ctx).at(-1)).toMatchObject({ readAt: NOW + 3 * MIN })
    // t+10 : le tour du calendrier initial ne tombe PAS ; t+13 : dix minutes après la lecture manuelle, si
    clock.advance(7 * MIN); await settle()
    expect(dataCalls(tesla)).toBe(2)
    clock.advance(3 * MIN); await settle()
    expect(dataCalls(tesla)).toBe(3)
  })

  it('rafraîchir un véhicule endormi ne le réveille pas : la veille seule est relue', async () => {
    const tesla = fakeTesla()
    const { plugin, ctx } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.refresh' })
    expect(dataCalls(tesla)).toBe(0)
    expect(tesla.calls.some((c) => c.path.endsWith('/wake_up'))).toBe(false)
    expect(patches(ctx).at(-1)).toEqual({ sleepState: 'asleep' })
  })

  it('rafraîchir quand le budget du jour est épuisé est refusé plutôt que dépensé', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const { plugin } = await started({ tesla, tokens: linkedTokens(), env: { TESLA_DAILY_DATA_BUDGET: '1' } })
    await plugin.start()
    await settle()
    await expect(plugin.execute(VIN, { type: 'vehicle.refresh' })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(dataCalls(tesla)).toBe(1)
  })

  it('régler la limite de charge : une commande, la cible publiée sans relecture facturée', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const { plugin, ctx, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.set_charge_limit', percent: 70 })
    expect(t.calls.at(-1)).toMatchObject({ method: 'POST', path: `/api/1/vehicles/${VIN}/command/set_charge_limit`, body: '{"percent":70}' })
    expect(dataCalls(t)).toBe(0)                     // la cible vient de NOUS : pas de lecture derrière
    expect(patches(ctx).at(-1)).toMatchObject({ chargeLimit: 70 })
    // une commande coûte dix fois moins qu'une lecture, mais elle COMPTE
    expect(plugin.health!().quota!.used).toBeCloseTo(1 / 1000, 5)
  })

  it('un REFUS de Tesla arrive en HTTP 200 : la cible n’est alors pas publiée', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.commandResult = { result: false, reason: 'charge_limit_not_supported' }
    const { plugin, ctx } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await expect(plugin.execute(VIN, { type: 'vehicle.set_charge_limit', percent: 70 }))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: expect.stringContaining('charge_limit_not_supported') })
    expect(patches(ctx).some((p) => 'chargeLimit' in p)).toBe(false)
  })

  it('régler la limite d’un véhicule ENDORMI est refusé : c’est au réveil, payant, de le ramener', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.asleep = true
    const { plugin, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await expect(plugin.execute(VIN, { type: 'vehicle.set_charge_limit', percent: 70 }))
      .rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    expect(t.calls.some((c) => c.path.endsWith('/wake_up'))).toBe(false)
  })

  it('le réveil est le seul geste : POST wake_up, puis une relecture différée ; le reste est refusé', async () => {
    const tesla = fakeTesla()
    const { plugin, clock, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await expect(plugin.execute(VIN, { type: 'vehicle.lock' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(plugin.execute('unknown', { type: 'vehicle.wake' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    await plugin.execute(VIN, { type: 'vehicle.wake' })
    expect(t.calls.at(-1)).toMatchObject({ method: 'POST', path: `/api/1/vehicles/${VIN}/wake_up` })
    expect(dataCalls(t)).toBe(0)
    tesla.world.list = VEHICLES_ONLINE
    clock.advance(15_000)
    await settle()
    expect(dataCalls(t)).toBe(1)
  })
})

describe('relevé brut', () => {
  it('liste puis vehicle_data des seuls véhicules éveillés, sans réveiller les autres', async () => {
    const { app, tesla } = await started({ tokens: linkedTokens() })
    const asleep = await app.inject({ method: 'GET', url: '/api/plugins/tesla/raw' }).then((r) => r.json())
    // la région d'abord : c'est ce qui explique une liste vide
    expect(Object.keys(asleep)).toEqual(['/api/1/users/region', '/api/1/vehicles'])
    expect(dataCalls(tesla)).toBe(0)
    tesla.world.list = VEHICLES_ONLINE
    const awake = await app.inject({ method: 'GET', url: '/api/plugins/tesla/raw' }).then((r) => r.json())
    expect(Object.keys(awake)).toHaveLength(3)
    expect(dataCalls(tesla)).toBe(1)
  })
})
