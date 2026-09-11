import { Agent, fetch as undiciFetch } from 'undici'
import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'

// Client de l'API locale de la passerelle IQ. Trois particularités :
//  - HTTPS SEUL : le port 80 de la passerelle refuse la connexion (vérifié sur la vraie), et son
//    certificat est auto-signé → Agent undici dédié, jamais global (même choix que Hue et TaHoma) ;
//  - `/info` répond SANS jeton et donne le numéro de série : c'est ainsi que le plugin connaît la
//    passerelle sans le demander à l'utilisateur. Tout le reste exige `Authorization: Bearer` ;
//  - un jeton refusé ne rend pas 401 en JSON mais une page HTML de redirection vers /login.html.
//    On traduit donc le code HTTP, pas le corps.

/** Au-delà, on abandonne : la passerelle est sur le LAN. */
export const REQUEST_TIMEOUT_MS = 8000

export interface EnphaseClientOptions {
  host: string
  token?: string | undefined
  fetchImpl?: FetchLike
  logger?: Logger
  /** Abrégé dans les tests ; en production c'est `REQUEST_TIMEOUT_MS`. */
  requestTimeoutMs?: number
  /** Vérifier le certificat (jamais en production : il est auto-signé). */
  secureTls?: boolean
}

export interface GatewayInfo {
  serial: string
  /** Version du logiciel (`D8.3.5289`) : c'est elle qui décide si le jeton est exigé (7.0 et plus). */
  software?: string
}

/** Valeur d'une balise du XML de `/info`. Deux champs à lire : pas de quoi embarquer un parseur XML. */
function tag(xml: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]+)</${name}>`).exec(xml)?.[1]?.trim()
}

export class EnphaseClient {
  readonly dispatcher: Agent | undefined
  private readonly fetchImpl: FetchLike
  private token: string | undefined

  constructor(private readonly opts: EnphaseClientOptions) {
    this.dispatcher = opts.secureTls ? undefined : new Agent({ connect: { rejectUnauthorized: false } })
    this.fetchImpl = opts.fetchImpl
      ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
    this.token = opts.token
  }

  get baseUrl(): string { return `https://${this.opts.host}` }
  get hasToken(): boolean { return !!this.token }
  /** Après un (ré)appairage : le jeton change sans reconstruire le client ni redémarrer le plugin. */
  setToken(token: string): void { this.token = token }

  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private async request(path: string, opts: { auth: boolean; signal?: AbortSignal }): Promise<{ status: number; text: string }> {
    if (opts.auth && !this.token) throw new PluginError('NEEDS_PAIRING', `no Enphase token: cannot read ${path}`)
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: {
          accept: 'application/json',
          ...(opts.auth && this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        signal: this.deadline(opts.signal),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `IQ Gateway unreachable at ${this.opts.host}${path}`, { cause: err })
    }
    const text = await res.text()
    // 401 / 403 : jeton absent, expiré ou d'une autre passerelle — un geste de l'utilisateur, pas un incident
    if (res.status === 401 || res.status === 403) {
      throw new PluginError('NEEDS_PAIRING', `IQ Gateway refused the token (HTTP ${res.status} on ${path}): renew it`)
    }
    if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `IQ Gateway returned HTTP ${res.status} on ${path}`)
    return { status: res.status, text }
  }

  /** Identité de la passerelle. Seule route qui ne demande aucun jeton : sert à la reconnaître d'abord. */
  async info(signal?: AbortSignal): Promise<GatewayInfo> {
    const { text } = await this.request('/info', { auth: false, ...(signal ? { signal } : {}) })
    const serial = tag(text, 'sn')
    if (!serial) throw new PluginError('UPSTREAM_ERROR', `no serial number in /info from ${this.opts.host}`)
    const software = tag(text, 'software')
    return { serial, ...(software ? { software } : {}) }
  }

  /** GET authentifié, corps JSON. Le schéma est appliqué par l'appelant (mapping). */
  async getJson(path: string, signal?: AbortSignal): Promise<unknown> {
    const { text } = await this.request(path, { auth: true, ...(signal ? { signal } : {}) })
    try { return JSON.parse(text) as unknown }
    catch (err) { throw new PluginError('UPSTREAM_ERROR', `IQ Gateway sent invalid JSON on ${path}`, { cause: err }) }
  }
}
