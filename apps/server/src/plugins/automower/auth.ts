import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { tokenResponseSchema } from './types'

// Jeton de l'Authentication API Husqvarna, en `client_credentials` : la CLÉ et le SECRET de
// l'application créée sur developer.husqvarnagroup.cloud suffisent, sans consentement dans un
// navigateur. Le fabricant le dit lui-même : « this grant type is intended only for you » — le
// jeton représente le compte qui a créé l'application, donc le propriétaire du robot. C'est le cas
// d'un foyer, et c'est pourquoi il n'y a ni page de retour ni fichier de jetons ici : un jeton se
// redemande à volonté, il vaut une journée, et rien ne se perd au redémarrage.

export const TOKEN_URL = 'https://api.authentication.husqvarnagroup.dev/v1/oauth2/token'

/** Marge avant l'échéance au-delà de laquelle on redemande un jeton d'avance. */
const REFRESH_MARGIN_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 20_000

export interface AutomowerAuthOptions {
  appKey: string
  appSecret: string
  fetchImpl: FetchLike
  now: () => number
  /** Un appel de plus au fabricant : compté au quota, par prudence (sa catégorie n'est pas publiée). */
  onCall?: (path: string, status: number) => void
}

export class AutomowerAuth {
  private token: { value: string; expiresAt: number } | null = null
  private pending: Promise<string> | null = null

  constructor(private readonly opts: AutomowerAuthOptions) {}

  /** Jeton d'accès valide, redemandé s'il manque ou s'il expire bientôt. Un seul appel en vol à la fois. */
  accessToken(signal?: AbortSignal): Promise<string> {
    const t = this.token
    if (t && t.expiresAt - this.opts.now() > REFRESH_MARGIN_MS) return Promise.resolve(t.value)
    this.pending ??= this.fetchToken(signal).finally(() => { this.pending = null })
    return this.pending
  }

  /** L'API a refusé le jeton (401) : on l'oublie, le prochain appel en redemande un. */
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
    this.opts.onCall?.('/oauth2/token', res.status)
    const text = await res.text()
    // 400 `invalid_client` ou 401 : la clé ou le secret sont faux. Ce n'est pas une panne réseau,
    // c'est la configuration à revoir — `NEEDS_PAIRING`, comme un compte à relier ailleurs
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

/** L'erreur du corps, quand le fabricant en met une (`{ error, error_description }` ou `{ message }`). */
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
