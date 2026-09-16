import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ManualClock } from '@kasbah/mock-sim'
import { serverMessageSchema, type ServerMessage } from '@kasbah/shared'
import pino from 'pino'
import WebSocket from 'ws'
import { buildApp, type KasbahApp } from '../src/app'
import { loadEnv } from '../src/config/env'

const HOUSE = resolve(import.meta.dirname, '../../../house/demo-house.json')
const MONDAY = Date.UTC(2026, 8, 7, 12)

async function makeApp(scenario: string, extraEnv: Record<string, string> = {}, houseFile = HOUSE) {
  const clock = new ManualClock(MONDAY)
  // quels plugins tournent vient de la MAISON : demo-house.json n'a pas de section `plugins`,
  // donc le defaut du schema s'applique (mock seul, tous ses kinds)
  const env = loadEnv({ KASBAH_HOUSE_FILE: houseFile, KASBAH_LOG_LEVEL: 'silent' })
  const kasbah = await buildApp({
    env, logger: pino({ level: 'silent' }), clock, serveStatic: false,
    envSource: { MOCK_SCENARIO: scenario, MOCK_SEED: '3', MOCK_START_TIME: new Date(MONDAY).toISOString(), ...extraEnv },
  })
  await kasbah.app.ready()
  await kasbah.startPlugins()
  return { kasbah, clock }
}

// La simulation doit pouvoir COMPLETER un parc reel au lieu de le doubler : des qu'un vrai plugin
// couvre un kind, ses equivalents simules n'ont plus a encombrer les listes en « hors plan ». Le
// choix se fait dans l'UI (sous-items du plugin) et s'ecrit dans house.json.
describe('sous-items du plugin mock', () => {
  async function withTempHouse(fn: (kasbah: KasbahApp, file: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-plugins-'))
    const file = join(dir, 'house.json')
    await copyFile(HOUSE, file)
    const { kasbah } = await makeApp('default', {}, file)
    try { await fn(kasbah, file) } finally { await kasbah.close(); await rm(dir, { recursive: true, force: true }) }
  }

  const kindsOf = async (kasbah: KasbahApp) => {
    const { devices } = (await kasbah.app.inject({ method: 'GET', url: '/api/devices' })).json()
    return new Set<string>(devices.map((e: { descriptor: { kind: string } }) => e.descriptor.kind))
  }

  it('decocher un kind le retire a chaud, garde les autres, et l ecrit dans la maison', async () => {
    await withTempHouse(async (kasbah, file) => {
      expect(await kindsOf(kasbah)).toContain('light')
      const r = await kasbah.app.inject({ method: 'PATCH', url: '/api/plugins/mock', payload: { parts: { light: false, cover: false } } })
      expect(r.statusCode).toBe(200)
      const mock = r.json().plugins.find((p: { id: string }) => p.id === 'mock')
      expect(mock.parts.find((p: { id: string }) => p.id === 'light')).toEqual({ id: 'light', labelKey: 'kinds.light', enabled: false })
      expect(mock.parts.find((p: { id: string }) => p.id === 'vehicle').enabled).toBe(true)

      const kinds = await kindsOf(kasbah)                  // redemarrage du plugin, sans redemarrer le serveur
      expect(kinds.has('light')).toBe(false)
      expect(kinds.has('cover')).toBe(false)
      expect(kinds.has('vehicle')).toBe(true)              // non traite par un vrai plugin : conserve
      expect(kinds.has('energy')).toBe(true)

      const health = (await kasbah.app.inject({ method: 'GET', url: '/api/health' })).json()
      expect(health.plugins.mock.status).toBe('ok')
      expect(health.plugins.mock.detail).toContain('sans light/cover')

      const written = JSON.parse(await readFile(file, 'utf8'))
      expect(written.plugins.mock).toMatchObject({ enabled: true, parts: { light: false, cover: false } })
    })
  })

  it('sans reglage, la maison muette simule tout', async () => {
    const { kasbah } = await makeApp('default')
    try {
      const kinds = await kindsOf(kasbah)
      expect(kinds.has('light')).toBe(true)
      expect(kinds.has('cover')).toBe(true)
    } finally { await kasbah.close() }
  })
})

// Activer / desactiver un fabricant depuis les Reglages : le choix vit dans house.json et prend
// effet tout de suite, sans redemarrer le serveur.
describe('activation des plugins (GET /api/plugins, PATCH /api/plugins/:id)', () => {
  it('liste TOUS les plugins declares, allume et eteint a chaud, refuse un id inconnu', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-plugins-'))
    const file = join(dir, 'house.json')
    await copyFile(HOUSE, file)
    const { kasbah } = await makeApp('default', {}, file)
    try {
      const list = (await kasbah.app.inject({ method: 'GET', url: '/api/plugins' })).json().plugins
      const byId = Object.fromEntries(list.map((p: { id: string }) => [p.id, p]))
      expect(Object.keys(byId).length).toBeGreaterThan(5)          // tous disponibles, pas seulement les actifs
      expect(byId.mock).toMatchObject({ enabled: true, implemented: true })
      expect(byId.melcloud).toMatchObject({ enabled: false, implemented: false }) // squelette : pas activable
      expect(byId.mock.parts).toHaveLength(12)              // un par kind simulé (tous sauf `camera`)

      // eteindre la simulation : ses appareils quittent le registre
      expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/plugins/mock', payload: { enabled: false } })).statusCode).toBe(200)
      expect((await kasbah.app.inject({ method: 'GET', url: '/api/devices' })).json().devices).toHaveLength(0)
      const off = (await kasbah.app.inject({ method: 'GET', url: '/api/health' })).json()
      expect(off.plugins.mock.status).toBe('disabled')
      expect((await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:cover-living/command', payload: { type: 'cover.close' } })).statusCode).toBe(404)

      // et la rallumer les fait revenir
      expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/plugins/mock', payload: { enabled: true } })).statusCode).toBe(200)
      expect((await kasbah.app.inject({ method: 'GET', url: '/api/devices' })).json().devices.length).toBeGreaterThan(15)

      // un squelette coche reste eteint : il n'y a rien a demarrer
      await kasbah.app.inject({ method: 'PATCH', url: '/api/plugins/melcloud', payload: { enabled: true } })
      const health = (await kasbah.app.inject({ method: 'GET', url: '/api/health' })).json()
      expect(health.plugins.melcloud.status).toBe('not_implemented')

      expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/plugins/nope', payload: { enabled: true } })).statusCode).toBe(404)
      expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/plugins/mock', payload: { enabled: 'oui' } })).json().error.code).toBe('INVALID_BODY')
    } finally {
      await kasbah.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('REST API', () => {
  let kasbah: KasbahApp
  beforeAll(async () => { ({ kasbah } = await makeApp('default')) })
  afterAll(async () => { await kasbah.close() })

  it('health lists plugins with status', async () => {
    const r = await kasbah.app.inject({ method: 'GET', url: '/api/health' })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(body.plugins.mock.status).toBe('ok')
    expect(body.plugins.mock.deviceCount).toBeGreaterThan(15)
    expect(body.plugins.melcloud.status).toBe('not_implemented')
  })
  it('serves the validated house', async () => {
    const r = await kasbah.app.inject({ method: 'GET', url: '/api/house' })
    expect(r.statusCode).toBe(200)
    expect(r.json().name).toBe('Maison démo')
    expect(r.json().rooms[0].kind).toBe('corridor')   // défauts zod appliqués
  })
  it('lists devices with available states', async () => {
    const r = await kasbah.app.inject({ method: 'GET', url: '/api/devices' })
    const { devices } = r.json()
    const cover = devices.find((d: { descriptor: { id: string } }) => d.descriptor.id === 'mock:cover-living')
    expect(cover.state).toMatchObject({ kind: 'cover', available: true, position: 100, motion: 'stopped' })
  })
  it('executes a command and reflects the new state', async () => {
    const r = await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:cover-living/command', payload: { type: 'cover.close' } })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ ok: true })
    const after = await kasbah.app.inject({ method: 'GET', url: '/api/devices/mock:cover-living' })
    expect(after.json().state.motion).toBe('closing')
  })
  it('maps errors to status codes', async () => {
    expect((await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:nope/command', payload: { type: 'cover.close' } })).statusCode).toBe(404)
    const bad = await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:cover-living/command', payload: { type: 'nope' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe('INVALID_BODY')
    const mismatch = await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:cover-living/command', payload: { type: 'light.set', on: true } })
    expect(mismatch.statusCode).toBe(400)
    expect(mismatch.json().error.code).toBe('KIND_MISMATCH')
    const unsupported = await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:cover-living/command', payload: { type: 'cover.set_tilt', tilt: 10 } })
    expect(unsupported.statusCode).toBe(400)
    expect(unsupported.json().error.code).toBe('UNSUPPORTED_COMMAND')
  })
})

describe('plugin scenes (GET /api/scenes, POST /api/scenes/:id/recall)', () => {
  it('lists the registered scenes and refuses impossible recalls', async () => {
    const { kasbah } = await makeApp('default')
    try {
      // le plugin mock n'a pas de scènes : on en injecte pour exercer les routes
      kasbah.scenes.register('mock', [
        { id: 'mock:s1', pluginId: 'mock', externalId: 's1', name: 'Soirée', group: { name: 'Salon', kind: 'room' }, dynamic: false, autoDynamic: false, swatches: ['#ff8800'] },
      ])
      const list = await kasbah.app.inject({ method: 'GET', url: '/api/scenes' })
      expect(list.statusCode).toBe(200)
      expect(list.json().scenes).toEqual([
        { scene: { id: 'mock:s1', pluginId: 'mock', externalId: 's1', name: 'Soirée', group: { name: 'Salon', kind: 'room' }, dynamic: false, autoDynamic: false, swatches: ['#ff8800'] },
          state: { active: 'inactive', updatedAt: MONDAY } },
      ])

      expect((await kasbah.app.inject({ method: 'POST', url: '/api/scenes/mock:nope/recall', payload: {} })).statusCode).toBe(404)
      const notDynamic = await kasbah.app.inject({ method: 'POST', url: '/api/scenes/mock:s1/recall', payload: { mode: 'dynamic' } })
      expect(notDynamic.statusCode).toBe(400)
      expect(notDynamic.json().error.code).toBe('UNSUPPORTED_COMMAND')
      // le plugin mock n'implémente ni recallScene ni updateScene
      const noRecall = await kasbah.app.inject({ method: 'POST', url: '/api/scenes/mock:s1/recall', payload: {} })
      expect(noRecall.statusCode).toBe(501)
      expect(noRecall.json().error.code).toBe('NOT_IMPLEMENTED')

      // PATCH : le réglage « démarrer animée » n'a pas de sens sans palette animée
      const notAnimated = await kasbah.app.inject({ method: 'PATCH', url: '/api/scenes/mock:s1', payload: { autoDynamic: true } })
      expect(notAnimated.statusCode).toBe(400)
      expect(notAnimated.json().error.code).toBe('UNSUPPORTED_COMMAND')
      expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/scenes/mock:nope', payload: { autoDynamic: false } })).statusCode).toBe(404)
      expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/scenes/mock:s1', payload: {} })).json().error.code).toBe('INVALID_BODY')

      // POST /api/scenes : source inconnue, corps invalide, plugin incapable de créer
      expect((await kasbah.app.inject({ method: 'POST', url: '/api/scenes', payload: { fromSceneId: 'mock:nope', groupName: 'Salon' } })).statusCode).toBe(404)
      expect((await kasbah.app.inject({ method: 'POST', url: '/api/scenes', payload: { fromSceneId: 'mock:s1' } })).json().error.code).toBe('INVALID_BODY')
      const cannotCreate = await kasbah.app.inject({ method: 'POST', url: '/api/scenes', payload: { fromSceneId: 'mock:s1', groupName: 'Cuisine' } })
      expect(cannotCreate.statusCode).toBe(501)

      // DELETE /api/scenes/:id : scène inconnue, puis plugin incapable de supprimer
      expect((await kasbah.app.inject({ method: 'DELETE', url: '/api/scenes/mock:nope' })).statusCode).toBe(404)
      const cannotDelete = await kasbah.app.inject({ method: 'DELETE', url: '/api/scenes/mock:s1' })
      expect(cannotDelete.statusCode).toBe(501)
      expect(cannotDelete.json().error.code).toBe('NOT_IMPLEMENTED')
      const readOnly = await kasbah.app.inject({ method: 'PATCH', url: '/api/scenes/mock:s1', payload: { autoDynamic: false } })
      expect(readOnly.statusCode).toBe(501)
    } finally {
      await kasbah.close()
    }
  })
})

describe('chaos scenario error mapping', () => {
  it('surfaces upstream failures as 502', async () => {
    const { kasbah } = await makeApp('chaos')
    const codes = new Set<number>()
    for (let i = 0; i < 40 && !codes.has(502); i++) {
      const r = await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:light-kitchen/command', payload: { type: 'light.set', on: i % 2 === 0 } })
      codes.add(r.statusCode)
    }
    expect(codes.has(502)).toBe(true)
    await kasbah.close()
  })
})

describe('WebSocket hub', () => {
  it('sends a snapshot, then coalesced full states after a command', async () => {
    const { kasbah, clock } = await makeApp('default')
    const address = await kasbah.app.listen({ port: 0, host: '127.0.0.1' })
    const ws = new WebSocket(`${address.replace('http', 'ws')}/ws`)
    // file de messages posée AVANT `open` : le snapshot peut arriver dans le même tick que l'ouverture
    const queue: ServerMessage[] = []
    const waiters: ((m: ServerMessage) => void)[] = []
    ws.on('message', (d) => {
      const m = serverMessageSchema.parse(JSON.parse(d.toString()))
      const w = waiters.shift()
      if (w) w(m); else queue.push(m)
    })
    const next = () => new Promise<ServerMessage>((resolve) => { const m = queue.shift(); if (m) resolve(m); else waiters.push(resolve) })
    await new Promise((r) => ws.once('open', r))
    const snapshot = await next()
    expect(snapshot.type).toBe('snapshot')
    if (snapshot.type === 'snapshot') expect(snapshot.devices.length).toBeGreaterThan(15)

    const waitState = next()
    await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:light-living/command', payload: { type: 'light.set', on: true, brightness: 30 } })
    await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:light-living/command', payload: { type: 'light.set', brightness: 60 } })
    clock.advance(50)                                   // fenêtre de coalescence
    const state = await waitState
    expect(state.type).toBe('state')
    if (state.type === 'state') {
      expect(state.deviceId).toBe('mock:light-living')
      expect(state.state).toMatchObject({ kind: 'light', on: true, brightness: 60 })   // un seul message, dernier état
    }
    ws.close()
    await kasbah.close()
  })
})

describe('device placement (PUT /api/house/devices/:id)', () => {
  it('rewrites the house file atomically, keeps a .bak and broadcasts the new house', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-house-'))
    const file = join(dir, 'maison.json')
    await copyFile(HOUSE, file)
    const env = loadEnv({ KASBAH_PLUGINS: 'mock', KASBAH_HOUSE_FILE: file, KASBAH_LOG_LEVEL: 'silent' })
    const kasbah = await buildApp({ env, logger: pino({ level: 'silent' }), serveStatic: false })
    await kasbah.app.ready()
    try {
      const r = await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/light.salon', payload: { position: [5, 3, 0.75], mount: 'free' } })
      expect(r.statusCode).toBe(200)
      const moved = r.json().house.devices.find((d: { id: string }) => d.id === 'light.salon')
      expect(moved).toMatchObject({ position: [5, 3, 0.75], mount: 'free', name: 'Plafonnier salon' })

      const served = (await kasbah.app.inject({ method: 'GET', url: '/api/house' })).json()
      expect(served.devices.find((d: { id: string }) => d.id === 'light.salon').position).toEqual([5, 3, 0.75])

      const onDisk = JSON.parse(await readFile(file, 'utf8'))
      expect(onDisk.devices.find((d: { id: string }) => d.id === 'light.salon').position).toEqual([5, 3, 0.75])
      expect(onDisk.rooms[1].kind).toBeUndefined()            // le fichier ne reçoit pas les défauts zod (salon : kind 'room' implicite)
      expect(JSON.parse(await readFile(`${file}.bak`, 'utf8')).devices.find((d: { id: string }) => d.id === 'light.salon').position).toEqual([6.6, 2.5, 2.5])

      // création d'une entrée pour un appareil auto-placé
      const created = await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/auto.hue-abc', payload: { position: [1, 1, 2.4], roomId: 'salon', deviceId: 'hue:abc' } })
      expect(created.statusCode).toBe(200)
      expect(JSON.parse(await readFile(file, 'utf8')).devices.at(-1)).toEqual({ id: 'auto.hue-abc', deviceId: 'hue:abc', position: [1, 1, 2.4], roomId: 'salon' })

      // refus : corps invalide, pièce inconnue, appareil inconnu sans deviceId, pièce d'un autre niveau
      expect((await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/light.salon', payload: { position: [1, 2] } })).json().error.code).toBe('INVALID_BODY')
      expect((await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/light.salon', payload: { position: [1, 2, 3], roomId: 'veranda' } })).json().error.code).toBe('INVALID_PLACEMENT')
      expect((await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/nope', payload: { position: [1, 2, 3] } })).statusCode).toBe(400)
      // changer de pièce entraîne le levelId ; un volet ancré à une ouverture d'une autre pièce est refusé par la validation croisée
      const cross = await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/light.salon', payload: { position: [2.4, 2.4, 2.4], roomId: 'chambre1' } })
      expect(cross.statusCode).toBe(200)
      expect(cross.json().house.devices.find((d: { id: string }) => d.id === 'light.salon').levelId).toBe('etage')
      const invalid = await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/cover.baie', payload: { position: [6.6, 6.5, 1.3], roomId: 'cuisine' } })
      expect(invalid.statusCode).toBe(400)
      expect(invalid.json().error.code).toBe('INVALID_HOUSE')
      expect(JSON.parse(await readFile(file, 'utf8')).devices.find((d: { id: string }) => d.id === 'cover.baie').roomId).toBe('salon')   // rien n'a été écrit
    } finally {
      await kasbah.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// Les prévisions se lisent À LA DEMANDE, comme l'historique : le plugin rend sa dernière lecture,
// l'hôte y met le deviceId, et un appareil qui n'est pas une météo n'en a pas.
describe('GET /api/devices/:id/forecast', () => {
  it('serves the simulated forecast for the weather device and refuses other kinds', async () => {
    const { kasbah } = await makeApp('default')
    try {
      const ok = await kasbah.app.inject({ method: 'GET', url: '/api/devices/mock:weather/forecast' })
      expect(ok.statusCode).toBe(200)
      const body = ok.json()
      expect(body.deviceId).toBe('mock:weather')
      expect(body.hourly).toHaveLength(24)
      expect(body.daily).toHaveLength(7)
      expect((await kasbah.app.inject({ method: 'GET', url: '/api/devices/mock:light-living/forecast' })).json().error.code).toBe('KIND_MISMATCH')
      expect((await kasbah.app.inject({ method: 'GET', url: '/api/devices/mock:nope/forecast' })).statusCode).toBe(404)
    } finally { await kasbah.close() }
  })
})
