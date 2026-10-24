import { X509Certificate } from 'node:crypto'
import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { selfSignedCertificate, startTlsServer, type TestCertificate } from '../../core/test-tls'
import { EVENTS, EVENTS_STOPPED, IO_SHUTTER, IO_VENETIAN, RTS_SHUTTER, SETUP } from './__fixtures__/box'
import { createTahomaPlugin, tahomaConfigSchema } from './index'

const flush = () => new Promise((r) => setTimeout(r, 0))
const json = (data: unknown, status = 200) =>
  ({ ok: status < 400, status, body: null, json: async () => data, text: async () => JSON.stringify(data) })

/** Fake box: serves the setup, returns an event frame only once, logs the execs. */
function fakeBox(opts: { events?: unknown[]; then?: unknown[]; listenerGone?: boolean } = {}) {
  const applied: { label: string; actions: unknown }[] = []
  const calls: string[] = []
  let served = 0
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const path = url.replace(/^https:\/\/[^/]+\/enduser-mobile-web\/1\/enduserAPI/, '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    if (path === '/apiVersion') return json({ protocolVersion: '2021.5.4' })
    if (path === '/setup') return json(SETUP)
    if (path === '/events/register') return json({ id: 'listener-1' })
    if (path === '/events/listener-1/fetch') {
      if (opts.listenerGone) return json({ errorCode: 'NOT_REGISTERED', error: 'No registered event listener' }, 400)
      served += 1
      if (served === 1) return json(opts.events ?? EVENTS)
      if (served === 2 && opts.then) return json(opts.then)
      return json([])
    }
    if (path === '/events/listener-1/unregister') return json({})
    if (path === '/exec/apply') {
      applied.push(JSON.parse(String(init?.body)) as { label: string; actions: unknown })
      return json({ execId: 'exec-1' })
    }
    return json({ error: 'not found' }, 404)
  })
  return { fetchImpl, applied, calls }
}

function fakeContext(config: Record<string, unknown>, clock: ManualClock) {
  const ctrl = new AbortController()
  const ctx: PluginContext = {
    pluginId: 'tahoma', config, logger: pino({ level: 'silent' }), clock, signal: ctrl.signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  return { ctx, ctrl }
}

const CONFIG = { TAHOMA_HOST: '192.168.1.30', TAHOMA_TOKEN: 'secret-token' }
const config = (extra: Record<string, string> = {}) => tahomaConfigSchema.parse({ ...CONFIG, ...extra })
const BATCH = { TAHOMA_COMMAND_MODE: 'batch' }

async function started(box: ReturnType<typeof fakeBox>, extra: Record<string, string> = {}) {
  const clock = new ManualClock(0)
  const { ctx, ctrl } = fakeContext(config(extra), clock)
  const plugin = createTahomaPlugin({ fetchImpl: box.fetchImpl })
  await plugin.init(ctx)
  const descriptors = await plugin.discover()
  await plugin.start()
  return { plugin, ctx, ctrl, clock, descriptors }
}

describe('tahoma plugin', () => {
  it('without a token: probes the token-free /apiVersion and asks for a token', async () => {
    const box = fakeBox()
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(tahomaConfigSchema.parse({ TAHOMA_HOST: '192.168.1.30' }), clock)
    const plugin = createTahomaPlugin({ fetchImpl: box.fetchImpl })
    await plugin.init(ctx)
    expect(await plugin.discover()).toEqual([])
    await plugin.start()
    // the probe proves developer mode is on: the only thing missing is the token
    expect(box.calls).toEqual(['GET /apiVersion'])
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing', detail: expect.stringContaining('developer mode is on') })
    await plugin.stop()
  })

  it('a silent local API is reported as developer mode probably off', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => { throw new Error('connect ECONNREFUSED') })
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(tahomaConfigSchema.parse({ TAHOMA_HOST: '192.168.1.30' }), clock)
    const plugin = createTahomaPlugin({ fetchImpl })
    await plugin.init(ctx)
    expect(plugin.health!()).toMatchObject({ status: 'error', detail: expect.stringContaining('activate developer mode') })
    await plugin.stop()
  })

  it('reports the missing host instead of guessing one', async () => {
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(tahomaConfigSchema.parse({}), clock)
    const plugin = createTahomaPlugin({ fetchImpl: fakeBox().fetchImpl })
    await plugin.init(ctx)
    expect(plugin.health!()).toMatchObject({ status: 'error' })
    await plugin.stop()
  })

  it('discovers only the covers and publishes their initial states', async () => {
    const box = fakeBox()
    const { plugin, ctx, descriptors } = await started(box)
    expect(descriptors.map((d) => d.name)).toEqual(['Volet salon', 'BSO chambre', 'Store terrasse', 'Volet cuisine', 'Portail', 'Volet bureau', 'Volet bureau · luminosité'])
    expect(ctx.emitState).toHaveBeenCalledWith('io.1234-5678-9012.11110001', { position: 70, presetPosition: 27, motion: 'stopped' })
    // RTS: no state to publish, but the device must become available
    expect(ctx.emitState).toHaveBeenCalledWith('rts.1234-5678-9012.22220001', {})
    expect(ctx.setAvailable).toHaveBeenCalledWith('rts.1234-5678-9012.22220001', true)
    expect(plugin.health!()).toMatchObject({ status: 'ok', detail: '192.168.1.30 (protocol 2021.5.4)' })
    await plugin.stop()
  })

  it('merges single-key deltas: a lone MovingState still yields a direction', async () => {
    const box = fakeBox({ then: EVENTS_STOPPED })
    const { plugin, ctx, clock } = await started(box)
    vi.mocked(ctx.emitState).mockClear()
    clock.advance(2000)
    await flush()
    // the target (closure 100) and `MovingState` arrive in TWO separate frames: it is the merge with
    // the known position (70) that gives the direction of movement
    expect(ctx.emitState).toHaveBeenCalledWith('io.1234-5678-9012.11110001', { position: 70, presetPosition: 27, motion: 'closing' })
    expect(ctx.setAvailable).toHaveBeenCalledWith('io.1234-5678-9012.11110002', false)
    // end of travel: the real position only arrives here
    vi.mocked(ctx.emitState).mockClear()
    clock.advance(2000)
    await flush()
    expect(ctx.emitState).toHaveBeenCalledWith('io.1234-5678-9012.11110001', { position: 28, presetPosition: 27, motion: 'stopped' })
    await plugin.stop()
    expect(box.calls).toContain('POST /events/listener-1/unregister')
  })

  it('re-registers the listener and resyncs when the box forgot it', async () => {
    const box = fakeBox({ listenerGone: true })
    const { plugin, ctx, clock } = await started(box)
    vi.mocked(ctx.emitDevices).mockClear()
    clock.advance(2000)                         // fetch → listener lost
    await flush()
    clock.advance(2000)                         // re-registration + full resync
    await flush()
    expect(box.calls.filter((c) => c === 'POST /events/register').length).toBeGreaterThan(1)
    expect(ctx.emitDevices).toHaveBeenCalled()
    await plugin.stop()
  })

  it('translates commands into Overkiz actions', async () => {
    const box = fakeBox({ events: [] })
    const { plugin } = await started(box)
    await plugin.execute('io.1234-5678-9012.11110001', { type: 'cover.set_position', position: 70 })
    expect(box.applied[0]).toEqual({
      label: 'Kasbah cover.set_position',
      actions: [{ deviceURL: IO_SHUTTER.deviceURL, commands: [{ name: 'setClosure', parameters: [30] }] }],
    })
    await plugin.execute('io.1234-5678-9012.11110002', { type: 'cover.set_tilt', tilt: 25 })
    expect(box.applied[1]!.actions).toEqual([
      { deviceURL: IO_VENETIAN.deviceURL, commands: [{ name: 'setOrientation', parameters: [25] }] },
    ])
    await plugin.stop()
  })

  it('assumes the position of a one-way RTS device, and refuses what it cannot do', async () => {
    const box = fakeBox({ events: [] })
    const { plugin, ctx } = await started(box)
    vi.mocked(ctx.emitState).mockClear()
    await plugin.execute('rts.1234-5678-9012.22220001', { type: 'cover.close' })
    expect(box.applied[0]!.actions).toEqual([
      { deviceURL: RTS_SHUTTER.deviceURL, commands: [{ name: 'down', parameters: [] }] },
    ])
    expect(ctx.emitState).toHaveBeenCalledWith('rts.1234-5678-9012.22220001', { position: 0, motion: 'stopped' })
    // a positionable io, however, waits for the box's feedback: no invented state
    vi.mocked(ctx.emitState).mockClear()
    await plugin.execute('io.1234-5678-9012.11110001', { type: 'cover.open' })
    expect(ctx.emitState).not.toHaveBeenCalled()
    await expect(plugin.execute('rts.1234-5678-9012.22220001', { type: 'cover.set_position', position: 40 }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(plugin.execute('rts.1234-5678-9012.99999999', { type: 'cover.open' }))
      .rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    await plugin.stop()
  })

  it("recalling an RTS's favorite position CLEARS the assumed position", async () => {
    // The favorite position lives in the motor and an RTS does not say which one it is: after this
    // recall, the 0 assumed from the previous closing has become wrong. Keeping it would show
    // "Lowered" for a blind that went elsewhere — exactly the defect that was fixed.
    const box = fakeBox({ events: [] })
    const { plugin, ctx } = await started(box)
    await plugin.execute('rts.1234-5678-9012.22220001', { type: 'cover.close' })
    expect(ctx.emitState).toHaveBeenCalledWith('rts.1234-5678-9012.22220001', { position: 0, motion: 'stopped' })

    vi.mocked(ctx.emitState).mockClear()
    await plugin.execute('rts.1234-5678-9012.22220001', { type: 'cover.preset' })
    expect(box.applied.at(-1)!.actions).toEqual([
      { deviceURL: RTS_SHUTTER.deviceURL, commands: [{ name: 'my', parameters: [] }] },
    ])
    expect(ctx.emitState).toHaveBeenCalledWith('rts.1234-5678-9012.22220001', { position: null, motion: 'stopped' })

    // a positionable io will publish its real position: nothing to invent or clear
    vi.mocked(ctx.emitState).mockClear()
    await plugin.execute('io.1234-5678-9012.11110001', { type: 'cover.preset' })
    expect(ctx.emitState).not.toHaveBeenCalled()
    await plugin.stop()
  })

  it('STOPPING an RTS mid-travel also clears the assumed position', async () => {
    // Same reason as the favorite position recall: the stop cuts the travel in the middle, and a
    // unidirectional radio does not say where. The blind actually at half height must not be shown
    // "Lowered" at 100 %.
    const box = fakeBox({ events: [] })
    const { plugin, ctx } = await started(box)
    await plugin.execute('rts.1234-5678-9012.22220001', { type: 'cover.close' })
    vi.mocked(ctx.emitState).mockClear()
    await plugin.execute('rts.1234-5678-9012.22220001', { type: 'cover.stop' })
    expect(ctx.emitState).toHaveBeenCalledWith('rts.1234-5678-9012.22220001', { position: null, motion: 'stopped' })

    // an io reports its real position: its stop clears nothing
    vi.mocked(ctx.emitState).mockClear()
    await plugin.execute('io.1234-5678-9012.11110001', { type: 'cover.stop' })
    expect(ctx.emitState).not.toHaveBeenCalled()
    await plugin.stop()
  })

  it('in batch mode, a burst of commands goes out in ONE execution', async () => {
    // 15 simultaneous exec/apply: the box took 9 in 8 s, the other 6 timed out without being
    // executed (observed 2026-10-14). An automation sends its shutters all at once.
    const box = fakeBox({ events: [] })
    const { plugin, ctx } = await started(box, BATCH)
    await Promise.all([
      plugin.execute('io.1234-5678-9012.11110001', { type: 'cover.close' }),
      plugin.execute('io.1234-5678-9012.11110002', { type: 'cover.close' }),
      plugin.execute('rts.1234-5678-9012.22220001', { type: 'cover.close' }),
    ])
    expect(box.applied).toEqual([{
      label: 'Kasbah cover.close',
      actions: [
        { deviceURL: IO_SHUTTER.deviceURL, commands: [{ name: 'close', parameters: [] }] },
        { deviceURL: IO_VENETIAN.deviceURL, commands: [{ name: 'close', parameters: [] }] },
        { deviceURL: RTS_SHUTTER.deviceURL, commands: [{ name: 'down', parameters: [] }] },
      ],
    }])
    // what follows for each device has not changed: the RTS still sets its assumed position
    expect(ctx.emitState).toHaveBeenCalledWith('rts.1234-5678-9012.22220001', { position: 0, motion: 'stopped' })
    await plugin.stop()
  })

  it('in batch mode, the same device twice in the burst goes into a second batch, in order', async () => {
    const box = fakeBox({ events: [] })
    const { plugin } = await started(box, BATCH)
    await Promise.all([
      plugin.execute('rts.1234-5678-9012.22220001', { type: 'cover.close' }),
      plugin.execute('io.1234-5678-9012.11110001', { type: 'cover.open' }),
      plugin.execute('rts.1234-5678-9012.22220001', { type: 'cover.stop' }),
    ])
    expect(box.applied.map((a) => a.label)).toEqual(['Kasbah 2 commands', 'Kasbah cover.stop'])
    expect(box.applied[1]!.actions).toEqual([
      { deviceURL: RTS_SHUTTER.deviceURL, commands: [{ name: 'stop', parameters: [] }] },
    ])
    await plugin.stop()
  })

  it('in batch mode, a batch refused by the box fails each of its commands', async () => {
    const box = fakeBox({ events: [] })
    const { plugin } = await started(box, BATCH)
    box.fetchImpl.mockImplementationOnce(async () => json({ error: 'busy' }, 500))
    const results = await Promise.allSettled([
      plugin.execute('io.1234-5678-9012.11110001', { type: 'cover.close' }),
      plugin.execute('rts.1234-5678-9012.22220001', { type: 'cover.close' }),
    ])
    expect(results).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ code: 'UPSTREAM_ERROR' }) },
      { status: 'rejected', reason: expect.objectContaining({ code: 'UPSTREAM_ERROR' }) },
    ])
    await plugin.stop()
  })

  it('by default (queue), a burst goes out as one execution per device, one request at a time', async () => {
    // a stop sent to ONE shutter must not be able to cancel the others' execution
    const box = fakeBox({ events: [] })
    const { plugin } = await started(box)
    const serve = box.fetchImpl.getMockImplementation()!
    let inFlight = 0
    let maxInFlight = 0
    let failNext = true                         // the first request fails: the following ones go out anyway
    box.fetchImpl.mockImplementation(async (url, init) => {
      maxInFlight = Math.max(maxInFlight, ++inFlight)
      await new Promise((r) => setTimeout(r, 5))
      try {
        if (failNext) { failNext = false; return json({ error: 'busy' }, 500) }
        return await serve(url, init)
      } finally { inFlight-- }
    })
    const results = await Promise.allSettled([
      plugin.execute('io.1234-5678-9012.11110001', { type: 'cover.close' }),
      plugin.execute('io.1234-5678-9012.11110002', { type: 'cover.close' }),
      plugin.execute('rts.1234-5678-9012.22220001', { type: 'cover.close' }),
    ])
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled'])
    expect(maxInFlight).toBe(1)
    expect(box.applied.map((a) => a.actions)).toEqual([
      [{ deviceURL: IO_VENETIAN.deviceURL, commands: [{ name: 'close', parameters: [] }] }],
      [{ deviceURL: RTS_SHUTTER.deviceURL, commands: [{ name: 'down', parameters: [] }] }],
    ])
    await plugin.stop()
  })

  it('gives up on a hung box request instead of hanging forever', async () => {
    // a box that never answers: without its own timeout, the event polling would freeze
    const fetchImpl = vi.fn<FetchLike>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })))
    }))
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(config(), clock)
    const plugin = createTahomaPlugin({ fetchImpl, requestTimeoutMs: 150 })
    await plugin.init(ctx)
    await expect(plugin.discover()).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(plugin.health!()).toMatchObject({ status: 'error' })
    await plugin.stop()
  })

  it('maps a rejected token to NEEDS_PAIRING and keeps the box own wording', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) => (url.endsWith('/apiVersion')
      ? json({ protocolVersion: '2026.3.3-7' })
      : json({ errorCode: 'RESOURCE_ACCESS_DENIED', error: 'Not authenticated.' }, 401)))
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(config(), clock)
    const plugin = createTahomaPlugin({ fetchImpl })
    await plugin.init(ctx)
    await expect(plugin.discover()).rejects.toMatchObject({
      code: 'NEEDS_PAIRING',
      // the box's message tells "token refused" apart from a header bug on our side
      message: 'TaHoma local token rejected (Not authenticated.)',
    })
    expect(plugin.health!()).toMatchObject({ status: 'error', detail: expect.stringContaining('Not authenticated.') })
    await plugin.stop()
  })
})

/** Just enough of a box over real TLS: the token-free `/apiVersion`, an empty setup. */
function respondLikeABox(chunk: string): string | undefined {
  const path = /^(?:GET|POST) \S*\/enduserAPI(\S+)/.exec(chunk)?.[1]
  if (!path) return undefined
  const body = JSON.stringify(path === '/apiVersion' ? { protocolVersion: '2021.5.4' } : { devices: [], rootPlace: { label: 'Maison', oid: 'p', subPlaces: [] } })
  return `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

describe('tahoma box certificate pin', () => {
  const fingerprint = (c: TestCertificate) => new X509Certificate(c.cert).fingerprint256

  it('pins the box met first, then never sends the token to a box with another certificate', async () => {
    const cert = selfSignedCertificate()
    const server = await startTlsServer(cert, respondLikeABox)
    const boxConfig = tahomaConfigSchema.parse({ TAHOMA_HOST: '127.0.0.1', TAHOMA_PORT: String(server.port), TAHOMA_TOKEN: 'secret-token' })

    // first contact: learned, and the box answers
    let saved: string | undefined
    const first = createTahomaPlugin({ pinFile: { load: async () => saved, save: async (fp) => { saved = fp } } })
    await first.init(fakeContext(boxConfig, new ManualClock(0)).ctx)
    expect(saved).toBe(fingerprint(cert))
    expect(first.health!().status).not.toBe('error')
    await first.stop()

    // pinned on another box: nothing leaves, and the health says what to do
    const before = server.received().length
    saved = fingerprint(selfSignedCertificate())
    const second = createTahomaPlugin({ pinFile: { load: async () => saved, save: async (fp) => { saved = fp } } })
    await second.init(fakeContext(boxConfig, new ManualClock(0)).ctx)
    await expect(second.discover()).rejects.toThrow()
    expect(server.received().slice(before)).toBe('')       // not even the request line, let alone the token
    expect(second.health!()).toEqual({ status: 'error', detail: expect.stringContaining('tahoma-tls-pin.json') })
    await second.stop()
    await server.close()
  })
})
