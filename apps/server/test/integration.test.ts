import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { ManualClock } from '@kasbah/mock-sim'
import { serverMessageSchema, type ServerMessage } from '@kasbah/shared'
import pino from 'pino'
import WebSocket from 'ws'
import { buildApp, type KasbahApp } from '../src/app'
import { loadEnv } from '../src/config/env'

const HOUSE = resolve(import.meta.dirname, '../../../house/demo-house.json')
const MONDAY = Date.UTC(2026, 8, 7, 12)

async function makeApp(scenario: string) {
  const clock = new ManualClock(MONDAY)
  const env = loadEnv({ KASBAH_PLUGINS: 'mock,tesla', KASBAH_HOUSE_FILE: HOUSE, KASBAH_LOG_LEVEL: 'silent' })
  const kasbah = await buildApp({
    env, logger: pino({ level: 'silent' }), clock, serveStatic: false,
    envSource: { MOCK_SCENARIO: scenario, MOCK_SEED: '3', MOCK_START_TIME: new Date(MONDAY).toISOString() },
  })
  await kasbah.app.ready()
  await kasbah.startPlugins()
  return { kasbah, clock }
}

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
    expect(body.plugins.tesla.status).toBe('not_implemented')
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
