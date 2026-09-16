import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { detail, type AutomowerAuth } from './auth'

// Client HTTP de l'Automower Connect API. Trois en-têtes obligatoires sur chaque appel :
// `Authorization: Bearer`, `Authorization-Provider: husqvarna` et `X-Api-Key` (la clé d'application,
// la même que celle du jeton). Le corps est du JSON:API (`application/vnd.api+json`).
//
// Ce qu'il traduit :
//  - 401 → le jeton est périmé ou révoqué : on en redemande UN et on rejoue ; encore 401 →
//    `NEEDS_PAIRING` (clé ou secret à revoir) ;
//  - 403 → interdit : c'est aussi ainsi que le fabricant répond quand le QUOTA MENSUEL de la clé
//    (10 000 requêtes) est épuisé — `RATE_LIMITED`, le corps dit lequel ;
//  - 429 → plus d'une requête par seconde : `RATE_LIMITED` ;
//  - 404 → robot inconnu de ce compte : `DEVICE_UNAVAILABLE` ;
//  - le reste en `UPSTREAM_ERROR`.
// Chaque requête est COMPTÉE (`onCall`) : c'est au plugin de tenir le quota du mois.

export const API_BASE_URL = 'https://api.amc.husqvarna.dev/v1'
export const REQUEST_TIMEOUT_MS = 20_000

export interface AutomowerClientOptions {
  auth: AutomowerAuth
  appKey: string
  fetchImpl: FetchLike
  baseUrl?: string
  logger?: Logger
  requestTimeoutMs?: number
  /** Une requête qui a reçu une réponse, quelle qu'elle soit : le quota du fabricant la compte. */
  onCall?: (path: string, status: number) => void
}

export class AutomowerClient {
  constructor(private readonly opts: AutomowerClientOptions) {}

  /** `GET /mowers` : tous les robots du compte, état complet compris. */
  mowers(signal?: AbortSignal): Promise<unknown> { return this.request('GET', '/mowers', { signal }) }

  /** `GET /mowers/{id}/messages` : le journal du robot (erreurs et avertissements, datés et positionnés). */
  messages(mowerId: string, signal?: AbortSignal): Promise<unknown> {
    return this.request('GET', `/mowers/${encodeURIComponent(mowerId)}/messages`, { signal })
  }

  /** `POST /mowers/{id}/actions` : Start, Pause, Park… Le fabricant accuse en 202 sans corps. */
  action(mowerId: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.request('POST', `/mowers/${encodeURIComponent(mowerId)}/actions`, { body, signal })
  }

  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  async request(method: 'GET' | 'POST', path: string, o: { body?: unknown; signal?: AbortSignal } = {}): Promise<unknown> {
    let token = await this.opts.auth.accessToken(o.signal)
    let res = await this.send(method, path, token, o)
    if (res.status === 401) {
      this.opts.auth.invalidate()
      token = await this.opts.auth.accessToken(o.signal)
      res = await this.send(method, path, token, o)
    }
    return this.interpret(res, path)
  }

  private async send(method: string, path: string, token: string, o: { body?: unknown; signal?: AbortSignal }): Promise<{ status: number; text: string }> {
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(`${this.opts.baseUrl ?? API_BASE_URL}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'authorization-provider': 'husqvarna',
          'x-api-key': this.opts.appKey,
          accept: 'application/vnd.api+json',
          ...(o.body !== undefined ? { 'content-type': 'application/vnd.api+json' } : {}),
        },
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
        signal: this.deadline(o.signal),
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `Automower Connect API unreachable on ${path}`, { cause: err })
    }
    this.opts.onCall?.(path, res.status)
    return { status: res.status, text: await res.text() }
  }

  private interpret(res: { status: number; text: string }, path: string): unknown {
    if (res.status === 401) throw new PluginError('NEEDS_PAIRING', `Husqvarna refused the token (HTTP 401 on ${path}): check the application key and secret`)
    if (res.status === 403) throw new PluginError('RATE_LIMITED', `Husqvarna forbids ${path} (HTTP 403, monthly quota exhausted?)${detail(res.text)}`)
    if (res.status === 429) throw new PluginError('RATE_LIMITED', `Husqvarna rate limit hit on ${path} (1 request per second)`)
    if (res.status === 404) throw new PluginError('DEVICE_UNAVAILABLE', `Husqvarna knows no such mower (HTTP 404 on ${path})`)
    if (res.status >= 400) throw new PluginError('UPSTREAM_ERROR', `Automower Connect API returned HTTP ${res.status} on ${path}${detail(res.text)}`)
    // 202 Accepted sans corps sur une action : rien à lire
    if (!res.text.trim()) return null
    try { return JSON.parse(res.text) as unknown }
    catch (err) { throw new PluginError('UPSTREAM_ERROR', `Automower Connect API sent invalid JSON on ${path}`, { cause: err }) }
  }
}
