import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { readFile, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../core/atomic-file'
import { REPO_ROOT, SERVER_ROOT, stateFile, userStateDir } from '../core/paths'

// Authentication of `/mcp`: Kasbah is both the resource server and its own OAuth 2.1 authorization
// server, the minimum a claude.ai connector asks for (it calls from Anthropic's cloud, hence from the
// Internet). Token required EVERYWHERE, local network included: a single path, and nothing depends
// on a `Host` that a client can forge.
//
// - Accounts: `mcp-users.json` next to the server `.env` (outside the repo), passwords in scrypt,
//   written by `npm run mcp-user`. Re-read on each sign-in: removing an account also cuts its tokens.
//   The same accounts open the application under the public name (`http/session.ts`).
// - Clients: dynamic registration (`/oauth/register`, RFC 7591) or metadata document
//   (client_id = https URL, spec 2026-07-28). Public clients: PKCE S256 mandatory, no secret.
// - Opaque tokens, kept hashed in `.state/mcp-auth.json`: access 1 h, refresh 90 sliding days,
//   rotated on each use.

export const mcpAuthConfigSchema = z.object({
  MCP_USERS_FILE: z.string().trim().default(resolve(SERVER_ROOT, 'mcp-users.json')),
  MCP_AUTH_FILE: z.string().trim().default(stateFile('mcp-auth.json')),
  /** Public address (tunnel), e.g. `https://kasbah.example.com`: its name is accepted, and serves as the https issuer. */
  MCP_PUBLIC_URL: z.url().optional(),
  /** Consecutive sign-in failures that lock an account (0 = never), for the app as for the MCP. */
  KASBAH_LOGIN_MAX_FAILURES: z.coerce.number().int().min(0).default(5),
  /** Duration of an account lockout, in minutes. */
  KASBAH_LOGIN_LOCK_MINUTES: z.coerce.number().positive().default(15),
  /** Local network names on top of the ones always accepted (`isLanHost`), comma-separated. */
  KASBAH_LAN_HOSTS: z.string().default('').transform((s) => s.split(',').map((h) => h.trim()).filter(Boolean)),
})
export type McpAuthConfig = z.infer<typeof mcpAuthConfigSchema>

const ACCESS_TTL_MS = 60 * 60_000
const REFRESH_TTL_MS = 90 * 24 * 60 * 60_000
const CODE_TTL_MS = 60_000
const MAX_CLIENTS = 50
const GLOBAL_WINDOW_MS = 15 * 60_000
const GLOBAL_MAX_FAILURES = 10
const MAX_TRACKED_NAMES = 1000

// --- sign-in attempts --------------------------------------------------------------------------

/**
 * Both sign-in pages (application and MCP) go through the same guard, since the accounts are shared.
 * Two locks: a GLOBAL failure cap (behind a proxy, all requests have the same address) and the
 * lockout of an ACCOUNT after `maxFailures` consecutive failures, each less than `lockMs` after the
 * previous one. Tracked by the name typed, whether it exists or not: the lockout does not give the
 * accounts away. In memory: a restart unlocks everything. Sessions already open are not affected.
 */
export class LoginGuard {
  private readonly global: number[] = []
  private readonly names = new Map<string, { count: number; last: number }>()

  constructor(private readonly opts: { maxFailures: number; lockMs: number; now: () => number; logger?: Logger }) {}

  /** `null` if the attempt is allowed; otherwise the instant when it will be again. */
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
    // Bound: the names tried longest ago go out (the Map keeps insertion order).
    if (this.names.size > MAX_TRACKED_NAMES) this.names.delete(this.names.keys().next().value!)
  }

  succeed(name: string): void { this.names.delete(name) }
}

/** Refusal message for an attempt blocked until `until`. */
export const lockedMessage = (until: number, now: number) =>
  `Trop d’essais : réessayer dans ${Math.max(1, Math.ceil((until - now) / 60_000))} min.`

// --- passwords ------------------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1 }
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((ok, ko) =>
  scrypt(password, salt, 32, SCRYPT, (err, key) => (err ? ko(err) : ok(key))))

/** `scrypt$<base64url salt>$<base64url key>`. */
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

// --- files ------------------------------------------------------------------------------------

export const usersFileSchema = z.object({
  users: z.array(z.object({ name: z.string().min(1), password: z.string().min(1) })).default([]),
})
export type UsersFile = z.infer<typeof usersFileSchema>

export async function readUsers(path: string): Promise<UsersFile> {
  try { return usersFileSchema.parse(JSON.parse(await readFile(path, 'utf8'))) } catch { return { users: [] } }
}

// Writes to the accounts file (`mcp-user` script and Settings). A missing file is empty; an
// unreadable file makes the write FAIL rather than being overwritten by an empty list.
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

/** Creates the account, or changes its password. Returns the names. */
export async function saveUser(path: string, name: string, password: string): Promise<string[]> {
  const file = await readUsersForEdit(path)
  const users = [...file.users.filter((u) => u.name !== name), { name, password: await hashPassword(password) }]
  await writeUsers(path, { users })
  return users.map((u) => u.name)
}

/** Removes the account (its tokens no longer pass) and its music accounts; `null` if it did not exist. */
export async function deleteUser(path: string, name: string): Promise<string[] | null> {
  const file = await readUsersForEdit(path)
  const users = file.users.filter((u) => u.name !== name)
  if (users.length === file.users.length) return null
  await writeUsers(path, { users })
  await rm(userStateDir(name), { recursive: true, force: true })
  return users.map((u) => u.name)
}

// `pw`: fingerprint of the password hash when the grant was issued. Changing the password, or
// removing the account and creating it again, cuts the tokens; a grant without one (written before
// 2026-10-23) is refused, its client signs in again.
const grantSchema = z.object({ clientId: z.string(), user: z.string(), pw: z.string().optional(), expiresAt: z.number() })
const stateSchema = z.object({
  clients: z.record(z.string(), z.object({ name: z.string().optional(), redirectUris: z.array(z.string()), createdAt: z.number() })).default({}),
  access: z.record(z.string(), grantSchema).default({}),
  refresh: z.record(z.string(), grantSchema).default({}),
})
type AuthState = z.infer<typeof stateSchema>
type Grant = z.infer<typeof grantSchema>

export const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url')
/** Fingerprint of a password hash: a session or a token does not survive a change of password. */
export const pwTag = (hash: string) => sha256(hash).slice(0, 16)
export const token = () => randomBytes(32).toString('base64url')

// The app logo, INSIDE the page: neither `/icons` nor the rest of the interface is served without a session.
const LOGO = (() => {
  try { return readFileSync(resolve(REPO_ROOT, 'apps/web/public/icons/icon.svg'), 'utf8').replace(/^<svg /, '<svg aria-hidden="true" ') } catch { return '' }
})()

// The app font (Plus Jakarta Sans, Latin subset, 28 KB), INSIDE the page for the same reason.
// Without it, the page falls back to the system font.
const FONT_FACE = (() => {
  const file = 'node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2'
  for (const dir of [REPO_ROOT, resolve(REPO_ROOT, 'apps/web')]) {
    try {
      const data = readFileSync(resolve(dir, file)).toString('base64')
      return `@font-face{font-family:'Plus Jakarta Sans Variable';font-style:normal;font-display:swap;font-weight:200 800;src:url(data:font/woff2;base64,${data}) format('woff2-variations')}`
    } catch { /* next folder */ }
  }
  return ''
})()

// The "Kasbah" theme (apps/web/src/themes/kasbah.ts and the tokens derived from `cssVars`), light and
// dark according to the system: the page has no script and no access to the theme chosen in the app.
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
 * Self-contained HTML page for sign-ins (MCP and application): inline styles and font, no external
 * resource. No `form-action` in the CSP: the browser also applies it to the redirect that follows
 * the form, and refused the return to the client (seen in the browser, invisible to tests). `head`:
 * extra tags in the header (the sign-in page's manifest).
 */
export const htmlPage = (reply: FastifyReply, status: number, body: string, head = '') => reply.code(status)
  .header('content-type', 'text/html; charset=utf-8')
  .header('x-frame-options', 'DENY')
  .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; font-src data:; manifest-src 'self'; img-src 'self'; frame-ancestors 'none'")
  .header('cache-control', 'no-store')
  .send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kasbah — connexion</title>${head}
<style>${PAGE_CSS}</style></head>
<body><main><header class="brand">${LOGO}<h1>Kasbah</h1></header>${body}</main></body></html>`)

/** Accounts reader, re-read when the file changes (a removed account is refused without a restart). */
export function usersReader(path: string): () => Promise<UsersFile> {
  let cached: { mtime: number; file: UsersFile } | null = null
  return async () => {
    const mtime = await stat(path).then((s) => s.mtimeMs, () => -1)
    if (cached?.mtime !== mtime) cached = { mtime, file: await readUsers(path) }
    return cached.file
  }
}

// Dummy hash: an unknown account costs the same computation as a wrong password.
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

/**
 * Checks a name and a password through the guard. `blocked`: refused without an attempt (the guard
 * is blocking); `null`: wrong pair; otherwise the account.
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

/** A redirect over https, or over http to the client's machine (Claude Code, mcp-remote). */
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
  /** Reading of a client metadata document (tests). */
  fetch?: typeof fetch
}

// What can be reached under the PUBLIC name without a session: the MCP server and its authorization,
// which have their tokens. A reverse proxy (the NAS's) forwards everything arriving under its name;
// the sorting happens here, the rest goes through the session gate (`http/session.ts`).
const MCP_PATHS = new Set([
  '/mcp',
  '/oauth/authorize', '/oauth/token', '/oauth/register',
  '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server',
])

// A host name as DNS and the proxy see it: case-insensitive, trailing dot optional. Fastify's
// `req.hostname` is the raw header, so `KASBAH.example.org` or `kasbah.example.org.` would not match.
const hostKey = (host: string) => host.toLowerCase().replace(/\.$/, '')

/** Does the request arrive under a public name (`Host`, or a proxy's first `X-Forwarded-Host`)? */
export function isPublicRequest(req: FastifyRequest, publicHosts: string[]): boolean {
  if (!publicHosts.length) return false
  const forwarded = String(req.headers['x-forwarded-host'] ?? '').split(',')[0]!.trim().replace(/:\d+$/, '')
  const hosts = publicHosts.map(hostKey)
  return hosts.includes(hostKey(req.hostname)) || hosts.includes(hostKey(forwarded))
}

// Suffixes nobody can buy: a page on the Internet cannot be served under them.
const LAN_SUFFIXES = ['.internal', '.local', '.lan', '.home.arpa', '.localhost']

/**
 * Is this a name the local network can be reached under? An IP address, `localhost`, a single label
 * (`kasbah`), a non-public suffix, or one of `extra` (`KASBAH_LAN_HOSTS`). Any other name is one a
 * DNS-rebinding page can take: its domain re-resolved to the server's IP, the browser keeps sending it.
 */
export function isLanHost(hostname: string, extra: string[] = []): boolean {
  const host = hostKey(hostname)
  if (!host) return false
  if (isIP(host) || (host.startsWith('[') && isIP(host.slice(1, -1)))) return true
  if (host === 'localhost' || !host.includes('.') || LAN_SUFFIXES.some((s) => host.endsWith(s))) return true
  return extra.some((h) => hostKey(h) === host)
}

/** Does the `Origin` name the host the request was sent to? An absent `Origin` is not a browser's. */
function sameOrigin(req: FastifyRequest): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.host.toLowerCase()
  } catch {
    return false
  }
}

type Hook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>
const notFound: Hook = async (_req, reply) => { await reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } }) }
const refuse = (reply: FastifyReply, code: string, message: string) => reply.code(403).send({ error: { code, message } })
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * GLOBAL `onRequest` hook: under a public name, the MCP paths go through, everything else goes to
 * `gate` (404 by default). To be set before any route. On the local network, no account, but the
 * name must be a local one (`isLanHost`), and a browser's write or WebSocket must come from the page
 * Kasbah served: another site's page in a browser at home is not the local network.
 */
export function publicHostFilter(publicHosts: string[], gate: Hook = notFound, lanHosts: string[] = []): Hook {
  return async (req, reply) => {
    if (!isPublicRequest(req, publicHosts)) {
      if (!isLanHost(req.hostname, lanHosts)) {
        await refuse(reply, 'UNKNOWN_HOST', 'unknown host name: add it to KASBAH_LAN_HOSTS')
      } else if ((!SAFE_METHODS.has(req.method) || req.headers.upgrade !== undefined) && !sameOrigin(req)) {
        await refuse(reply, 'BAD_ORIGIN', 'cross-site request refused')
      }
      return
    }
    if (MCP_PATHS.has(req.url.split('?')[0]!)) return
    await gate(req, reply)
  }
}

export interface McpAuth {
  /** OAuth and metadata routes, to mount in the `/mcp` sub-application (same `Host` check). */
  routes(sub: FastifyInstance): void
  /** `onRequest` hook of `/mcp`: 401 and the metadata address without a valid token; otherwise `req.sessionUser` = the token's account. */
  requireToken(req: FastifyRequest, reply: FastifyReply): Promise<void>
  /** Host names on top of the local network ones (that of `MCP_PUBLIC_URL`). */
  publicHosts: string[]
  /** Sign-in guard, shared with the application's sign-in page. */
  guard: LoginGuard
  /** The accounts (shared with the application). */
  users: () => Promise<UsersFile>
  /**
   * Access token for a client started by the server itself (the assistant, `claude -p`): in memory
   * only, in the name of `user` (`null` = the house), until `revoke()` or `ttlMs`.
   */
  runToken(user: string | null, ttlMs: number): { token: string; revoke(): void }
}

export function createMcpAuth(deps: McpAuthDeps): McpAuth {
  const { config, logger } = deps
  const now = deps.now ?? Date.now
  const doFetch = deps.fetch ?? fetch
  const publicUrl = config.MCP_PUBLIC_URL ? new URL(config.MCP_PUBLIC_URL) : null

  // Issuer and resource are read from the request: `http://kasbah:8787` on the local network,
  // the public address (https, the tunnel terminates TLS) when the Host is its own.
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

  // The accounts, re-read when the file changes (a removed account cuts its tokens without a restart).
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

  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string; user: string; pw: string; expiresAt: number }>()

  async function issue(clientId: string, user: string, pw: string) {
    const s = await load()
    const access = token(), refresh = token()
    s.access[sha256(access)] = { clientId, user, pw, expiresAt: now() + ACCESS_TTL_MS }
    s.refresh[sha256(refresh)] = { clientId, user, pw, expiresAt: now() + REFRESH_TTL_MS }
    await save(s)
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh }
  }

  const accountExists = async (user: string) => (await currentUsers()).users.some((u) => u.name === user)
  /** The account still exists, with the password the grant was issued under. */
  const grantHolds = async (g: Grant) => {
    const account = (await currentUsers()).users.find((u) => u.name === g.user)
    return !!account && g.pw === pwTag(account.password)
  }

  // Per-run tokens: never written to disk, they do not survive the process that drew them.
  const runs = new Map<string, { user: string | null; expiresAt: number }>()

  // Parameters of `/oauth/authorize`, in the query (GET) or in the form (POST).
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

  // An invalid request is NEVER sent back to the requested redirect: error page here.
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

    runToken(user, ttlMs) {
      const t = now()
      for (const [k, r] of runs) if (r.expiresAt <= t) runs.delete(k)
      const raw = token()
      runs.set(sha256(raw), { user, expiresAt: t + ttlMs })
      return { token: raw, revoke: () => { runs.delete(sha256(raw)) } }
    },

    async requireToken(req, reply) {
      const metadata = `${baseOf(req)}/.well-known/oauth-protected-resource/mcp`
      const m = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')
      const run = m ? runs.get(sha256(m[1]!)) : undefined
      if (run && run.expiresAt > now() && (run.user === null || await accountExists(run.user))) {
        req.sessionUser = run.user
        return
      }
      const grant = m ? (await load()).access[sha256(m[1]!)] : undefined
      if (grant && grant.expiresAt > now() && await grantHolds(grant)) {
        // the tools act in the name of this account (its music accounts)
        req.sessionUser = grant.user
        return
      }
      await reply.code(401)
        .header('www-authenticate', `Bearer resource_metadata="${metadata}"${m ? ', error="invalid_token"' : ''}`)
        .send({ jsonrpc: '2.0', error: { code: -32001, message: 'authentication required' }, id: null })
    },

    routes(sub) {
      // OAuth forms (`/oauth/token`, sign-in page) arrive urlencoded.
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
        // Open to the Internet: the number of clients is bounded, the oldest go out.
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
        codes.set(code, { clientId: params.client_id, redirectUri: params.redirect_uri, challenge: params.code_challenge, user: user.name, pw: pwTag(user.password), expiresAt: now() + CODE_TTL_MS })
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
          return reply.header('cache-control', 'no-store').send(await issue(entry.clientId, entry.user, entry.pw))
        }
        if (body.grant_type === 'refresh_token') {
          const s = await load()
          const key = sha256(body.refresh_token ?? '')
          const grant = s.refresh[key]
          if (!grant?.pw || grant.expiresAt <= now() || (body.client_id && grant.clientId !== body.client_id) || !await grantHolds(grant)) {
            return oauthError(reply, 400, 'invalid_grant')
          }
          delete s.refresh[key]
          return reply.header('cache-control', 'no-store').send(await issue(grant.clientId, grant.user, grant.pw))
        }
        return oauthError(reply, 400, 'unsupported_grant_type')
      })
    },
  }
}
