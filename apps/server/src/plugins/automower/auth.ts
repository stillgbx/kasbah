import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { tokenResponseSchema } from './types'

// Husqvarna Authentication API token, via `client_credentials`: the KEY and SECRET of the
// application created on developer.husqvarnagroup.cloud are enough, with no consent in a
// browser. The vendor says so itself: "this grant type is intended only for you" — the token
// represents the account that created the application, hence the robot's owner. That is the case
// for a household, and that is why there is neither a callback page nor a token file here: a token
// can be requested again at will, it lasts a day, and nothing is lost on restart.

export const TOKEN_URL = 'https://api.authentication.husqvarnagroup.dev/v1/oauth2/token'

/** Margin before expiry beyond which a token is requested ahead of time. */
const REFRESH_MARGIN_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 20_000

export interface AutomowerAuthOptions {
  appKey: string
  appSecret: string
  fetchImpl: FetchLike
  now: () => number
}

export class AutomowerAuth {
  private token: { value: string; expiresAt: number } | null = null
  private pending: Promise<string> | null = null

  constructor(private readonly opts: AutomowerAuthOptions) {}

  /** A valid access token, requested again if missing or expiring soon. Only one call in flight at a time. */
  accessToken(signal?: AbortSignal): Promise<string> {
    const t = this.token
    if (t && t.expiresAt - this.opts.now() > REFRESH_MARGIN_MS) return Promise.resolve(t.value)
    this.pending ??= this.fetchToken(signal).finally(() => { this.pending = null })
    return this.pending
  }

  /** The API refused the token (401): forget it, the next call requests a new one. */
  invalidate(): void { this.token = null }

  private async fetchToken(signal?: AbortSignal): Promise<string> {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.opts.appKey, client_secret: this.opts.appSecret })
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: body.toString(),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', 'Husqvarna authentication API unreachable', { cause: err })
    }
    // not counted in the quota: the developer portal only counts calls to the Automower Connect API
    const text = await res.text()
    // 400 `invalid_client` or 401: the key or the secret is wrong. It is not a network failure,
    // it is the configuration to review — `NEEDS_PAIRING`, like an account to link elsewhere
    if (res.status === 400 || res.status === 401) {
      throw new PluginError('NEEDS_PAIRING', `Husqvarna refused the application key or secret (HTTP ${res.status})${detail(text)}`)
    }
    if (res.status >= 400) throw new PluginError('UPSTREAM_ERROR', `Husqvarna authentication API returned HTTP ${res.status}${detail(text)}`)
    let json: unknown
    try { json = JSON.parse(text) } catch (err) { throw new PluginError('UPSTREAM_ERROR', 'Husqvarna authentication API sent invalid JSON', { cause: err }) }
    const parsed = tokenResponseSchema.safeParse(json)
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'Husqvarna token response has an unexpected shape')
    this.token = { value: parsed.data.access_token, expiresAt: this.opts.now() + parsed.data.expires_in * 1000 }
    return this.token.value
  }
}

/** The error from the body, when the vendor puts one there (`{ error, error_description }` or `{ message }`). */
export function detail(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: unknown; error_description?: unknown; message?: unknown; errors?: unknown }
    const parts = [j.error, j.error_description, j.message].filter((s) => typeof s === 'string' && s)
    if (Array.isArray(j.errors)) {
      for (const e of j.errors as { title?: unknown; detail?: unknown }[]) {
        for (const s of [e.title, e.detail]) if (typeof s === 'string' && s) parts.push(s)
      }
    }
    return parts.length ? `: ${parts.join(' — ')}` : ''
  } catch { return '' }
}
