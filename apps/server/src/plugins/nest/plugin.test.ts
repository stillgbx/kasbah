import { ManualClock } from '@kasbah/mock-sim'
import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { DEVICES_RESPONSE, SDM_403, THERMOSTAT, TOKEN_INVALID_GRANT, TOKEN_OK, TOKEN_REFRESHED } from './__fixtures__/sdm'
import { createNestPlugin, nestConfigSchema } from './index'

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) }
const json = (data: unknown, status = 200) =>
  ({ ok: status < 400, status, body: null, json: async () => data, text: async () => JSON.stringify(data) })

type Traits = Record<string, Record<string, unknown>>

/**
 * Faux Google : échange / rafraîchit les jetons, sert la liste des appareils, exécute les commandes
 * du thermostat en mutant sa copie (comme le vrai : la relecture qui suit reflète la commande).
 */
function fakeGoogle(opts: { devices?: unknown; devicesStatus?: number; refreshStatus?: number; commandStatus?: number } = {}) {
  const calls: { url: string; init?: RequestInit & { dispatcher?: unknown } }[] = []
  const tokenBodies: URLSearchParams[] = []
  const commands: { id: string; command: string; params: Record<string, unknown> }[] = []
  const thermostat = structuredClone(THERMOSTAT) as unknown as { name: string; traits: Traits }
  const devices = () => {
    const base = (opts.devices ?? DEVICES_RESPONSE) as { devices?: { name: string }[] }
    if (!Array.isArray(base.devices)) return base as { devices: { name: string }[] }   // corps d'erreur servi tel quel
    return { ...base, devices: base.devices.map((d) => (d.name === THERMOSTAT.name ? thermostat : d)) }
  }
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) })
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(init?.body))
      tokenBodies.push(body)
      if (body.get('grant_type') === 'authorization_code') return json(TOKEN_OK)
      if (opts.refreshStatus) return json(TOKEN_INVALID_GRANT, opts.refreshStatus)
      return json(TOKEN_REFRESHED)
    }
    const m = /\/devices\/([^/:]+)(:executeCommand)?$/.exec(url)
    if (m?.[2]) {
      const body = JSON.parse(String(init?.body)) as { command: string; params: Record<string, unknown> }
      commands.push({ id: m[1]!, ...body })
      if (opts.commandStatus) return json({ error: { code: opts.commandStatus, message: 'Command not allowed in current state.', status: 'FAILED_PRECONDITION' } }, opts.commandStatus)
      const t = thermostat.traits
      if (body.command.endsWith('ThermostatTemperatureSetpoint.SetHeat')) t['sdm.devices.traits.ThermostatTemperatureSetpoint'] = { heatCelsius: body.params.heatCelsius }
      if (body.command.endsWith('ThermostatMode.SetMode')) t['sdm.devices.traits.ThermostatMode'] = { ...t['sdm.devices.traits.ThermostatMode'], mode: body.params.mode }
      if (body.command.endsWith('ThermostatEco.SetMode')) t['sdm.devices.traits.ThermostatEco'] = { ...t['sdm.devices.traits.ThermostatEco'], mode: body.params.mode }
      return json({})
    }
    if (m) {
      const found = devices().devices.find((d) => d.name.endsWith(`/${m[1]}`))
      return found ? json(found) : json({ error: { code: 404, message: 'not found', status: 'NOT_FOUND' } }, 404)
    }
    if (url.endsWith('/devices')) return json(devices(), opts.devicesStatus ?? 200)
    return json({ error: { message: 'not found' } }, 404)
  })
  const listCalls = () => calls.filter((c) => c.url.endsWith('/devices')).length
  return { fetchImpl, calls, tokenBodies, commands, listCalls }
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
const THERMOSTAT_STATE = { mode: 'heat', action: 'idle', currentTempC: 24.2, targetTempC: 18.8, humidity: 53 }

async function routes(plugin: ReturnType<typeof createNestPlugin>) {
  const app = Fastify()
  app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/nest' })
  await app.ready()
  return app
}

/** Plugin déjà lié par .env, découvert et démarré (le premier tick du poller est passé). */
async function linked(google: ReturnType<typeof fakeGoogle>, extra: Record<string, string> = {}) {
  const clock = new ManualClock(0)
  const { ctx, ctrl } = fakeContext(config({ NEST_REFRESH_TOKEN: '1//saved', ...extra }), clock)
  const plugin = createNestPlugin({ fetchImpl: google.fetchImpl })
  await plugin.init(ctx)
  const descriptors = await plugin.discover()
  await plugin.start()
  await flush()
  return { plugin, ctx, ctrl, clock, descriptors }
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

  it('links the account: auth url with state, callback exchanges the code and publishes devices', async () => {
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
    expect((published as { id: string }[]).map((d) => d.id)).toEqual(['nest:DEVICE3', 'nest:DEVICE8', 'nest:DEVICE2', 'nest:DEVICE5', 'nest:SYNTHETIC1'])
    expect(ctx.emitState).toHaveBeenCalledWith('DEVICE2', {})
    expect(ctx.emitState).toHaveBeenCalledWith('DEVICE3', THERMOSTAT_STATE)
    expect(plugin.health!()).toMatchObject({ status: 'ok', detail: '4 camera(s), 1 thermostat(s)' })

    // le state est à usage unique
    expect((await app.inject({ method: 'GET', url: '/api/plugins/nest/auth/callback?code=abc&state=state-1' })).statusCode).toBe(400)
    // la réponse brute est relevable pour écrire une fixture réelle
    const raw = await app.inject({ method: 'GET', url: '/api/plugins/nest/devices/raw' })
    expect((raw.json() as { devices: unknown[] }).devices).toHaveLength(5)
    await plugin.stop()
  })

  it('already linked via .env: refreshes the access token, discovers cameras and thermostat, publishes states', async () => {
    const google = fakeGoogle()
    const { plugin, ctx, descriptors } = await linked(google)
    expect(descriptors.map((d) => `${d.kind} ${d.name}`)).toEqual([
      'climate Thermostat Palier', 'camera Caméra Garage', "camera Porte d'entrée", 'camera Caméra Salon', 'camera Caméra Cuisine',
    ])
    expect(google.tokenBodies[0]!.get('grant_type')).toBe('refresh_token')
    expect(google.tokenBodies[0]!.get('refresh_token')).toBe('1//saved')
    expect(ctx.emitState).toHaveBeenCalledWith('DEVICE8', {})
    expect(ctx.emitState).toHaveBeenCalledWith('DEVICE3', THERMOSTAT_STATE)
    expect(ctx.setAvailable).toHaveBeenCalledWith('DEVICE3', true)
    expect(plugin.health!()).toMatchObject({ status: 'ok', detail: '4 camera(s), 1 thermostat(s)' })
    // le jeton d'accès est réutilisé tant qu'il est valide : un seul appel au jeton pour tout ça
    expect(google.tokenBodies).toHaveLength(1)
    await expect(plugin.execute('DEVICE8', { type: 'light.set', on: true })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await plugin.stop()
  })

  it('polls the device list at NEST_POLL_MS and republishes the inventory only when it changes', async () => {
    const google = fakeGoogle()
    const { plugin, ctx, clock } = await linked(google, { NEST_POLL_MS: '60000' })
    // découverte + premier tick du poller
    expect(google.listCalls()).toBe(2)
    expect(ctx.emitDevices).not.toHaveBeenCalled()      // l'inventaire n'a pas changé : pas de republication
    clock.advance(60_000)
    await flush()
    expect(google.listCalls()).toBe(3)
    expect(ctx.emitDevices).not.toHaveBeenCalled()
    await plugin.stop()
  })

  it('drives the thermostat: setpoint, eco, back to heat in two commands, refusals, then re-reads the device', async () => {
    const google = fakeGoogle()
    const { plugin, ctx } = await linked(google)
    ;(ctx.emitState as ReturnType<typeof vi.fn>).mockClear()

    await plugin.execute('DEVICE3', { type: 'climate.set_target_temp', targetTempC: 21 })
    expect(google.commands).toEqual([{ id: 'DEVICE3', command: 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat', params: { heatCelsius: 21 } }])
    // l'état publié vient de la RELECTURE de l'appareil, pas de la commande
    expect(ctx.emitState).toHaveBeenLastCalledWith('DEVICE3', { ...THERMOSTAT_STATE, targetTempC: 21 })
    const post = google.calls.find((c) => c.url.endsWith(':executeCommand'))!
    expect(post.url).toBe('https://smartdevicemanagement.googleapis.com/v1/enterprises/proj-1/devices/DEVICE3:executeCommand')
    expect((post.init!.headers as Record<string, string>)['content-type']).toBe('application/json')

    await plugin.execute('DEVICE3', { type: 'climate.set_mode', mode: 'eco' })
    expect(google.commands.at(-1)).toEqual({ id: 'DEVICE3', command: 'sdm.devices.commands.ThermostatEco.SetMode', params: { mode: 'MANUAL_ECO' } })
    expect(ctx.emitState).toHaveBeenLastCalledWith('DEVICE3', { ...THERMOSTAT_STATE, mode: 'eco', targetTempC: 13.9 })

    // en éco : la consigne est refusée AVANT d'appeler Google, et « cool » n'est pas déclaré
    await expect(plugin.execute('DEVICE3', { type: 'climate.set_target_temp', targetTempC: 20 })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND', message: expect.stringContaining('"eco"') })
    await expect(plugin.execute('DEVICE3', { type: 'climate.set_mode', mode: 'cool' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    expect(google.commands).toHaveLength(2)

    await plugin.execute('DEVICE3', { type: 'climate.set_mode', mode: 'heat' })
    expect(google.commands.slice(2)).toEqual([
      { id: 'DEVICE3', command: 'sdm.devices.commands.ThermostatEco.SetMode', params: { mode: 'OFF' } },
      { id: 'DEVICE3', command: 'sdm.devices.commands.ThermostatMode.SetMode', params: { mode: 'HEAT' } },
    ])
    expect(ctx.emitState).toHaveBeenLastCalledWith('DEVICE3', { ...THERMOSTAT_STATE, targetTempC: 21 })

    await expect(plugin.execute('nope', { type: 'climate.set_mode', mode: 'off' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    await plugin.stop()
  })

  it('a 400 from Google on a command surfaces as UNSUPPORTED_COMMAND with Google’s message', async () => {
    const google = fakeGoogle({ commandStatus: 400 })
    const { plugin } = await linked(google)
    await expect(plugin.execute('DEVICE3', { type: 'climate.set_mode', mode: 'off' }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND', message: expect.stringContaining('Command not allowed') })
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
