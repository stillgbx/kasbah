import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../core/atomic-file'
import { stateFile } from '../core/paths'
import { checkLogin, esc, htmlPage, isPublicRequest, lockedMessage, sha256, token, type LoginGuard, type UsersFile } from '../mcp/auth'
import { sendError } from './errors'

// L'application sous le nom PUBLIC (`MCP_PUBLIC_URL`, le proxy inverse du NAS) : une session par
// cookie, ouverte par les comptes du MCP. Le réseau local reste sans authentification.
//
// - Cookie `__Host-` (Secure, Path=/, aucun Domain), HttpOnly, SameSite=Lax : envoyé quand l'app
//   s'ouvre depuis un lien, jamais par une requête d'un autre site.
// - Origine exigée sur toute écriture et sur tout WebSocket : les autres services du NAS partagent le
//   même site (`*.synology.me` est un suffixe public), SameSite ne les sépare pas.
// - Session gardée hachée dans `.state/sessions.json`, 90 jours glissants. Elle tombe avec le compte,
//   ET quand son mot de passe change (empreinte du haché) : de quoi couper un téléphone perdu.
// - Comptes gérés (`/api/mcp/users`) et mise à jour du serveur (`/api/system`) depuis le réseau local
//   seulement, même connecté.
// - Les outils MCP passent par `app.inject` au nom du compte de leur jeton (`actAsHeaders`).

export const sessionConfigSchema = z.object({
  KASBAH_SESSIONS_FILE: z.string().trim().default(stateFile('sessions.json')),
})
export type SessionConfig = z.infer<typeof sessionConfigSchema>

const COOKIE = '__Host-kasbah_session'
const TTL_MS = 90 * 24 * 60 * 60_000
/** Prolongée (et le cookie réécrit) au plus une fois par jour. */
const SLIDE_MS = 24 * 60 * 60_000

const fileSchema = z.object({
  sessions: z.record(z.string(), z.object({ user: z.string(), pw: z.string(), expiresAt: z.number() })).default({}),
})
type SessionsFile = z.infer<typeof fileSchema>

// Ouverts sans session : la connexion, et ce que le navigateur charge SANS cookie (le manifest d'une
// app installable est demandé sans identifiants, ses icônes avec lui).
const OPEN_PATHS = new Set(['/login', '/logout', '/manifest.webmanifest'])
const OPEN_PREFIXES = ['/icons/']
const LAN_ONLY = ['/api/mcp/users', '/api/system']
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Compte de la session, sous le nom public, ou celui du jeton d'un outil MCP ; `null` sur le
     * réseau local. C'est lui qui choisit les comptes musicaux (`music/sources.ts`).
     */
    sessionUser: string | null
  }
}

export interface AppSessionDeps {
  config: SessionConfig
  /** Adresse publique (`MCP_PUBLIC_URL`) ; sans elle, rien n'est filtré. */
  publicUrl: string | undefined
  publicHosts: string[]
  guard: LoginGuard
  users: () => Promise<UsersFile>
  logger: Logger
  now?: () => number
}

export interface AppSession {
  /** Porte de `publicHostFilter` : tout ce qui, sous le nom public, n'est pas le MCP. */
  gate(req: FastifyRequest, reply: FastifyReply): Promise<void>
  routes(app: FastifyInstance): void
}

/**
 * Un outil MCP rejoue une route de l'app par `app.inject` AU NOM du compte de son jeton. Le secret est
 * tiré au démarrage et ne quitte jamais le processus : une requête venue du réseau ne peut pas s'en
 * réclamer.
 */
const INTERNAL_SECRET = randomBytes(32).toString('base64url')
export const actAsHeaders = (user: string): Record<string, string> => ({ 'x-kasbah-internal': INTERNAL_SECRET, 'x-kasbah-user': user })
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

/** Empreinte du haché du mot de passe : la session ne survit pas à un changement. */
const pwTag = (hash: string) => sha256(hash).slice(0, 16)

// L'app s'installe dès la page de connexion : manifest et icônes sont servis sans session (le
// manifest pointe `start_url` sur `/`). Mêmes balises que `apps/web/index.html`.
const INSTALL_HEAD = `
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Kasbah">
<meta name="theme-color" content="#e9edf1" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0d1420" media="(prefers-color-scheme: dark)">`

/** Retour après connexion : un chemin de CE site seulement, jamais la page de connexion elle-même. */
const safeNext = (raw: unknown): string =>
  typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') && !raw.startsWith('/login') ? raw : '/'

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

  /** Le compte de la session du cookie, ou `null`. Prolonge la session au passage. */
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
        // Une page demandée part vers la connexion. L'API, le WebSocket et les fichiers que la page
        // charge (un script qui recevrait la page de connexion casserait la vue) disent 401 : le web y
        // renvoie lui-même.
        if (req.method === 'GET' && !path.startsWith('/api/') && path !== '/ws' && String(req.headers.accept ?? '').includes('text/html')) {
          await reply.code(302).header('cache-control', 'no-store').redirect(`/login?next=${encodeURIComponent(req.url)}`)
        } else {
          await sendError(reply, 401, 'AUTH_REQUIRED', 'sign in first')
        }
        return
      }
      if (LAN_ONLY.some((p) => path === p || path.startsWith(`${p}/`))) {
        await sendError(reply, 403, 'LAN_ONLY', 'managed from the local network only')
        return
      }
      // Tout WebSocket : `/ws`, et les flux des caméras sous `/api/plugins/<id>/cameras/…`.
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

        // Sur le réseau local il n'y a rien à ouvrir : retour à l'app.
        sub.get('/login', async (req, reply) => {
          if (!isPublicRequest(req, publicHosts)) return reply.redirect('/')
          return form(reply, 200, safeNext((req.query as { next?: unknown }).next))
        })

        sub.post('/login', async (req, reply) => {
          if (!isPublicRequest(req, publicHosts)) return reply.redirect('/')
          const { username = '', password = '', next } = (req.body ?? {}) as { username?: string; password?: string; next?: string }
          const back = safeNext(next)
          const result = await checkLogin(guard, users, username, password)
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
