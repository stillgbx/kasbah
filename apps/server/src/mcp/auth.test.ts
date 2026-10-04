import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import pino from 'pino'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMcpAuth, hashPassword, mcpAuthConfigSchema, verifyPassword } from './auth'

// Le serveur d'autorisation seul, devant une route protégée factice : les refus que le parcours
// heureux (server.test.ts, vrai client du SDK) ne traverse pas.

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
    sub.get('/mcp', { onRequest: auth.requireToken }, async () => ({ ok: true }))
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

it('hache et vérifie un mot de passe', async () => {
  const h = await hashPassword('secret')
  expect(h).toMatch(/^scrypt\$/)
  expect(await verifyPassword('secret', h)).toBe(true)
  expect(await verifyPassword('Secret', h)).toBe(false)
  expect(await verifyPassword('secret', 'n’importe quoi')).toBe(false)
})

it('va de l’enregistrement au jeton, et le jeton ouvre /mcp', async () => {
  const { tokens } = await signIn()
  expect((await callMcp(tokens.access_token)).statusCode).toBe(200)
})

it('renvoie vers le client avec code, state et émetteur', async () => {
  const clientId = (await register()).json().client_id
  const res = await login(clientId)
  expect(res.statusCode).toBe(302)
  const back = new URL(res.headers.location as string)
  expect(back.origin + back.pathname).toBe(REDIRECT)
  expect(back.searchParams.get('state')).toBe('xyz')
  expect(back.searchParams.get('iss')).toBe('http://localhost:80')
})

it('refuse un mauvais mot de passe ou un compte inconnu, sans renvoyer vers le client', async () => {
  const clientId = (await register()).json().client_id
  for (const res of [await login(clientId, 'faux'), await login(clientId, 'bon-mot-de-passe', 'inconnu')]) {
    expect(res.statusCode).toBe(401)
    expect(res.headers.location).toBeUndefined()
    expect(res.body).toContain('incorrect')
  }
  expect((await login(clientId, 'faux')).body).toContain('value="lou"')
})

it('bloque les connexions après dix échecs, un quart d’heure', async () => {
  const clientId = (await register()).json().client_id
  for (let i = 0; i < 10; i++) await login(clientId, 'faux')
  expect((await login(clientId)).statusCode).toBe(429)
  clock += 15 * 60_000 + 1
  expect((await login(clientId)).statusCode).toBe(302)
})

it('ne renvoie jamais vers une adresse que le client n’a pas déclarée', async () => {
  const clientId = (await register()).json().client_id
  const res = await app.inject({ method: 'GET', url: `/oauth/authorize?${new URLSearchParams(authorizeParams(clientId, { redirect_uri: 'https://evil.example/cb' }))}` })
  expect(res.statusCode).toBe(400)
  expect(res.headers.location).toBeUndefined()
})

it('exige PKCE S256', async () => {
  const clientId = (await register()).json().client_id
  const res = await app.inject({ method: 'GET', url: `/oauth/authorize?${new URLSearchParams(authorizeParams(clientId, { code_challenge_method: 'plain' }))}` })
  expect(res.statusCode).toBe(400)
})

it('montre le client et sa destination sur la page de connexion', async () => {
  const clientId = (await register()).json().client_id
  const res = await app.inject({ method: 'GET', url: `/oauth/authorize?${new URLSearchParams(authorizeParams(clientId))}` })
  expect(res.statusCode).toBe(200)
  expect(res.body).toContain('<strong>Claude</strong>')
  expect(res.body).toContain('<svg aria-hidden="true"') // le logo de l'app, dans la page
  expect(res.body).toContain('claude.ai')
  expect(res.headers['x-frame-options']).toBe('DENY')
  // `form-action` bloquerait aussi la redirection vers le client qui suit l'envoi (vu dans le navigateur)
  expect(res.headers['content-security-policy']).not.toContain('form-action')
})

it('refuse une redirection en http hors de la machine du client', async () => {
  expect((await register(['http://192.168.1.20/cb'])).statusCode).toBe(400)
  expect((await register(['http://127.0.0.1:33418/callback'])).statusCode).toBe(201)
})

it('refuse un code avec le mauvais vérificateur, un code rejoué ou expiré', async () => {
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

it('tourne le jeton de renouvellement : l’ancien ne sert plus', async () => {
  const { clientId, tokens } = await signIn()
  const next = await refresh(clientId, tokens.refresh_token)
  expect(next.statusCode).toBe(200)
  expect((await callMcp(next.json().access_token)).statusCode).toBe(200)
  expect((await refresh(clientId, tokens.refresh_token)).statusCode).toBe(400)
})

it('fait expirer le jeton d’accès au bout d’une heure', async () => {
  const { tokens } = await signIn()
  clock += 60 * 60_000 + 1
  const res = await callMcp(tokens.access_token)
  expect(res.statusCode).toBe(401)
  expect(res.headers['www-authenticate']).toContain('error="invalid_token"')
})

it('coupe les jetons d’un compte retiré du fichier', async () => {
  const { clientId, tokens } = await signIn()
  writeFileSync(usersFile, JSON.stringify({ users: [] }))
  expect((await callMcp(tokens.access_token)).statusCode).toBe(401)
  expect((await refresh(clientId, tokens.refresh_token)).statusCode).toBe(400)
})

it('garde les jetons après un redémarrage', async () => {
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

it('accepte un client décrit par son document de métadonnées (client_id = URL)', async () => {
  const clientId = 'https://claude.ai/oauth/mcp-client-metadata'
  metadataDocs.set(clientId, { client_id: clientId, client_name: 'Claude', redirect_uris: [REDIRECT] })
  const res = await login(clientId)
  expect(res.statusCode).toBe(302)
  const code = new URL(res.headers.location as string).searchParams.get('code')!
  expect((await exchange(clientId, code)).statusCode).toBe(200)
  metadataDocs.set('https://evil.example/meta', { client_id: 'https://autre.example/meta', redirect_uris: [REDIRECT] })
  expect((await login('https://evil.example/meta')).statusCode).toBe(400)
})

describe('adresse publique', () => {
  beforeEach(async () => { await build({ MCP_PUBLIC_URL: 'https://kasbah.example.org' }) })

  it('annonce l’adresse https quand la requête arrive sous ce nom, celle du réseau local sinon', async () => {
    const pub = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp', headers: { host: 'kasbah.example.org' } })
    expect(pub.json()).toMatchObject({ resource: 'https://kasbah.example.org/mcp', authorization_servers: ['https://kasbah.example.org'] })
    const lan = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server', headers: { host: 'kasbah:8787' } })
    expect(lan.json()).toMatchObject({ issuer: 'http://kasbah:8787', token_endpoint: 'http://kasbah:8787/oauth/token', code_challenge_methods_supported: ['S256'] })
  })

  it('ajoute ce nom aux hôtes acceptés', () => {
    expect(createMcpAuth({ config: mcpAuthConfigSchema.parse({ MCP_PUBLIC_URL: 'https://kasbah.example.org' }), logger: pino({ level: 'silent' }) }).publicHosts)
      .toEqual(['kasbah.example.org'])
  })
})
