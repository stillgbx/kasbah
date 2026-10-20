import { PluginError } from '../../core/plugin'

// TouteMonAnnée client: the PRIVATE API of its web app (Laravel), surveyed on 2026-10-04 in the
// browser. A session = cookies; nothing else is asked for reads. Writes (POST, PUT) also carry a
// CSRF token.
//
// Sign-in in two steps, like the `/connect` page: `check-email-username` (JSON) then `signin`
// (multipart form, `remember=1`). `remember` sets a long-lived `remember_web_…` cookie with which
// Laravel reopens an expired session by itself: it is what makes the password unnecessary after
// linking. A session that is really lost shows as a redirect to `/connect`.

export const TMA_BASE = 'https://www.toutemonannee.com'
const TIMEOUT_MS = 20_000

export type Cookies = Record<string, string>
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** Session lost: the account has to be linked again. */
export class SessionLostError extends PluginError {
  constructor(message = 'TouteMonAnnée session lost — link the account again') {
    super('NEEDS_PAIRING', message)
  }
}

export interface TmaClientOptions {
  cookies?: Cookies
  fetch?: FetchLike
  base?: string
  signal?: AbortSignal
  /** Called as soon as the site changes a cookie (the session rotates): to keep on disk. */
  onCookies?: (cookies: Cookies) => void
}

/** The CSRF token Laravel slips into its pages (`<meta name="csrf-token" content="…">` or equivalent). */
export function csrfFromHtml(html: string): string | null {
  const m = /csrf[-_]?token["']?\s*(?:content\s*=\s*|:\s*|=\s*)["']([A-Za-z0-9]{20,})["']/i.exec(html)
    ?? /content\s*=\s*["']([A-Za-z0-9]{20,})["'][^>]*name\s*=\s*["']csrf-token["']/i.exec(html)
  return m?.[1] ?? null
}

export function createTmaClient(opts: TmaClientOptions = {}) {
  const base = opts.base ?? TMA_BASE
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init))
  let cookies: Cookies = { ...(opts.cookies ?? {}) }
  let csrf: string | null = null

  function absorb(res: Response) {
    const set = res.headers.getSetCookie?.() ?? []
    if (!set.length) return
    const next = { ...cookies }
    for (const line of set) {
      const [pair, ...attrs] = line.split(';')
      const eq = pair!.indexOf('=')
      if (eq <= 0) continue
      const name = pair!.slice(0, eq).trim()
      const value = pair!.slice(eq + 1).trim()
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*(0|-\d+)\s*$/i.test(a))
        || attrs.some((a) => { const m = /^\s*expires\s*=\s*(.+)$/i.exec(a); return !!m && Date.parse(m[1]!) < Date.now() })
      if (expired || value === '' || value === 'deleted') delete next[name]
      else next[name] = value
    }
    cookies = next
    opts.onCookies?.(cookies)
  }

  const cookieHeader = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')

  async function send(path: string, init: { method?: string; body?: BodyInit; json?: unknown; html?: boolean } = {}): Promise<Response> {
    const method = init.method ?? 'GET'
    const headers: Record<string, string> = {
      accept: init.html ? 'text/html' : 'application/json, text/plain, */*',
      'x-requested-with': 'XMLHttpRequest',
      'x-requested-from': 'Reactor',
      origin: base,
      referer: `${base}/`,
      'user-agent': 'Mozilla/5.0 (Kasbah home dashboard)',
    }
    if (Object.keys(cookies).length) headers.cookie = cookieHeader()
    if (method !== 'GET') {
      // Laravel reads `X-CSRF-TOKEN` if present, otherwise `X-XSRF-TOKEN` = the XSRF-TOKEN cookie (encrypted)
      if (csrf) headers['x-csrf-token'] = csrf
      if (cookies['XSRF-TOKEN']) headers['x-xsrf-token'] = decodeURIComponent(cookies['XSRF-TOKEN'])
    }
    let body = init.body
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json;charset=utf-8'
      body = JSON.stringify(init.json)
    }
    const signal = AbortSignal.any([opts.signal ?? new AbortController().signal, AbortSignal.timeout(TIMEOUT_MS)])
    const res = await doFetch(`${base}${path}`, { method, headers, body, redirect: 'manual', signal })
    absorb(res)
    return res
  }

  /** An HTML page, from which the CSRF token is taken. */
  async function refreshCsrf(path: string) {
    const res = await send(path, { html: true })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') ?? ''
      if (loc) await refreshCsrf(new URL(loc, base).pathname)
      return
    }
    csrf = csrfFromHtml(await res.text()) ?? csrf
  }

  const lostSession = (res: Response) => {
    if (res.status === 401) return true
    if (res.status >= 300 && res.status < 400) return /\/connect/.test(res.headers.get('location') ?? '')
    return false
  }

  /** JSON of an app route; a lost session throws `SessionLostError`. */
  async function json(path: string, init: { method?: string; json?: unknown; body?: BodyInit } = {}, retried = false): Promise<unknown> {
    const res = await send(path, init)
    if (lostSession(res)) throw new SessionLostError()
    // 419 = CSRF token refused: read a new one, only once
    if (res.status === 419 && !retried) {
      await refreshCsrf('/dashboard')
      return json(path, init, true)
    }
    if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `TouteMonAnnée ${init.method ?? 'GET'} ${path.split('?')[0]} → HTTP ${res.status}`)
    const type = res.headers.get('content-type') ?? ''
    // an HTML page instead of JSON: it is the sign-in page served without a redirect
    if (!type.includes('json')) throw new SessionLostError()
    return res.json()
  }

  return {
    get cookies() { return { ...cookies } },

    /**
     * Links the account. The password only lives for the duration of this call: only what it
     * obtains (the cookies) is kept.
     */
    async login(username: string, password: string): Promise<void> {
      cookies = {}
      csrf = null
      await refreshCsrf('/connect')
      const check = await json('/connect/check-email-username', { method: 'POST', json: { username } }).catch((err: unknown) => {
        if (err instanceof SessionLostError) throw new PluginError('UPSTREAM_ERROR', 'TouteMonAnnée refused the login request')
        throw err
      }) as { is_username_or_email_used?: boolean }
      if (check.is_username_or_email_used === false) throw new PluginError('NEEDS_PAIRING', 'unknown TouteMonAnnée account')
      const form = new FormData()
      form.set('username', username)
      form.set('password', password)
      form.set('remember', '1')
      const res = await send('/connect/signin', { method: 'POST', body: form })
      if (res.status === 419) throw new PluginError('UPSTREAM_ERROR', 'TouteMonAnnée refused the login request (CSRF)')
      if (res.status === 401 || res.status === 422) throw new PluginError('NEEDS_PAIRING', 'TouteMonAnnée refused these credentials')
      if (!res.ok && !(res.status >= 300 && res.status < 400)) throw new PluginError('UPSTREAM_ERROR', `TouteMonAnnée sign-in → HTTP ${res.status}`)
      // the proof: a route that requires the session answers
      try { await json('/spaces/list') } catch (err) {
        if (err instanceof SessionLostError) throw new PluginError('NEEDS_PAIRING', 'TouteMonAnnée refused these credentials')
        throw err
      }
    },

    forget() {
      cookies = {}
      csrf = null
      opts.onCookies?.(cookies)
    },

    spaces: () => json('/spaces/list'),
    events: (journal: string, q: { date?: string; page: number }) =>
      json(`/journal/${journal}/events/list?${q.date ? `date=${q.date}&` : ''}page=${q.page}`),
    acknowledge: (journal: string, eventId: number) =>
      json(`/journal/${journal}/events/acknowledge/${eventId}`, { method: 'PUT' }),
    transmissions: (journal: string, page: number) => json(`/journal/${journal}/transmissions/list?page=${page}`),
    posts: (journal: string, page: number) => json(`/journal/${journal}/posts/list?published_date_order=1&page=${page}`),
  }
}
export type TmaClient = ReturnType<typeof createTmaClient>
