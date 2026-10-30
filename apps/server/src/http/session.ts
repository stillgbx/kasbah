import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../core/atomic-file'
import { stateFile } from '../core/paths'
import { checkLogin, clientOf, esc, htmlPage, isPublicRequest, lockedMessage, pwTag, sha256, token, type LoginGuard, type UsersFile } from '../mcp/auth'
import { sendError } from './errors'

// The application under the PUBLIC name (`MCP_PUBLIC_URL`, the NAS reverse proxy): a cookie session,
// opened with the MCP accounts. The local network stays without authentication.
//
// - `__Host-` cookie (Secure, Path=/, no Domain), HttpOnly, SameSite=Lax: sent when the app opens
//   from a link, never by a request from another site.
// - Origin required on every write and every WebSocket: the NAS's other services share the same
//   site (`*.synology.me` is a public suffix), SameSite does not separate them.
// - Session kept hashed in `.state/sessions.json`, 90 sliding days. It falls with the account, AND
//   when its password changes (fingerprint of the hash): enough to cut off a lost phone.
// - Account management (`/api/mcp/users`) and server update (`/api/system`) from the local network
//   only, even when signed in.
// - MCP tools go through `app.inject` in the name of their token's account (`actAsHeaders`).

export const sessionConfigSchema = z.object({
  KASBAH_SESSIONS_FILE: z.string().trim().default(stateFile('sessions.json')),
})
export type SessionConfig = z.infer<typeof sessionConfigSchema>

const COOKIE = '__Host-kasbah_session'
const TTL_MS = 90 * 24 * 60 * 60_000
/** Extended (and the cookie rewritten) at most once a day. */
const SLIDE_MS = 24 * 60 * 60_000

const fileSchema = z.object({
  sessions: z.record(z.string(), z.object({ user: z.string(), pw: z.string(), expiresAt: z.number() })).default({}),
})
type SessionsFile = z.infer<typeof fileSchema>

// Open without a session: sign-in, and what the browser loads WITHOUT a cookie (the manifest of an
// installable app is requested without credentials, its icons along with it).
const OPEN_PATHS = new Set(['/login', '/logout', '/manifest.webmanifest'])
const OPEN_PREFIXES = ['/icons/']
// the Matter bridge: its pairing code lets any assistant take over what it publishes (a garage, a lock)
const LAN_ONLY = ['/api/mcp/users', '/api/system', '/api/matter']
const lanOnly = (path: string | undefined) => path !== undefined && LAN_ONLY.some((p) => path === p || path.startsWith(`${p}/`))
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Account of the session, under the public name, or that of an MCP tool's token; `null` on the
     * local network. It is the one that picks the music accounts (`music/sources.ts`).
     */
    sessionUser: string | null
  }
}

export interface AppSessionDeps {
  config: SessionConfig
  /** Public address (`MCP_PUBLIC_URL`); without it, nothing is filtered. */
  publicUrl: string | undefined
  publicHosts: string[]
  guard: LoginGuard
  users: () => Promise<UsersFile>
  logger: Logger
  now?: () => number
}

export interface AppSession {
  /** Gate for `publicHostFilter`: everything under the public name that is not the MCP. */
  gate(req: FastifyRequest, reply: FastifyReply): Promise<void>
  routes(app: FastifyInstance): void
}

/**
 * An MCP tool replays an app route through `app.inject` IN THE NAME of its token's account. The
 * secret is drawn at startup and never leaves the process: a request coming from the network cannot
 * claim it.
 */
const INTERNAL_SECRET = randomBytes(32).toString('base64url')
/** `user` null: the house (per-run token of the app's assistant) — the request stays marked MCP. */
export const actAsHeaders = (user: string | null): Record<string, string> =>
  ({ 'x-kasbah-internal': INTERNAL_SECRET, ...(user ? { 'x-kasbah-user': user } : {}) })
/** The request comes from an MCP tool (the only holder of the secret). */
export const fromMcp = (req: FastifyRequest): boolean => req.headers['x-kasbah-internal'] === INTERNAL_SECRET
export async function actAsHook(req: FastifyRequest): Promise<void> {
  const user = req.headers['x-kasbah-user']
  if (req.headers['x-kasbah-internal'] === INTERNAL_SECRET && typeof user === 'string') req.sessionUser = user
}

const cookieOf = (req: FastifyRequest): string | null => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim() || null
  }
  return null
}
const setCookie = (reply: FastifyReply, value: string, maxAgeMs: number) =>
  reply.header('set-cookie', `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`)

// The app can be installed from the sign-in page already: manifest and icons are served without a
// session (the manifest points `start_url` to `/`). Same tags as `apps/web/index.html`.
const INSTALL_HEAD = `
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Kasbah">
<meta name="theme-color" content="#e9edf1" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0d1420" media="(prefers-color-scheme: dark)">`

/**
 * Return after sign-in: a path of THIS site only, never the sign-in page itself. Read as the browser
 * will read it: it drops tabs and line breaks and takes `\` for `/`, so `/<TAB>/evil.example` is
 * `//evil.example`, another site. The normalised path can itself start with `//`: the dot segment of
 * `/.//evil.example` goes, the empty one stays.
 */
const safeNext = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/'
  const base = 'http://kasbah.invalid'
  const url = new URL(raw, base)
  return url.origin === base && !url.pathname.startsWith('//') && !url.pathname.startsWith('/login') ? url.pathname + url.search + url.hash : '/'
}

export function createAppSession(deps: AppSessionDeps): AppSession {
  const { config, guard, users, logger, publicHosts } = deps
  const now = deps.now ?? Date.now
  const origin = deps.publicUrl ? new URL(deps.publicUrl).origin : null

  let state: Promise<SessionsFile> | null = null
  const load = () => (state ??= readFile(config.KASBAH_SESSIONS_FILE, 'utf8')
    .then((t) => fileSchema.parse(JSON.parse(t)))
    .catch(() => fileSchema.parse({})))
  const save = async (s: SessionsFile) => {
    const t = now()
    for (const [k, v] of Object.entries(s.sessions)) if (v.expiresAt <= t) delete s.sessions[k]
    try { await writeFileAtomic(config.KASBAH_SESSIONS_FILE, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 }) } catch (err) { logger.warn({ err }, 'sessions not saved') }
  }

  /** The account of the cookie's session, or `null`. Extends the session along the way. */
  async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const raw = cookieOf(req)
    if (!raw) return null
    const s = await load()
    const entry = s.sessions[sha256(raw)]
    if (!entry || entry.expiresAt <= now()) return null
    const account = (await users()).users.find((u) => u.name === entry.user)
    if (!account || pwTag(account.password) !== entry.pw) return null
    if (entry.expiresAt - now() < TTL_MS - SLIDE_MS) {
      entry.expiresAt = now() + TTL_MS
      await save(s)
      setCookie(reply, raw, TTL_MS)
    }
    return entry.user
  }

  function form(reply: FastifyReply, status: number, next: string, error?: string, username = '') {
    return htmlPage(reply, status, `<p>Connexion à la maison.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/login"><input type="hidden" name="next" value="${esc(next)}">
<label for="u">Utilisateur</label><input id="u" name="username" value="${esc(username)}" autocomplete="username" autocapitalize="off" spellcheck="false" required${username ? '' : ' autofocus'}>
<label for="p">Mot de passe</label><input id="p" name="password" type="password" autocomplete="current-password" required${username ? ' autofocus' : ''}>
<button type="submit">Se connecter</button></form>`, INSTALL_HEAD)
  }

  return {
    async gate(req, reply) {
      const path = req.url.split('?')[0]!
      const writes = !SAFE_METHODS.has(req.method)
      if (OPEN_PATHS.has(path) || OPEN_PREFIXES.some((p) => path.startsWith(p))) {
        if (writes && req.headers.origin !== origin) await sendError(reply, 403, 'BAD_ORIGIN', 'cross-site request refused')
        return
      }
      const user = await authenticate(req, reply)
      if (!user) {
        // A requested page goes to sign-in. The API, the WebSocket and the files the page loads (a
        // script that received the sign-in page would break the view) say 401: the web app redirects
        // there itself.
        if (req.method === 'GET' && !path.startsWith('/api/') && path !== '/ws' && String(req.headers.accept ?? '').includes('text/html')) {
          await reply.code(302).header('cache-control', 'no-store').redirect(`/login?next=${encodeURIComponent(req.url)}`)
        } else {
          await sendError(reply, 401, 'AUTH_REQUIRED', 'sign in first')
        }
        return
      }
      // The route the router matched decides too, not the raw URL alone: it decodes `%75` into `u`,
      // stops at `#` and drops an absolute `http://host` before matching.
      if (lanOnly(path) || lanOnly(req.routeOptions.url)) {
        await sendError(reply, 403, 'LAN_ONLY', 'managed from the local network only')
        return
      }
      // Any WebSocket: `/ws`, and the camera streams under `/api/plugins/<id>/cameras/…`.
      if ((writes || req.headers.upgrade !== undefined) && req.headers.origin !== origin) {
        await sendError(reply, 403, 'BAD_ORIGIN', 'cross-site request refused')
        return
      }
      req.sessionUser = user
    },

    routes(app) {
      app.decorateRequest('sessionUser', null)
      app.get('/api/session', async (req) => ({ user: req.sessionUser }))

      void app.register(async (sub) => {
        sub.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
          done(null, Object.fromEntries(new URLSearchParams(body as string)))
        })

        // On the local network there is nothing to open: back to the app.
        sub.get('/login', async (req, reply) => {
          if (!isPublicRequest(req, publicHosts)) return reply.redirect('/')
          return form(reply, 200, safeNext((req.query as { next?: unknown }).next))
        })

        sub.post('/login', async (req, reply) => {
          if (!isPublicRequest(req, publicHosts)) return reply.redirect('/')
          const { username = '', password = '', next } = (req.body ?? {}) as { username?: string; password?: string; next?: string }
          const back = safeNext(next)
          const result = await checkLogin(guard, users, username, password, clientOf(req))
          if (result && 'blocked' in result) return form(reply, 429, back, lockedMessage(result.blocked, now()), username)
          if (!result) {
            logger.warn({ username }, 'app login refused')
            return form(reply, 401, back, 'Utilisateur ou mot de passe incorrect.', username)
          }
          const raw = token()
          const s = await load()
          s.sessions[sha256(raw)] = { user: result.user.name, pw: pwTag(result.user.password), expiresAt: now() + TTL_MS }
          await save(s)
          logger.info({ user: result.user.name }, 'app login')
          setCookie(reply, raw, TTL_MS)
          return reply.code(303).header('cache-control', 'no-store').redirect(back)
        })

        sub.post('/logout', async (req, reply) => {
          const raw = cookieOf(req)
          if (raw) {
            const s = await load()
            if (s.sessions[sha256(raw)]) { delete s.sessions[sha256(raw)]; await save(s) }
          }
          setCookie(reply, '', 0)
          return reply.code(303).header('cache-control', 'no-store').redirect('/login')
        })
      })
    },
  }
}
