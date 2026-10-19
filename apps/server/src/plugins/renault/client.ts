import type { Logger } from 'pino'
import type { Clock } from '../../core/clock'
import { PluginError, type PluginErrorCode } from '../../core/plugin'
import { TokenBucket } from '../../core/rate-limit'
import type { FetchLike } from '../../core/sse'
import type { RenaultAuth } from './auth'
import { kamereonErrorsSchema } from './types'

// Client HTTP de Kamereon, l'API véhicule de Renault. Ce qu'il traduit :
//  - 401 → on renouvelle le JWT UNE fois et on rejoue ; encore 401 → `NEEDS_PAIRING` ;
//  - 403 `err.func.wired.forbidden` → l'endpoint N'EXISTE PAS POUR CE VÉHICULE. Ce n'est pas une
//    panne : sur une R5 E-Tech, `pressure`, `charge-mode` et `lock-status` répondent toujours ça.
//    Le plugin doit pouvoir le reconnaître pour cesser de demander — d'où `upstreamCode` ;
//  - 429 → `RATE_LIMITED` ;
//  - le reste en `UPSTREAM_ERROR`.
//
// L'API est GRATUITE (rien à voir avec Tesla), mais son débit est serré et Renault l'a resserré fin
// 2025 : un seau à jetons borne le plugin AVANT d'appeler, plutôt que d'attendre le 429.

/** Ce que Renault tolère en pratique, la valeur retenue par les autres intégrations : 60 par heure. */
export const DEFAULT_RATE_PER_HOUR = 60
/** Kamereon interroge la voiture par le réseau mobile : plusieurs secondes sont normales. */
export const REQUEST_TIMEOUT_MS = 30_000

/** Erreur Kamereon qui porte, en plus, le code maison du corps. */
export class RenaultApiError extends PluginError {
  constructor(code: PluginErrorCode, message: string, readonly upstreamCode?: string, options?: { cause?: unknown }) {
    super(code, message, options)
    this.name = 'RenaultApiError'
  }
}

/**
 * « Cet endpoint n'est pas servi pour ce véhicule » — définitif, pas une panne passagère. Le plugin
 * s'en sert pour rayer une lecture de sa liste au lieu de la retenter toutes les sept minutes.
 */
export function isEndpointUnavailable(err: unknown): boolean {
  return err instanceof RenaultApiError
    && (err.upstreamCode === 'err.func.wired.forbidden' || err.upstreamCode === 'err.func.wired.notFound')
}

/**
 * « Pas maintenant » — et non une panne. Deux refus distincts, tous deux normaux :
 *   - HTTP 409 `err.func.vcps.ev.post-settings.error` : une commande de réglages est DÉJÀ en attente
 *     pour ce véhicule, la suivante est refusée tant qu'elle n'est pas purgée. Constaté le
 *     2026-09-19 : un même corps accepté à 14:21 était refusé à 14:22, puis encore à 14:33 ;
 *   - `RATE_LIMITED` (429) : les actions ont leur propre quota, plus serré que les lectures.
 * Les confondre avec une panne, c'est ce qui a rendu cinq heures d'échecs illisibles.
 */
export function isDeferred(err: unknown): boolean {
  return (err instanceof RenaultApiError && err.upstreamCode === 'err.func.vcps.ev.post-settings.error')
    || (err instanceof PluginError && err.code === 'RATE_LIMITED')
}

export type Adapter = 'kca' | 'kcm'

/**
 * Chemin d'une lecture véhicule. Deux familles cohabitent, et elles ne se ressemblent pas :
 *   - `kca` : `.../kamereon/kca/car-adapter/v{n}/cars/{vin}/{endpoint}` (batterie, cockpit…) ;
 *   - `kcm` : `.../kamereon/kcm/v{n}/vehicles/{vin}/{endpoint}` (les réglages VE des modèles
 *     récents — `ev/soc-levels`, `ev/settings` : c'est par là que passe la R5).
 * Pur, donc réutilisable tel quel par le relevé brut.
 */
export function carDataPath(o: { accountId: string; vin: string; endpoint: string; version?: number; adapter?: Adapter }): string {
  const account = encodeURIComponent(o.accountId)
  const vin = encodeURIComponent(o.vin)
  const v = o.version ?? 1
  return o.adapter === 'kcm'
    ? `/commerce/v1/accounts/${account}/kamereon/kcm/v${v}/vehicles/${vin}/${o.endpoint}`
    : `/commerce/v1/accounts/${account}/kamereon/kca/car-adapter/v${v}/cars/${vin}/${o.endpoint}`
}

export interface RenaultClientOptions {
  baseUrl: string
  apiKey: string
  /** Code pays (`FR`), exigé en paramètre de requête sur TOUTES les routes. */
  country: string
  auth: RenaultAuth
  fetchImpl: FetchLike
  clock: Clock
  logger?: Logger
  requestTimeoutMs?: number
  ratePerHour?: number
}

export class RenaultClient {
  private readonly bucket: TokenBucket

  constructor(private readonly opts: RenaultClientOptions) {
    const perHour = opts.ratePerHour ?? DEFAULT_RATE_PER_HOUR
    this.bucket = new TokenBucket(perHour, perHour / 3600, opts.clock)
  }

  /** Délai (ms) avant qu'un appel soit permis — 0 si le budget de débit en laisse un passer. */
  waitMs(): number { return this.bucket.waitMs() }

  /** Une requête Kamereon, jeton renouvelé au besoin et débit respecté. */
  async request(method: 'GET' | 'POST', path: string, o: { query?: Record<string, string>; body?: unknown; signal?: AbortSignal } = {}): Promise<unknown> {
    if (!this.bucket.tryTake()) {
      throw new PluginError('RATE_LIMITED', `Renault rate budget spent, next call in ${Math.ceil(this.bucket.waitMs() / 1000)} s`)
    }
    let jwt = await this.opts.auth.jwt(o.signal)
    let res = await this.send(method, path, jwt, o)
    if (res.status === 401) {
      jwt = await this.opts.auth.mintJwt(o.signal)
      res = await this.send(method, path, jwt, o)
    }
    return this.interpret(res, path)
  }

  /** Les comptes Kamereon de la personne. */
  person(personId: string, signal?: AbortSignal): Promise<unknown> {
    return this.request('GET', `/commerce/v1/persons/${encodeURIComponent(personId)}`, { signal })
  }

  /** Les véhicules d'un compte. */
  vehicles(accountId: string, signal?: AbortSignal): Promise<unknown> {
    return this.request('GET', `/commerce/v1/accounts/${encodeURIComponent(accountId)}/vehicles`, { signal })
  }

  /** La fiche d'un véhicule : c'est là que vit ce que le compte sait en dire, au-delà du car-adapter. */
  vehicleDetails(accountId: string, vin: string, signal?: AbortSignal): Promise<unknown> {
    return this.request('GET', `/commerce/v1/accounts/${encodeURIComponent(accountId)}/vehicles/${encodeURIComponent(vin)}/details`, { signal })
  }

  /**
   * Les contrats du véhicule : garanties, services connectés, entretien. Lu À LA DEMANDE seulement
   * (bouton du panneau « Modifier ») — rien n'y change d'une semaine sur l'autre.
   */
  vehicleContracts(accountId: string, vin: string, locale: string, signal?: AbortSignal): Promise<unknown> {
    return this.request('GET', `/commerce/v1/accounts/${encodeURIComponent(accountId)}/vehicles/${encodeURIComponent(vin)}/contracts`, {
      query: { locale, brand: 'RENAULT', connectedServicesContracts: 'true', warranty: 'true', warrantyMaintenanceContracts: 'true' },
      signal,
    })
  }

  /**
   * Réécrit les réglages VE. **C'est l'écriture qui réveille la voiture**, pas son contenu : sur la
   * plateforme récente (R5, Scenic), `charge/pause-resume` répond 403 et seul ce POST fait réagir le
   * boîtier télématique. Le corps est celui qu'on vient de LIRE, horodatage rafraîchi — surtout pas
   * des valeurs inventées, qui écraseraient l'heure de départ et la température choisies.
   */
  writeEvSettings(o: { accountId: string; vin: string; body: unknown; signal?: AbortSignal }): Promise<unknown> {
    const path = carDataPath({ accountId: o.accountId, vin: o.vin, endpoint: 'ev/settings', version: 1, adapter: 'kcm' })
    return this.request('POST', path, { body: o.body, signal: o.signal })
  }

  /**
   * Écrit les NIVEAUX VE (`ev/soc-levels`, kcm) : c'est là que vit la cible de charge, à côté du
   * plancher que l'utilisateur a réglé dans la voiture. Même précaution que `writeEvSettings` : le
   * corps est celui qu'on vient de lire, seule la cible change.
   */
  writeSocLevels(o: { accountId: string; vin: string; body: unknown; signal?: AbortSignal }): Promise<unknown> {
    const path = carDataPath({ accountId: o.accountId, vin: o.vin, endpoint: 'ev/soc-levels', version: 1, adapter: 'kcm' })
    return this.request('POST', path, { body: o.body, signal: o.signal })
  }

  /**
   * Climatiser maintenant (`start`, 10 min au plus) ou arrêter (`cancel`). Une ACTION `kca` : son
   * quota est bien plus serré que celui des lectures (429 puis compte bloqué 1 h, le 2026-09-19).
   */
  hvacStart(o: { accountId: string; vin: string; body: unknown; signal?: AbortSignal }): Promise<unknown> {
    const path = carDataPath({ accountId: o.accountId, vin: o.vin, endpoint: 'actions/hvac-start', version: 1, adapter: 'kca' })
    return this.request('POST', path, { body: o.body, signal: o.signal })
  }

  /** Une lecture véhicule (cf. `carDataPath`). */
  carData(o: { accountId: string; vin: string; endpoint: string; version?: number; adapter?: Adapter; signal?: AbortSignal }): Promise<unknown> {
    return this.request('GET', carDataPath(o), { signal: o.signal })
  }

  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private async send(method: string, path: string, jwt: string, o: { query?: Record<string, string>; body?: unknown; signal?: AbortSignal }): Promise<{ status: number; text: string }> {
    const url = new URL(`${this.opts.baseUrl}${path}`)
    url.searchParams.set('country', this.opts.country)
    for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v)
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(url.toString(), {
        method,
        headers: {
          apikey: this.opts.apiKey,
          'x-gigya-id_token': jwt,
          accept: 'application/json',
          ...(o.body !== undefined ? { 'content-type': 'application/vnd.api+json' } : {}),
        },
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
        signal: this.deadline(o.signal),
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `Renault API unreachable on ${path}`, { cause: err })
    }
    return { status: res.status, text: await res.text() }
  }

  private interpret(res: { status: number; text: string }, path: string): unknown {
    const body = ((): unknown => { try { return JSON.parse(res.text) } catch { return null } })()
    const upstream = upstreamCode(body)
    if (res.status === 401) {
      throw new RenaultApiError('NEEDS_PAIRING', `Renault refused the token (HTTP 401 on ${path}): link the account again`, upstream)
    }
    if (res.status === 403) {
      throw new RenaultApiError('UPSTREAM_ERROR', `Renault forbids ${path} (HTTP 403${upstream ? `, ${upstream}` : ''})`, upstream)
    }
    if (res.status === 429) throw new RenaultApiError('RATE_LIMITED', `Renault rate limit hit on ${path}`, upstream)
    if (res.status >= 400) {
      throw new RenaultApiError('UPSTREAM_ERROR', `Renault API returned HTTP ${res.status} on ${path}${upstream ? `: ${upstream}` : ''}`, upstream)
    }
    if (body === null) throw new PluginError('UPSTREAM_ERROR', `Renault API sent invalid JSON on ${path}`)
    return body
  }
}

/** Le premier `errors[].errorCode` du corps, quand Kamereon en met un. */
function upstreamCode(body: unknown): string | undefined {
  const parsed = kamereonErrorsSchema.safeParse(body)
  if (!parsed.success) return undefined
  return parsed.data.errors[0]?.errorCode
}
