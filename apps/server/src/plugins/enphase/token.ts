import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Logger } from 'pino'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'

// Jeton d'accès à l'API locale de la passerelle IQ (logiciel 7.0 et plus : plus de mot de passe, un
// JWT signé par le cloud Enphase). Deux façons de l'obtenir, décrites par la note technique du
// fabricant (« Accessing IQ Gateway local APIs or local UI with token-based authentication ») :
//
//  - à la main sur entrez.enphaseenergy.com, puis collé ici ;
//  - PROGRAMMATIQUEMENT, en deux requêtes au cloud : ouvrir une session avec le compte Enphase,
//    puis échanger l'id de session contre un jeton pour un numéro de série de passerelle. Cette
//    voie donne un jeton de PROPRIÉTAIRE (un an) là où, pour un compte à la fois installateur et
//    propriétaire — le cas d'un auto-installateur —, le formulaire web n'en donne qu'un de 12 h.
//
// Le mot de passe du compte Enphase ouvre bien plus que l'API locale : il n'est donc NI une clé de
// configuration, NI conservé. Il traverse une fois la route d'appairage, sert à frapper le jeton, et
// c'est tout — seul le jeton est mis en cache. Rien ici ne lit `process.env` pour des identifiants.

/** Ouverture de session (compte Enphase) — première des deux requêtes au cloud. */
const LOGIN_URL = 'https://enlighten.enphaseenergy.com/login/login.json'
/** Échange de l'id de session contre un jeton pour une passerelle — seconde requête. */
const TOKENS_URL = 'https://entrez.enphaseenergy.com/tokens'
/** Le cloud est sur Internet, pas sur le LAN : plus généreux que les 8 s accordées à la passerelle. */
export const CLOUD_TIMEOUT_MS = 15_000
/** En dessous, l'UI réclame un renouvellement (le jeton d'un propriétaire vaut un an). */
export const RENEW_WARNING_DAYS = 30

const loginResponseSchema = z.object({
  session_id: z.string().min(1),
  message: z.string().optional(),
})

/** Corps de `/tokens` : du JSON chez certains firmwares, le JWT en texte brut chez d'autres. */
const tokenResponseSchema = z.object({ token: z.string().min(1) })

const claimsSchema = z.object({
  /** Passerelle pour laquelle le jeton a été émis (numéro de série). */
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  /** `owner` (un an) ou `installer` (douze heures) : explique une expiration courte. */
  enphaseUser: z.string().optional(),
  username: z.string().optional(),
  /** Expiration, en SECONDES epoch (convention JWT). */
  exp: z.number(),
})

export interface EnphaseTokenClaims {
  /** Numéro de série de la passerelle visée, si le jeton le porte. */
  serial: string | undefined
  /** Rôle du compte émetteur (`owner`, `installer`). */
  role: string | undefined
  username: string | undefined
  /** Expiration en MILLISECONDES epoch (le JWT la porte en secondes). */
  expiresAt: number
}

/**
 * Contenu utile d'un jeton, sans vérifier sa signature : le vérificateur est la passerelle, pas nous.
 * On ne lit que ce qui sert à l'utilisateur — pour quelle passerelle, jusqu'à quand, quel rôle.
 * `null` si ce n'est pas un JWT lisible : un jeton tronqué à la copie doit se dire en clair, pas
 * partir en 401 inexpliqué à la première requête.
 */
export function decodeEnphaseToken(token: string): EnphaseTokenClaims | null {
  const parts = token.trim().split('.')
  if (parts.length !== 3) return null
  let payload: unknown
  try { payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) }
  catch { return null }
  const parsed = claimsSchema.safeParse(payload)
  if (!parsed.success) return null
  const { aud, enphaseUser, username, exp } = parsed.data
  return {
    serial: Array.isArray(aud) ? aud[0] : aud,
    role: enphaseUser,
    username,
    expiresAt: exp * 1000,
  }
}

export type TokenStage = 'ok' | 'expiring' | 'expired'

/**
 * Où en est le jeton : `expired` (la passerelle refusera tout), `expiring` (moins de
 * `RENEW_WARNING_DAYS` : l'UI le signale avant la panne), `ok`. `daysLeft` est arrondi vers le bas
 * et négatif après l'échéance.
 */
export function tokenStage(claims: EnphaseTokenClaims, now: number): { stage: TokenStage; daysLeft: number } {
  const daysLeft = Math.floor((claims.expiresAt - now) / 86_400_000)
  if (claims.expiresAt <= now) return { stage: 'expired', daysLeft }
  return { stage: daysLeft < RENEW_WARNING_DAYS ? 'expiring' : 'ok', daysLeft }
}

export interface CheckedToken {
  token: string
  claims: EnphaseTokenClaims
  stage: TokenStage
  daysLeft: number
}
export type TokenRejection = 'unreadable' | 'other-gateway' | 'expired'

/**
 * Un jeton est-il utilisable pour cette passerelle ? Trois refus possibles, distingués parce qu'ils
 * ne se réparent pas pareil : illisible (copie tronquée), émis pour une AUTRE passerelle (deux
 * passerelles sur le compte), expiré (à renouveler).
 */
export function checkToken(token: string, o: { serial?: string | undefined; now: number }):
{ ok: true; checked: CheckedToken } | { ok: false; reason: TokenRejection; claims: EnphaseTokenClaims | null } {
  const claims = decodeEnphaseToken(token)
  if (!claims) return { ok: false, reason: 'unreadable', claims: null }
  if (o.serial && claims.serial && claims.serial !== o.serial) return { ok: false, reason: 'other-gateway', claims }
  const { stage, daysLeft } = tokenStage(claims, o.now)
  if (stage === 'expired') return { ok: false, reason: 'expired', claims }
  return { ok: true, checked: { token: token.trim(), claims, stage, daysLeft } }
}

/** Phrase à montrer à l'utilisateur pour un refus (l'UI n'a pas à traduire un code en cause). */
export function rejectionMessage(reason: TokenRejection, claims: EnphaseTokenClaims | null, serial?: string): string {
  switch (reason) {
    case 'unreadable': return 'this is not a readable Enphase token (truncated copy?)'
    case 'other-gateway': return `this token was issued for gateway ${claims?.serial}, not ${serial}`
    case 'expired': return `this token expired on ${new Date(claims!.expiresAt).toISOString().slice(0, 10)}`
  }
}

export interface CloudFetchOptions {
  fetchImpl?: FetchLike
  signal?: AbortSignal
  /** Abrégé dans les tests ; en production c'est `CLOUD_TIMEOUT_MS`. */
  timeoutMs?: number
}

export interface LoginOptions extends CloudFetchOptions {
  /** Identifiant du compte Enphase (adresse e-mail). Jamais conservé. */
  user: string
  /** Mot de passe du compte. Traverse cette fonction, n'est ni journalisé ni écrit. */
  password: string
}

export interface MintOptions extends LoginOptions {
  /** Numéro de série de la passerelle — lu sur `/info`, qui ne demande aucun jeton. */
  serial: string
}

function deadline(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function cloudFetch(o: CloudFetchOptions): FetchLike {
  return o.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>)
}

async function postCloud(
  doFetch: FetchLike,
  url: string,
  init: Parameters<FetchLike>[1],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; text: string; headers?: MinimalHeaders }> {
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await doFetch(url, { ...init, method: 'POST', signal: deadline(timeoutMs, signal) })
  } catch (err) {
    const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
    throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `Enphase cloud unreachable (${url})`, { cause: err })
  }
  return { status: res.status, text: await res.text(), headers: headersOf(res) }
}

/** Sous-ensemble de `Headers` : le `fetch` réel l'a, les faux des tests souvent pas. */
interface MinimalHeaders {
  get(name: string): string | null
  getSetCookie?(): string[]
}

function headersOf(res: Awaited<ReturnType<FetchLike>>): MinimalHeaders | undefined {
  const h = (res as { headers?: MinimalHeaders }).headers
  return h && typeof h.get === 'function' ? h : undefined
}

function setCookieLines(headers?: MinimalHeaders): string[] {
  if (!headers) return []
  // undici : `get('set-cookie')` concatène au virgule (cassé dès qu'un cookie a un `Expires`),
  // `getSetCookie()` rend une ligne par cookie. C'est ça qu'il faut lire.
  const lines = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
  if (lines.length) return lines
  const joined = headers.get('set-cookie')
  return joined ? [joined] : []
}

function cookieValue(setCookie: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|,\\s*)${name}=([^;]+)`).exec(setCookie)
  return m?.[1]?.trim()
}

function cookieFrom(headers: MinimalHeaders | undefined, name: string): string | undefined {
  for (const line of setCookieLines(headers)) {
    const v = cookieValue(line, name)
    if (v) return v
  }
  return undefined
}

/**
 * Ouvre une session Enlighten. Deux jetons distincts, à ne pas confondre :
 *  - `session_id` JSON → `POST entrez.enphaseenergy.com/tokens` (JWT local de la passerelle) ;
 *  - cookie `_enlighten_4_session` → API web/appli (sites, borne). Un `session_id` collé en
 *    cookie se fait répondre 401. Identifiants faux → `NEEDS_PAIRING`, pas une panne.
 */
export async function loginEnlighten(o: LoginOptions): Promise<{ sessionId: string; cookie?: string }> {
  const timeoutMs = o.timeoutMs ?? CLOUD_TIMEOUT_MS
  const login = await postCloud(cloudFetch(o), LOGIN_URL, {
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ 'user[email]': o.user, 'user[password]': o.password }).toString(),
  }, timeoutMs, o.signal)
  const parsed = loginResponseSchema.safeParse(((): unknown => { try { return JSON.parse(login.text) } catch { return null } })())
  const sessionId = parsed.success ? parsed.data.session_id : undefined
  const cookie = cookieFrom(login.headers, '_enlighten_4_session')
  if (!sessionId) {
    throw new PluginError('NEEDS_PAIRING', `Enphase refused the sign-in (HTTP ${login.status}): wrong e-mail or password`)
  }
  return cookie ? { sessionId, cookie } : { sessionId }
}

/** Échange une session Enlighten déjà ouverte contre un jeton LOCAL de CETTE passerelle. */
export async function exchangeEnphaseToken(o: CloudFetchOptions & {
  sessionId: string
  serial: string
  username: string
}): Promise<{ token: string; claims: EnphaseTokenClaims }> {
  const timeoutMs = o.timeoutMs ?? CLOUD_TIMEOUT_MS
  const minted = await postCloud(cloudFetch(o), TOKENS_URL, {
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ session_id: o.sessionId, serial_num: o.serial, username: o.username }),
  }, timeoutMs, o.signal)
  const asJson = tokenResponseSchema.safeParse(((): unknown => { try { return JSON.parse(minted.text) } catch { return null } })())
  const token = (asJson.success ? asJson.data.token : minted.text).trim()
  const claims = decodeEnphaseToken(token)
  if (!claims) {
    throw new PluginError('UPSTREAM_ERROR', `Enphase returned no usable token for gateway ${o.serial} (HTTP ${minted.status})`)
  }
  return { token, claims }
}

/** Frappe un jeton auprès du cloud Enphase (session puis échange). Lève `PluginError` sinon. */
export async function mintEnphaseToken(o: MintOptions): Promise<{ token: string; claims: EnphaseTokenClaims }> {
  const { sessionId } = await loginEnlighten(o)
  return exchangeEnphaseToken({ ...o, sessionId, username: o.user })
}

export interface TokenStore {
  load(): Promise<string | null>
  save(token: string): Promise<void>
}

const tokenFileSchema = z.object({ token: z.string().min(1) })

/**
 * Où vit le jeton entre deux démarrages. C'est ce qui permet de ne demander les identifiants qu'au
 * moment où il faut (re)frapper un jeton, et jamais de les garder : le jeton, lui, sert un an.
 * Fichier absent ou illisible : cache vide, jamais une erreur fatale (le plugin doit démarrer même
 * si le disque refuse l'écriture).
 */
export function createTokenFile(path: string, logger?: Logger): TokenStore {
  return {
    async load() {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return null }
      const parsed = tokenFileSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger?.warn({ path }, 'unreadable Enphase token cache, ignoring it'); return null }
      return parsed.data.token
    },
    async save(token) {
      // `.tmp` nommé d'après le processus : deux serveurs sur la même machine (développement et
      // preview) partagent ce fichier, un intermédiaire commun se marcherait dessus
      const tmp = `${path}.${process.pid}.tmp`
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(tmp, `${JSON.stringify({ token }, null, 2)}\n`, 'utf8')
        await rename(tmp, path)
      } catch (err) {
        logger?.warn({ err, path }, 'could not write Enphase token cache')
      }
    },
  }
}

export interface ResolveTokenOptions {
  /** `ENPHASE_TOKEN` : un jeton posé en configuration gagne sur le cache tant qu'il est valable. */
  token?: string | undefined
  store?: TokenStore | undefined
  /** Passerelle visée (lue sur `/info`) : sert à refuser un jeton d'une AUTRE passerelle. */
  serial?: string | undefined
  now: number
  logger?: Logger
}

/** D'où vient le jeton en service : la configuration, le cache, ou une frappe qu'on vient de faire. */
export type TokenSource = 'config' | 'cache' | 'minted'

export interface ResolvedToken extends CheckedToken {
  source: Extract<TokenSource, 'config' | 'cache'>
}

/**
 * Le jeton à utiliser au démarrage, parmi celui de la configuration et celui du cache. AUCUN appel
 * au cloud ici — frapper un jeton demande des identifiants, que seul l'utilisateur peut donner, au
 * moment où il les tape (route d'appairage). Un candidat refusé est journalisé et on passe au
 * suivant : un jeton périmé en configuration ne doit pas masquer un jeton frais en cache.
 *
 * Entre deux candidats recevables, on garde celui qui expire LE PLUS TARD, et non celui de la
 * configuration. C'est un cas vécu : un jeton d'installateur de 12 h laissé dans `.env` aurait
 * éclipsé pendant toute sa durée le jeton d'un an fraîchement frappé et mis en cache.
 *
 * `null` quand il n'y a rien d'utilisable : au plugin de se déclarer `needs_pairing`.
 */
export async function resolveEnphaseToken(o: ResolveTokenOptions): Promise<ResolvedToken | null> {
  const candidates: { token: string; source: 'config' | 'cache' }[] = []
  if (o.token) candidates.push({ token: o.token, source: 'config' })
  const cached = o.store ? await o.store.load() : null
  if (cached) candidates.push({ token: cached, source: 'cache' })

  let best: ResolvedToken | null = null
  for (const candidate of candidates) {
    const result = checkToken(candidate.token, { serial: o.serial, now: o.now })
    if (!result.ok) {
      o.logger?.warn(
        { source: candidate.source, reason: result.reason },
        `Enphase token ignored: ${rejectionMessage(result.reason, result.claims, o.serial)}`,
      )
      continue
    }
    if (!best || result.checked.claims.expiresAt > best.claims.expiresAt) {
      best = { ...result.checked, source: candidate.source }
    }
  }
  return best
}
