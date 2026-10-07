import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../core/atomic-file'
import { REPO_ROOT, SERVER_ROOT, stateFile, userStateDir } from '../core/paths'

// Authentification de `/mcp` : Kasbah est à la fois le serveur de ressource et son propre serveur
// d'autorisation OAuth 2.1, le minimum que demande un connecteur claude.ai (qui appelle depuis le
// cloud d'Anthropic, donc depuis Internet). Jeton exigé PARTOUT, réseau local compris : un seul
// chemin, et rien ne dépend d'un `Host` qu'un client peut forger.
//
// - Comptes : `mcp-users.json` à côté du `.env` serveur (hors dépôt), mots de passe en scrypt,
//   écrits par `npm run mcp-user`. Relu à chaque connexion : retirer un compte coupe aussi ses jetons.
//   Les mêmes comptes ouvrent l'application sous le nom public (`http/session.ts`).
// - Clients : enregistrement dynamique (`/oauth/register`, RFC 7591) ou document de métadonnées
//   (client_id = URL https, spec 2026-07-28). Clients publics : PKCE S256 obligatoire, pas de secret.
// - Jetons opaques, gardés hachés dans `.state/mcp-auth.json` : accès 1 h, renouvellement 90 jours
//   glissants, tourné à chaque usage.

export const mcpAuthConfigSchema = z.object({
  MCP_USERS_FILE: z.string().trim().default(resolve(SERVER_ROOT, 'mcp-users.json')),
  MCP_AUTH_FILE: z.string().trim().default(stateFile('mcp-auth.json')),
  /** Adresse publique (tunnel), ex. `https://kasbah.example.com` : son nom est accepté, et sert d'émetteur en https. */
  MCP_PUBLIC_URL: z.url().optional(),
  /** Échecs de connexion d'affilée qui bloquent un compte (0 = jamais), pour l'app comme pour le MCP. */
  KASBAH_LOGIN_MAX_FAILURES: z.coerce.number().int().min(0).default(5),
  /** Durée du blocage d'un compte, en minutes. */
  KASBAH_LOGIN_LOCK_MINUTES: z.coerce.number().positive().default(15),
})
export type McpAuthConfig = z.infer<typeof mcpAuthConfigSchema>

const ACCESS_TTL_MS = 60 * 60_000
const REFRESH_TTL_MS = 90 * 24 * 60 * 60_000
const CODE_TTL_MS = 60_000
const MAX_CLIENTS = 50
const GLOBAL_WINDOW_MS = 15 * 60_000
const GLOBAL_MAX_FAILURES = 10
const MAX_TRACKED_NAMES = 1000

// --- tentatives de connexion -------------------------------------------------------------------

/**
 * Les deux pages de connexion (application et MCP) passent par le même gardien, les comptes étant
 * partagés. Deux verrous : un plafond GLOBAL d'échecs (derrière un proxy, toutes les requêtes ont la
 * même adresse) et le blocage d'un COMPTE après `maxFailures` échecs d'affilée, chacun à moins de
 * `lockMs` du précédent. Suivi par nom saisi, qu'il existe ou non : le blocage ne trahit pas les
 * comptes. En mémoire : un redémarrage débloque tout. Les sessions déjà ouvertes ne sont pas touchées.
 */
export class LoginGuard {
  private readonly global: number[] = []
  private readonly names = new Map<string, { count: number; last: number }>()

  constructor(private readonly opts: { maxFailures: number; lockMs: number; now: () => number; logger?: Logger }) {}

  /** `null` si l'essai est permis ; sinon l'instant où il le redeviendra. */
  blockedUntil(name: string): number | null {
    const t = this.opts.now()
    while (this.global.length && this.global[0]! <= t - GLOBAL_WINDOW_MS) this.global.shift()
    if (this.global.length >= GLOBAL_MAX_FAILURES) return this.global[0]! + GLOBAL_WINDOW_MS
    const n = this.names.get(name)
    const { maxFailures, lockMs } = this.opts
    if (maxFailures > 0 && n && n.count >= maxFailures && t - n.last < lockMs) return n.last + lockMs
    return null
  }

  fail(name: string): void {
    const t = this.opts.now()
    this.global.push(t)
    const prev = this.names.get(name)
    const count = prev && t - prev.last < this.opts.lockMs ? prev.count + 1 : 1
    this.names.delete(name)
    this.names.set(name, { count, last: t })
    if (count === this.opts.maxFailures) this.opts.logger?.warn({ username: name, minutes: this.opts.lockMs / 60_000 }, 'login locked for this account')
    // Borne : les noms les plus anciennement essayés sortent (la Map garde l'ordre d'insertion).
    if (this.names.size > MAX_TRACKED_NAMES) this.names.delete(this.names.keys().next().value!)
  }

  succeed(name: string): void { this.names.delete(name) }
}

/** Message de refus pour un essai bloqué jusqu'à `until`. */
export const lockedMessage = (until: number, now: number) =>
  `Trop d’essais : réessayer dans ${Math.max(1, Math.ceil((until - now) / 60_000))} min.`

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

/** Retire le compte (ses jetons ne passent plus) et ses comptes musicaux ; `null` s'il n'existait pas. */
export async function deleteUser(path: string, name: string): Promise<string[] | null> {
  const file = await readUsersForEdit(path)
  const users = file.users.filter((u) => u.name !== name)
  if (users.length === file.users.length) return null
  await writeUsers(path, { users })
  await rm(userStateDir(name), { recursive: true, force: true })
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

export const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url')
export const token = () => randomBytes(32).toString('base64url')

// Le logo de l'app, DANS la page : ni `/icons` ni le reste de l'interface ne sont servis sans session.
const LOGO = (() => {
  try { return readFileSync(resolve(REPO_ROOT, 'apps/web/public/icons/icon.svg'), 'utf8').replace(/^<svg /, '<svg aria-hidden="true" ') } catch { return '' }
})()

// La police de l'app (Plus Jakarta Sans, jeu latin, 28 Ko), DANS la page pour la même raison. Sans
// elle, la page retombe sur la police du système.
const FONT_FACE = (() => {
  const file = 'node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2'
  for (const dir of [REPO_ROOT, resolve(REPO_ROOT, 'apps/web')]) {
    try {
      const data = readFileSync(resolve(dir, file)).toString('base64')
      return `@font-face{font-family:'Plus Jakarta Sans Variable';font-style:normal;font-display:swap;font-weight:200 800;src:url(data:font/woff2;base64,${data}) format('woff2-variations')}`
    } catch { /* dossier suivant */ }
  }
  return ''
})()

// Le thème « Kasbah » (apps/web/src/themes/kasbah.ts et les jetons dérivés de `cssVars`), clair et
// sombre selon le système : la page n'a ni script ni accès au thème choisi dans l'app.
const PAGE_CSS = `${FONT_FACE}
:root{--bg:#e9edf1;--surface:#fff;--surface2:#f2f5f8;--text:#141a22;--muted:#5f6a78;--line:rgba(20,26,34,.09);--accent:#1f6f78;--accent-soft:rgba(31,111,120,.12);--on-accent:#fff;--error:#d24a43;--shadow:0 8px 30px rgba(20,26,34,.08);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0d1420;--surface:#161e2d;--surface2:#1d2839;--text:#e8edf3;--muted:#8d9ab0;--line:rgba(232,237,243,.08);--accent:#4fb3bd;--accent-soft:rgba(79,179,189,.18);--on-accent:#0d1420;--error:#e57373;--shadow:0 8px 30px rgba(0,0,0,.35);color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--text);font:15px/1.5 'Plus Jakarta Sans Variable','Plus Jakarta Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:28px 24px 24px}
.brand{display:flex;align-items:center;gap:12px;margin:0 0 20px}.brand svg{width:44px;height:44px;flex:none;border-radius:12px}
h1{font-size:22px;font-weight:600;letter-spacing:-.02em;margin:0}
p{margin:0 0 16px;color:var(--muted);font-size:14px}p strong{color:var(--text);font-weight:600}
.err{color:var(--error);background:var(--surface2);border-radius:12px;padding:10px 12px;font-weight:500}
label{display:block;margin:16px 0 6px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
input{display:block;width:100%;height:44px;padding:0 14px;font:inherit;color:var(--text);background:var(--surface2);border:1px solid var(--line);border-radius:12px;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
button{display:block;margin-top:24px;width:100%;height:44px;border:0;border-radius:999px;background:var(--accent);color:var(--on-accent);font:inherit;font-weight:600;cursor:pointer;transition:filter .15s}
button:hover{filter:brightness(1.08)}button:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-soft)}`

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * Page HTML autonome des connexions (MCP et application) : styles et police en ligne, aucune
 * ressource externe. Pas de `form-action` dans la CSP : le navigateur l'applique aussi à la
 * redirection qui suit le formulaire, et refusait le retour vers le client (vu dans le navigateur,
 * invisible aux tests). `head` : balises en plus dans l'en-tête (le manifest de la connexion).
 */
export const htmlPage = (reply: FastifyReply, status: number, body: string, head = '') => reply.code(status)
  .header('content-type', 'text/html; charset=utf-8')
  .header('x-frame-options', 'DENY')
  .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; font-src data:; manifest-src 'self'; img-src 'self'; frame-ancestors 'none'")
  .header('cache-control', 'no-store')
  .send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kasbah — connexion</title>${head}
<style>${PAGE_CSS}</style></head>
<body><main><header class="brand">${LOGO}<h1>Kasbah</h1></header>${body}</main></body></html>`)

/** Lecteur des comptes, relu quand le fichier change (un compte retiré est refusé sans redémarrage). */
export function usersReader(path: string): () => Promise<UsersFile> {
  let cached: { mtime: number; file: UsersFile } | null = null
  return async () => {
    const mtime = await stat(path).then((s) => s.mtimeMs, () => -1)
    if (cached?.mtime !== mtime) cached = { mtime, file: await readUsers(path) }
    return cached.file
  }
}

// Haché factice : un compte inconnu coûte le même calcul qu'un mauvais mot de passe.
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

/**
 * Vérifie un nom et un mot de passe en passant par le gardien. `blocked` : refusé sans essai (le
 * gardien bloque) ; `null` : mauvais couple ; sinon le compte.
 */
export async function checkLogin(guard: LoginGuard, users: () => Promise<UsersFile>, username: string, password: string):
  Promise<{ user: UsersFile['users'][number] } | { blocked: number } | null> {
  const blocked = guard.blockedUntil(username)
  if (blocked !== null) return { blocked }
  const user = (await users()).users.find((u) => u.name === username)
  const ok = await verifyPassword(password, user?.password ?? DUMMY_HASH)
  if (!user || !ok) { guard.fail(username); return null }
  guard.succeed(username)
  return { user }
}

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

// Ce qu'on joint sous le nom PUBLIC sans session : le serveur MCP et son autorisation, qui ont leurs
// jetons. Un proxy inverse (celui du NAS) transmet tout ce qui arrive sous son nom ; c'est ici qu'on
// trie, le reste passe par la porte à session (`http/session.ts`).
const MCP_PATHS = new Set([
  '/mcp',
  '/oauth/authorize', '/oauth/token', '/oauth/register',
  '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server',
])

/** La requête arrive-t-elle sous un nom public (`Host`, ou premier `X-Forwarded-Host` d'un proxy) ? */
export function isPublicRequest(req: FastifyRequest, publicHosts: string[]): boolean {
  if (!publicHosts.length) return false
  const forwarded = String(req.headers['x-forwarded-host'] ?? '').split(',')[0]!.trim().replace(/:\d+$/, '')
  return publicHosts.includes(req.hostname) || publicHosts.includes(forwarded)
}

type Hook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>
const notFound: Hook = async (_req, reply) => { await reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } }) }

/**
 * Crochet `onRequest` GLOBAL : sous un nom public, les chemins du MCP passent, tout le reste va à
 * `gate` (404 par défaut). À poser avant toute route. Le réseau local n'est jamais filtré.
 */
export function publicHostFilter(publicHosts: string[], gate: Hook = notFound): Hook {
  return async (req, reply) => {
    if (!isPublicRequest(req, publicHosts)) return
    if (MCP_PATHS.has(req.url.split('?')[0]!)) return
    await gate(req, reply)
  }
}

export interface McpAuth {
  /** Routes OAuth et métadonnées, à monter dans la sous-application de `/mcp` (même contrôle de `Host`). */
  routes(sub: FastifyInstance): void
  /** Crochet `onRequest` de `/mcp` : 401 et l'adresse des métadonnées sans jeton valide ; sinon `req.sessionUser` = le compte du jeton. */
  requireToken(req: FastifyRequest, reply: FastifyReply): Promise<void>
  /** Noms d'hôte en plus de ceux du réseau local (celui de `MCP_PUBLIC_URL`). */
  publicHosts: string[]
  /** Gardien des connexions, partagé avec la page de connexion de l'application. */
  guard: LoginGuard
  /** Les comptes (partagés avec l'application). */
  users: () => Promise<UsersFile>
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
  const currentUsers = usersReader(config.MCP_USERS_FILE)
  const guard = new LoginGuard({
    maxFailures: config.KASBAH_LOGIN_MAX_FAILURES, lockMs: config.KASBAH_LOGIN_LOCK_MINUTES * 60_000, now, logger,
  })

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

  function loginForm(reply: FastifyReply, status: number, params: AuthorizeParams, client: ClientInfo, error?: string, username = '') {
    const back = new URL(params.redirect_uri).host
    const hidden = Object.entries(params).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`).join('')
    return htmlPage(reply, status, `<p><strong>${esc(client.name ?? 'Un client MCP')}</strong> demande l’accès à la maison (retour vers <strong>${esc(back)}</strong>).</p>
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
    guard,
    users: currentUsers,

    async requireToken(req, reply) {
      const metadata = `${baseOf(req)}/.well-known/oauth-protected-resource/mcp`
      const m = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')
      const grant = m ? (await load()).access[sha256(m[1]!)] : undefined
      if (grant && grant.expiresAt > now() && await userExists(grant)) {
        // les outils agissent au nom de ce compte (ses comptes musicaux)
        req.sessionUser = grant.user
        return
      }
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
        if (typeof checked === 'string') return htmlPage(reply, 400, `<p class="err">${esc(checked)}</p>`)
        return loginForm(reply, 200, checked.params, checked.client)
      })

      sub.post('/oauth/authorize', async (req, reply) => {
        const checked = await checkAuthorize(req.body)
        if (typeof checked === 'string') return htmlPage(reply, 400, `<p class="err">${esc(checked)}</p>`)
        const { params, client } = checked
        const { username = '', password = '' } = req.body as { username?: string; password?: string }
        const result = await checkLogin(guard, currentUsers, username, password)
        if (result && 'blocked' in result) return loginForm(reply, 429, params, client, lockedMessage(result.blocked, now()), username)
        if (!result) {
          logger.warn({ username }, 'mcp login refused')
          return loginForm(reply, 401, params, client, 'Utilisateur ou mot de passe incorrect.', username)
        }
        const { user } = result
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
