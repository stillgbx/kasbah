import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ManualClock } from '@kasbah/mock-sim'
import Fastify from 'fastify'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceDescriptor } from '@kasbah/shared'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { BLINDS, COLOR_LIGHT, DEVICES, LIGHT_DIMMED_EVENT, OUTLET } from './__fixtures__/hub'
import { DirigeraClient, codeChallengeOf, makeCodeVerifier } from './client'
import { createDirigeraPlugin, dirigeraConfigSchema } from './index'
import type { WsLike } from './socket'

const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }
const json = (data: unknown, status = 200) => ({
  ok: status < 400, status, body: null, json: async () => data, text: async () => (data === null ? '' : JSON.stringify(data)),
})

/** Fake hub: serves the fixture list, records the PATCHes; the token is refused `refusals` times. */
function fakeHub(opts: { refusals?: number } = {}) {
  const patches: { path: string; body: unknown; auth: string | undefined }[] = []
  let refusals = opts.refusals ?? 0
  let devices: unknown[] = DEVICES
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const path = url.replace(/^https:\/\/[^/]+\/v1/, '')
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization
    if (path.startsWith('/oauth/authorize')) return json({ code: 'code-1' })
    if (path === '/oauth/token') {
      // the refusal status is not documented: a 400 here, so that nothing hangs on a 403
      if (refusals-- > 0) return json({ error: 'Button not pressed or presence time stamp timed out.' }, 400)
      return json({ access_token: 'token-1' })
    }
    if (path === '/devices') return json(devices)
    if (init?.method === 'PATCH') { patches.push({ path, body: JSON.parse(String(init.body)), auth }); return json(null, 202) }
    return json({}, 404)
  })
  return { fetchImpl, patches, setDevices: (d: unknown[]) => { devices = d } }
}

/** Fake socket: opens on the next tick, lets the test push frames or close it. */
function fakeSocket() {
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {}
  const state = { opened: 0, headers: {} as Record<string, string>, sent: [] as Record<string, unknown>[] }
  const factory = (_url: string, headers: Record<string, string>): WsLike => {
    state.opened++
    state.headers = headers
    for (const k of Object.keys(handlers)) delete handlers[k]
    const ws: WsLike = {
      on: (event: string, fn: (...a: unknown[]) => void) => { (handlers[event] ??= []).push(fn); return ws },
      send: (data: string) => { state.sent.push(JSON.parse(data) as Record<string, unknown>) }, terminate: () => {},
    } as WsLike
    setImmediate(() => handlers.open?.forEach((f) => f()))
    return ws
  }
  const push = (msg: unknown) => handlers.message?.forEach((f) => f(JSON.stringify(msg)))
  const close = () => handlers.close?.forEach((f) => f(1006))
  return { factory, push, close, state }
}

let dir = ''
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

async function setup(opts: { token?: boolean; host?: boolean; refusals?: number } = {}) {
  dir = await mkdtemp(join(tmpdir(), 'kasbah-dirigera-'))
  const tokenFile = join(dir, 'dirigera-token.json')
  if (opts.token !== false) await writeFile(tokenFile, JSON.stringify({ token: 'token-0' }))
  const hub = fakeHub({ refusals: opts.refusals ?? 0 })
  const sock = fakeSocket()
  const plugin = createDirigeraPlugin({
    fetchImpl: hub.fetchImpl, wsFactory: sock.factory,
    pinFile: { load: async () => undefined, save: async () => {} },
  })
  const clock = new ManualClock(0)
  const ctx: PluginContext = {
    pluginId: 'dirigera',
    config: dirigeraConfigSchema.parse({ ...(opts.host !== false ? { DIRIGERA_HOST: '192.168.1.30' } : {}), DIRIGERA_TOKEN_FILE: tokenFile }),
    logger: pino({ level: 'silent' }), clock, signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47, lon: 5, alt: 0 },
  }
  const app = Fastify()
  await app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/dirigera' })
  await plugin.init(ctx)
  await plugin.discover()
  await plugin.start()
  await flush()
  const lastDevices = () => (vi.mocked(ctx.emitDevices).mock.calls.at(-1)?.[0] ?? []) as DeviceDescriptor[]
  return { plugin, ctx, app, hub, sock, clock, tokenFile, lastDevices }
}

describe('DIRIGERA client', () => {
  it('PKCE: the RFC 7636 example challenge, and a 128-character verifier', () => {
    expect(codeChallengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    expect(makeCodeVerifier()).toMatch(/^[A-Za-z0-9._~-]{128}$/)
  })

  it('skips a malformed device alone', async () => {
    const hub = fakeHub()
    const client = new DirigeraClient({ host: '192.168.1.30', token: 't', clock: new ManualClock(0), fetchImpl: hub.fetchImpl })
    const list = await client.getDevices()
    expect(list).toHaveLength(DEVICES.length - 1)
    expect(list.some((d) => d.id === 'broken')).toBe(false)
  })
})

describe('DIRIGERA plugin', () => {
  it('reads the hub, publishes the devices and their states, opens the socket with the token', async () => {
    const { ctx, lastDevices, sock, plugin } = await setup()
    const ids = lastDevices().map((d) => d.externalId)
    expect(ids).toContain(COLOR_LIGHT.id)
    expect(ids).toContain(`${OUTLET.id}.power`)
    expect(ids).toContain(BLINDS.id)
    expect(ctx.emitState).toHaveBeenCalledWith(BLINDS.id, { motion: 'stopped', position: 25, batteryPct: 88 })
    expect(sock.state.headers).toEqual({ Authorization: 'Bearer token-0' })
    expect(plugin.health!().status).toBe('ok')
  })

  it('keeps the socket alive with an application ping every 30 s', async () => {
    const { sock, clock } = await setup()
    clock.advance(30_000)
    expect(sock.state.sent).toEqual([expect.objectContaining({ type: 'ping', specversion: '1.1.0' })])
  })

  it('a socket delta is merged into the full state before being published', async () => {
    const { ctx, sock } = await setup()
    vi.mocked(ctx.emitState).mockClear()
    sock.push(LIGHT_DIMMED_EVENT)
    expect(ctx.emitState).toHaveBeenCalledWith(COLOR_LIGHT.id, expect.objectContaining({ on: true, brightness: 40 }))
  })

  it('a device that becomes unreachable is greyed out, measurements included', async () => {
    const { ctx, sock } = await setup()
    sock.push({ type: 'deviceStateChanged', data: { id: OUTLET.id, isReachable: false } })
    for (const id of [OUTLET.id, `${OUTLET.id}.power`, `${OUTLET.id}.energy`]) expect(ctx.setAvailable).toHaveBeenCalledWith(id, false)
  })

  it('a renamed device republishes the list', async () => {
    const { ctx, sock, lastDevices } = await setup()
    const before = vi.mocked(ctx.emitDevices).mock.calls.length
    sock.push({ type: 'deviceStateChanged', data: { id: COLOR_LIGHT.id, attributes: { customName: 'Lampe 3' } } })
    expect(vi.mocked(ctx.emitDevices).mock.calls.length).toBe(before + 1)
    expect(lastDevices().find((d) => d.externalId === COLOR_LIGHT.id)?.name).toBe('Lampe 3')
  })

  it('an added device triggers a full read', async () => {
    const { sock, hub, clock, lastDevices } = await setup()
    hub.setDevices([COLOR_LIGHT])
    sock.push({ type: 'deviceAdded', data: { id: 'new' } })
    clock.advance(2_000)
    await flush()
    expect(lastDevices().map((d) => d.externalId)).toEqual([COLOR_LIGHT.id])
  })

  it('a dropped socket greys everything out, and the reconnection re-reads the hub', async () => {
    const { ctx, sock, hub, clock } = await setup()
    sock.close()
    expect(ctx.setAvailable).toHaveBeenCalledWith('*', false)
    const reads = hub.fetchImpl.mock.calls.filter(([u]) => u.endsWith('/devices')).length
    clock.advance(60_000)
    await flush()
    clock.advance(2_000)
    await flush()
    expect(sock.state.opened).toBe(2)
    expect(hub.fetchImpl.mock.calls.filter(([u]) => u.endsWith('/devices')).length).toBe(reads + 1)
  })

  it('a command becomes one PATCH per attribute family, in order, with the token', async () => {
    const { plugin, hub } = await setup()
    await plugin.execute(COLOR_LIGHT.id, { type: 'light.set', on: true, brightness: 50 })
    expect(hub.patches).toEqual([
      { path: `/devices/${encodeURIComponent(COLOR_LIGHT.id)}`, body: [{ attributes: { isOn: true } }], auth: 'Bearer token-0' },
      { path: `/devices/${encodeURIComponent(COLOR_LIGHT.id)}`, body: [{ attributes: { lightLevel: 50 } }], auth: 'Bearer token-0' },
    ])
  })

  it('a measurement takes no command; an unknown device is unavailable', async () => {
    const { plugin } = await setup()
    await expect(plugin.execute(`${OUTLET.id}.power`, { type: 'light.set', on: true })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(plugin.execute('nope', { type: 'light.set', on: true })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
  })

  it('without a host it says so; without a token it asks for pairing and stays quiet', async () => {
    const noHost = await setup({ host: false, token: false })
    expect(noHost.plugin.health!().status).toBe('error')
    const noToken = await setup({ token: false })
    expect(noToken.plugin.health!().status).toBe('needs_pairing')
    expect(noToken.hub.fetchImpl).not.toHaveBeenCalled()
    await expect(noToken.plugin.execute(COLOR_LIGHT.id, { type: 'light.set', on: true })).rejects.toMatchObject({ code: 'NEEDS_PAIRING' })
  })

  it('pairing waits for the button, keeps the token and connects', async () => {
    const { app, hub, clock, tokenFile, lastDevices, sock } = await setup({ token: false, refusals: 2 })
    const pending = app.inject({ method: 'POST', url: '/api/plugins/dirigera/pair' })
    for (let i = 0; i < 3; i++) { await flush(); clock.advance(2_000) }
    const res = await pending
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ paired: true })
    expect(JSON.parse(await readFile(tokenFile, 'utf8'))).toEqual({ token: 'token-1' })
    expect(hub.fetchImpl.mock.calls.filter(([u]) => u.endsWith('/oauth/token'))).toHaveLength(3)
    expect(lastDevices().length).toBeGreaterThan(0)
    await flush()
    expect(sock.state.headers).toEqual({ Authorization: 'Bearer token-1' })
  })

  it('pairing gives up when the button is never pressed', async () => {
    const { app, clock, plugin } = await setup({ token: false, refusals: 1_000 })
    const pending = app.inject({ method: 'POST', url: '/api/plugins/dirigera/pair' })
    for (let i = 0; i < 35; i++) { await flush(); clock.advance(2_000) }
    const res = await pending
    expect(res.json()).toMatchObject({ error: { code: 'ACTION_BUTTON_NOT_PRESSED' } })
    expect(plugin.health!().status).toBe('needs_pairing')
  })
})
