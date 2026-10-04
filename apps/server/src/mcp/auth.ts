import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../core/atomic-file'
import { REPO_ROOT, SERVER_ROOT, stateFile } from '../core/paths'

// Authentification de `/mcp` : Kasbah est à la fois le serveur de ressource et son propre serveur
// d'autorisation OAuth 2.1, le minimum que demande un connecteur claude.ai (qui appelle depuis le
// cloud d'Anthropic, donc depuis Internet). Jeton exigé PARTOUT, réseau local compris : un seul
// chemin, et rien ne dépend d'un `Host` qu'un client peut forger.
//
// - Comptes : `mcp-users.json` à côté du `.env` serveur (hors dépôt), mots de passe en scrypt,
//   écrits par `npm run mcp-user`. Relu à chaque connexion : retirer un compte coupe aussi ses jetons.
// - Clients : enregistrement dynamique (`/oauth/register`, RFC 7591) ou document de métadonnées
//   (client_id = URL https, spec 2026-07-28). Clients publics : PKCE S256 obligatoire, pas de secret.
// - Jetons opaques, gardés hachés dans `.state/mcp-auth.json` : accès 1 h, renouvellement 90 jours
//   glissants, tourné à chaque usage.

export const mcpAuthConfigSchema = z.object({
  MCP_USERS_FILE: z.string().trim().default(resolve(SERVER_ROOT, 'mcp-users.json')),
  MCP_AUTH_FILE: z.string().trim().default(stateFile('mcp-auth.json')),
  /** Adresse publique (tunnel), ex. `https://kasbah.example.com` : son nom est accepté, et sert d'émetteur en https. */
  MCP_PUBLIC_URL: z.url().optional(),
})
export type McpAuthConfig = z.infer<typeof mcpAuthConfigSchema>

const ACCESS_TTL_MS = 60 * 60_000
const REFRESH_TTL_MS = 90 * 24 * 60 * 60_000
const CODE_TTL_MS = 60_000
const MAX_CLIENTS = 50
const LOCK_WINDOW_MS = 15 * 60_000
const MAX_FAILURES = 10

// --- mots de passe ---------------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1 }
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((ok, ko) =>
  scrypt(password, salt, 32, SCRYPT, (err, key) => (err ? ko(err) : ok(key))))

/** `scrypt$<sel base64url>$<clé base64url>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('base64url')}$${(await derive(password, salt)).toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, key] = stored.split('$')
  if (algo !== 'scrypt' || !salt || !key) return false
  const expected = Buffer.from(key, 'base64url')
  const got = await derive(password, Buffer.from(salt, 'base64url'))
  return got.length === expected.length && timingSafeEqual(got, expected)
}

// --- fichiers ---------------------------------------------------------------------------------

export const usersFileSchema = z.object({
  users: z.array(z.object({ name: z.string().min(1), password: z.string().min(1) })).default([]),
})
export type UsersFile = z.infer<typeof usersFileSchema>

export async function readUsers(path: string): Promise<UsersFile> {
  try { return usersFileSchema.parse(JSON.parse(await readFile(path, 'utf8'))) } catch { return { users: [] } }
}

// Écritures du fichier des comptes (script `mcp-user` et Réglages). Un fichier absent est vide ; un
// fichier illisible fait ÉCHOUER l'écriture plutôt que d'être écrasé par une liste vide.
export const userNameSchema = z.string().trim().regex(/^[\w.@-]{1,64}$/, 'letters, digits, . _ @ - (64 max)')
export const passwordSchema = z.string().min(8, '8 characters at least').max(200)

async function readUsersForEdit(path: string): Promise<UsersFile> {
  let text: string
  try { text = await readFile(path, 'utf8') } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { users: [] }
    throw err
  }
  try { return usersFileSchema.parse(JSON.parse(text)) } catch {
    throw new Error(`${path} is unreadable: fix or remove it by hand`)
  }
}
const writeUsers = (path: string, file: UsersFile) => writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })

/** Crée le compte, ou change son mot de passe. Rend les noms. */
export async function saveUser(path: string, name: string, password: string): Promise<string[]> {
  const file = await readUsersForEdit(path)
  const users = [...file.users.filter((u) => u.name !== name), { name, password: await hashPassword(password) }]
  await writeUsers(path, { users })
  return users.map((u) => u.name)
}

/** Retire le compte (ses jetons ne passent plus) ; `null` s'il n'existait pas. */
export async function deleteUser(path: string, name: string): Promise<string[] | null> {
  const file = await readUsersForEdit(path)
  const users = file.users.filter((u) => u.name !== name)
  if (users.length === file.users.length) return null
  await writeUsers(path, { users })
  return users.map((u) => u.name)
}

const grantSchema = z.object({ clientId: z.string(), user: z.string(), expiresAt: z.number() })
const stateSchema = z.object({
  clients: z.record(z.string(), z.object({ name: z.string().optional(), redirectUris: z.array(z.string()), createdAt: z.number() })).default({}),
  access: z.record(z.string(), grantSchema).default({}),
  refresh: z.record(z.string(), grantSchema).default({}),
})
type AuthState = z.infer<typeof stateSchema>
type Grant = z.infer<typeof grantSchema>

const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url')
const token = () => randomBytes(32).toString('base64url')

// Le logo de l'app, DANS la page : le tunnel ne publie que `/mcp`, `/oauth` et `/.well-known`, pas `/icons`.
const LOGO = (() => {
  try { return readFileSync(resolve(REPO_ROOT, 'apps/web/public/icons/icon.svg'), 'utf8').replace(/^<svg /, '<svg aria-hidden="true" ') } catch { return '' }
})()

// --- clients --------------------------------------------------------------------------------

interface ClientInfo { name?: string; redirectUris: string[] }

/** Une redirection en https, ou en http vers la machine du client (Claude Code, mcp-remote). */
function redirectAllowed(uri: string): boolean {
  try {
    const u = new URL(uri)
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
  } catch { return false }
}

const cimdSchema = z.object({ client_id: z.string(), client_name: z.string().optional(), redirect_uris: z.array(z.string()).min(1) })

export interface McpAuthDeps {
  config: McpAuthConfig
  logger: Logger
  now?: () => number
  /** Lecture d'un document de métadonnées client (tests). */
  fetch?: typeof fetch
}

// Ce qu'on peut joindre sous le nom PUBLIC : le serveur MCP et son autorisation, rien d'autre. Un
// proxy inverse (celui du NAS) transmet tout ce qui arrive sous son nom ; c'est ici qu'on trie, pour
// que l'interface, l'API REST (sans authentification) et les caméras restent au réseau local.
const PUBLIC_PATHS = new Set([
  '/mcp',
  '/oauth/authorize', '/oauth/token', '/oauth/register',
  '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server',
])

/**
 * Crochet `onRequest` GLOBAL : sous un nom public (`Host`, ou `X-Forwarded-Host` d'un proxy), 404 hors
 * des chemins du MCP. À poser avant toute route.
 */
export function publicHostFilter(publicHosts: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!publicHosts.length) return
    const forwarded = String(req.headers['x-forwarded-host'] ?? '').split(',')[0]!.trim().replace(/:\d+$/, '')
    if (!publicHosts.includes(req.hostname) && !publicHosts.includes(forwarded)) return
    if (PUBLIC_PATHS.has(req.url.split('?')[0]!)) return
    await reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } })
  }
}

export interface McpAuth {
  /** Routes OAuth et métadonnées, à monter dans la sous-application de `/mcp` (même contrôle de `Host`). */
  routes(sub: FastifyInstance): void
  /** Crochet `onRequest` de `/mcp` : 401 et l'adresse des métadonnées sans jeton valide. */
  requireToken(req: FastifyRequest, reply: FastifyReply): Promise<void>
  /** Noms d'hôte en plus de ceux du réseau local (celui de `MCP_PUBLIC_URL`). */
  publicHosts: string[]
}

export function createMcpAuth(deps: McpAuthDeps): McpAuth {
  const { config, logger } = deps
  const now = deps.now ?? Date.now
  const doFetch = deps.fetch ?? fetch
  const publicUrl = config.MCP_PUBLIC_URL ? new URL(config.MCP_PUBLIC_URL) : null

  // Émetteur et ressource se lisent sur la requête : `http://kasbah:8787` sur le réseau local,
  // l'adresse publique (https, le tunnel termine le TLS) quand le Host est le sien.
  const baseOf = (req: FastifyRequest) => (publicUrl && req.host === publicUrl.host ? publicUrl.origin : `http://${req.host}`)

  let state: Promise<AuthState> | null = null
  const load = () => (state ??= readFile(config.MCP_AUTH_FILE, 'utf8')
    .then((t) => stateSchema.parse(JSON.parse(t)))
    .catch(() => stateSchema.parse({})))
  const save = async (s: AuthState) => {
    const t = now()
    for (const map of [s.access, s.refresh]) for (const [k, g] of Object.entries(map)) if (g.expiresAt <= t) delete map[k]
    try { await writeFileAtomic(config.MCP_AUTH_FILE, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 }) } catch (err) { logger.warn({ err }, 'mcp auth state not saved') }
  }

  // Les comptes, relus quand le fichier change (un compte retiré coupe ses jetons sans redémarrage).
  let users: { mtime: number; file: UsersFile } | null = null
  const currentUsers = async () => {
    const mtime = await stat(config.MCP_USERS_FILE).then((s) => s.mtimeMs, () => -1)
    if (users?.mtime !== mtime) users = { mtime, file: await readUsers(config.MCP_USERS_FILE) }
    return users.file
  }

  const cimdCache = new Map<string, { info: ClientInfo; until: number }>()
  async function clientInfo(clientId: string): Promise<ClientInfo | null> {
    if (!clientId.startsWith('https://')) return (await load()).clients[clientId] ?? null
    const hit = cimdCache.get(clientId)
    if (hit && hit.until > now()) return hit.info
    try {
      const res = await doFetch(clientId, { signal: AbortSignal.timeout(5000), redirect: 'error' })
      const text = await res.text()
      if (!res.ok || text.length > 64_000) return null
      const doc = cimdSchema.parse(JSON.parse(text))
      if (doc.client_id !== clientId) return null
      const info = { ...(doc.client_name ? { name: doc.client_name } : {}), redirectUris: doc.redirect_uris }
      cimdCache.set(clientId, { info, until: now() + 60 * 60_000 })
      return info
    } catch { return null }
  }

  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string; user: string; expiresAt: number }>()
  const failures: number[] = []

  async function issue(clientId: string, user: string) {
    const s = await load()
    const access = token(), refresh = token()
    s.access[sha256(access)] = { clientId, user, expiresAt: now() + ACCESS_TTL_MS }
    s.refresh[sha256(refresh)] = { clientId, user, expiresAt: now() + REFRESH_TTL_MS }
    await save(s)
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh }
  }

  const userExists = async (g: Grant) => (await currentUsers()).users.some((u) => u.name === g.user)

  // Paramètres de `/oauth/authorize`, en query (GET) ou dans le formulaire (POST).
  const authorizeSchema = z.object({
    response_type: z.literal('code'),
    client_id: z.string().min(1),
    redirect_uri: z.string().min(1),
    code_challenge: z.string().min(43).max(128),
    code_challenge_method: z.literal('S256'),
    state: z.string().optional(),
    resource: z.string().optional(),
    scope: z.string().optional(),
  })
  type AuthorizeParams = z.infer<typeof authorizeSchema>

  // Une requête invalide n'est JAMAIS renvoyée vers la redirection demandée : page d'erreur ici.
  async function checkAuthorize(raw: unknown): Promise<{ params: AuthorizeParams; client: ClientInfo } | string> {
    const p = authorizeSchema.safeParse(raw)
    if (!p.success) return 'Requête d’autorisation invalide (PKCE S256 obligatoire).'
    const client = await clientInfo(p.data.client_id)
    if (!client) return 'Client inconnu.'
    if (!client.redirectUris.includes(p.data.redirect_uri)) return 'Adresse de retour non déclarée par ce client.'
    return { params: p.data, client }
  }

  // Pas de `form-action` dans la CSP : le navigateur l'applique aussi à la redirection qui suit le
  // formulaire, et refusait le retour vers le client (vu dans le navigateur, invisible aux tests).
  const page = (reply: FastifyReply, status: number, body: string) => reply.code(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('x-frame-options', 'DENY')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
    .header('cache-control', 'no-store')
    .send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kasbah — connexion</title>
<style>body{font:16px system-ui,sans-serif;background:#f4f1ec;color:#222;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box}
@media (prefers-color-scheme:dark){body{background:#1b1a18;color:#eee}main{background:#26241f!important}input{background:#1b1a18;color:#eee;border-color:#555!important}}
main{background:#fff;border-radius:12px;padding:24px;max-width:400px;width:100%;box-sizing:border-box;box-shadow:0 2px 12px #0002}.brand{display:flex;align-items:center;gap:12px;margin:0 0 16px}.brand svg{width:40px;height:40px;flex:none}h1{font-size:20px;margin:0}
p{margin:0 0 16px;line-height:1.4}label{display:block;margin:12px 0 4px;font-size:14px}input{width:100%;box-sizing:border-box;padding:10px;font:inherit;border:1px solid #ccc;border-radius:8px}
button{margin-top:20px;width:100%;padding:12px;font:inherit;font-weight:600;border:0;border-radius:8px;background:#b5562d;color:#fff;cursor:pointer}.err{color:#c0392b}</style></head>
<body><main><header class="brand">${LOGO}<h1>Kasbah</h1></header>${body}</main></body></html>`)

  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

  function loginForm(reply: FastifyReply, status: number, params: AuthorizeParams, client: ClientInfo, error?: string, username = '') {
    const back = new URL(params.redirect_uri).host
    const hidden = Object.entries(params).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`).join('')
    return page(reply, status, `<p><strong>${esc(client.name ?? 'Un client MCP')}</strong> demande l’accès à la maison (retour vers <strong>${esc(back)}</strong>).</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/oauth/authorize">${hidden}
<label for="u">Utilisateur</label><input id="u" name="username" value="${esc(username)}" autocomplete="username" required${username ? '' : ' autofocus'}>
<label for="p">Mot de passe</label><input id="p" name="password" type="password" autocomplete="current-password" required${username ? ' autofocus' : ''}>
<button type="submit">Autoriser</button></form>`)
  }

  const oauthError = (reply: FastifyReply, status: number, error: string, description?: string) =>
    reply.code(status).header('cache-control', 'no-store').send({ error, ...(description ? { error_description: description } : {}) })

  return {
    publicHosts: publicUrl ? [publicUrl.hostname] : [],

    async requireToken(req, reply) {
      const metadata = `${baseOf(req)}/.well-known/oauth-protected-resource/mcp`
      const m = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')
      const grant = m ? (await load()).access[sha256(m[1]!)] : undefined
      if (grant && grant.expiresAt > now() && await userExists(grant)) return
      await reply.code(401)
        .header('www-authenticate', `Bearer resource_metadata="${metadata}"${m ? ', error="invalid_token"' : ''}`)
        .send({ jsonrpc: '2.0', error: { code: -32001, message: 'authentication required' }, id: null })
    },

    routes(sub) {
      // Les formulaires OAuth (`/oauth/token`, page de connexion) arrivent en urlencoded.
      sub.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
        done(null, Object.fromEntries(new URLSearchParams(body as string)))
      })

      const resourceMetadata = async (req: FastifyRequest) => ({
        resource: `${baseOf(req)}/mcp`,
        authorization_servers: [baseOf(req)],
        bearer_methods_supported: ['header'],
        resource_name: 'Kasbah',
      })
      sub.get('/.well-known/oauth-protected-resource', resourceMetadata)
      sub.get('/.well-known/oauth-protected-resource/mcp', resourceMetadata)

      sub.get('/.well-known/oauth-authorization-server', async (req) => {
        const base = baseOf(req)
        return {
          issuer: base,
          authorization_endpoint: `${base}/oauth/authorize`,
          token_endpoint: `${base}/oauth/token`,
          registration_endpoint: `${base}/oauth/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          client_id_metadata_document_supported: true,
          authorization_response_iss_parameter_supported: true,
        }
      })

      sub.post('/oauth/register', async (req, reply) => {
        const body = z.object({ redirect_uris: z.array(z.string()).min(1), client_name: z.string().max(100).optional() }).safeParse(req.body)
        if (!body.success) return oauthError(reply, 400, 'invalid_client_metadata')
        if (!body.data.redirect_uris.every(redirectAllowed)) return oauthError(reply, 400, 'invalid_redirect_uri', 'https, or http to localhost')
        const s = await load()
        // Ouvert à Internet : on borne le nombre de clients, les plus anciens sortent.
        const ids = Object.keys(s.clients).sort((a, b) => s.clients[a]!.createdAt - s.clients[b]!.createdAt)
        for (const id of ids.slice(0, Math.max(0, ids.length - MAX_CLIENTS + 1))) delete s.clients[id]
        const clientId = `kasbah-${token().slice(0, 22)}`
        s.clients[clientId] = { ...(body.data.client_name ? { name: body.data.client_name } : {}), redirectUris: body.data.redirect_uris, createdAt: now() }
        await save(s)
        logger.info({ clientId, name: body.data.client_name }, 'mcp client registered')
        return reply.code(201).send({
          client_id: clientId, client_id_issued_at: Math.floor(now() / 1000),
          redirect_uris: body.data.redirect_uris, ...(body.data.client_name ? { client_name: body.data.client_name } : {}),
          token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
        })
      })

      sub.get('/oauth/authorize', async (req, reply) => {
        const checked = await checkAuthorize(req.query)
        if (typeof checked === 'string') return page(reply, 400, `<p class="err">${esc(checked)}</p>`)
        return loginForm(reply, 200, checked.params, checked.client)
      })

      sub.post('/oauth/authorize', async (req, reply) => {
        const checked = await checkAuthorize(req.body)
        if (typeof checked === 'string') return page(reply, 400, `<p class="err">${esc(checked)}</p>`)
        const { params, client } = checked
        // Plafond GLOBAL d'échecs : derrière un tunnel, toutes les requêtes ont la même adresse.
        while (failures.length && failures[0]! <= now() - LOCK_WINDOW_MS) failures.shift()
        if (failures.length >= MAX_FAILURES) return loginForm(reply, 429, params, client, 'Trop d’essais : réessayer dans un quart d’heure.')
        const { username = '', password = '' } = req.body as { username?: string; password?: string }
        const user = (await currentUsers()).users.find((u) => u.name === username)
        // Un compte inconnu coûte le même calcul qu'un mauvais mot de passe.
        const ok = await verifyPassword(password, user?.password ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
        if (!user || !ok) {
          failures.push(now())
          logger.warn({ username }, 'mcp login refused')
          return loginForm(reply, 401, params, client, 'Utilisateur ou mot de passe incorrect.', username)
        }
        const code = token()
        codes.set(code, { clientId: params.client_id, redirectUri: params.redirect_uri, challenge: params.code_challenge, user: user.name, expiresAt: now() + CODE_TTL_MS })
        logger.info({ user: user.name, client: client.name ?? params.client_id }, 'mcp client authorized')
        const to = new URL(params.redirect_uri)
        to.searchParams.set('code', code)
        if (params.state !== undefined) to.searchParams.set('state', params.state)
        to.searchParams.set('iss', baseOf(req))
        return reply.code(302).header('cache-control', 'no-store').redirect(to.href)
      })

      sub.post('/oauth/token', async (req, reply) => {
        const body = (req.body ?? {}) as Record<string, string | undefined>
        if (body.grant_type === 'authorization_code') {
          const entry = body.code ? codes.get(body.code) : undefined
          if (body.code) codes.delete(body.code)
          const challenge = createHash('sha256').update(body.code_verifier ?? '').digest('base64url')
          if (!entry || entry.expiresAt <= now() || entry.clientId !== body.client_id || entry.redirectUri !== body.redirect_uri || entry.challenge !== challenge) {
            return oauthError(reply, 400, 'invalid_grant')
          }
          return reply.header('cache-control', 'no-store').send(await issue(entry.clientId, entry.user))
        }
        if (body.grant_type === 'refresh_token') {
          const s = await load()
          const key = sha256(body.refresh_token ?? '')
          const grant = s.refresh[key]
          if (!grant || grant.expiresAt <= now() || (body.client_id && grant.clientId !== body.client_id) || !await userExists(grant)) {
            return oauthError(reply, 400, 'invalid_grant')
          }
          delete s.refresh[key]
          return reply.header('cache-control', 'no-store').send(await issue(grant.clientId, grant.user))
        }
        return oauthError(reply, 400, 'unsupported_grant_type')
      })
    },
  }
}
