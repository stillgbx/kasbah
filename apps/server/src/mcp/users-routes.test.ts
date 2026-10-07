import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, expect, it } from 'vitest'
import { userStateDir, userStateFile } from '../core/paths'
import { describeError, sendError } from '../http/errors'
import { readUsers, verifyPassword } from './auth'
import { registerMcpUserRoutes } from './users-routes'

let app: FastifyInstance
let usersFile: string

beforeEach(() => {
  usersFile = join(mkdtempSync(join(tmpdir(), 'kasbah-mcp-users-')), 'mcp-users.json')
  app = Fastify()
  app.setErrorHandler((err, _req, reply) => { const d = describeError(err); return sendError(reply, d.status, d.code, d.message) })
  registerMcpUserRoutes(app, { usersFile })
})

const put = (name: string, password: string) => app.inject({ method: 'PUT', url: `/api/mcp/users/${encodeURIComponent(name)}`, payload: { password } })

it('crée un compte, change son mot de passe, ne rend jamais les hachés', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/mcp/users' })).json()).toEqual({ users: [] })
  expect((await put('lou', 'premier-mdp')).json()).toEqual({ users: [{ name: 'lou' }] })
  const first = (await readUsers(usersFile)).users[0]!.password
  const res = await put('lou', 'second-mdp')
  expect(res.json()).toEqual({ users: [{ name: 'lou' }] })
  expect(res.body).not.toContain('scrypt')
  const stored = (await readUsers(usersFile)).users[0]!.password
  expect(stored).not.toBe(first)
  expect(await verifyPassword('second-mdp', stored)).toBe(true)
  expect((await app.inject({ method: 'GET', url: '/api/mcp/users' })).body).not.toContain('scrypt')
})

it('refuse un mot de passe court ou un nom invalide', async () => {
  expect((await put('lou', 'court')).statusCode).toBe(400)
  expect((await put('a b', 'assez-long')).statusCode).toBe(400)
})

it('retire un compte, 404 s\'il n\'existe pas', async () => {
  await put('lou', 'premier-mdp')
  await put('zoe', 'premier-mdp')
  expect((await app.inject({ method: 'DELETE', url: '/api/mcp/users/lou' })).json()).toEqual({ users: [{ name: 'zoe' }] })
  expect((await app.inject({ method: 'DELETE', url: '/api/mcp/users/lou' })).statusCode).toBe(404)
})

it('efface les comptes musicaux du compte retiré, et ceux-là seulement', async () => {
  await put('lou', 'premier-mdp')
  await put('zoe', 'premier-mdp')
  for (const name of ['lou', 'zoe']) {
    mkdirSync(dirname(userStateFile(name, 'mixcloud.json')), { recursive: true })
    writeFileSync(userStateFile(name, 'mixcloud.json'), '{}')
  }
  await app.inject({ method: 'DELETE', url: '/api/mcp/users/lou' })
  expect(existsSync(userStateDir('lou'))).toBe(false)
  expect(existsSync(userStateFile('zoe', 'mixcloud.json'))).toBe(true)
})

it('range un nom en point dans son propre dossier, sous celui des comptes', () => {
  // `userNameSchema` admet `.` et `..` : ils ne doivent désigner ni le dossier des comptes ni son parent
  expect(dirname(userStateDir('..'))).toBe(dirname(userStateDir('lou')))
  expect(userStateDir('.')).not.toBe(dirname(userStateDir('lou')))
  // `Lou` et `lou` sont deux comptes : leurs dossiers diffèrent aussi sur un disque qui ignore la casse
  expect(userStateDir('Lou').toLowerCase()).not.toBe(userStateDir('lou').toLowerCase())
})

it('n\'écrase pas un fichier illisible', async () => {
  writeFileSync(usersFile, '{ pas du json')
  const res = await put('lou', 'premier-mdp')
  expect(res.statusCode).toBe(500)
  expect(readFileSync(usersFile, 'utf8')).toBe('{ pas du json')
})
