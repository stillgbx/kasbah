import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { CLOUD_TIMEOUT_MS, loginEnlighten, type LoginOptions } from './token'
import { writeFileAtomic } from '../../core/atomic-file'

// Enlighten (cloud) session: what the IQ EV Charger 2 needs. The gateway's LOCAL API does not see
// it; Modbus is reserved for partners. That leaves the Enphase app's private API — same decision as
// Renault, for lack of an official route useful to a UI (Enlighten v4's Watt plan is 1,000
// calls/month, 15 min telemetry, VPP commands).
//
// The password is NEVER kept: it opens a session, we keep the `session_id` (and possibly an access
// token and the site id). The charger mapping awaits a capture (`GET /api/plugins/enphase/ev/raw`):
// the paths below are probes, not a contract.

export const ENLIGHTEN_ORIGIN = 'https://enlighten.enphaseenergy.com'
const SESSION_COOKIE = '_enlighten_4_session'

export interface CloudSession {
  /** JSON `session_id`: exchanged for the local JWT, unusable as an Enlighten cookie. */
  sessionId: string
  /** `_enlighten_4_session` cookie: it is what opens search_sites and the EVSE API. */
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
      try { await writeFileAtomic(path, `${JSON.stringify(session, null, 2)}\n`) }
      catch (err) { logger?.warn({ err, path }, 'could not write Enphase cloud session') }
    },
  }
}

const WRAPPERS = ['sites', 'data', 'items', 'systems'] as const
const ID_KEYS = ['site_id', 'siteId', 'system_id', 'id'] as const
const TITLE_KEYS = ['title', 'name', 'site_name', 'siteName', 'displayName', 'display_name'] as const

export interface EnlightenSite { id: string; title?: string }

/**
 * An account's sites, read without presuming the wrapper. The app has already shown four different
 * envelopes (`sites` / `data` / `items` / `systems`): we accept them all, and let the capture say
 * which one THIS account really returns.
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

/** Paths probed to write the charger fixtures. Read-only. `{site}` = Enlighten id. */
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
    return this.send('GET', path, undefined, signal)
  }

  /**
   * Read or write. On a write (charger command), the EVSE routes return `{ data, error }`: a
   * non-empty `error` is a refusal even under HTTP 200, and a 409 / 422 says the charger is not ready
   * (`DEVICE_UNAVAILABLE`, not plugged in according to the Home Assistant integration that recorded
   * them).
   */
  async send(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const doFetch = this.opts.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>)
    const url = path.startsWith('http') ? path : `${ENLIGHTEN_ORIGIN}${path}`
    const headers = body === undefined ? this.headers() : { ...this.headers(), 'content-type': 'application/json' }
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await doFetch(url, {
        method, headers, signal: this.deadline(signal), ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `Enlighten unreachable (${path})`, { cause: err })
    }
    const text = await res.text()
    if (!res.ok) {
      const notReady = method !== 'GET' && (res.status === 409 || res.status === 422)
      throw new PluginError(notReady ? 'DEVICE_UNAVAILABLE' : 'UPSTREAM_ERROR', `Enlighten ${path} → HTTP ${res.status}`)
    }
    let json: unknown
    try { json = JSON.parse(text) as unknown }
    catch { throw new PluginError('UPSTREAM_ERROR', `Enlighten ${path} returned non-JSON`) }
    const error = method !== 'GET' ? (json as { error?: unknown } | null)?.error : undefined
    if (error && typeof error === 'object' && Object.keys(error).length > 0) {
      throw new PluginError('UPSTREAM_ERROR', `Enlighten ${path} refused: ${JSON.stringify(error)}`)
    }
    return json
  }

  /** The app's access token, optional: many reads go through with the cookie alone. */
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
 * Opens a session and, at best, completes it (access token, site id). A failure on these reads
 * does NOT invalidate the session: the raw reading will pick them up again.
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
