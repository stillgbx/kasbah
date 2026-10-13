import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify'
import pino from 'pino'
import { beforeEach, expect, it } from 'vitest'
import { hashPassword, LoginGuard, publicHostFilter, usersReader } from '../mcp/auth'
import { createAppSession } from './session'

// L'application sous le nom public : session par cookie, origine contrôlée, blocage des comptes.
// Sur une application réduite (quelques routes factices) pour maîtriser l'horloge.

const PUBLIC = 'kasbah.example.org'
const ORIGIN = `https://${PUBLIC}`
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

let app: FastifyInstance
let usersFile: string
let clock: number

async function writeUsers(users: Record<string, string>) {
  writeFileSync(usersFile, JSON.stringify({ users: await Promise.all(Object.entries(users).map(async ([name, pw]) => ({ name, password: await hashPassword(pw) }))) }))
}

async function build(maxFailures = 3) {
  const dir = mkdtempSync(join(tmpdir(), 'kasbah-session-'))
  usersFile = join(dir, 'users.json')
  await writeUsers({ lou: 'bon-mot-de-passe' })
  const now = () => clock
  const guard = new LoginGuard({ maxFailures, lockMs: 15 * MINUTE, now })
  const session = createAppSession({
    config: { KASBAH_SESSIONS_FILE: join(dir, 'sessions.json') },
    publicUrl: ORIGIN, publicHosts: [PUBLIC], guard, users: usersReader(usersFile), logger: pino({ level: 'silent' }), now,
  })
  app = Fastify()
  app.addHook('onRequest', publicHostFilter([PUBLIC], session.gate))
  session.routes(app)
  app.get('/api/devices', async () => ({ devices: [] }))
  app.post('/api/devices/x/command', async () => ({ ok: true }))
  app.get('/api/mcp/users', async () => ({ users: [] }))
  app.get('/ws', async () => ({ ws: true }))
  app.get('/api/plugins/nest/cameras/c1/stream', async () => ({ ws: true }))
  app.get('/settings', async () => 'app')
  app.get('/manifest.webmanifest', async () => ({ name: 'Kasbah' }))
  await app.ready()
}

beforeEach(async () => { clock = 1_000_000_000; await build() })

const req = (o: InjectOptions & { cookie?: string; origin?: string; host?: string }) => app.inject({
  ...o,
  headers: { host: o.host ?? PUBLIC, ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.origin ? { origin: o.origin } : {}), ...o.headers },
})

const login = (username = 'lou', password = 'bon-mot-de-passe', next?: string, origin: string | null = ORIGIN) => req({
  method: 'POST', url: '/login', ...(origin ? { origin } : {}),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  payload: new URLSearchParams({ username, password, ...(next !== undefined ? { next } : {}) }).toString(),
})

/** Se connecte et rend l'en-tête `cookie` à renvoyer. */
async function signIn(): Promise<string> {
  const res = await login()
  expect(res.statusCode).toBe(303)
  return String(res.headers['set-cookie']).split(';')[0]!
}

it('sans session : une page part vers la connexion, l’API et le WebSocket disent 401', async () => {
  const page = await req({ method: 'GET', url: '/settings?tab=1', headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } })
  expect(page.statusCode).toBe(302)
  expect(page.headers.location).toBe('/login?next=%2Fsettings%3Ftab%3D1')
  // un script de la page : jamais la page de connexion à sa place
  const chunk = await req({ method: 'GET', url: '/assets/EnergyView-x.js', headers: { accept: '*/*' } })
  expect(chunk.statusCode).toBe(401)
  expect(chunk.json().error.code).toBe('AUTH_REQUIRED')
  for (const url of ['/api/devices', '/ws', '/api/mcp/users']) {
    const res = await req({ method: 'GET', url })
    expect(res.statusCode, url).toBe(401)
    expect(res.json().error.code, url).toBe('AUTH_REQUIRED')
  }
})

it('sert sans session la page de connexion et le manifest de l’app installable', async () => {
  const page = await req({ method: 'GET', url: '/login?next=/settings' })
  expect(page.statusCode).toBe(200)
  expect(page.body).toContain('action="/login"')
  expect(page.body).toContain('name="next" value="/settings"')
  // l'app s'installe dès cette page : manifest annoncé, et permis par la CSP
  expect(page.body).toContain('<link rel="manifest" href="/manifest.webmanifest">')
  expect(page.headers['content-security-policy']).toContain("manifest-src 'self'")
  expect((await req({ method: 'GET', url: '/manifest.webmanifest' })).statusCode).toBe(200)
})

it('ouvre une session par un cookie __Host- protégé, et revient où l’on allait', async () => {
  const res = await login('lou', 'bon-mot-de-passe', '/settings?tab=1')
  expect(res.statusCode).toBe(303)
  expect(res.headers.location).toBe('/settings?tab=1')
  const cookie = String(res.headers['set-cookie'])
  expect(cookie).toMatch(/^__Host-kasbah_session=[\w-]{43}; /)
  for (const attr of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax', `Max-Age=${90 * DAY / 1000}`]) expect(cookie).toContain(attr)

  const c = cookie.split(';')[0]!
  expect((await req({ method: 'GET', url: '/api/devices', cookie: c })).statusCode).toBe(200)
  expect((await req({ method: 'GET', url: '/settings', cookie: c })).body).toBe('app')
  expect((await req({ method: 'GET', url: '/api/session', cookie: c })).json()).toEqual({ user: 'lou' })
})

it('ne renvoie jamais ailleurs que sur le site après la connexion', async () => {
  for (const next of ['//evil.example/x', 'https://evil.example', '/\\evil.example', '/login', 'settings']) {
    expect((await login('lou', 'bon-mot-de-passe', next)).headers.location, next).toBe('/')
  }
})

it('refuse un mauvais mot de passe ou un compte inconnu, sans cookie', async () => {
  for (const res of [await login('lou', 'faux'), await login('inconnu')]) {
    expect(res.statusCode).toBe(401)
    expect(res.headers['set-cookie']).toBeUndefined()
    expect(res.body).toContain('incorrect')
  }
})

it('exige l’origine du site pour se connecter, écrire et ouvrir le WebSocket', async () => {
  expect((await login('lou', 'bon-mot-de-passe', '/', null)).statusCode).toBe(403)
  expect((await login('lou', 'bon-mot-de-passe', '/', 'https://nas.example.org')).statusCode).toBe(403)
  const c = await signIn()
  const command = (origin?: string) => req({ method: 'POST', url: '/api/devices/x/command', cookie: c, ...(origin ? { origin } : {}), payload: {} })
  expect((await command()).statusCode).toBe(403)
  expect((await command('https://nas.example.org')).json().error.code).toBe('BAD_ORIGIN')
  expect((await command(ORIGIN)).statusCode).toBe(200)
  const upgrade = { connection: 'upgrade', upgrade: 'websocket' }
  for (const url of ['/ws', '/api/plugins/nest/cameras/c1/stream']) {
    expect((await req({ method: 'GET', url, cookie: c, headers: upgrade })).statusCode, url).toBe(403)
    expect((await req({ method: 'GET', url, cookie: c, headers: upgrade, origin: ORIGIN })).statusCode, url).toBe(200)
  }
})

it('laisse la gestion des comptes au réseau local, même connecté', async () => {
  const c = await signIn()
  const res = await req({ method: 'GET', url: '/api/mcp/users', cookie: c })
  expect(res.statusCode).toBe(403)
  expect(res.json().error.code).toBe('LAN_ONLY')
})

it('laisse la mise à jour du serveur au réseau local, même connecté', async () => {
  const c = await signIn()
  for (const [method, url] of [['GET', '/api/system/version'], ['POST', '/api/system/update']] as const) {
    const res = await req({ method, url, cookie: c, origin: ORIGIN })
    expect(res.statusCode, url).toBe(403)
    expect(res.json().error.code, url).toBe('LAN_ONLY')
  }
})

it('coupe la session quand le compte est retiré ou que son mot de passe change', async () => {
  const c = await signIn()
  await writeUsers({ lou: 'nouveau-mot-de-passe' })
  expect((await req({ method: 'GET', url: '/api/devices', cookie: c })).statusCode).toBe(401)
  const d = String((await login('lou', 'nouveau-mot-de-passe')).headers['set-cookie']).split(';')[0]!
  await writeUsers({ autre: 'bon-mot-de-passe' })
  expect((await req({ method: 'GET', url: '/api/devices', cookie: d })).statusCode).toBe(401)
})

it('ferme la session à la déconnexion', async () => {
  const c = await signIn()
  const out = await req({ method: 'POST', url: '/logout', cookie: c, origin: ORIGIN })
  expect(out.statusCode).toBe(303)
  expect(out.headers.location).toBe('/login')
  expect(String(out.headers['set-cookie'])).toContain('Max-Age=0')
  expect((await req({ method: 'GET', url: '/api/devices', cookie: c })).statusCode).toBe(401)
})

it('prolonge la session à l’usage, au plus une fois par jour, et la perd après 90 jours sans visite', async () => {
  const c = await signIn()
  clock += DAY / 2
  expect((await req({ method: 'GET', url: '/api/devices', cookie: c })).headers['set-cookie']).toBeUndefined()
  clock += DAY
  const slid = await req({ method: 'GET', url: '/api/devices', cookie: c })
  expect(slid.statusCode).toBe(200)
  expect(String(slid.headers['set-cookie'])).toContain(`Max-Age=${90 * DAY / 1000}`)
  clock += 89 * DAY
  expect((await req({ method: 'GET', url: '/api/devices', cookie: c })).statusCode).toBe(200)
  clock += 90 * DAY
  expect((await req({ method: 'GET', url: '/api/devices', cookie: c })).statusCode).toBe(401)
})

it('bloque un compte après trop d’échecs d’affilée, même avec le bon mot de passe, le temps réglé', async () => {
  for (let i = 0; i < 3; i++) expect((await login('lou', 'faux')).statusCode).toBe(401)
  const locked = await login()
  expect(locked.statusCode).toBe(429)
  expect(locked.body).toContain('15 min')
  clock += 15 * MINUTE + 1
  expect((await login()).statusCode).toBe(303)
})

it('ne bloque que le compte visé, et remet le compteur à zéro après une connexion réussie', async () => {
  await writeUsers({ lou: 'bon-mot-de-passe', sam: 'autre-mot-de-passe' })
  for (let i = 0; i < 3; i++) await login('lou', 'faux')
  expect((await login('sam', 'autre-mot-de-passe')).statusCode).toBe(303)
  clock += 15 * MINUTE + 1
  for (let i = 0; i < 2; i++) await login('lou', 'faux')
  expect((await login()).statusCode).toBe(303)
  for (let i = 0; i < 2; i++) await login('lou', 'faux')
  expect((await login()).statusCode).toBe(303)
})

it('ne bloque jamais un compte quand le seuil vaut 0', async () => {
  await build(0)
  for (let i = 0; i < 9; i++) await login('lou', 'faux')
  expect((await login()).statusCode).toBe(303)
})

it('ne change rien sur le réseau local', async () => {
  expect((await req({ method: 'GET', url: '/api/devices', host: 'kasbah:8787' })).statusCode).toBe(200)
  expect((await req({ method: 'GET', url: '/api/session', host: 'kasbah:8787' })).json()).toEqual({ user: null })
  expect((await req({ method: 'GET', url: '/login', host: 'kasbah:8787' })).headers.location).toBe('/')
})
