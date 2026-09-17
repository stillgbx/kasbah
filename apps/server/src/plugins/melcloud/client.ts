import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import type { MelcloudAuth } from './auth'

// Client HTTP de MELCloud. Ce qu'il traduit :
//  - 401 → la `ContextKey` est morte. Rien à rafraîchir (il n'y a pas de jeton de renouvellement),
//    donc on la JETTE et on remonte `NEEDS_PAIRING` : la carte des Réglages redemandera le mot de
//    passe, plutôt que de laisser le plugin marteler une clé que MELCloud refuse ;
//  - 429 → `RATE_LIMITED` ;
//  - le reste en `UPSTREAM_ERROR`.
//
// Pas de seau à jetons ici, contrairement à Renault : MELCloud ne publie aucun quota, et la seule
// borne connue est physique — une Ecodan ne parle au cloud que toutes les quelques minutes
// (`NextCommunication` le dit), donc sonder plus vite relit la même chose. C'est la CADENCE qui
// protège, pas un compteur. À revoir si le fabricant se met à répondre 429.

/** MELCloud interroge la machine par son module Wi-Fi : plusieurs secondes sont normales. */
export const REQUEST_TIMEOUT_MS = 30_000

export interface MelcloudClientOptions {
  baseUrl: string
  auth: MelcloudAuth
  fetchImpl: FetchLike
  logger?: Logger
  requestTimeoutMs?: number
}

export class MelcloudClient {
  constructor(private readonly opts: MelcloudClientOptions) {}

  /** L'inventaire du compte : bâtiments, étages, zones et appareils, en un seul appel. */
  listDevices(signal?: AbortSignal): Promise<unknown> {
    return this.request('GET', '/User/ListDevices', { signal })
  }

  /**
   * L'état complet d'une machine. `buildingID` est exigé en plus de l'identifiant : MELCloud
   * répond en erreur si on l'omet, même quand l'appareil est sans ambiguïté.
   */
  device(o: { deviceId: string; buildingId: string; signal?: AbortSignal }): Promise<unknown> {
    return this.request('GET', '/Device/Get', {
      query: { id: o.deviceId, buildingID: o.buildingId },
      signal: o.signal,
    })
  }

  /**
   * Le relevé d'énergie d'une machine sur une période (kWh consommés et produits, par jour et par
   * usage : chauffage, eau chaude, froid). Beaucoup d'installations SANS compteur d'énergie
   * répondent des zéros — c'est une réponse, pas une panne, et seule la capture dira ce que vos
   * machines rendent vraiment.
   */
  energyReport(o: { deviceId: string; from: string; to: string; signal?: AbortSignal }): Promise<unknown> {
    return this.request('POST', '/EnergyCost/Report', {
      body: { DeviceId: Number(o.deviceId), FromDate: o.from, ToDate: o.to, UseCurrency: false },
      signal: o.signal,
    })
  }

  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  /** Une requête authentifiée. La clé de session ne figure dans aucun message d'erreur. */
  async request(method: 'GET' | 'POST', path: string, o: { query?: Record<string, string>; body?: unknown; signal?: AbortSignal } = {}): Promise<unknown> {
    const key = this.opts.auth.key()
    const url = new URL(`${this.opts.baseUrl}${path}`)
    for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v)

    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(url.toString(), {
        method,
        headers: {
          'X-MitsContextKey': key,
          accept: 'application/json',
          ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
        signal: this.deadline(o.signal),
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `MELCloud unreachable on ${path}`, { cause: err })
    }

    const text = await res.text()
    if (res.status === 401) {
      await this.opts.auth.invalidate()
      throw new PluginError('NEEDS_PAIRING', `MELCloud refused the session key (HTTP 401 on ${path}): link the account again`)
    }
    if (res.status === 429) throw new PluginError('RATE_LIMITED', `MELCloud rate limit hit on ${path}`)
    if (res.status >= 400) throw new PluginError('UPSTREAM_ERROR', `MELCloud returned HTTP ${res.status} on ${path}`)

    const body = ((): unknown => { try { return JSON.parse(text) } catch { return null } })()
    if (body === null) throw new PluginError('UPSTREAM_ERROR', `MELCloud sent invalid JSON on ${path}`)
    return body
  }
}
