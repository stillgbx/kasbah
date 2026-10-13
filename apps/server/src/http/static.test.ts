import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { readAppBuild, registerStatic } from './static'

let dir: string
let app: FastifyInstance | null = null

async function webBuild(files: Record<string, string>) {
  dir = await mkdtemp(join(tmpdir(), 'kasbah-static-'))
  await mkdir(join(dir, 'assets'))
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body)
}

afterEach(async () => {
  await app?.close(); app = null
  await rm(dir, { recursive: true, force: true })
})

describe('registerStatic', () => {
  it('replie une adresse de page sur index.html, mais un fichier absent de /assets est un vrai 404', async () => {
    await webBuild({ 'index.html': '<!doctype html><title>k</title>', 'assets/HomeView-new.js': 'export {}' })
    app = Fastify()
    expect(await registerStatic(app, dir)).toBe(true)

    const page = await app.inject({ method: 'GET', url: '/shopping' })
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toMatch(/text\/html/)

    const chunk = await app.inject({ method: 'GET', url: '/assets/HomeView-new.js' })
    expect(chunk.statusCode).toBe(200)
    expect(chunk.headers['content-type']).toMatch(/javascript/)

    // la vue d'un build remplacé, demandée par un écran resté ouvert
    const gone = await app.inject({ method: 'GET', url: '/assets/ShoppingView-old.js' })
    expect(gone.statusCode).toBe(404)
    expect(gone.headers['content-type']).toMatch(/json/)
  })
})

describe('readAppBuild', () => {
  it('lit l identifiant du build, relu à chaque appel, et rend undefined sans fichier', async () => {
    await webBuild({ 'index.html': '' })
    expect(readAppBuild(dir)).toBeUndefined()
    await writeFile(join(dir, 'build-id.txt'), 'abc123\n')
    expect(readAppBuild(dir)).toBe('abc123')
    await writeFile(join(dir, 'build-id.txt'), 'def456')
    expect(readAppBuild(dir)).toBe('def456')
  })
})
