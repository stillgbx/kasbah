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

it('creates an account, changes its password, never returns the hashes', async () => {
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

it('refuses a short password or an invalid name', async () => {
  expect((await put('lou', 'court')).statusCode).toBe(400)
  expect((await put('a b', 'assez-long')).statusCode).toBe(400)
})

it('removes an account, 404 if it does not exist', async () => {
  await put('lou', 'premier-mdp')
  await put('zoe', 'premier-mdp')
  expect((await app.inject({ method: 'DELETE', url: '/api/mcp/users/lou' })).json()).toEqual({ users: [{ name: 'zoe' }] })
  expect((await app.inject({ method: 'DELETE', url: '/api/mcp/users/lou' })).statusCode).toBe(404)
})

it('wipes the music accounts of the removed account, and only those', async () => {
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

it('stores a dot name in its own folder, under the accounts folder', () => {
  // `userNameSchema` allows `.` and `..`: they must designate neither the accounts folder nor its parent
  expect(dirname(userStateDir('..'))).toBe(dirname(userStateDir('lou')))
  expect(userStateDir('.')).not.toBe(dirname(userStateDir('lou')))
  // `Lou` and `lou` are two accounts: their folders also differ on a case-insensitive disk
  expect(userStateDir('Lou').toLowerCase()).not.toBe(userStateDir('lou').toLowerCase())
})

it('does not overwrite an unreadable file', async () => {
  writeFileSync(usersFile, '{ pas du json')
  const res = await put('lou', 'premier-mdp')
  expect(res.statusCode).toBe(500)
  expect(readFileSync(usersFile, 'utf8')).toBe('{ pas du json')
})

it('sets the rights of an account, keeps them across a password change, and gives them all back', async () => {
  await put('lou', 'premier-mdp')
  const rights = (list: string[] | null) => app.inject({ method: 'PUT', url: '/api/mcp/users/lou/rights', payload: { rights: list } })
  expect((await rights(['lights', 'covers'])).json()).toEqual({ users: [{ name: 'lou', rights: ['lights', 'covers'] }] })
  expect((await put('lou', 'second-mdp')).json()).toEqual({ users: [{ name: 'lou', rights: ['lights', 'covers'] }] })
  expect((await rights(null)).json()).toEqual({ users: [{ name: 'lou' }] })
  expect((await rights(['nope'] as string[])).statusCode).toBe(400)
  expect((await app.inject({ method: 'PUT', url: '/api/mcp/users/zoe/rights', payload: { rights: [] } })).statusCode).toBe(404)
})

it('creates an account with its rights in the same write, and leaves an existing account its own', async () => {
  const create = (name: string, rights: string[] | null) =>
    app.inject({ method: 'PUT', url: `/api/mcp/users/${name}`, payload: { password: 'premier-mdp', rights } })
  expect((await create('lou', ['lights', 'pets'])).json()).toEqual({ users: [{ name: 'lou', rights: ['lights', 'pets'] }] })
  expect((await create('lou', ['weather'])).json()).toEqual({ users: [{ name: 'lou', rights: ['lights', 'pets'] }] })
  expect((await create('zoe', null)).json().users[1]).toEqual({ name: 'zoe' })
  expect((await create('max', ['nope'])).statusCode).toBe(400)
})

it('creates an account with its roles, the house mark moving to it, and leaves an existing account its own', async () => {
  const create = (name: string, body: { admin?: boolean; house?: boolean }) =>
    app.inject({ method: 'PUT', url: `/api/mcp/users/${name}`, payload: { password: 'premier-mdp', ...body } })
  await create('lou', { house: true })
  expect((await create('zoe', { admin: true, house: true })).json()).toEqual({ users: [{ name: 'lou' }, { name: 'zoe', admin: true, house: true }] })
  expect((await create('lou', { admin: true, house: true })).json()).toEqual({ users: [{ name: 'lou' }, { name: 'zoe', admin: true, house: true }] })
  expect(readFileSync(usersFile, 'utf8')).not.toContain('false')
})

const role = (name: string, body: { admin?: boolean; house?: boolean }) =>
  app.inject({ method: 'PUT', url: `/api/mcp/users/${encodeURIComponent(name)}/role`, payload: body })

it('makes an account an admin, keeps the role across a password and a rights change, and takes it back', async () => {
  await put('lou', 'premier-mdp')
  await put('zoe', 'premier-mdp')
  expect((await role('lou', { admin: true })).json()).toEqual({ users: [{ name: 'lou', admin: true }, { name: 'zoe' }] })
  await put('lou', 'second-mdp')
  await app.inject({ method: 'PUT', url: '/api/mcp/users/lou/rights', payload: { rights: ['lights'] } })
  expect((await app.inject({ method: 'GET', url: '/api/mcp/users' })).json()).toEqual({ users: [{ name: 'lou', rights: ['lights'], admin: true }, { name: 'zoe' }] })
  await role('zoe', { admin: true })
  expect((await role('lou', { admin: false })).json()).toEqual({ users: [{ name: 'lou', rights: ['lights'] }, { name: 'zoe', admin: true }] })
  // nothing written for a false role
  expect(readFileSync(usersFile, 'utf8')).not.toContain('false')
})

it('keeps a single house account', async () => {
  await put('lou', 'premier-mdp')
  await put('maison', 'premier-mdp')
  expect((await role('lou', { house: true })).json()).toEqual({ users: [{ name: 'lou', house: true }, { name: 'maison' }] })
  expect((await role('maison', { house: true })).json()).toEqual({ users: [{ name: 'lou' }, { name: 'maison', house: true }] })
  await put('maison', 'second-mdp')
  expect((await role('maison', { house: false })).json()).toEqual({ users: [{ name: 'lou' }, { name: 'maison' }] })
})

it('never leaves the accounts without an admin once there is one', async () => {
  await put('lou', 'premier-mdp')
  await put('zoe', 'premier-mdp')
  await role('lou', { admin: true })
  const demote = await role('lou', { admin: false })
  expect(demote.statusCode).toBe(409)
  expect(demote.json().error.code).toBe('LAST_ADMIN')
  const remove = await app.inject({ method: 'DELETE', url: '/api/mcp/users/lou' })
  expect(remove.statusCode).toBe(409)
  expect(remove.json().error.code).toBe('LAST_ADMIN')
  expect((await readUsers(usersFile)).users.map((u) => u.name)).toEqual(['lou', 'zoe'])
  // with a second admin, the first one may go
  await role('zoe', { admin: true })
  expect((await app.inject({ method: 'DELETE', url: '/api/mcp/users/lou' })).json()).toEqual({ users: [{ name: 'zoe', admin: true }] })
  // accounts that never had an admin are not blocked
  await put('max', 'premier-mdp')
  expect((await app.inject({ method: 'DELETE', url: '/api/mcp/users/max' })).statusCode).toBe(200)
})

it('refuses a role change without a role, or for an unknown account', async () => {
  await put('lou', 'premier-mdp')
  expect((await role('lou', {})).statusCode).toBe(400)
  expect((await app.inject({ method: 'PUT', url: '/api/mcp/users/lou/role', payload: { admin: 'yes' } })).statusCode).toBe(400)
  expect((await role('zoe', { admin: true })).statusCode).toBe(404)
})
