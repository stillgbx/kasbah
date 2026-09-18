import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { LightMyRequestResponse } from 'fastify'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'

// Réglage d'une ouverture depuis le mode édition : la route ÉCRIT dans house.json, elle se teste
// donc sur une COPIE de la maison de démo — sinon chaque exécution modifierait le dépôt.

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
    // et le fichier, pas seulement la réponse : c'est le relevé de l'utilisateur qu'on corrige
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
