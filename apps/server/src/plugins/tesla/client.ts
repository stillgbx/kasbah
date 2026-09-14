import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import type { TeslaAuth } from './auth'

// Client HTTP de la Fleet API. Ce qu'il traduit :
//  - 401 → on rafraîchit UNE fois et on rejoue ; encore 401 → `NEEDS_PAIRING` (compte à relier) ;
//  - 408 → le véhicule DORT. Ce n'est pas une erreur : c'est la réponse normale de `vehicle_data`
//    sur un véhicule endormi, rendue en `DEVICE_UNAVAILABLE` pour que le plugin la reconnaisse ;
//  - 429 → `RATE_LIMITED` (60 lectures / min, 3 réveils / min, 30 commandes / min par véhicule) ;
//  - le reste en `UPSTREAM_ERROR`.
// Tout appel qui aboutit (statut < 500) est FACTURÉ par Tesla : c'est au plugin d'en compter,
// pas au client d'en refuser.

/**
 * `vehicle_data` interroge la voiture par le réseau mobile : le fabricant lui-même met plusieurs
 * secondes, et jusqu'à une dizaine quand le véhicule sort de veille.
 */
export const REQUEST_TIMEOUT_MS = 30_000

export interface TeslaClientOptions {
  baseUrl: string
  auth: TeslaAuth
  fetchImpl: FetchLike
  logger?: Logger
  requestTimeoutMs?: number
  /**
   * Appelé pour chaque requête du COMPTE qui a reçu une réponse, avec son chemin. Tesla facture tout
   * ce qui répond en dessous de 500 — un 408 « voiture endormie » compris —, et c'est par là que le
   * plugin tient sa consommation du mois. Les requêtes partenaires n'en font pas partie.
   */
  onCall?: (path: string, status: number) => void
}

export class TeslaClient {
  constructor(private readonly opts: TeslaClientOptions) {}

  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  /** Requête au nom du COMPTE (jeton rafraîchi au besoin). */
  async request(method: 'GET' | 'POST', path: string, o: { body?: unknown; signal?: AbortSignal } = {}): Promise<unknown> {
    let token = await this.opts.auth.accessToken(o.signal)
    let res = await this.send(method, path, token, o)
    if (res.status === 401) {
      token = await this.opts.auth.refresh(o.signal)
      res = await this.send(method, path, token, o)
    }
    // avant d'interpréter : un 408 ou un 4xx a bel et bien été facturé, et doit compter
    if (res.status < 500) this.opts.onCall?.(path, res.status)
    return this.interpret(res, path)
  }

  /** Requête au nom du PARTENAIRE (enregistrement du domaine) : jeton fourni par l'appelant. */
  async partnerRequest(method: 'GET' | 'POST', path: string, token: string, o: { body?: unknown; signal?: AbortSignal } = {}): Promise<unknown> {
    return this.interpret(await this.send(method, path, token, o), path)
  }

  private async send(method: string, path: string, token: string, o: { body?: unknown; signal?: AbortSignal }): Promise<{ status: number; text: string }> {
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(`${this.opts.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`, accept: 'application/json',
          ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
        signal: this.deadline(o.signal),
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `Tesla Fleet API unreachable on ${path}`, { cause: err })
    }
    return { status: res.status, text: await res.text() }
  }

  private interpret(res: { status: number; text: string }, path: string): unknown {
    if (res.status === 401) {
      throw new PluginError('NEEDS_PAIRING', `Tesla refused the token (HTTP 401 on ${path}): link the account again`)
    }
    // 403 : le jeton est bon mais n'a pas le DROIT — portée manquante, application pas enregistrée,
    // véhicule pas partagé. Le corps dit lequel, et c'est la seule chose utile à remonter ; relier
    // le compte n'y changerait rien
    if (res.status === 403) throw new PluginError('UPSTREAM_ERROR', `Tesla forbids ${path} (HTTP 403)${detail(res.text)}`)
    if (res.status === 408) throw new PluginError('DEVICE_UNAVAILABLE', `vehicle is asleep or offline (HTTP 408 on ${path})`)
    if (res.status === 429) throw new PluginError('RATE_LIMITED', `Tesla rate limit hit on ${path}`)
    if (res.status >= 400) {
      throw new PluginError('UPSTREAM_ERROR', `Tesla Fleet API returned HTTP ${res.status} on ${path}${detail(res.text)}`)
    }
    try { return JSON.parse(res.text) as unknown }
    catch (err) { throw new PluginError('UPSTREAM_ERROR', `Tesla Fleet API sent invalid JSON on ${path}`, { cause: err }) }
  }
}

/** L'`error` du corps, quand Tesla en met une : c'est elle qui explique un 4xx. */
function detail(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: unknown; error_description?: unknown }
    const e = [j.error, j.error_description].filter((s) => typeof s === 'string' && s).join(' — ')
    return e ? `: ${e}` : ''
  } catch { return '' }
}
