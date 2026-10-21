import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { STATUS_BUS_SILENT, STATUS_CLOSED } from './__fixtures__/status'
import { createHormannPlugin, hormannConfigSchema } from './index'

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }

const DOOR = { id: 'garage1', host: '192.168.1.51', password: 'secret', name: 'Porte garage 1' }

/**
 * Fake bridge: `/status` returns its state, `/command` acts like the firmware (open → opening,
 * light → toggle) unless `ignoreCommands` (the firmware's "OK" to a dropped command).
 */
function fakeBridge(initial: Record<string, unknown> = STATUS_CLOSED) {
  const bridge = {
    state: { ...initial } as Record<string, unknown>,
    requests: [] as { url: string; auth: string | undefined }[],
    ignoreCommands: false,
    httpStatus: 200,
  }
  const reply = (status: number, text: string) => ({
    ok: status < 400, status, body: null, json: async () => JSON.parse(text), text: async () => text,
  })
  const fetchImpl: FetchLike = async (input, init) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization
    bridge.requests.push({ url: input, auth })
    if (bridge.httpStatus !== 200) return reply(bridge.httpStatus, 'refused')
    const url = new URL(input)
    if (url.pathname === '/status') return reply(200, JSON.stringify(bridge.state))
    if (url.pathname === '/command' && !bridge.ignoreCommands) {
      const action = Number(url.searchParams.get('action'))
      if (action === 1) bridge.state = { ...bridge.state, doorstate: 'opening', targetPosition: 100 }
      if (action === 5) bridge.state = { ...bridge.state, light: !bridge.state.light }
    }
    return reply(200, 'OK')
  }
  return { bridge, fetchImpl }
}

function fakeContext(clock: ManualClock, doors: unknown[] = [DOOR]) {
  const ctrl = new AbortController()
  const ctx: PluginContext = {
    pluginId: 'hormann',
    config: hormannConfigSchema.parse({ HORMANN_DOORS: JSON.stringify(doors) }),
    logger: pino({ level: 'silent' }), clock, signal: ctrl.signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  return { ctx, ctrl }
}

const patches = (ctx: PluginContext, externalId: string) =>
  (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === externalId).map((c) => c[1] as Record<string, unknown>)

/** Runs `p` while advancing the clock, as long as it is pending. */
async function drive<T>(clock: ManualClock, p: Promise<T>, stepMs = 500, maxSteps = 40): Promise<T> {
  // Settled at once (both ways), so a rejection is never left unhandled while the clock runs.
  const box: { outcome?: { ok: true; value: T } | { ok: false; error: unknown } } = {}
  void p.then((value) => { box.outcome = { ok: true, value } }, (error: unknown) => { box.outcome = { ok: false, error } })
  for (let i = 0; i < maxSteps && !box.outcome; i++) {
    await flush()
    clock.advance(stepMs)
  }
  await flush()
  if (!box.outcome) throw new Error('drive: promise still pending')
  if (!box.outcome.ok) throw box.outcome.error
  return box.outcome.value
}

async function started(bridgeInit?: Record<string, unknown>) {
  const clock = new ManualClock(0)
  const { ctx, ctrl } = fakeContext(clock)
  const { bridge, fetchImpl } = fakeBridge(bridgeInit)
  const plugin = createHormannPlugin({ fetchImpl })
  await plugin.init(ctx)
  await plugin.start()
  await flush()
  return { clock, ctx, ctrl, bridge, plugin }
}

describe('hormann plugin', () => {
  it('discover() declares the door and its light without network', async () => {
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock)
    const { bridge, fetchImpl } = fakeBridge()
    const plugin = createHormannPlugin({ fetchImpl })
    await plugin.init(ctx)
    expect((await plugin.discover()).map((d) => d.kind)).toEqual(['cover', 'light'])
    expect(bridge.requests).toHaveLength(0)
  })

  it('start() reads /status with Basic auth and publishes both devices', async () => {
    const { ctx, ctrl, bridge, plugin } = await started()
    expect(bridge.requests[0]).toEqual({
      url: 'http://192.168.1.51/status',
      auth: `Basic ${Buffer.from('admin:secret').toString('base64')}`,
    })
    expect(patches(ctx, 'garage1_door').at(-1)).toEqual({ motion: 'stopped', position: 0 })
    expect(patches(ctx, 'garage1_light').at(-1)).toEqual({ on: false })
    expect(plugin.health?.()).toEqual({ status: 'ok' })
    ctrl.abort()
    await plugin.stop()
  })

  it('a silent bus makes the door unavailable', async () => {
    const { ctx, ctrl, plugin } = await started(STATUS_BUS_SILENT)
    expect(ctx.setAvailable).toHaveBeenCalledWith('garage1_door', false)
    expect(patches(ctx, 'garage1_door')).toHaveLength(0)
    expect(plugin.health?.()).toMatchObject({ status: 'degraded' })
    await expect(plugin.execute('garage1_door', { type: 'cover.open' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    ctrl.abort()
    await plugin.stop()
  })

  it('a refused password asks for pairing', async () => {
    const clock = new ManualClock(0)
    const { ctx, ctrl } = fakeContext(clock)
    const { bridge, fetchImpl } = fakeBridge()
    bridge.httpStatus = 401
    const plugin = createHormannPlugin({ fetchImpl })
    await plugin.init(ctx)
    await plugin.start()
    await flush()
    expect(plugin.health?.()).toMatchObject({ status: 'needs_pairing' })
    ctrl.abort()
    await plugin.stop()
  })

  it('open resolves once the door is seen moving', async () => {
    const { clock, ctx, ctrl, bridge, plugin } = await started()
    await drive(clock, plugin.execute('garage1_door', { type: 'cover.open' }))
    expect(bridge.requests.some((r) => r.url === 'http://192.168.1.51/command?action=1')).toBe(true)
    expect(patches(ctx, 'garage1_door').at(-1)).toMatchObject({ motion: 'opening' })
    ctrl.abort()
    await plugin.stop()
  })

  it('a command the firmware drops fails instead of resolving on its "OK"', async () => {
    const { clock, ctrl, bridge, plugin } = await started()
    bridge.ignoreCommands = true
    await expect(drive(clock, plugin.execute('garage1_door', { type: 'cover.open' })))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
    ctrl.abort()
    await plugin.stop()
  })

  it('switching on a lit lamp sends nothing (the light only toggles)', async () => {
    const { clock, ctrl, bridge, plugin } = await started({ ...STATUS_CLOSED, light: true })
    await drive(clock, plugin.execute('garage1_light', { type: 'light.set', on: true }))
    expect(bridge.requests.some((r) => r.url.includes('/command'))).toBe(false)
    await drive(clock, plugin.execute('garage1_light', { type: 'light.set', on: false }))
    expect(bridge.requests.some((r) => r.url.endsWith('/command?action=5'))).toBe(true)
    expect(bridge.state.light).toBe(false)
    ctrl.abort()
    await plugin.stop()
  })

  it('health needs_pairing without doors', async () => {
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock, [])
    const plugin = createHormannPlugin({ fetchImpl: fakeBridge().fetchImpl })
    await plugin.init(ctx)
    expect(plugin.health?.()).toMatchObject({ status: 'needs_pairing' })
  })
})
