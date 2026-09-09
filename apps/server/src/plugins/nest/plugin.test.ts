import { ManualClock } from '@kasbah/mock-sim'
import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { DEVICES_RESPONSE, SDM_403, TOKEN_INVALID_GRANT, TOKEN_OK, TOKEN_REFRESHED } from './__fixtures__/sdm'
import { createNestPlugin, nestConfigSchema } from './index'

const json = (data: unknown, status = 200) =>
  ({ ok: status < 400, status, body: null, json: async () => data, text: async () => JSON.stringify(data) })

/** Faux Google : échange / rafraîchit les jetons, sert la liste des appareils, journalise tout. */
function fakeGoogle(opts: { devices?: unknown; devicesStatus?: number; refreshStatus?: number } = {}) {
  const calls: { url: string; init?: RequestInit & { dispatcher?: unknown } }[] = []
  const tokenBodies: URLSearchParams[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) })
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(init?.body))
      tokenBodies.push(body)
      if (body.get('grant_type') === 'authorization_code') return json(TOKEN_OK)
      if (opts.refreshStatus) return json(TOKEN_INVALID_GRANT, opts.refreshStatus)
      return json(TOKEN_REFRESHED)
    }
    if (url.endsWith('/devices')) return json(opts.devices ?? DEVICES_RESPONSE, opts.devicesStatus ?? 200)
    return json({ error: { message: 'not found' } }, 404)
  })
  return { fetchImpl, calls, tokenBodies }
}

function fakeContext(config: Record<string, unknown>, clock: ManualClock) {
  const ctrl = new AbortController()
  const ctx: PluginContext = {
    pluginId: 'nest', config, logger: pino({ level: 'silent' }), clock, signal: ctrl.signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(),
  }
  return { ctx, ctrl }
}

const CREDENTIALS = { NEST_PROJECT_ID: 'proj-1', NEST_CLIENT_ID: 'cid.apps.googleusercontent.com', NEST_CLIENT_SECRET: 'secret' }
const config = (extra: Record<string, string> = {}) => nestConfigSchema.parse({ ...CREDENTIALS, ...extra })

async function routes(plugin: ReturnType<typeof createNestPlugin>) {
  const app = Fastify()
  app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/nest' })
  await app.ready()
  return app
}

describe('nest plugin', () => {
  it('without Google credentials: error health, no devices, auth url refused', async () => {
    const { ctx } = fakeContext(nestConfigSchema.parse({}), new ManualClock(0))
    const plugin = createNestPlugin({ fetchImpl: fakeGoogle().fetchImpl })
    await plugin.init(ctx)
    expect(await plugin.discover()).toEqual([])
    expect(plugin.health!()).toMatchObject({ status: 'error', detail: expect.stringContaining('NEST_PROJECT_ID') })
    const app = await routes(plugin)
    expect((await app.inject({ method: 'GET', url: '/api/plugins/nest/auth/url' })).statusCode).toBe(409)
    await plugin.stop()
  })

  it('an empty key in .env counts as absent (a blank NEST_REFRESH_TOKEN= must not disable the plugin)', () => {
    const parsed = nestConfigSchema.parse({ ...CREDENTIALS, NEST_REFRESH_TOKEN: '', NEST_CLIENT_SECRET: ' secret ' })
    expect(parsed.NEST_REFRESH_TOKEN).toBeUndefined()
    expect(parsed.NEST_CLIENT_SECRET).toBe('secret')
  })

  it('links the account: auth url with state, callback exchanges the code and publishes cameras', async () => {
    const google = fakeGoogle()
    const { ctx } = fakeContext(config(), new ManualClock(0))
    const plugin = createNestPlugin({ fetchImpl: google.fetchImpl, randomState: () => 'state-1' })
    await plugin.init(ctx)
    expect(await plugin.discover()).toEqual([])
    await plugin.start()
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing' })
    expect(google.calls).toEqual([])                     // rien n'est appelé tant que le compte n'est pas lié

    const app = await routes(plugin)
    const r1 = await app.inject({ method: 'GET', url: '/api/plugins/nest/auth/url' })
    expect(r1.statusCode).toBe(200)
    const url = new URL((r1.json() as { url: string }).url)
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.pathname).toBe('/partnerconnections/proj-1/auth')

    // un retour avec un state qu'on n'a pas émis est refusé
    const bad = await app.inject({ method: 'GET', url: '/api/plugins/nest/auth/callback?code=abc&state=forged' })
    expect(bad.statusCode).toBe(400)
    expect(google.calls).toEqual([])

    const ok = await app.inject({ method: 'GET', url: '/api/plugins/nest/auth/callback?code=abc&state=state-1' })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['content-type']).toContain('text/html')
    expect(ok.body).toContain('NEST_REFRESH_TOKEN=1//refresh-token')
    expect(google.tokenBodies[0]!.get('grant_type')).toBe('authorization_code')
    expect(google.tokenBodies[0]!.get('code')).toBe('abc')
    expect(google.tokenBodies[0]!.get('redirect_uri')).toBe('http://localhost:8787/api/plugins/nest/auth/callback')
    // la liste est lue avec le jeton d'accès reçu, sans second appel au jeton
    const list = google.calls.find((c) => c.url.endsWith('/devices'))!
    expect(list.url).toBe('https://smartdevicemanagement.googleapis.com/v1/enterprises/proj-1/devices')
    expect((list.init!.headers as Record<string, string>).authorization).toBe('Bearer ya29.access')
    expect(google.tokenBodies).toHaveLength(1)

    const published = (ctx.emitDevices as unknown as { mock: { calls: [unknown[]][] } }).mock.calls.at(-1)![0]
    expect((published as { id: string }[]).map((d) => d.id)).toEqual(['nest:DEVICE8', 'nest:DEVICE2', 'nest:DEVICE5', 'nest:SYNTHETIC1'])
    expect(ctx.emitState).toHaveBeenCalledWith('DEVICE2', {})
    expect(plugin.health!()).toMatchObject({ status: 'ok', detail: '4 camera(s), 1 other device(s) ignored' })

    // le state est à usage unique
    expect((await app.inject({ method: 'GET', url: '/api/plugins/nest/auth/callback?code=abc&state=state-1' })).statusCode).toBe(400)
    // la réponse brute est relevable pour écrire une fixture réelle
    const raw = await app.inject({ method: 'GET', url: '/api/plugins/nest/devices/raw' })
    expect(raw.json()).toEqual(DEVICES_RESPONSE)
    await plugin.stop()
  })

  it('already linked via .env: refreshes the access token, discovers cameras, marks them available', async () => {
    const google = fakeGoogle()
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(config({ NEST_REFRESH_TOKEN: '1//saved' }), clock)
    const plugin = createNestPlugin({ fetchImpl: google.fetchImpl })
    await plugin.init(ctx)
    const descriptors = await plugin.discover()
    expect(descriptors.map((d) => d.name)).toEqual(['Caméra Garage', "Porte d'entrée", 'Caméra Salon', 'Caméra Cuisine'])
    expect(google.tokenBodies[0]!.get('grant_type')).toBe('refresh_token')
    expect(google.tokenBodies[0]!.get('refresh_token')).toBe('1//saved')
    await plugin.start()
    expect(ctx.emitState).toHaveBeenCalledTimes(4)
    expect(ctx.emitState).toHaveBeenCalledWith('DEVICE8', {})
    expect(plugin.health!().status).toBe('ok')
    await expect(plugin.execute('DEVICE8', { type: 'light.set', on: true })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })

    // un second relevé avant l'heure réutilise le jeton d'accès ; après, il en redemande un
    const app = await routes(plugin)
    expect((await app.inject({ method: 'GET', url: '/api/plugins/nest/devices/raw' })).statusCode).toBe(200)
    expect(google.tokenBodies).toHaveLength(1)
    await plugin.stop()
  })

  it('a revoked refresh token asks for a new link; a 403 from SDM surfaces Google’s message', async () => {
    const revoked = fakeGoogle({ refreshStatus: 400 })
    const { ctx } = fakeContext(config({ NEST_REFRESH_TOKEN: '1//old' }), new ManualClock(0))
    const plugin = createNestPlugin({ fetchImpl: revoked.fetchImpl })
    await plugin.init(ctx)
    await expect(plugin.discover()).rejects.toMatchObject({ code: 'NEEDS_PAIRING' })
    expect(plugin.health!()).toMatchObject({ status: 'error', detail: expect.stringContaining('link the account again') })

    const forbidden = fakeGoogle({ devices: SDM_403, devicesStatus: 403 })
    const second = createNestPlugin({ fetchImpl: forbidden.fetchImpl })
    await second.init(fakeContext(config({ NEST_REFRESH_TOKEN: '1//saved' }), new ManualClock(0)).ctx)
    await expect(second.discover()).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: expect.stringContaining('has not been used in project') })
  })
})
