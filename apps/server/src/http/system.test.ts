import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, expect, it, vi } from 'vitest'
import { registerSystemRoutes, type UpdateRequest, type UpdateStatus } from './system'

const SHA = 'a'.repeat(40)
const line = (sha: string, subject: string) => `${sha}\x1f${subject}\x1f2026-10-13T10:00:00+02:00`

let statusFile: string
let clock: number
let calls: string[][]
let sent: UpdateRequest[]

/** `git` simulé : HEAD = SHA, deux commits d'avance sur origin/main. */
const git = async (args: string[]) => {
  calls.push(args)
  if (args[0] === 'log' && args[1] === '-1') return line(SHA, 'en service')
  if (args[0] === 'log') return [line('c'.repeat(40), 'deuxième'), line('b'.repeat(40), 'premier')].join('\n')
  return ''
}

function build(supervised: boolean): FastifyInstance {
  const app = Fastify()
  registerSystemRoutes(app, {
    statusFile, git, now: () => clock,
    ...(supervised ? { supervisor: (m: UpdateRequest) => { sent.push(m) } } : {}),
  })
  return app
}

beforeEach(() => {
  statusFile = join(mkdtempSync(join(tmpdir(), 'kasbah-system-')), 'update-status.json')
  clock = 1_000_000
  calls = []
  sent = []
})

it('rend le commit en service et ceux qui attendent sur origin/main', async () => {
  const res = await build(true).inject({ method: 'GET', url: '/api/system/version' })
  expect(res.json()).toEqual({
    supervised: true,
    running: { sha: SHA, subject: 'en service', date: '2026-10-13T10:00:00+02:00' },
    available: [
      { sha: 'c'.repeat(40), subject: 'deuxième', date: '2026-10-13T10:00:00+02:00' },
      { sha: 'b'.repeat(40), subject: 'premier', date: '2026-10-13T10:00:00+02:00' },
    ],
    error: null,
  })
  expect(calls).toContainEqual(['log', '--format=%H%x1f%s%x1f%cI', '-n', '50', `${SHA}..origin/main`])
})

it('ne refait pas `git fetch` avant une minute, sauf demande', async () => {
  const app = build(true)
  const fetches = () => calls.filter((c) => c[0] === 'fetch').length
  await app.inject({ method: 'GET', url: '/api/system/version' })
  await app.inject({ method: 'GET', url: '/api/system/version' })
  expect(fetches()).toBe(1)
  await app.inject({ method: 'GET', url: '/api/system/version?refresh=1' })
  expect(fetches()).toBe(2)
  clock += 61_000
  await app.inject({ method: 'GET', url: '/api/system/version' })
  expect(fetches()).toBe(3)
})

it('dit l’échec de git sans tomber', async () => {
  const app = Fastify()
  registerSystemRoutes(app, { statusFile, git: async (args) => { if (args[0] === 'fetch') throw new Error('could not resolve host\ndetail'); return git(args) } })
  const body = (await app.inject({ method: 'GET', url: '/api/system/version' })).json()
  expect(body.available).toBeNull()
  expect(body.error).toBe('could not resolve host')
})

it('refuse la mise à jour sans superviseur', async () => {
  const res = await build(false).inject({ method: 'POST', url: '/api/system/update' })
  expect(res.statusCode).toBe(409)
  expect(res.json().error.code).toBe('NOT_SUPERVISED')
})

it('transmet la demande au superviseur et écrit l’état « en cours » tout de suite', async () => {
  const app = build(true)
  const res = await app.inject({ method: 'POST', url: '/api/system/update' })
  expect(res.statusCode).toBe(202)
  expect(sent).toEqual([{ type: 'update', statusFile, running: SHA }])
  const written = JSON.parse(readFileSync(statusFile, 'utf8')) as UpdateStatus
  expect(written).toMatchObject({ state: 'running', step: 'fetch', from: SHA, startedAt: clock })
  expect((await app.inject({ method: 'GET', url: '/api/system/update' })).json().status.state).toBe('running')
  // une seconde demande pendant la première
  const again = await app.inject({ method: 'POST', url: '/api/system/update' })
  expect(again.statusCode).toBe(409)
  expect(again.json().error.code).toBe('UPDATE_RUNNING')
  expect(sent).toHaveLength(1)
})

it('tient pour interrompue une mise à jour « en cours » depuis plus de 30 minutes', async () => {
  const app = build(true)
  await app.inject({ method: 'POST', url: '/api/system/update' })
  clock += 31 * 60_000
  const status = (await app.inject({ method: 'GET', url: '/api/system/update' })).json().status
  expect(status).toMatchObject({ state: 'failed', failedStep: 'fetch', error: 'interrupted' })
  expect((await app.inject({ method: 'POST', url: '/api/system/update' })).statusCode).toBe(202)
})

it('garde la dernière lecture quand le fichier d’état est illisible (en cours d’écriture)', async () => {
  const app = build(true)
  await app.inject({ method: 'POST', url: '/api/system/update' })
  writeFileSync(statusFile, '{"state": "runn')
  expect((await app.inject({ method: 'GET', url: '/api/system/update' })).json().status.state).toBe('running')
})

it('rend un état vide tant qu’aucune mise à jour n’a eu lieu', async () => {
  const spy = vi.fn()
  const app = Fastify()
  registerSystemRoutes(app, { statusFile, git, supervisor: spy })
  expect((await app.inject({ method: 'GET', url: '/api/system/update' })).json()).toEqual({ status: null })
})
