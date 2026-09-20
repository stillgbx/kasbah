import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Logger } from 'pino'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { CLOUD_TIMEOUT_MS, loginEnlighten, type LoginOptions } from './token'

// Session Enlighten (cloud) : ce dont la borne IQ EV Charger 2 a besoin. L'API LOCALE de la
// passerelle ne la voit pas ; le Modbus est réservé aux partenaires. Reste l'API privée de
// l'appli Enphase — même décision que Renault, faute de voie officielle utile à une tablette
// (le plan Watt d'Enlighten v4 est 1 000 appels/mois, télémétrie 15 min, commandes VPP).
//
// Le mot de passe n'est JAMAIS gardé : il ouvre une session, on conserve le `session_id` (et
// éventuellement un jeton d'accès et l'id du site). Le mappage de la borne attend une capture
// (`GET /api/plugins/enphase/ev/raw`) : les chemins ci-dessous sont des sondes, pas un contrat.

export const ENLIGHTEN_ORIGIN = 'https://enlighten.enphaseenergy.com'
const SESSION_COOKIE = '_enlighten_4_session'

export interface CloudSession {
  /** `session_id` JSON : échange contre le JWT local, inutilisable comme cookie Enlighten. */
  sessionId: string
  /** Cookie `_enlighten_4_session` : c'est lui qui ouvre search_sites et l'API EVSE. */
  cookie?: string
  accessToken?: string
  siteId?: string
}

const cloudSessionSchema = z.object({
  sessionId: z.string().min(1),
  cookie: z.string().min(1).optional(),
  accessToken: z.string().min(1).optional(),
  siteId: z.string().min(1).optional(),
})

export interface CloudStore {
  load(): Promise<CloudSession | null>
  save(session: CloudSession): Promise<void>
}

export function createCloudFile(path: string, logger?: Logger): CloudStore {
  return {
    async load() {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return null }
      const parsed = cloudSessionSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger?.warn({ path }, 'unreadable Enphase cloud session, ignoring it'); return null }
      return parsed.data
    },
    async save(session) {
      const tmp = `${path}.${process.pid}.tmp`
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(tmp, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
        await rename(tmp, path)
      } catch (err) {
        logger?.warn({ err, path }, 'could not write Enphase cloud session')
      }
    },
  }
}

const WRAPPERS = ['sites', 'data', 'items', 'systems'] as const
const ID_KEYS = ['site_id', 'siteId', 'system_id', 'id'] as const
const TITLE_KEYS = ['title', 'name', 'site_name', 'siteName', 'displayName', 'display_name'] as const

export interface EnlightenSite { id: string; title?: string }

/**
 * Sites d'un compte, lus sans présumer l'emballage. L'appli a déjà montré quatre enveloppes
 * différentes (`sites` / `data` / `items` / `systems`) : on les accepte toutes, et on laisse
 * la capture dire laquelle CE compte rend vraiment.
 */
export function sitesOf(json: unknown): EnlightenSite[] {
  if (json == null) return []
  let list: unknown[] = []
  if (Array.isArray(json)) list = json
  else if (typeof json === 'object') {
    const rec = json as Record<string, unknown>
    for (const key of WRAPPERS) {
      if (Array.isArray(rec[key])) { list = rec[key] as unknown[]; break }
    }
  }
  const out: EnlightenSite[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = ID_KEYS.map((k) => o[k]).find((v) => v != null && String(v).trim() !== '')
    if (id == null) continue
    const title = TITLE_KEYS.map((k) => o[k]).find((v) => typeof v === 'string' && v.trim())
    out.push({ id: String(id), ...(typeof title === 'string' ? { title } : {}) })
  }
  return out
}

const accessTokenSchema = z.object({ token: z.string().min(1) })

/** Chemins sondés pour écrire les fixtures de la borne. Lecture seule. `{site}` = id Enlighten. */
export const EV_RAW_PATHS = [
  '/users/self/token',
  '/app-api/search_sites.json?searchText=&favourite=false',
  '/service/evse_controller/{site}/ev_chargers/status',
  '/service/evse_controller/api/v2/{site}/ev_chargers/status',
  '/service/evse_controller/api/v2/{site}/ev_chargers/summary?filter_retired=true',
  '/service/evse_controller/{site}/ev_chargers/summary',
  '/app-api/{site}/devices.json',
  '/service/evse_management/fwDetails/{site}',
] as const

export class EnlightenClient {
  private session: CloudSession | null

  constructor(
    private readonly opts: {
      fetchImpl?: FetchLike
      logger?: Logger
      timeoutMs?: number
      session?: CloudSession | null
    } = {},
  ) {
    this.session = opts.session ?? null
  }

  get hasSession(): boolean { return !!this.session?.sessionId }
  get current(): CloudSession | null { return this.session }
  setSession(session: CloudSession | null): void { this.session = session }

  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? CLOUD_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private headers(): Record<string, string> {
    const s = this.session
    if (!s) throw new PluginError('NEEDS_PAIRING', 'no Enlighten session: pair with the Enphase account')
    const token = s.accessToken ?? s.sessionId
    return {
      accept: 'application/json',
      cookie: `${SESSION_COOKIE}=${s.cookie ?? s.sessionId}`,
      'e-auth-token': token,
      ...(s.accessToken ? { authorization: `Bearer ${s.accessToken}` } : {}),
    }
  }

  async getJson(path: string, signal?: AbortSignal): Promise<unknown> {
    const doFetch = this.opts.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>)
    const url = path.startsWith('http') ? path : `${ENLIGHTEN_ORIGIN}${path}`
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await doFetch(url, { headers: this.headers(), signal: this.deadline(signal) })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `Enlighten unreachable (${path})`, { cause: err })
    }
    const text = await res.text()
    if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `Enlighten ${path} → HTTP ${res.status}`)
    try { return JSON.parse(text) as unknown }
    catch { throw new PluginError('UPSTREAM_ERROR', `Enlighten ${path} returned non-JSON`) }
  }

  /** Jeton d'accès de l'appli, facultatif : beaucoup de lectures passent avec le cookie seul. */
  async readAccessToken(signal?: AbortSignal): Promise<string | undefined> {
    try {
      const parsed = accessTokenSchema.safeParse(await this.getJson('/users/self/token', signal))
      return parsed.success ? parsed.data.token : undefined
    } catch (err) {
      this.opts.logger?.debug({ err }, 'Enlighten /users/self/token unavailable: cookie-only session')
      return undefined
    }
  }

  async readSites(signal?: AbortSignal): Promise<EnlightenSite[]> {
    return sitesOf(await this.getJson('/app-api/search_sites.json?searchText=&favourite=false', signal))
  }
}

/**
 * Ouvre une session et, au mieux, la complète (jeton d'accès, id du site). Un échec sur ces
 * lectures n'invalide PAS la session : le relevé brut les reprendra.
 */
export async function openCloudSession(o: LoginOptions & { logger?: Logger }): Promise<CloudSession> {
  const { sessionId, cookie } = await loginEnlighten(o)
  const session: CloudSession = { sessionId, ...(cookie ? { cookie } : {}) }
  if (!cookie) o.logger?.warn('Enlighten login returned no _enlighten_4_session cookie: EVSE routes will 401')
  const client = new EnlightenClient({
    ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
    ...(o.logger ? { logger: o.logger } : {}),
    ...(o.timeoutMs != null ? { timeoutMs: o.timeoutMs } : {}),
    session,
  })
  const accessToken = await client.readAccessToken(o.signal)
  if (accessToken) {
    session.accessToken = accessToken
    client.setSession(session)
  }
  try {
    const sites = await client.readSites(o.signal)
    if (sites[0]) session.siteId = sites[0].id
  } catch (err) {
    o.logger?.debug({ err }, 'Enlighten site list unavailable during pairing')
  }
  return session
}

export async function probeEvRaw(
  client: EnlightenClient,
  siteId: string | undefined,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { siteId: siteId ?? null, hasCookie: !!client.current?.cookie }
  for (const template of EV_RAW_PATHS) {
    if (template.includes('{site}') && !siteId) {
      out[template] = { error: 'no Enlighten site id yet: pair with the account, then retry' }
      continue
    }
    const path = siteId ? template.replaceAll('{site}', siteId) : template
    try { out[path] = await client.getJson(path, signal) }
    catch (err) { out[path] = { error: (err as Error).message } }
  }
  return out
}
