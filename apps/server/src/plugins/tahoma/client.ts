import { Agent, fetch as undiciFetch } from 'undici'
import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import {
  overkizApiVersionSchema, overkizDeviceSchema, overkizErrorSchema, overkizEventsSchema, overkizListenerSchema,
  overkizSetupEnvelopeSchema, type OverkizAction, type OverkizDevice, type OverkizEvent,
} from './types'

// Client de l'API locale Overkiz (mode développeur de la box TaHoma). Trois particularités :
//  - le certificat de la box est signé par l'AC Overkiz pour le nom `gateway-XXXX-XXXX-XXXX.local` :
//    joindre la box par son IP échoue la vérification TLS → Agent undici dédié (jamais globalement,
//    même choix que le pont Hue) ;
//  - il n'y a pas de flux d'événements poussés : on enregistre un écouteur puis on le sonde ;
//  - CHAQUE requête porte son propre délai. La box répond d'ordinaire en 50 à 300 ms, mais on l'a
//    vue bloquer une commande au-delà de 10 s sans rien journaliser. Le défaut d'undici étant de
//    300 s, une requête coincée gèlerait le sondage d'événements pour de bon — le plugin
//    resterait « ok » tout en étant aveugle. D'où l'abandon explicite ci-dessous.

/** Au-delà, on abandonne la requête : la box est sur le LAN et répond en centaines de ms. */
export const REQUEST_TIMEOUT_MS = 8000

export interface TahomaClientOptions {
  host: string
  port: number
  token?: string
  insecureTls?: boolean
  fetchImpl?: FetchLike
  logger?: Logger
  /** Abrégé dans les tests ; en production c'est `REQUEST_TIMEOUT_MS`. */
  requestTimeoutMs?: number
}

export class TahomaClient {
  readonly dispatcher: Agent | undefined
  readonly fetchImpl: FetchLike
  private readonly logger: Logger | undefined

  constructor(private readonly opts: TahomaClientOptions) {
    this.dispatcher = opts.insecureTls === false ? undefined : new Agent({ connect: { rejectUnauthorized: false } })
    this.fetchImpl = opts.fetchImpl
      ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
    this.logger = opts.logger
  }

  get baseUrl(): string {
    return `https://${this.opts.host}:${this.opts.port}/enduser-mobile-web/1/enduserAPI`
  }

  /** Signal de la requête : celui de l'appelant (arrêt du plugin) OU l'abandon sur délai. */
  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private async request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}),
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: this.deadline(signal),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      })
    } catch (err) {
      // `signal` déjà annulé = arrêt du plugin ; sinon c'est notre propre délai qui a expiré
      if ((err as Error).name === 'TimeoutError' && signal?.aborted !== true) {
        const ms = this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
        throw new PluginError('TIMEOUT', `TaHoma box did not answer ${method} ${path} within ${ms} ms`, { cause: err })
      }
      throw new PluginError('UPSTREAM_ERROR', `TaHoma box unreachable (${(err as Error).message})`, { cause: err })
    }
    // Le corps est diagnostique et vaut d'être remonté : « Missing authorization token. » accuse
    // NOTRE en-tête, « Not authenticated. » accuse le jeton (inconnu de la box, ou pas encore
    // synchronisé depuis le compte Somfy). Il ne contient jamais le jeton.
    if (res.status === 401 || res.status === 403) {
      throw new PluginError('NEEDS_PAIRING', `TaHoma local token rejected${await this.describe(res)}`)
    }
    if (res.status === 429) throw new PluginError('RATE_LIMITED', 'TaHoma box rate limit')
    if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `TaHoma box HTTP ${res.status}${await this.describe(res)}`)
    return res.json()
  }

  /** Détail lisible d'une erreur de la box, sans jamais recopier le jeton. */
  private async describe(res: Awaited<ReturnType<FetchLike>>): Promise<string> {
    try {
      const parsed = overkizErrorSchema.safeParse(JSON.parse(await res.text()))
      const detail = parsed.success ? parsed.data.error ?? parsed.data.errorCode : undefined
      return detail ? ` (${detail})` : ''
    } catch { return '' }
  }

  /** Sonde de joignabilité et de validité du jeton : `{ protocolVersion }`. */
  async getApiVersion(signal?: AbortSignal): Promise<string | undefined> {
    return overkizApiVersionSchema.parse(await this.request('GET', '/apiVersion', undefined, signal)).protocolVersion
  }

  /**
   * Liste des appareils. Chaque appareil est validé SÉPARÉMENT : un seul appareil à la forme
   * inattendue ne doit pas priver la maison de tous les autres (même choix que le pont Hue).
   */
  async getSetup(signal?: AbortSignal): Promise<OverkizDevice[]> {
    const raw = overkizSetupEnvelopeSchema.parse(await this.request('GET', '/setup', undefined, signal))
    const out: OverkizDevice[] = []
    for (const item of raw.devices) {
      const parsed = overkizDeviceSchema.safeParse(item)
      if (parsed.success) out.push(parsed.data)
      else this.logger?.debug({ issues: parsed.error.issues }, 'TaHoma device skipped')
    }
    return out
  }

  async registerListener(signal?: AbortSignal): Promise<string> {
    return overkizListenerSchema.parse(await this.request('POST', '/events/register', undefined, signal)).id
  }

  /**
   * Sonde l'écouteur. `null` quand la box ne le connaît plus (expiré, box redémarrée) : l'appelant
   * doit en réenregistrer un et resynchroniser.
   */
  async fetchEvents(listenerId: string, signal?: AbortSignal): Promise<OverkizEvent[] | null> {
    try {
      return overkizEventsSchema.parse(await this.request('POST', `/events/${listenerId}/fetch`, undefined, signal))
    } catch (err) {
      const message = (err as Error).message
      if (err instanceof PluginError && err.code === 'UPSTREAM_ERROR' && /400|404|listener/i.test(message)) {
        this.logger?.info({ listenerId }, 'TaHoma event listener gone, re-registering')
        return null
      }
      throw err
    }
  }

  async unregisterListener(listenerId: string): Promise<void> {
    await this.request('POST', `/events/${listenerId}/unregister`)
  }

  /** Exécute une action ; la box répond `{ execId }` dès qu'elle a pris la commande. */
  async apply(label: string, action: OverkizAction, signal?: AbortSignal): Promise<void> {
    await this.request('POST', '/exec/apply', { label, actions: [action] }, signal)
  }

  close(): void { void this.dispatcher?.close() }
}
