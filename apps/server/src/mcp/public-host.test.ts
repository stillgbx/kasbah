import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'
import { createMockPlugin } from '../plugins/mock'
import { hashPassword } from './auth'

// Under the public name (`MCP_PUBLIC_URL`, that of the NAS reverse proxy), the MCP answers with its
// tokens and the rest requires a session (details in `http/session.test.ts`): the proxy forwards
// everything, the assembled application does the sorting. The local network does not change.

const PUBLIC = 'kasbah.example.org'
const ORIGIN = `https://${PUBLIC}`
let kasbah: KasbahApp
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kasbah-public-'))
  const usersFile = join(dir, 'mcp-users.json')
  writeFileSync(usersFile, JSON.stringify({ users: [{ name: 'lou', password: await hashPassword('bon-mot-de-passe') }] }))
  kasbah = await buildApp({
    env: loadEnv({ KASBAH_LOG_LEVEL: 'silent' }),
    logger: pino({ level: 'silent' }),
    house: await loadHouse(resolve(import.meta.dirname, '../../../../house/demo-house.json')),
    factories: { mock: createMockPlugin },
    envSource: {
      MCP_PUBLIC_URL: ORIGIN, MCP_USERS_FILE: usersFile, MCP_AUTH_FILE: join(dir, 'mcp-auth.json'),
      KASBAH_SESSIONS_FILE: join(dir, 'sessions.json'), KASBAH_LOGIN_MAX_FAILURES: '2',
      KASBAH_LAN_HOSTS: 'nas.example.net, Kasbah.Example.Net',
    },
    serveStatic: false,
  })
  await kasbah.app.ready()
})
afterAll(async () => { await kasbah.close() })

const get = (url: string, headers: Record<string, string>) => kasbah.app.inject({ method: 'GET', url, headers })
const HTML = { accept: 'text/html' }

it('closes the interface, the API, the WebSocket and the accounts without a session under the public name', async () => {
  for (const url of ['/', '/settings', '/oauth', '/.well-known/other']) {
    const res = await get(url, { host: PUBLIC, ...HTML })
    expect(res.statusCode, url).toBe(302)
    expect(res.headers.location, url).toBe(`/login?next=${encodeURIComponent(url)}`)
  }
  for (const url of ['/api/devices', '/api/health', '/api/mcp/users', '/ws', '/api/devices?x=1', '/api/session']) {
    expect((await get(url, { host: PUBLIC })).statusCode, url).toBe(401)
  }
  expect((await get('/login', { host: PUBLIC })).statusCode).toBe(200)
})

it('lets the MCP and its authorization through under the public name', async () => {
  expect((await kasbah.app.inject({ method: 'POST', url: '/mcp', headers: { host: PUBLIC, 'content-type': 'application/json' }, payload: {} })).statusCode).toBe(401)
  const meta = await get('/.well-known/oauth-protected-resource/mcp', { host: PUBLIC })
  expect(meta.json()).toMatchObject({ resource: `https://${PUBLIC}/mcp` })
  expect((await get('/.well-known/oauth-authorization-server', { host: PUBLIC })).statusCode).toBe(200)
  expect((await get('/oauth/authorize?client_id=x', { host: PUBLIC })).statusCode).toBe(400)
})

it('also recognizes the public name forwarded by the proxy in X-Forwarded-Host', async () => {
  expect((await get('/api/devices', { host: '192.168.1.90:8787', 'x-forwarded-host': `${PUBLIC}:443` })).statusCode).toBe(401)
})

it('recognizes the public name whatever its letter case or trailing dot, in Host and X-Forwarded-Host', async () => {
  for (const name of [PUBLIC.toUpperCase(), 'Kasbah.Example.Org', `${PUBLIC}.`, `${PUBLIC.toUpperCase()}.`]) {
    expect((await get('/api/devices', { host: name })).statusCode, name).toBe(401)
    expect((await get('/api/devices', { host: `${name}:443` })).statusCode, name).toBe(401)
    expect((await get('/api/devices', { host: '192.168.1.90:8787', 'x-forwarded-host': `${name}:443` })).statusCode, name).toBe(401)
    expect((await get('/api/devices', { host: '192.168.1.90:8787', 'x-forwarded-host': `${name}, proxy.example.org` })).statusCode, name).toBe(401)
    expect((await get('/login', { host: name })).statusCode, name).toBe(200)
  }
})

it('changes nothing on the local network', async () => {
  expect((await get('/api/devices', { host: 'kasbah:8787' })).statusCode).toBe(200)
  expect((await get('/api/mcp/users', { host: 'localhost:8787' })).statusCode).toBe(200)
  expect((await get('/api/session', { host: 'kasbah:8787' })).json()).toEqual({ user: null })
})

it('refuses on the local network a name a DNS-rebinding page could take', async () => {
  for (const host of ['attacker.example.com:8787', 'attacker.example.com', 'example.org', 'kasbah.example.org.evil.example']) {
    const res = await get('/api/devices', { host })
    expect(res.statusCode, host).toBe(403)
    expect(res.json().error.code, host).toBe('UNKNOWN_HOST')
  }
  const put = await kasbah.app.inject({ method: 'PUT', url: '/api/mcp/users/eve', headers: { host: 'attacker.example.com:8787' }, payload: { password: 'mot-de-passe-long' } })
  expect(put.statusCode).toBe(403)
  await expect(kasbah.app.injectWS('/ws', { headers: { host: 'attacker.example.com:8787' } })).rejects.toThrow('403')
  for (const host of [
    '192.168.1.90:8787', '192.168.1.90', '[::1]:8787', 'localhost:5173', 'kasbah:8787', 'kasbah.home.internal:8787',
    'KASBAH.HOME.INTERNAL', 'kasbah.local', 'kasbah.lan', 'kasbah.home.arpa', 'app.localhost', 'nas.example.net', 'kasbah.example.net:8787',
  ]) {
    expect((await get('/api/devices', { host })).statusCode, host).toBe(200)
  }
})

it('refuses on the local network a write or a WebSocket from another site, not a read or a client without Origin', async () => {
  const host = 'kasbah.home.internal:8787'
  const command = (headers: Record<string, string>) => kasbah.app.inject({ method: 'POST', url: '/api/devices/unknown/command', headers: { host, ...headers }, payload: {} })
  for (const origin of ['http://attacker.example.com', 'http://192.168.1.90:8787', 'http://kasbah.home.internal:5173', 'null']) {
    const res = await command({ origin })
    expect(res.statusCode, origin).toBe(403)
    expect(res.json().error.code, origin).toBe('BAD_ORIGIN')
  }
  expect((await command({ origin: `http://${host}` })).statusCode).not.toBe(403)
  expect((await command({ origin: 'HTTP://KASBAH.home.internal:8787' })).statusCode).not.toBe(403)
  expect((await command({})).statusCode).not.toBe(403)
  expect((await get('/api/devices', { host, origin: 'http://attacker.example.com' })).statusCode).toBe(200)
  await expect(kasbah.app.injectWS('/ws', { headers: { host, origin: 'http://attacker.example.com' } })).rejects.toThrow('403')
  const socket = await kasbah.app.injectWS('/ws', { headers: { host, origin: `http://${host}` } })
  socket.terminate()
})

const login = (username: string, password: string) => kasbah.app.inject({
  method: 'POST', url: '/login',
  headers: { host: PUBLIC, origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
  payload: new URLSearchParams({ username, password }).toString(),
})

it('opens the WebSocket with a session and the site origin, and refuses it otherwise', async () => {
  const ws = (headers: Record<string, string>) => kasbah.app.injectWS('/ws', { headers: { host: PUBLIC, ...headers } })
  await expect(ws({ origin: ORIGIN })).rejects.toThrow('401')
  const cookie = String((await login('lou', 'bon-mot-de-passe')).headers['set-cookie']).split(';')[0]!
  await expect(ws({ cookie })).rejects.toThrow('403')
  await expect(ws({ cookie, origin: 'https://nas.example.org' })).rejects.toThrow('403')
  // The snapshot goes out on open: listener set beforehand.
  let first!: Promise<string>
  const socket = await kasbah.app.injectWS('/ws', { headers: { host: PUBLIC, cookie, origin: ORIGIN } }, {
    onInit: (s) => { first = new Promise((ok) => s.once('message', (m) => ok(String(m)))) },
  })
  expect(JSON.parse(await first).type).toBe('snapshot')
  socket.terminate()
})

it('shares the account lockout with the MCP sign-in, at the configured threshold', async () => {
  for (let i = 0; i < 2; i++) expect((await login('lou', 'faux')).statusCode).toBe(401)
  expect((await login('lou', 'bon-mot-de-passe')).statusCode).toBe(429)
  const clientId = (await kasbah.app.inject({
    method: 'POST', url: '/oauth/register', headers: { host: PUBLIC },
    payload: { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] },
  })).json().client_id
  const authorize = await kasbah.app.inject({
    method: 'POST', url: '/oauth/authorize', headers: { host: PUBLIC, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: createHash('sha256').update('v'.repeat(50)).digest('base64url'), code_challenge_method: 'S256',
      username: 'lou', password: 'bon-mot-de-passe',
    }).toString(),
  })
  expect(authorize.statusCode).toBe(429)
})
