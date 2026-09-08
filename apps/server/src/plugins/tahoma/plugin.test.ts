import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { EVENTS, EVENTS_STOPPED, IO_SHUTTER, IO_VENETIAN, RTS_SHUTTER, SETUP } from './__fixtures__/box'
import { createTahomaPlugin, tahomaConfigSchema } from './index'

const flush = () => new Promise((r) => setTimeout(r, 0))
const json = (data: unknown, status = 200) =>
  ({ ok: status < 400, status, body: null, json: async () => data, text: async () => JSON.stringify(data) })

/** Fausse box : sert le setup, rend une trame d'événements une seule fois, journalise les exec. */
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
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(),
  }
  return { ctx, ctrl }
}

const CONFIG = { TAHOMA_HOST: '192.168.1.30', TAHOMA_TOKEN: 'secret-token' }
const config = (extra: Record<string, string> = {}) => tahomaConfigSchema.parse({ ...CONFIG, ...extra })

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
    // le sondage prouve que le mode développeur est actif : le seul manque est le jeton
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
    expect(descriptors.map((d) => d.name)).toEqual(['Volet salon', 'BSO chambre', 'Store terrasse', 'Volet cuisine', 'Portail'])
    expect(ctx.emitState).toHaveBeenCalledWith('io.1234-5678-9012.11110001', { position: 70, presetPosition: 27, motion: 'stopped' })
    // RTS : aucun état à publier, mais l'appareil doit devenir disponible
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
    // la cible (fermeture 100) et `MovingState` arrivent dans DEUX trames distinctes : c'est la
    // fusion avec la position connue (70) qui donne le sens du mouvement
    expect(ctx.emitState).toHaveBeenCalledWith('io.1234-5678-9012.11110001', { position: 70, presetPosition: 27, motion: 'closing' })
    expect(ctx.setAvailable).toHaveBeenCalledWith('io.1234-5678-9012.11110002', false)
    // fin de course : la position réelle n'arrive qu'ici
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
    clock.advance(2000)                         // fetch → écouteur perdu
    await flush()
    clock.advance(2000)                         // réenregistrement + resynchronisation complète
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
    // un io positionnable, lui, attend le retour de la box : aucun état inventé
    vi.mocked(ctx.emitState).mockClear()
    await plugin.execute('io.1234-5678-9012.11110001', { type: 'cover.open' })
    expect(ctx.emitState).not.toHaveBeenCalled()
    await expect(plugin.execute('rts.1234-5678-9012.22220001', { type: 'cover.set_position', position: 40 }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(plugin.execute('rts.1234-5678-9012.99999999', { type: 'cover.open' }))
      .rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    await plugin.stop()
  })

  it('rappeler la position favorite d un RTS EFFACE la position supposee', async () => {
    // La position favorite vit dans le moteur et un RTS ne dit pas laquelle c'est : apres ce
    // rappel, le 0 suppose par la fermeture precedente est devenu faux. Le garder afficherait
    // « Baisse » pour un store parti ailleurs — exactement le defaut qu'on a corrige.
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

    // un io positionnable publiera sa vraie position : rien a inventer ni a effacer
    vi.mocked(ctx.emitState).mockClear()
    await plugin.execute('io.1234-5678-9012.11110001', { type: 'cover.preset' })
    expect(ctx.emitState).not.toHaveBeenCalled()
    await plugin.stop()
  })

  it('gives up on a hung box request instead of hanging forever', async () => {
    // une box qui ne repond jamais : sans delai propre, le sondage d'evenements gelerait
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
      // le message de la box distingue « jeton refuse » d'un bug d'en-tete de notre cote
      message: 'TaHoma local token rejected (Not authenticated.)',
    })
    expect(plugin.health!()).toMatchObject({ status: 'error', detail: expect.stringContaining('Not authenticated.') })
    await plugin.stop()
  })
})
