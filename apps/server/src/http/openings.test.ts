import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { LightMyRequestResponse } from 'fastify'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'

// Adjusting an opening from edit mode: the route WRITES into house.json, so it is tested on a COPY
// of the demo house — otherwise each run would modify the repo.

const DEMO_HOUSE = resolve(import.meta.dirname, '../../../../house/demo-house.json')

describe('PUT /api/house/rooms/:roomId/openings/:openingId', () => {
  let kasbah: KasbahApp
  let file: string
  beforeAll(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'kasbah-openings-')), 'house.json')
    await copyFile(DEMO_HOUSE, file)
    kasbah = await buildApp({
      env: loadEnv({ KASBAH_LOG_LEVEL: 'silent' }),
      logger: pino({ level: 'silent' }),
      house: await loadHouse(file),
      envSource: {},
      serveStatic: false,
    })
    await kasbah.app.ready()
  })
  afterAll(async () => { await kasbah.close() })

  const put = (roomId: string, openingId: string, payload: object): Promise<LightMyRequestResponse> =>
    kasbah.app.inject({ method: 'PUT', url: `/api/house/rooms/${roomId}/openings/${openingId}`, payload })

  it('writes the given dimensions and hands back the rewritten house', async () => {
    const res = await put('entree', 'porte-entree', { width: 1.1, height: 2.2, sill: 0 })
    expect(res.statusCode).toBe(200)
    const room = res.json().house.rooms.find((r: { id: string }) => r.id === 'entree')
    expect(room.openings[0]).toMatchObject({ id: 'porte-entree', width: 1.1, height: 2.2 })
    // and the file, not just the response: it is the user's survey that is being corrected
    const written = JSON.parse(await readFile(file, 'utf8'))
    expect(written.rooms.find((r: { id: string }) => r.id === 'entree').openings[0].width).toBe(1.1)
  })

  it('moves the opening to another wall of the room', async () => {
    const res = await put('entree', 'porte-entree', { segment: 2, offset: 0.4 })
    expect(res.statusCode).toBe(200)
    const room = res.json().house.rooms.find((r: { id: string }) => r.id === 'entree')
    expect(room.openings[0]).toMatchObject({ segment: 2, offset: 0.4 })
  })

  it('refuses an opening that runs off the end of its wall, and leaves the file alone', async () => {
    const before = await readFile(file, 'utf8')
    const res = await put('entree', 'porte-entree', { offset: 40 })
    expect(res.statusCode).toBe(400)
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('refuses an opening taller than its room', async () => {
    expect((await put('entree', 'porte-entree', { height: 9 })).statusCode).toBe(400)
  })

  it('refuses an unknown room or opening', async () => {
    expect((await put('nulle-part', 'porte-entree', { width: 1 })).statusCode).toBe(400)
    expect((await put('entree', 'pas-une-ouverture', { width: 1 })).statusCode).toBe(400)
  })

  it('refuses a width zod would never accept', async () => {
    expect((await put('entree', 'porte-entree', { width: 0 })).statusCode).toBe(400)
  })
})

// Adding and removing an opening, from the room panel. Same mechanism as the adjustment — copy of
// the demo house, real write of the file, `parseHouse` as a safeguard.
describe('POST and DELETE /api/house/rooms/:roomId/openings', () => {
  let kasbah: KasbahApp
  let file: string
  beforeAll(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'kasbah-openings-add-')), 'house.json')
    await copyFile(DEMO_HOUSE, file)
    kasbah = await buildApp({
      env: loadEnv({ KASBAH_LOG_LEVEL: 'silent' }),
      logger: pino({ level: 'silent' }),
      house: await loadHouse(file),
      envSource: {},
      serveStatic: false,
    })
    await kasbah.app.ready()
  })
  afterAll(async () => { await kasbah.close() })

  const post = (roomId: string, payload: object): Promise<LightMyRequestResponse> =>
    kasbah.app.inject({ method: 'POST', url: `/api/house/rooms/${roomId}/openings`, payload })
  const del = (roomId: string, openingId: string): Promise<LightMyRequestResponse> =>
    kasbah.app.inject({ method: 'DELETE', url: `/api/house/rooms/${roomId}/openings/${openingId}` })
  const openingsOf = (res: LightMyRequestResponse, roomId: string) =>
    res.json().house.rooms.find((r: { id: string }) => r.id === roomId).openings as { id: string }[]

  it('adds the opening to the room and writes it to the file', async () => {
    const res = await post('chambre1', { id: 'window-1', type: 'window', segment: 1, offset: 0.6, width: 1, height: 1.2, sill: 0.9 })
    expect(res.statusCode).toBe(200)
    expect(openingsOf(res, 'chambre1').map((o) => o.id)).toContain('window-1')
    const written = JSON.parse(await readFile(file, 'utf8'))
    expect(written.rooms.find((r: { id: string }) => r.id === 'chambre1').openings.at(-1)).toMatchObject({ id: 'window-1', width: 1 })
  })

  it('refuses an opening that overlaps a neighbour, and leaves the file alone', async () => {
    const before = await readFile(file, 'utf8')
    const res = await post('chambre1', { id: 'window-2', type: 'window', segment: 1, offset: 0.6, width: 1, height: 1.2, sill: 0.9 })
    expect(res.statusCode).toBe(400)
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('refuses an id already taken and an unknown room', async () => {
    expect((await post('chambre1', { id: 'window-1', type: 'window', segment: 3, offset: 0.2, width: 0.8, height: 1, sill: 0.9 })).statusCode).toBe(400)
    expect((await post('nulle-part', { id: 'window-3', type: 'window', segment: 0, offset: 0.2, width: 0.8, height: 1 })).statusCode).toBe(400)
  })

  it('removes the opening and frees the cover that was on it', async () => {
    const res = await del('chambre1', 'fen-ch1')                    // cover.chambre1 sits on it
    expect(res.statusCode).toBe(200)
    expect(openingsOf(res, 'chambre1').map((o) => o.id)).not.toContain('fen-ch1')
    const cover = res.json().house.devices.find((d: { id: string }) => d.id === 'cover.chambre1')
    expect(cover.openingId).toBeUndefined()
    const written = JSON.parse(await readFile(file, 'utf8'))
    expect(written.devices.find((d: { id: string }) => d.id === 'cover.chambre1').openingId).toBeUndefined()
  })

  it('refuses to remove what is not there', async () => {
    expect((await del('chambre1', 'fen-ch1')).statusCode).toBe(400)
    expect((await del('nulle-part', 'window-1')).statusCode).toBe(400)
  })
})
