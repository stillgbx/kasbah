import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ManualClock } from '@kasbah/mock-sim'
import { serverMessageSchema, type AutomationEntry, type ServerMessage } from '@kasbah/shared'
import pino from 'pino'
import WebSocket from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../src/app'
import { loadEnv } from '../src/config/env'

// End-to-end automations: routes, file next to the house, WebSocket snapshot, and a real trigger by
// the simulation (the scenario's Tesla comes home from work at the end of the day).
// House COPIED into a temporary folder: the automations file is written next to it.

const HOUSE = resolve(import.meta.dirname, '../../../house/demo-house.json')
const MONDAY = Date.UTC(2026, 8, 7, 12)

let dir: string
let houseFile: string
let kasbah: KasbahApp
let clock: ManualClock

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kasbah-automations-'))
  houseFile = join(dir, 'maison.json')
  await copyFile(HOUSE, houseFile)
  clock = new ManualClock(MONDAY)
  const env = loadEnv({ KASBAH_HOUSE_FILE: houseFile, KASBAH_LOG_LEVEL: 'silent' })
  kasbah = await buildApp({
    env, logger: pino({ level: 'silent' }), clock, serveStatic: false,
    // ten simulated minutes per clock second: a day fits in a few steps
    envSource: { MOCK_SCENARIO: 'default', MOCK_SEED: '3', MOCK_START_TIME: new Date(MONDAY).toISOString(), MOCK_TIME_SCALE: '600' },
  })
  await kasbah.app.ready()
  await kasbah.startPlugins()
})

afterEach(async () => {
  await kasbah.close()
  await rm(dir, { recursive: true, force: true })
})

const lights = {
  name: 'Lumière du salon', enabled: true, unless: [],
  trigger: { type: 'time', at: { kind: 'clock', time: '07:30' } },
  actions: [{ type: 'command', target: { type: 'devices', deviceIds: ['mock:light-living'] }, command: { type: 'light.set', on: true } }],
}

describe('automation routes', () => {
  it('creates, reads, disables, runs and deletes, writing next to the house', async () => {
    const put = await kasbah.app.inject({ method: 'PUT', url: '/api/automations/salon', payload: lights })
    expect(put.statusCode).toBe(200)
    expect(put.json().automation.status.health).toBe('ok')
    expect(put.json().automation.status.nextRunAt).toBeGreaterThan(MONDAY)

    const file = JSON.parse(await readFile(join(dir, 'maison.automations.json'), 'utf8'))
    expect(file.automations[0]).toMatchObject({ id: 'salon', name: 'Lumière du salon' })

    const list = (await kasbah.app.inject({ method: 'GET', url: '/api/automations' })).json()
    expect(list.automations.map((e: AutomationEntry) => e.automation.id)).toEqual(['salon'])

    const patch = await kasbah.app.inject({ method: 'PATCH', url: '/api/automations/salon', payload: { enabled: false } })
    expect(patch.json().automation.automation.enabled).toBe(false)
    expect(patch.json().automation.status.nextRunAt).toBeUndefined()

    const run = await kasbah.app.inject({ method: 'POST', url: '/api/automations/salon/run' })
    expect(run.json().run).toMatchObject({ by: 'manual', outcome: 'ok', errors: [] })

    expect((await kasbah.app.inject({ method: 'DELETE', url: '/api/automations/salon' })).statusCode).toBe(200)
    expect((await kasbah.app.inject({ method: 'DELETE', url: '/api/automations/salon' })).statusCode).toBe(404)
  })

  it('refuses an invalid body or id with 400, and an unknown automation with 404', async () => {
    expect((await kasbah.app.inject({ method: 'PUT', url: '/api/automations/x', payload: { ...lights, actions: [] } })).statusCode).toBe(400)
    expect((await kasbah.app.inject({ method: 'PUT', url: '/api/automations/pas%20bon', payload: lights })).json().error.code).toBe('INVALID_BODY')
    expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/automations/nope', payload: { enabled: true } })).statusCode).toBe(404)
    expect((await kasbah.app.inject({ method: 'POST', url: '/api/automations/nope/run' })).statusCode).toBe(404)
  })

  it('accepts a rule on a device that does not exist, and shows it incomplete', async () => {
    const ghost = { ...lights, actions: [{ ...lights.actions[0], target: { type: 'devices', deviceIds: ['hue:disparue'] } }] }
    const r = await kasbah.app.inject({ method: 'PUT', url: '/api/automations/ghost', payload: ghost })
    expect(r.json().automation.status).toMatchObject({ health: 'incomplete', missing: [{ kind: 'device', id: 'hue:disparue' }] })
  })
})

describe('automations over WebSocket and the simulation', () => {
  it('ships automations in the snapshot', async () => {
    await kasbah.app.inject({ method: 'PUT', url: '/api/automations/salon', payload: lights })
    const address = await kasbah.app.listen({ port: 0, host: '127.0.0.1' })
    const ws = new WebSocket(`${address.replace('http', 'ws')}/ws`)
    const first = await new Promise<ServerMessage>((res) => ws.once('message', (d) => res(serverMessageSchema.parse(JSON.parse(d.toString())))))
    ws.close()
    expect(first.type === 'snapshot' && first.automations.map((e) => e.automation.id)).toEqual(['salon'])
  })

  it('fires when the Tesla comes home', async () => {
    await kasbah.app.inject({
      method: 'PUT', url: '/api/automations/arrivee',
      payload: { ...lights, name: 'Arrivée', trigger: { type: 'state', when: { type: 'vehicleOnSite', deviceId: 'mock:vehicle-tesla' } } },
    })
    const lastRun = () => kasbah.automations.get('arrivee')?.status.lastRun
    let steps = 0
    // one-second step = 10 simulated min; at most 36 simulated hours for a departure and a return
    while (!lastRun() && steps++ < 216) {
      clock.advance(1000)
      await new Promise((r) => setTimeout(r, 0))
    }
    expect(lastRun()).toMatchObject({ by: 'state', outcome: 'ok' })
    expect(kasbah.registry.get('mock:light-living')?.state).toMatchObject({ on: true })
  })
})
