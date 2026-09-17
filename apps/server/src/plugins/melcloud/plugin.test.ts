import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { DEVICE_GET, ENERGY_REPORT_SEPTEMBER, LIST_DEVICES } from './__fixtures__/melcloud'
import type { SessionStore, StoredSession } from './auth'
import { createMelcloudPlugin, melcloudConfigSchema } from './index'

// Ce que le plugin doit tenir face à MELCloud, et que seule une API privée impose :
//
//  - MELCLOUD RÉPOND EN HTTP 200 MÊME QUAND IL REFUSE. Un mot de passe faux arrive en 200 avec un
//    `ErrorId` dans le corps — le même piège que Gigya chez Renault, et la raison d'être de la
//    moitié des cas ci-dessous.
//  - Le MOT DE PASSE ne doit rien laisser derrière lui : ni dans le cache de session, ni ailleurs.
//  - Une clé de session REFUSÉE (401) ne se rafraîchit pas : il n'y a pas de jeton de
//    renouvellement. Elle doit être jetée, pour que la carte des Réglages redemande le mot de passe
//    au lieu de laisser le plugin marteler une clé morte.
//  - Le plugin publie UNE ZONE, pas une machine : l'installation de référence a trois Zubadan en
//    cascade derrière un seul régulateur, que MELCloud montre comme un appareil à deux zones.
//
// Le faux fabricant rejoue la CAPTURE (`__fixtures__/melcloud.ts`), pas une réponse reconstruite :
// un test qui valide une hypothèse déguisée en preuve ne prouve rien (leçon COMAP).
// Aucun compte ni machine réelle n'est touché.

const NOW = Date.UTC(2026, 8, 17, 10)
const BASE = 'https://app.melcloud.com/Mitsubishi.Wifi.Client'
const CONTEXT_KEY = 'context-key-abc'
const PASSWORD = 'un-mot-de-passe-qui-ne-doit-pas-fuir'
const EMAIL = 'moi@exemple.fr'
/** L'identifiant de la machine dans la capture anonymisée, et les deux zones qu'elle publie. */
const UNIT = '111111'
const Z1 = `${UNIT}-z1`
const Z2 = `${UNIT}-z2`

const response = (body: unknown, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

/** Le poller lance sa première lecture sans l'attendre : il faut laisser tourner la boucle. */
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)) }

/** Faux MELCloud, piloté par un état mutable. Tout sort en 200, y compris les refus. */
function fakeMelcloud(over: { loginError?: number; rejectKey?: boolean; deviceFails?: string; listFails?: boolean } = {}) {
  const calls: { method: string; path: string }[] = []
  const world = { list: LIST_DEVICES as unknown }
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const path = url.slice(BASE.length).split('?')[0]!
    const query = new URL(url).searchParams
    calls.push({ method, path })

    if (path === '/Login/ClientLogin') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { Password?: string }
      // le refus arrive en HTTP 200 : c'est `ErrorId` qui tranche, jamais le statut
      if (over.loginError !== undefined) return response({ ErrorId: over.loginError, LoginData: null })
      if (body.Password !== PASSWORD) return response({ ErrorId: 1, LoginData: null })
      return response({ ErrorId: null, LoginData: { ContextKey: CONTEXT_KEY, Name: 'Compte de démonstration' } })
    }

    if (over.rejectKey || headers['X-MitsContextKey'] !== CONTEXT_KEY) return response({ ErrorId: 5 }, 401)

    if (path === '/User/ListDevices') {
      if (over.listFails) return response({ error: 'boom' }, 500)
      return response(world.list)
    }
    if (path === '/Device/Get') {
      if (over.deviceFails === query.get('id')) return response({ error: 'boom' }, 500)
      return response(DEVICE_GET)
    }
    if (path === '/EnergyCost/Report') return response(ENERGY_REPORT_SEPTEMBER)
    return response({ ErrorId: 404 }, 404)
  })
  return { calls, fetchImpl, world }
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

async function setup(over: { session?: StoredSession | null; loginError?: number; rejectKey?: boolean; deviceFails?: string; listFails?: boolean } = {}) {
  const melcloud = fakeMelcloud({
    ...(over.loginError !== undefined ? { loginError: over.loginError } : {}),
    ...(over.rejectKey !== undefined ? { rejectKey: over.rejectKey } : {}),
    ...(over.deviceFails !== undefined ? { deviceFails: over.deviceFails } : {}),
    ...(over.listFails !== undefined ? { listFails: over.listFails } : {}),
  })
  const sessionStore = memoryStore(over.session ?? null)
  const clock = new ManualClock(NOW)
  const plugin = createMelcloudPlugin({ fetchImpl: melcloud.fetchImpl, sessionStore })
  const ctx: PluginContext = {
    pluginId: 'melcloud',
    config: melcloudConfigSchema.parse({}),
    logger: pino({ level: 'silent' }), clock, signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  await plugin.init(ctx)
  const app = Fastify()
  app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/melcloud' })
  await app.ready()
  return { plugin, app, melcloud, sessionStore, ctx, clock }
}

const login = (app: Awaited<ReturnType<typeof setup>>['app'], password = PASSWORD) =>
  app.inject({ method: 'POST', url: '/api/plugins/melcloud/login', payload: { email: EMAIL, password } })

const linked: StoredSession = { contextKey: CONTEXT_KEY, name: 'Compte de démonstration' }

describe('MELCloud — liaison du compte', () => {
  it('relie le compte et ne garde que la clé de session, jamais le mot de passe', async () => {
    const { app, sessionStore } = await setup()
    const r = await login(app)
    expect(r.statusCode).toBe(200)
    expect(sessionStore.value).toEqual(linked)
    expect(JSON.stringify(sessionStore.value)).not.toContain(PASSWORD)
    expect(r.json().devices).toEqual([{ deviceId: UNIT, name: 'Chauffage', family: 'atw', buildingName: 'Maison' }])
  })

  it('refuse un mot de passe faux, que MELCloud rend pourtant en HTTP 200', async () => {
    const { app, sessionStore } = await setup()
    const r = await login(app, 'pas-le-bon')
    expect(r.statusCode).toBe(401)
    expect(sessionStore.value).toBeNull()
  })

  it('distingue un refus d’identifiants d’une panne du fabricant', async () => {
    const { app } = await setup({ loginError: 42 })
    expect((await login(app)).statusCode).toBe(502)
  })

  it('délier efface la clé de session et retire les zones de la maison', async () => {
    const { app, sessionStore, ctx } = await setup()
    await login(app)
    const r = await app.inject({ method: 'POST', url: '/api/plugins/melcloud/logout' })
    expect(r.statusCode).toBe(200)
    expect(sessionStore.value).toBeNull()
    expect(r.json().linked).toBe(false)
    expect(ctx.emitDevices).toHaveBeenLastCalledWith([])
  })

  it('jette une clé de session que MELCloud refuse, plutôt que de la marteler', async () => {
    const { plugin, sessionStore } = await setup({ session: linked, rejectKey: true })
    await plugin.start()
    await flush()
    // la clé est morte et rien ne peut la renouveler : le compte redevient « à relier »
    expect(sessionStore.value).toBeNull()
    expect(plugin.health!().status).toBe('needs_pairing')
  })
})

describe('MELCloud — ce que le plugin publie', () => {
  it('publie DEUX zones pour UNE machine (trois Zubadan en cascade)', async () => {
    const { plugin, ctx } = await setup({ session: linked })
    await plugin.start()
    await flush()
    const published = (ctx.emitDevices as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]
    expect(published.map((d: { id: string }) => d.id)).toEqual([`melcloud:${Z1}`, `melcloud:${Z2}`])
    expect(plugin.health!().detail).toContain('2 zone(s) on 1 unit(s)')
  })

  it('publie l’état de chaque zone avec ses vraies valeurs', async () => {
    const { plugin, ctx } = await setup({ session: linked })
    await plugin.start()
    await flush()
    expect(ctx.emitState).toHaveBeenCalledWith(Z1, expect.objectContaining({ currentTempC: 23, targetTempC: 19.5, action: 'idle' }))
    // la zone sans sonde d'ambiance publie son eau de départ, jamais la sentinelle -39
    expect(ctx.emitState).toHaveBeenCalledWith(Z2, expect.objectContaining({ currentTempC: 20, targetTempC: 45 }))
  })

  /** Le registre ne doit pas battre : redire les mêmes descripteurs toutes les deux minutes serait gratuit. */
  it('ne republie les appareils que lorsqu’ils changent', async () => {
    const { plugin, ctx, clock, melcloud } = await setup({ session: linked })
    await plugin.start()
    await flush()
    expect(ctx.emitDevices).toHaveBeenCalledTimes(1)

    clock.advance(120_000)
    await flush()
    expect(ctx.emitDevices).toHaveBeenCalledTimes(1)   // même machine, même zones

    // la zone 2 repasse en ambiante : `meta.climate.control` change, l'UI doit le savoir
    const flipped = JSON.parse(JSON.stringify(melcloud.world.list)) as { Structure: { Devices: { Device: Record<string, unknown> }[] } }[]
    Object.assign(flipped[0]!.Structure.Devices[0]!.Device, { Zone2InRoomMode: true, RoomTemperatureZone2: 21 })
    melcloud.world.list = flipped
    clock.advance(120_000)
    await flush()
    expect(ctx.emitDevices).toHaveBeenCalledTimes(2)
  })

  it('ne connaît aucun appareil avant sa première lecture, et les redit ensuite', async () => {
    const { plugin } = await setup({ session: linked })
    expect(await plugin.discover()).toEqual([])   // aucun appel réseau dans discover
    await plugin.start()
    await flush()
    expect(await plugin.discover()).toHaveLength(2)
  })

  it('oublie ce qu’il a publié quand l’hôte le redémarre sans le réinstancier', async () => {
    const { plugin, ctx } = await setup({ session: linked })
    await plugin.start()
    await flush()
    await plugin.stop()
    await plugin.init(ctx)
    expect(await plugin.discover()).toEqual([])
    expect(plugin.health!().detail).toContain('0 zone(s)')
  })

  it('refuse toute commande : le plugin est en lecture seule', async () => {
    const { plugin } = await setup({ session: linked })
    await expect(plugin.execute(Z1, { type: 'climate.set_mode', mode: 'heat' })).rejects.toThrow(/read-only/i)
  })

  it('reste démarrable quand MELCloud ne répond pas', async () => {
    const { plugin } = await setup({ session: linked, listFails: true })
    await expect(plugin.start()).resolves.toBeUndefined()
    await flush()
    expect(plugin.health!().deviceCount).toBe(0)
  })
})

describe('MELCloud — l’état machine servi à la vue Chauffage', () => {
  it('rend la dernière lecture du sondage, sans rappeler le fabricant', async () => {
    const { plugin, app, melcloud } = await setup({ session: linked })
    await plugin.start()
    await flush()
    const before = melcloud.calls.length
    const r = await app.inject({ method: 'GET', url: '/api/plugins/melcloud/system' })
    expect(r.statusCode).toBe(200)
    expect(melcloud.calls.length).toBe(before)   // aucun appel de plus
    expect(r.json().units[0]).toMatchObject({ name: 'Chauffage', power: true, outdoorTempC: 22, energyMeter: false })
    expect(r.json().units[0].error).toMatchObject({ hasError: false, code: 8000 })
  })

  it('refuse tant qu’aucun compte n’est relié', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/api/plugins/melcloud/system' })).statusCode).toBe(409)
  })
})

describe('MELCloud — relevé brut', () => {
  it('rend la liste, le détail et le relevé d’énergie de chaque machine', async () => {
    const { app } = await setup({ session: linked })
    const body = (await app.inject({ method: 'GET', url: '/api/plugins/melcloud/raw' })).json()
    expect(body.devices).toHaveLength(1)
    expect(body.details[0]).toMatchObject({ deviceId: UNIT, ok: true })
    expect(body.reports[0]).toMatchObject({ deviceId: UNIT, ok: true })
  })

  it('accepte une fenêtre de relevé, seule façon de trancher l’absence de compteur', async () => {
    const { app } = await setup({ session: linked })
    const body = (await app.inject({ method: 'GET', url: '/api/plugins/melcloud/raw?from=2026-01-15&to=2026-02-15' })).json()
    expect(body.reports[0]).toMatchObject({ from: '2026-01-15T00:00:00', to: '2026-02-15T00:00:00' })
  })

  it('rend l’échec d’une machine au lieu de perdre la capture', async () => {
    const { app } = await setup({ session: linked, deviceFails: UNIT })
    const body = (await app.inject({ method: 'GET', url: '/api/plugins/melcloud/raw' })).json()
    expect(body.details[0]).toMatchObject({ deviceId: UNIT, ok: false })
    expect(body.reports[0]).toMatchObject({ ok: true })   // le relevé d'énergie, lui, a répondu
  })

  it('refuse la capture tant qu’aucun compte n’est relié', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/api/plugins/melcloud/raw' })).statusCode).toBe(409)
  })
})
