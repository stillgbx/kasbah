import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import pino from 'pino'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMcpAuth, hashPassword, mcpAuthConfigSchema, sha256, verifyPassword } from './auth'

// The authorization server alone, in front of a fake protected route: the refusals that the happy
// path (server.test.ts, real SDK client) does not go through.

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const VERIFIER = 'v'.repeat(50)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')

let app: FastifyInstance
let usersFile: string
let clock: number
const metadataDocs = new Map<string, unknown>()

async function build(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kasbah-mcp-auth-'))
  usersFile = join(dir, 'mcp-users.json')
  writeFileSync(usersFile, JSON.stringify({ users: [{ name: 'lou', password: await hashPassword('bon-mot-de-passe') }] }))
  const auth = createMcpAuth({
    config: mcpAuthConfigSchema.parse({ MCP_USERS_FILE: usersFile, MCP_AUTH_FILE: join(dir, 'mcp-auth.json'), ...env }),
    logger: pino({ level: 'silent' }),
    now: () => clock,
    fetch: (async (url: string) => metadataDocs.has(url)
      ? new Response(JSON.stringify(metadataDocs.get(url)))
      : new Response('', { status: 404 })) as typeof fetch,
  })
  app = Fastify()
  await app.register(async (sub) => {
    auth.routes(sub)
    sub.get('/mcp', { onRequest: auth.requireToken }, async (req) => ({ ok: true, user: req.sessionUser }))
  })
  return auth
}

beforeEach(async () => { clock = 1_000_000; metadataDocs.clear(); await build() })

const register = async (redirectUris = [REDIRECT]) =>
  (await app.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'Claude', redirect_uris: redirectUris } }))

const authorizeParams = (clientId: string, extra: Record<string, string> = {}) => ({
  response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'xyz', ...extra,
})

async function login(clientId: string, password = 'bon-mot-de-passe', username = 'lou') {
  return app.inject({
    method: 'POST', url: '/oauth/authorize', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ ...authorizeParams(clientId), username, password }).toString(),
  })
}

const exchange = (clientId: string, code: string, verifier = VERIFIER) => app.inject({
  method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  payload: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier }).toString(),
})

const refresh = (clientId: string, token: string) => app.inject({
  method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  payload: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token, client_id: clientId }).toString(),
})

const callMcp = (token: string) => app.inject({ method: 'GET', url: '/mcp', headers: { authorization: `Bearer ${token}` } })

async function signIn() {
  const clientId = (await register()).json().client_id as string
  const code = new URL((await login(clientId)).headers.location as string).searchParams.get('code')!
  return { clientId, tokens: (await exchange(clientId, code)).json() as { access_token: string; refresh_token: string } }
}

it('hashes and verifies a password', async () => {
  const h = await hashPassword('secret')
  expect(h).toMatch(/^scrypt\$/)
  expect(await verifyPassword('secret', h)).toBe(true)
  expect(await verifyPassword('Secret', h)).toBe(false)
  expect(await verifyPassword('secret', 'n’importe quoi')).toBe(false)
})

it('goes from registration to token, and the token opens /mcp', async () => {
  const { tokens } = await signIn()
  expect((await callMcp(tokens.access_token)).statusCode).toBe(200)
})

it('redirects to the client with code, state and issuer', async () => {
  const clientId = (await register()).json().client_id
  const res = await login(clientId)
  expect(res.statusCode).toBe(302)
  const back = new URL(res.headers.location as string)
  expect(back.origin + back.pathname).toBe(REDIRECT)
  expect(back.searchParams.get('state')).toBe('xyz')
  expect(back.searchParams.get('iss')).toBe('http://localhost:80')
})

it('refuses a wrong password or an unknown account, without redirecting to the client', async () => {
  const clientId = (await register()).json().client_id
  for (const res of [await login(clientId, 'faux'), await login(clientId, 'bon-mot-de-passe', 'inconnu')]) {
    expect(res.statusCode).toBe(401)
    expect(res.headers.location).toBeUndefined()
    expect(res.body).toContain('incorrect')
  }
  expect((await login(clientId, 'faux')).body).toContain('value="lou"')
})

it('locks sign-ins after ten failures, for a quarter of an hour', async () => {
  const clientId = (await register()).json().client_id
  for (let i = 0; i < 10; i++) await login(clientId, 'faux')
  expect((await login(clientId)).statusCode).toBe(429)
  clock += 15 * 60_000 + 1
  expect((await login(clientId)).statusCode).toBe(302)
})

it('never redirects to an address the client has not declared', async () => {
  const clientId = (await register()).json().client_id
  const res = await app.inject({ method: 'GET', url: `/oauth/authorize?${new URLSearchParams(authorizeParams(clientId, { redirect_uri: 'https://evil.example/cb' }))}` })
  expect(res.statusCode).toBe(400)
  expect(res.headers.location).toBeUndefined()
})

it('requires PKCE S256', async () => {
  const clientId = (await register()).json().client_id
  const res = await app.inject({ method: 'GET', url: `/oauth/authorize?${new URLSearchParams(authorizeParams(clientId, { code_challenge_method: 'plain' }))}` })
  expect(res.statusCode).toBe(400)
})

it('shows the client and its destination on the sign-in page', async () => {
  const clientId = (await register()).json().client_id
  const res = await app.inject({ method: 'GET', url: `/oauth/authorize?${new URLSearchParams(authorizeParams(clientId))}` })
  expect(res.statusCode).toBe(200)
  expect(res.body).toContain('<strong>Claude</strong>')
  expect(res.body).toContain('<svg aria-hidden="true"') // the app logo, inline in the page
  expect(res.body).toContain('claude.ai')
  expect(res.headers['x-frame-options']).toBe('DENY')
  // `form-action` would also block the redirect to the client that follows the submission (seen in the browser)
  expect(res.headers['content-security-policy']).not.toContain('form-action')
})

it('refuses an http redirect outside the client\'s machine', async () => {
  expect((await register(['http://192.168.1.20/cb'])).statusCode).toBe(400)
  expect((await register(['http://127.0.0.1:33418/callback'])).statusCode).toBe(201)
})

it('refuses a code with the wrong verifier, a replayed or expired code', async () => {
  const clientId = (await register()).json().client_id
  const codeOf = async () => new URL((await login(clientId)).headers.location as string).searchParams.get('code')!
  expect((await exchange(clientId, await codeOf(), 'w'.repeat(50))).statusCode).toBe(400)
  const code = await codeOf()
  expect((await exchange(clientId, code)).statusCode).toBe(200)
  expect((await exchange(clientId, code)).statusCode).toBe(400)
  const late = await codeOf()
  clock += 61_000
  expect((await exchange(clientId, late)).statusCode).toBe(400)
})

it('rotates the refresh token: the old one no longer works', async () => {
  const { clientId, tokens } = await signIn()
  const next = await refresh(clientId, tokens.refresh_token)
  expect(next.statusCode).toBe(200)
  expect((await callMcp(next.json().access_token)).statusCode).toBe(200)
  expect((await refresh(clientId, tokens.refresh_token)).statusCode).toBe(400)
})

it('expires the access token after one hour', async () => {
  const { tokens } = await signIn()
  clock += 60 * 60_000 + 1
  const res = await callMcp(tokens.access_token)
  expect(res.statusCode).toBe(401)
  expect(res.headers['www-authenticate']).toContain('error="invalid_token"')
})

it('cuts the tokens of an account removed from the file', async () => {
  const { clientId, tokens } = await signIn()
  writeFileSync(usersFile, JSON.stringify({ users: [] }))
  expect((await callMcp(tokens.access_token)).statusCode).toBe(401)
  expect((await refresh(clientId, tokens.refresh_token)).statusCode).toBe(400)
})

it('cuts the tokens when the password changes, and an account created again under the name does not revive them', async () => {
  const { clientId, tokens } = await signIn()
  writeFileSync(usersFile, JSON.stringify({ users: [{ name: 'lou', password: await hashPassword('nouveau-mot-de-passe') }] }))
  expect((await callMcp(tokens.access_token)).statusCode).toBe(401)
  expect((await refresh(clientId, tokens.refresh_token)).statusCode).toBe(400)
  writeFileSync(usersFile, JSON.stringify({ users: [] }))
  writeFileSync(usersFile, JSON.stringify({ users: [{ name: 'lou', password: await hashPassword('bon-mot-de-passe') }] }))
  expect((await callMcp(tokens.access_token)).statusCode).toBe(401)
  expect((await refresh(clientId, tokens.refresh_token)).statusCode).toBe(400)
})

it('refuses a token written without the password fingerprint (issued before 2026-10-23)', async () => {
  const dir = usersFile.replace(/mcp-users\.json$/, '')
  const grant = { clientId: 'c1', user: 'lou', expiresAt: clock + 60_000 }
  writeFileSync(join(dir, 'mcp-auth.json'), JSON.stringify({ access: { [sha256('old-access')]: grant }, refresh: { [sha256('old-refresh')]: grant } }))
  const auth = createMcpAuth({
    config: mcpAuthConfigSchema.parse({ MCP_USERS_FILE: usersFile, MCP_AUTH_FILE: join(dir, 'mcp-auth.json') }),
    logger: pino({ level: 'silent' }), now: () => clock,
  })
  app = Fastify()
  await app.register(async (sub) => { auth.routes(sub); sub.get('/mcp', { onRequest: auth.requireToken }, async () => ({ ok: true })) })
  expect((await callMcp('old-access')).statusCode).toBe(401)
  expect((await refresh('c1', 'old-refresh')).statusCode).toBe(400)
})

it('opens /mcp to the per-run token, in the name of the account or the house, until it is revoked', async () => {
  const auth = await build()
  const lou = auth.runToken('lou', 60_000)
  const house = auth.runToken(null, 60_000)
  expect((await callMcp(lou.token)).json()).toEqual({ ok: true, user: 'lou' })
  expect((await callMcp(house.token)).json()).toEqual({ ok: true, user: null })
  lou.revoke()
  expect((await callMcp(lou.token)).statusCode).toBe(401)
  expect((await callMcp(house.token)).statusCode).toBe(200)
  clock += 60_000
  expect((await callMcp(house.token)).statusCode).toBe(401)
})

it('refuses the per-run token of a removed account', async () => {
  const auth = await build()
  const { token } = auth.runToken('lou', 60_000)
  writeFileSync(usersFile, JSON.stringify({ users: [] }))
  expect((await callMcp(token)).statusCode).toBe(401)
})

it('keeps the tokens after a restart', async () => {
  const { tokens } = await signIn()
  const dir = usersFile.replace(/mcp-users\.json$/, '')
  const auth = createMcpAuth({
    config: mcpAuthConfigSchema.parse({ MCP_USERS_FILE: usersFile, MCP_AUTH_FILE: join(dir, 'mcp-auth.json') }),
    logger: pino({ level: 'silent' }), now: () => clock,
  })
  app = Fastify()
  await app.register(async (sub) => { auth.routes(sub); sub.get('/mcp', { onRequest: auth.requireToken }, async () => ({ ok: true })) })
  expect((await callMcp(tokens.access_token)).statusCode).toBe(200)
})

it('accepts a client described by its metadata document (client_id = URL)', async () => {
  const clientId = 'https://claude.ai/oauth/mcp-client-metadata'
  metadataDocs.set(clientId, { client_id: clientId, client_name: 'Claude', redirect_uris: [REDIRECT] })
  const res = await login(clientId)
  expect(res.statusCode).toBe(302)
  const code = new URL(res.headers.location as string).searchParams.get('code')!
  expect((await exchange(clientId, code)).statusCode).toBe(200)
  metadataDocs.set('https://evil.example/meta', { client_id: 'https://autre.example/meta', redirect_uris: [REDIRECT] })
  expect((await login('https://evil.example/meta')).statusCode).toBe(400)
})

describe('public address', () => {
  beforeEach(async () => { await build({ MCP_PUBLIC_URL: 'https://kasbah.example.org' }) })

  it('announces the https address when the request arrives under that name, the local network one otherwise', async () => {
    const pub = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp', headers: { host: 'kasbah.example.org' } })
    expect(pub.json()).toMatchObject({ resource: 'https://kasbah.example.org/mcp', authorization_servers: ['https://kasbah.example.org'] })
    const lan = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server', headers: { host: 'kasbah:8787' } })
    expect(lan.json()).toMatchObject({ issuer: 'http://kasbah:8787', token_endpoint: 'http://kasbah:8787/oauth/token', code_challenge_methods_supported: ['S256'] })
  })

  it('adds that name to the accepted hosts', () => {
    expect(createMcpAuth({ config: mcpAuthConfigSchema.parse({ MCP_PUBLIC_URL: 'https://kasbah.example.org' }), logger: pino({ level: 'silent' }) }).publicHosts)
      .toEqual(['kasbah.example.org'])
  })
})
