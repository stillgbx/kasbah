import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import type { SessionStore, StoredSession } from './auth'
import { PetkitAuth } from './auth'
import { FAMILIES, ROSTER, FEEDER_DETAIL, FOUNTAIN_DETAIL, WORK_RECORD } from './__fixtures__/petkit'
import { createPetkitPlugin, petkitConfigSchema } from './index'
import { toDescriptor, toDevices, toDrinkPatch, toFeederPatch, toFountainPatch } from './mapping'

// What the plugin must guarantee against PetKit, which only a private API imposes:
//
//  - SIGN-IN BY CODE: no password exists. A lost session doesn't come back on its own, so it must
//    be extended BEFORE it expires, and only once even when two readings claim it at the same time
//    (two concurrent sign-ins doom the session for the length of its lease — the known bug of the
//    third-party libraries).
//  - THE API ANSWERS HTTP 200 EVEN WHEN IT REFUSES: the failure is in the body.
//  - A FOUNTAIN HAS NO WI-FI: it is reached through a Bluetooth relay, and the link must be closed
//    even when what we wanted to do failed — otherwise the relay (the feeder) stays tied up for the
//    following calls.
//  - A PORTION OUTSIDE THE LIST is refused here rather than letting the vendor round it silently.
//
// The fixtures are BUILT, not captured — the account isn't linked yet. They are labeled as such in
// `__fixtures__/petkit.ts`, and the `GET /raw` route exists to replace them with recorded data at
// the first linking. No real account or device is touched.

const NOW = Date.UTC(2026, 8, 21, 10)
const GATEWAY = 'https://api.eu-pet.com/latest'
const EMAIL = 'animaux@exemple.fr'
const CODE = '483920'
const SESSION = 'session-abc'
const GROUP = '300000001'
const FEEDER = 'd4-400000004'
const FOUNTAIN = 'ctw3-400000002'

const response = (body: unknown, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

/** The poller launches its first reading without awaiting it: the loop has to be left running. */
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)) }

interface FakeOptions {
  /** The API refuses the session (code 5, as HTTP 200). */
  deadSession?: boolean
  /** `ble/ownSupportBleDevices` returns no relay: the fountain is out of range. */
  noRelay?: boolean
  /** The fountain reading fails ONCE the link is open. */
  fountainReadFails?: boolean
  /** Announced lifetime of the session, in seconds. */
  expiresIn?: number
}

function fakePetkit(o: FakeOptions = {}) {
  const calls: { path: string; method: string; form: Record<string, string>; query: Record<string, string> }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const [bare, qs] = url.split('?')
    const path = bare!.replace(`${GATEWAY}/`, '').replace('https://passport.petkt.com/v1/', 'passport/')
    const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')))
    const query = Object.fromEntries(new URLSearchParams(qs ?? ''))
    calls.push({ path, method: init?.method ?? 'GET', form, query })
    // The VERB matters: PetKit serves `regionservers` and `sendcodeforquicklogin` over GET, and
    // refuses a POST. So the fake vendor refuses the same way, otherwise the test would prove nothing.
    if (path === 'passport/regionservers' || path === 'user/sendcodeforquicklogin') {
      if ((init?.method ?? 'GET') !== 'GET') return response({ error: { code: 400, msg: 'method not allowed' } })
    }
    if (path === 'passport/regionservers') return response({ list: [{ id: 'fr', name: 'France', gateway: `${GATEWAY}/` }] })
    if (path === 'user/sendcodeforquicklogin') {
      return query.username ? response({ result: { sent: true } }) : response({ error: { code: 400, msg: 'username required' } })
    }
    if (path === 'user/login') {
      if (form.validCode !== CODE) return response({ error: { code: 122, msg: 'invalid code' } })
      return response({ result: { session: { id: SESSION, expiresIn: o.expiresIn ?? 36 * 3600 } } })
    }
    if (path === 'user/refreshsession') return response({ result: { session: { id: `${SESSION}-r`, expiresIn: o.expiresIn ?? 36 * 3600 } } })
    if (o.deadSession) return response({ error: { code: 5, msg: 'session expired' } })
    if (path === 'group/family/list') return response({ result: FAMILIES })
    if (path === 'discovery/device_roster_v2') {
      // `day` AND `groupId` are required: without them PetKit refuses with "Request is incorrect."
      // (verified on 09/21). The fake vendor refuses the same way, otherwise the test would prove nothing.
      if (!form.day || !form.groupId) return response({ error: { code: 3, msg: 'Request is incorrect.' } })
      return response({ result: ROSTER })
    }
    if (path === 'ble/ownSupportBleDevices') return response({ result: o.noRelay ? [] : [{ deviceId: 400000004, deviceType: 'd4' }] })
    if (path === 'ble/connect') return response({ result: { state: 1 } })
    if (path === 'ble/poll') return response({ result: 1 })
    if (path === 'ble/cancel') return response({ result: 1 })
    if (path === 'ble/controlDevice') return response({ result: 1 })
    if (path === 'd4/device_detail') return response({ result: FEEDER_DETAIL })
    // A fountain answers on `deviceData`, not on `device_detail` (404 verified on 09/21).
    if (path === 'ctw3/device_detail') return response({ error: { code: 404, msg: 'not found' } }, 404)
    if (path === 'ctw3/deviceData') {
      if (o.fountainReadFails) return response({ error: { code: 99, msg: 'device busy' } })
      return response({ result: FOUNTAIN_DETAIL })
    }
    if (path === 'ctw3/getWorkRecord') {
      // three required parameters, including the OWNER: without it, "L'appareil n'a pas été trouvé"
      if (!form.day || !form.deviceId || !form.userId) return response({ error: { code: 703, msg: 'device not found' } })
      return response({ result: WORK_RECORD })
    }
    if (path === 'd4/saveDailyFeed' || path === 'd4/callPet') return response({ result: { ok: 1 } })
    return response({ error: { code: 404, msg: `unexpected ${path}` } }, 404)
  })
  return { fetchImpl, calls }
}

async function setup(o: FakeOptions & { session?: StoredSession | null } = {}) {
  const petkit = fakePetkit(o)
  let saved: StoredSession | null = o.session ?? null
  const sessionStore: SessionStore = {
    load: async () => saved,
    save: async (s) => { saved = s },
    clear: async () => { saved = null },
  }
  const clock = new ManualClock(NOW)
  const plugin = createPetkitPlugin({ fetchImpl: petkit.fetchImpl, sessionStore })
  const ctx: PluginContext = {
    pluginId: 'petkit',
    config: petkitConfigSchema.parse({ PETKIT_GATEWAY: `${GATEWAY}/` }),
    logger: pino({ level: 'silent' }), clock, signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  await plugin.init(ctx)
  const app = Fastify()
  app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/petkit' })
  await app.ready()
  // `opts` is MUTABLE: some cases must make a reading fail AFTER linking, not before — otherwise
  // the Bluetooth address is never learned and the intended scenario doesn't happen.
  return { plugin, app, petkit, ctx, clock, opts: o, store: () => saved }
}

const link = (app: Awaited<ReturnType<typeof setup>>['app'], code = CODE) =>
  app.inject({ method: 'POST', url: '/api/plugins/petkit/login', payload: { email: EMAIL, code } })

const linked = (expiresAt = NOW + 36 * 3600_000): StoredSession =>
  ({ id: SESSION, gateway: `${GATEWAY}/`, createdAt: NOW, expiresAt, account: EMAIL })

describe('PetKit — pairing by code', () => {
  it('requests a code, then exchanges it for a session; neither code nor password survives', async () => {
    const { app, petkit, store } = await setup()
    const asked = await app.inject({ method: 'POST', url: '/api/plugins/petkit/login/code', payload: { email: EMAIL } })
    expect(asked.statusCode).toBe(200)
    // GET, address as a URL PARAMETER: sent as a form POST, PetKit refuses — that's the 502 hit at
    // the first real pairing, on 09/21.
    const ask = petkit.calls.find((c) => c.path === 'user/sendcodeforquicklogin')!
    expect(ask.method).toBe('GET')
    expect(ask.query.username).toBe(EMAIL)

    const r = await link(app)
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ linked: true, account: EMAIL })
    // the token survives, the code doesn't — and there was never a password to lose
    expect(store()).toMatchObject({ id: SESSION })
    expect(JSON.stringify(store())).not.toContain(CODE)
    expect(petkit.calls.find((c) => c.path === 'user/login')?.form.password).toBeUndefined()
  })

  it('resolves the gateway over GET and sends the server IDENTIFIER as the region', async () => {
    // "FR" is used to FIND the server; what PetKit then expects in `region` is that server's id, in
    // lowercase. Confusing the two went unnoticed as long as discovery failed silently (it was
    // called with POST).
    const petkit = fakePetkit()
    const auth = new PetkitAuth({
      passportUrl: 'https://passport.petkt.com/', gateway: null, region: 'FR', timezone: 'Europe/Paris',
      appVersion: '13.2.1', fetchImpl: petkit.fetchImpl, store: null, now: () => NOW,
    })
    await auth.loginWithCode(EMAIL, CODE)
    expect(petkit.calls.find((c) => c.path === 'passport/regionservers')?.method).toBe('GET')
    expect(petkit.calls.find((c) => c.path === 'user/login')?.form.region).toBe('fr')
  })

  it('refuses a wrong code with 401, even though PetKit answered 200', async () => {
    const { app } = await setup()
    const r = await link(app, '000000')
    expect(r.statusCode).toBe(502)
    // Envelope `{ error: { code, message } }`: it's the one the interface can read. With a plain
    // string `error`, the message got lost and the screen only showed an "HTTP 502".
    expect(r.json().error.message).toContain('invalid code')
    expect(r.json().error.code).toBe('UPSTREAM_ERROR')
  })

  it('without a linked account, health says `needs_pairing` and no device is published', async () => {
    const { plugin, ctx } = await setup()
    expect(await plugin.discover()).toEqual([])
    expect(plugin.health!().status).toBe('needs_pairing')
    expect(ctx.emitDevices).not.toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]))
  })
})

describe('PetKit — session', () => {
  it('extends the session ONLY ONCE when two readings claim it at the same time', async () => {
    // The known bug: both see the lease half elapsed, both sign in again, one of the two tokens is
    // stillborn and everything then fails silently until expiry.
    const petkit = fakePetkit()
    const auth = new PetkitAuth({
      passportUrl: 'https://passport.petkt.com/', gateway: `${GATEWAY}/`, region: 'FR', timezone: 'Europe/Paris',
      appVersion: '13.2.1', fetchImpl: petkit.fetchImpl, store: null, now: () => NOW + 30 * 3600_000,
    })
    await auth.loginWithCode(EMAIL, CODE)
    // the sign-in dated the session at `now`: we age it by reloading it from a store
    const aged = new PetkitAuth({
      passportUrl: 'https://passport.petkt.com/', gateway: `${GATEWAY}/`, region: 'FR', timezone: 'Europe/Paris',
      appVersion: '13.2.1', fetchImpl: petkit.fetchImpl, now: () => NOW + 30 * 3600_000,
      store: { load: async () => linked(), save: async () => {}, clear: async () => {} },
    })
    await aged.restore()
    await Promise.all([aged.ensureFresh(), aged.ensureFresh(), aged.ensureFresh()])
    expect(petkit.calls.filter((c) => c.path === 'user/refreshsession')).toHaveLength(1)
  })

  it('does not extend a session that is still young', async () => {
    const petkit = fakePetkit()
    const auth = new PetkitAuth({
      passportUrl: 'https://passport.petkt.com/', gateway: `${GATEWAY}/`, region: 'FR', timezone: 'Europe/Paris',
      appVersion: '13.2.1', fetchImpl: petkit.fetchImpl, now: () => NOW,
      store: { load: async () => linked(), save: async () => {}, clear: async () => {} },
    })
    await auth.restore()
    await auth.ensureFresh()
    expect(petkit.calls.filter((c) => c.path === 'user/refreshsession')).toHaveLength(0)
  })

  it('a refused session is DISCARDED: the Settings card will ask for a code again', async () => {
    const { plugin, app, store } = await setup({ deadSession: true, session: linked() })
    await plugin.discover()
    await flush()
    expect(store()).toBeNull()
    expect((await app.inject({ method: 'GET', url: '/api/plugins/petkit/status' })).json()).toMatchObject({ linked: false })
  })

  it('does not pick up an already expired session at startup', async () => {
    const { plugin } = await setup({ session: linked(NOW - 1000) })
    expect(plugin.health!().status).toBe('needs_pairing')
  })
})

describe('PetKit — inventory and mapping', () => {
  it('publishes a feeder and a fountain, and ignores unknown models', async () => {
    const devices = toDevices(ROSTER, GROUP)
    expect(devices.map((d) => d.externalId)).toEqual([FEEDER, FOUNTAIN, 'd4-400000003', 'ctw3-400000001'])
    expect(devices.map((d) => d.kind)).toEqual(['pet_feeder', 'pet_fountain', 'pet_feeder', 'pet_fountain'])
    // the group identifier comes from the CALLER: the roster is requested group by group and the
    // device doesn't repeat its own — without this, no Bluetooth relay could be found
    expect(devices.every((d) => d.groupId === GROUP)).toBe(true)
  })

  it('requests the FAMILIES before the inventory, and one roster per group', async () => {
    // PetKit exposes no "whole account" view: without `group/family/list` first, then a roster
    // carrying `day` and `groupId`, the answer is "Request is incorrect. (code 3)".
    const { plugin, app, petkit } = await setup({ session: linked() })
    await link(app)
    petkit.calls.length = 0
    await plugin.discover()
    expect(petkit.calls.some((c) => c.path === 'group/family/list')).toBe(true)
    const roster = petkit.calls.find((c) => c.path === 'discovery/device_roster_v2')!
    expect(roster.form.groupId).toBe(GROUP)
    expect(roster.form.day).toBe('20260921')
  })

  it('counts the animal VISITS, for lack of being able to measure a volume', async () => {
    // An Eversweet Max returns -1 for the water dispensed but keeps the log of its visits: that's
    // what `water_usage` carries here, not milliliters.
    const fountain = toDevices(ROSTER, GROUP).find((d) => d.kind === 'pet_fountain')!
    expect(toDescriptor(fountain).capabilities).toContain('water_usage')
    expect(toDrinkPatch(WORK_RECORD)).toEqual({ drinksToday: 2, drinkAvgS: 26 })
    // no visit: the count is 0 and the average CLEARED, not 0 s ("came without drinking")
    expect(toDrinkPatch([])).toEqual({ drinksToday: 0, drinkAvgS: null })
  })

  it('declares `feed` with the MODEL portions, never an invented range', async () => {
    const [feeder] = toDevices(ROSTER, GROUP)
    const d = toDescriptor(feeder!)
    expect(d.capabilities).toContain('feed')
    // in CUPS, not grams: the machine declares `factor: 10`, its 10..50 are tenths
    expect(d.meta.petFeeder).toEqual({ portions: [1, 2, 3, 4, 5], unit: 'cup' })
    expect(d.meta.model).toBe('Fresh Element Solo')
  })

  it('does NOT declare `feed` for a model whose portions are unknown', async () => {
    const unknownModel = toDevices({ devices: [{ id: 9, type: 'd4s', name: 'Gemini' }] }, GROUP)
    // `d4s` is a feeder, but with two hoppers: its portions are not grams, and offering wrong
    // buttons would be worse than offering nothing.
    expect(unknownModel).toHaveLength(0)
  })

  it('translates a feeder state without inventing what it does not say', async () => {
    const patch = toFeederPatch(FEEDER_DETAIL, 'd4', NOW)
    // raw 30 and 50 become 3 and 5 tenths of a cup — the factor comes from the machine
    expect(patch).toMatchObject({ foodLow: false, servedToday: 3, plannedToday: 5, desiccantDays: 0, feeding: false })
    // This model has no weighing tray: it does NOT say what was eaten. The line stays empty rather
    // than copying the served amount under another name.
    expect(patch.eatenToday).toBeUndefined()
    // mains-powered machine without batteries (`batteryPower: 0`): absent, and above all not "0 %"
    expect(patch.batteryPct).toBeUndefined()
    // resolved error: `null` CLEARS, otherwise an old message would stay stuck on the card
    expect(patch.errorMessage).toBeNull()
  })

  it('translates a fountain state and DATES the reading', async () => {
    const patch = toFountainPatch(FOUNTAIN_DETAIL, NOW)
    // `on` comes from `status.powerStatus` and not from the top level: read from the wrong place,
    // the fountain would look permanently off.
    expect(patch).toMatchObject({ on: true, mode: 'intermittent', filterPct: 0, waterLow: false, batteryPct: 100 })
    // -1 = "not counted": cleared (null), never brought to zero — "0 mL drunk" would be a lie.
    expect(patch.todayMl).toBeNull()
    expect(patch.filterDays).toBeNull()
    expect(patch.syncedAt).toBe(Date.parse('2026-09-21T06:35:36.860+0000'))
  })

  it('without a sync date, the reading is dated NOW rather than left unknown', async () => {
    const patch = toFountainPatch({ ...FOUNTAIN_DETAIL, syncTime: undefined, updateAt: undefined }, NOW)
    expect(patch.syncedAt).toBe(NOW)
  })
})

describe('PetKit — commands', () => {
  it('serves a portion then RE-READS: the vendor acknowledgment does not prove the portion dropped', async () => {
    const { plugin, app, petkit, ctx } = await setup({ session: linked() })
    await link(app)
    await plugin.discover()
    petkit.calls.length = 0
    await plugin.execute(FEEDER, { type: 'pet_feeder.feed', amount: 2 })
    const feed = petkit.calls.find((c) => c.path === 'd4/saveDailyFeed')
    // the user asks for 2 tenths of a cup, the machine receives 20: the conversion is here
    expect(feed?.form).toMatchObject({ amount: '20', deviceId: '400000004', day: '20260921' })
    expect(petkit.calls.some((c) => c.path === 'd4/device_detail')).toBe(true)
    expect(ctx.emitState).toHaveBeenCalledWith(FEEDER, expect.objectContaining({ servedToday: 3 }))
  })

  it('refuses a portion the model does not accept, instead of letting it be rounded', async () => {
    const { plugin, app, petkit } = await setup({ session: linked() })
    await link(app)
    await plugin.discover()
    petkit.calls.length = 0
    await expect(plugin.execute(FEEDER, { type: 'pet_feeder.feed', amount: 2.5 })).rejects.toThrow(/1, 2, 3, 4, 5 cup/)
    expect(petkit.calls.some((c) => c.path === 'd4/saveDailyFeed')).toBe(false)
  })

  it('drives the fountain through a relay: connection, frame, re-read, close', async () => {
    const { plugin, app, petkit } = await setup({ session: linked() })
    await link(app)
    await plugin.discover()
    petkit.calls.length = 0
    await plugin.execute(FOUNTAIN, { type: 'pet_fountain.set_mode', mode: 'continuous' })
    expect(petkit.calls.map((c) => c.path)).toEqual([
      'ble/ownSupportBleDevices', 'ble/connect', 'ble/poll', 'ble/controlDevice', 'ctw3/deviceData', 'ble/cancel',
    ])
    const frame = petkit.calls.find((c) => c.path === 'ble/controlDevice')!
    const bytes = [...Buffer.from(decodeURIComponent(frame.form.data!), 'base64')]
    // Frame MEASURED on the real fountain: header, code 220, counter, length, on/off, then the mode
    // REPEATED TWICE. It's this last byte that the reference library's table had wrong — its frame
    // was acknowledged "1" and changed nothing.
    expect(bytes).toEqual([250, 252, 253, 220, 1, 1, 3, 0, 1, 1, 1, 251])
    expect(frame.form.cmd).toBe('220')
  })

  it('SWITCHING OFF the pump does not change its mode along the way', async () => {
    // On/off and mode travel in the same frame: freezing one would flip the other behind the
    // user's back — a fountain set to intermittent would go back to continuous at every stop.
    const { plugin, app, petkit } = await setup({ session: linked() })
    await link(app)
    await plugin.discover()
    petkit.calls.length = 0
    await plugin.execute(FOUNTAIN, { type: 'pet_fountain.set_power', on: false })
    const bytes = [...Buffer.from(decodeURIComponent(petkit.calls.find((c) => c.path === 'ble/controlDevice')!.form.data!), 'base64')]
    // on = 0, and the mode STAYS 2 (intermittent), the one the capture carries. Verified on the real
    // fountain: `powerStatus` goes to 0, `mode` doesn't move, restarting goes back to 1.
    expect(bytes.slice(-4)).toEqual([0, 2, 2, 251])
  })

  it('CLOSES the link even when what we wanted to do fails', async () => {
    // Without this, the relay — that is, the feeder — would stay tied up for what follows.
    const { plugin, app, petkit, opts } = await setup({ session: linked() })
    await link(app)
    await plugin.discover()
    // the fountain only fails AFTER having been read once: otherwise we wouldn't know its Bluetooth
    // address, and the command would fail before even opening a link
    opts.fountainReadFails = true
    petkit.calls.length = 0
    await expect(plugin.execute(FOUNTAIN, { type: 'pet_fountain.set_power', on: false })).rejects.toThrow()
    expect(petkit.calls.some((c) => c.path === 'ble/cancel')).toBe(true)
  })

  it('a fountain out of range DEGRADES, it does not bring the plugin down', async () => {
    const { plugin, app } = await setup({ session: linked(), noRelay: true })
    await link(app)
    await plugin.discover()
    await expect(plugin.execute(FOUNTAIN, { type: 'pet_fountain.set_power', on: true })).rejects.toThrow(/relay/)
    const r = await app.inject({ method: 'GET', url: '/api/plugins/petkit/status' })
    expect(r.json().linked).toBe(true)
  })
})
