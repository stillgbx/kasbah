import type { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { ManualClock } from '@kasbah/mock-sim'
import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { DEVICES_RESPONSE, SDM_403, THERMOSTAT, TOKEN_INVALID_GRANT, TOKEN_OK, TOKEN_REFRESHED } from './__fixtures__/sdm'
import { createNestPlugin, nestConfigSchema } from './index'

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) }
/** Comme `flush`, mais laisse aussi passer les `fs.stat` des vignettes (vrai système de fichiers). */
const settle = () => new Promise((r) => setTimeout(r, 25))
/** Grâce du relais sans abonné (STREAM_IDLE_MS du plugin). */
const GRID_GRACE = 8000
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
  const pubsub: { ackId: string; message: { data: string } }[] = []
  const acks: string[] = []
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
    if (url.includes('pubsub.googleapis.com')) {
      if (url.endsWith(':pull')) return json({ receivedMessages: pubsub.splice(0) })
      if (url.endsWith(':acknowledge')) { acks.push(...(JSON.parse(String(init?.body)) as { ackIds: string[] }).ackIds); return json({}) }
      return json({ error: { message: 'not found' } }, 404)
    }
    const m = /\/devices\/([^/:]+)(:executeCommand)?$/.exec(url)
    if (m?.[2]) {
      const body = JSON.parse(String(init?.body)) as { command: string; params: Record<string, unknown> }
      commands.push({ id: m[1]!, ...body })
      if (opts.commandStatus) return json({ error: { code: opts.commandStatus, message: 'Command not allowed in current state.', status: 'FAILED_PRECONDITION' } }, opts.commandStatus)
      if (body.command.endsWith('GenerateRtspStream')) return json({ results: { streamUrls: { rtspUrl: `rtsps://stream.google/${m[1]}?auth=tok` }, streamExtensionToken: 'ext-1', streamToken: 'tok', expiresAt: '2026-09-09T12:00:00Z' } })
      if (body.command.endsWith('ExtendRtspStream')) return json({ results: { streamExtensionToken: 'ext-2', streamToken: 'tok2', expiresAt: '2026-09-09T12:05:00Z' } })
      if (body.command.endsWith('StopRtspStream')) return json({})
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
  const pushEvent = (externalId: string, event: string) => {
    const data = Buffer.from(JSON.stringify({ resourceUpdate: { name: `enterprises/PROJECT/devices/${externalId}`, events: { [event]: {} } } })).toString('base64')
    pubsub.push({ ackId: `ack-${pubsub.length}`, message: { data } })
  }
  return { fetchImpl, calls, tokenBodies, commands, listCalls, pushEvent, acks }
}

/** Faux ffmpeg : on ne fait que compter les lancements et les arrêts. */
function fakeSpawn() {
  const procs: { kill: ReturnType<typeof vi.fn> }[] = []
  const spawnImpl = vi.fn(() => {
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null, kill: vi.fn() })
    proc.kill.mockImplementation(() => { proc.exitCode = 0; proc.emit('exit', null, 'SIGTERM'); return true })
    procs.push(proc)
    return proc
  })
  return { spawnImpl: spawnImpl as unknown as typeof spawn, procs }
}

function fakeContext(config: Record<string, unknown>, clock: ManualClock) {
  const ctrl = new AbortController()
  const ctx: PluginContext = {
    pluginId: 'nest', config, logger: pino({ level: 'silent' }), clock, signal: ctrl.signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {},
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
async function linked(google: ReturnType<typeof fakeGoogle>, extra: Record<string, string> = {}, ffmpeg?: ReturnType<typeof fakeSpawn>) {
  const clock = new ManualClock(0)
  const { ctx, ctrl } = fakeContext(config({ NEST_REFRESH_TOKEN: '1//saved', ...extra }), clock)
  const plugin = createNestPlugin({ fetchImpl: google.fetchImpl, ...(ffmpeg ? { spawnImpl: ffmpeg.spawnImpl } : {}) })
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

  it('cameras view: watching opens snapshot sessions within the budget, stopping to watch closes them', async () => {
    const google = fakeGoogle()
    const ffmpeg = fakeSpawn()
    const { plugin, clock } = await linked(google, {}, ffmpeg)
    const app = await routes(plugin)
    const rtsp = (c: { command: string }) => c.command.split('.').pop()
    // trois caméras RTSP dans la fixture (la WebRTC est ignorée), budget 10 : trois sessions, mais
    // UNE ouverture par tick de 8 s (quota Google), donc trois ticks
    const r1 = await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots?watch=1' })
    expect(r1.statusCode).toBe(200)
    await settle()
    expect(google.commands.filter((c) => rtsp(c) === 'GenerateRtspStream')).toHaveLength(1)
    for (let i = 0; i < 2; i++) { clock.advance(8000); await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots?watch=1' }); await settle() }
    expect(google.commands.filter((c) => rtsp(c) === 'GenerateRtspStream').map((c) => c.id).sort()).toEqual(['DEVICE2', 'DEVICE5', 'DEVICE8'])
    expect(ffmpeg.procs).toHaveLength(3)
    const args = (ffmpeg.spawnImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string[]
    expect(args).toEqual(expect.arrayContaining(['-update', '1', '-f', 'image2']))
    expect(plugin.health!().detail).toContain('3 live stream(s)')
    // sans vignette écrite (pas de vrai ffmpeg), la liste est vide mais la route répond
    expect(await (await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots' })).json()).toMatchObject({ snapshots: {}, budget: 10, sessions: 3 })
    expect((await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/DEVICE8/snapshot.jpg' })).statusCode).toBe(404)
    // plus personne ne regarde : 15 s sans signal (constaté au tick suivant), puis la grâce du
    // relais (8 s), et les sessions sont rendues
    clock.advance(24_000)
    await settle()
    clock.advance(16_000)
    await settle()
    expect(ffmpeg.procs.every((p) => p.kill.mock.calls.length === 1)).toBe(true)
    // le faux ffmpeg n'a jamais livré d'entête : ces sessions n'ont pas démarré, on ne dépense pas
    // une commande Google pour les rendre (elles expirent seules)
    expect(google.commands.filter((c) => rtsp(c) === 'StopRtspStream')).toHaveLength(0)
    expect(plugin.health!().detail).not.toContain('live stream')
    await plugin.stop()
  })

  it('pub/sub: a doorbell chime pulled from the subscription is pushed to clients and acknowledged', async () => {
    const google = fakeGoogle()
    const { plugin, ctx, clock } = await linked(google, { NEST_PUBSUB_SUBSCRIPTION: 'projects/p/subscriptions/s' })
    // le premier tirage (au démarrage) ne trouve rien ; on dépose ensuite une sonnerie sur DEVICE2 (la sonnette)
    google.pushEvent('DEVICE2', 'sdm.devices.events.DoorbellChime.Chime')
    clock.advance(5000)
    await settle()
    expect(ctx.emitEvent).toHaveBeenCalledWith('DEVICE2', 'chime')
    expect(google.acks).toHaveLength(1)
    await plugin.stop()
  })

  it('pub/sub: motion/person events are acknowledged but not pushed yet, unknown devices are skipped', async () => {
    const google = fakeGoogle()
    const { plugin, ctx, clock } = await linked(google, { NEST_PUBSUB_SUBSCRIPTION: 'projects/p/subscriptions/s' })
    google.pushEvent('DEVICE8', 'sdm.devices.events.CameraMotion.Motion')   // caméra connue, mais mouvement non exposé
    google.pushEvent('GHOST', 'sdm.devices.events.DoorbellChime.Chime')     // appareil inconnu
    clock.advance(5000)
    await settle()
    expect(ctx.emitEvent).not.toHaveBeenCalled()
    expect(google.acks).toHaveLength(2)                                     // tout est acquitté, sinon Google boucle
    await plugin.stop()
  })

  it('extends a session after four minutes and reconnects ffmpeg on the URL carrying the new token', async () => {
    const google = fakeGoogle()
    const ffmpeg = fakeSpawn()
    const { plugin, clock } = await linked(google, {}, ffmpeg)
    const app = await routes(plugin)
    // budget 10 pour trois caméras : aucune rotation, les sessions durent (ouvertes à 0, 8 et 16 s)
    await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots?watch=1' })
    await settle()
    expect(ffmpeg.procs).toHaveLength(1)
    for (let t = 0; t < 4 * 60_000; t += 8000) { clock.advance(8000); await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots?watch=1' }); await settle() }
    // à 4 min, seule la première session est prolongée
    expect(google.commands.filter((c) => c.command.endsWith('ExtendRtspStream')).map((c) => c.id)).toEqual([google.commands[0]!.id])
    // un second ffmpeg est lancé sur l'URL portant le nouveau jeton ; l'ancien reste jusqu'à la relève
    expect(ffmpeg.procs).toHaveLength(4)
    const args = (ffmpeg.spawnImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[3]![1] as string[]
    expect(args.find((a) => a.startsWith('rtsps://'))).toBe(`rtsps://stream.google/${google.commands[0]!.id}?auth=tok2`)
    expect(ffmpeg.procs[0]!.kill).not.toHaveBeenCalled()
    await plugin.stop()
  })

  it('cameras view: a budget below the camera count rotates the snapshot sessions', async () => {
    const google = fakeGoogle()
    const ffmpeg = fakeSpawn()
    const { plugin, clock } = await linked(google, { NEST_LIVE_BUDGET: '1' }, ffmpeg)
    const app = await routes(plugin)
    const opened = () => google.commands.filter((c) => c.command.endsWith('GenerateRtspStream')).map((c) => c.id)
    await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots?watch=1' })
    await flush()
    expect(opened()).toHaveLength(1)
    // la caméra tenue cède sa place après 20 s de présence ; sa session se ferme 8 s plus tard et
    // libère le budget ; la suivante prend le relais au tick d'après
    for (let t = 0; t < 56_000; t += 8000) { clock.advance(8000); await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots?watch=1' }); await settle() }
    expect(opened().length).toBeGreaterThanOrEqual(2)
    expect(new Set(opened()).size).toBeGreaterThanOrEqual(2)
    await plugin.stop()
  })

  it('cameras view: the stop button of a tile releases that camera and keeps it out of the rotation until resumed', async () => {
    const google = fakeGoogle()
    const ffmpeg = fakeSpawn()
    const { plugin, clock } = await linked(google, {}, ffmpeg)
    const app = await routes(plugin)
    const opened = () => google.commands.filter((c) => c.command.endsWith('GenerateRtspStream')).map((c) => c.id)
    await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots?watch=1' })
    await settle()
    const [first] = opened()
    // arrêt : la prise est rendue, la session se ferme après la grâce, la caméra est annoncée « paused »
    expect((await app.inject({ method: 'PUT', url: `/api/plugins/nest/cameras/${first}/snapshots`, payload: { enabled: false } })).json()).toEqual({ enabled: false })
    clock.advance(GRID_GRACE)
    await settle()
    expect(ffmpeg.procs[0]!.kill).toHaveBeenCalledTimes(1)
    const r = await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots?watch=1' })
    expect(r.json().snapshots[first!]).toMatchObject({ paused: true, live: false })
    // les ticks suivants ouvrent les autres caméras, jamais celle-là
    for (let i = 0; i < 4; i++) { clock.advance(8000); await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots?watch=1' }); await settle() }
    expect(opened().filter((id) => id === first)).toHaveLength(1)
    expect(new Set(opened()).size).toBe(3)
    // reprise : elle est rouverte au tick suivant
    await app.inject({ method: 'PUT', url: `/api/plugins/nest/cameras/${first}/snapshots`, payload: { enabled: true } })
    clock.advance(8000)
    await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots?watch=1' })
    await settle()
    expect(opened().filter((id) => id === first)).toHaveLength(2)
    expect((await app.inject({ method: 'PUT', url: '/api/plugins/nest/cameras/DEVICE8/snapshots', payload: { enabled: 'yes' } })).statusCode).toBe(400)
    await plugin.stop()
  })

  it('cameras view: after a restart, a camera that gave an image last time is reopened before the others', async () => {
    // vignette laissée par l'exécution précédente (le dossier survit au serveur)
    const dir = join(tmpdir(), 'kasbah-nest-snapshots')
    mkdirSync(dir, { recursive: true })
    const stale = join(dir, 'DEVICE5.jpg')
    writeFileSync(stale, 'jpg')
    const old = new Date(Date.now() - 10 * 60_000)
    utimesSync(stale, old, old)
    try {
      const google = fakeGoogle()
      const ffmpeg = fakeSpawn()
      const { plugin } = await linked(google, {}, ffmpeg)
      const app = await routes(plugin)
      await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots?watch=1' })
      await settle()
      expect(google.commands.filter((c) => c.command.endsWith('GenerateRtspStream')).map((c) => c.id)).toEqual(['DEVICE5'])
      await plugin.stop()
    } finally { unlinkSync(stale) }
  })

  it('cameras view: a camera whose stream dies before its first image is not retried right away', async () => {
    const google = fakeGoogle()
    const ffmpeg = fakeSpawn()
    const { plugin, clock } = await linked(google, { NEST_LIVE_BUDGET: '1' }, ffmpeg)
    const app = await routes(plugin)
    const opened = () => google.commands.filter((c) => c.command.endsWith('GenerateRtspStream')).map((c) => c.id)
    await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots?watch=1' })
    await settle()
    expect(opened()).toEqual(['DEVICE8'])
    // la caméra est éteinte : Google a donné l'URL mais son serveur répond 404, ffmpeg sort
    const proc = ffmpeg.procs[0] as unknown as EventEmitter & { stderr: PassThrough; exitCode: number | null }
    proc.stderr.write('rtsps://stream/x?auth=t: Server returned 404 Not Found\n')
    proc.exitCode = 1
    proc.emit('exit', 1, null)
    await settle()
    // la place libérée va aux AUTRES caméras ; DEVICE8 attend au moins une minute avant un nouvel essai
    for (let t = 0; t < 40_000; t += 8000) { clock.advance(8000); await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots?watch=1' }); await settle() }
    expect(opened().filter((id) => id === 'DEVICE8')).toHaveLength(1)
    expect(opened().length).toBeGreaterThanOrEqual(2)
    const list = (await app.inject({ method: 'GET', url: '/api/plugins/nest/cameras/snapshots' })).json() as { snapshots: Record<string, { inactive?: boolean }> }
    expect(list.snapshots.DEVICE8).toMatchObject({ inactive: true })
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
    // la découverte ne condamne pas le plugin : liste vide, et `health` dit pourquoi
    expect(await plugin.discover()).toEqual([])
    expect(plugin.health!()).toMatchObject({ status: 'error', detail: expect.stringContaining('link the account again') })

    const forbidden = fakeGoogle({ devices: SDM_403, devicesStatus: 403 })
    const second = createNestPlugin({ fetchImpl: forbidden.fetchImpl })
    await second.init(fakeContext(config({ NEST_REFRESH_TOKEN: '1//saved' }), new ManualClock(0)).ctx)
    expect(await second.discover()).toEqual([])
    expect(second.health!()).toMatchObject({ status: 'error', detail: expect.stringContaining('has not been used in project') })
  })
})
