import { fetch as undiciFetch } from 'undici'
import type { Logger } from 'pino'
import type { Clock } from '../../core/clock'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { authorizationUrl } from './mapping'
import {
  oauthErrorSchema, oauthTokenResponseSchema, sdmCommandResponseSchema, sdmDeviceSchema, sdmDevicesResponseSchema, sdmErrorSchema,
  sdmExtendStreamSchema, sdmRtspStreamSchema, type SdmDevice, type SdmRtspStream,
} from './types'

// Client de l'API Google Smart Device Management. Tout passe par le cloud Google (les appareils
// Nest n'ont pas d'API locale) et par OAuth : un jeton de rafraîchissement, obtenu une fois à la
// liaison du compte, donne des jetons d'accès d'une heure renouvelés ici à la demande. Le jeton de
// rafraîchissement est le seul secret durable ; il ne sort jamais de cette classe sauf par
// `exchangeCode`, qui le rend à l'utilisateur pour qu'il le colle dans `.env`.

export const SDM_BASE_URL = 'https://smartdevicemanagement.googleapis.com/v1'
export const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
/** Google répond en général sous la seconde ; au-delà de ce délai on abandonne (cf. TaHoma). */
export const REQUEST_TIMEOUT_MS = 15_000
/** On renouvelle le jeton d'accès un peu avant son expiration réelle. */
const EXPIRY_MARGIN_MS = 60_000

export interface NestClientOptions {
  projectId: string
  clientId: string
  clientSecret: string
  redirectUri: string
  refreshToken?: string
  clock: Clock
  fetchImpl?: FetchLike
  logger?: Logger
  /** Abrégé dans les tests ; en production c'est `REQUEST_TIMEOUT_MS`. */
  requestTimeoutMs?: number
}

export class NestClient {
  readonly fetchImpl: FetchLike
  private refreshToken: string | undefined
  private accessToken: string | undefined
  private accessTokenExpiresAt = 0

  constructor(private readonly opts: NestClientOptions) {
    this.refreshToken = opts.refreshToken
    this.fetchImpl = opts.fetchImpl
      ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
  }

  /** Un compte Google est lié (jeton de rafraîchissement connu). */
  get linked(): boolean { return this.refreshToken !== undefined }

  authorizationUrl(state: string): string {
    return authorizationUrl({ projectId: this.opts.projectId, clientId: this.opts.clientId, redirectUri: this.opts.redirectUri, state })
  }

  private deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private async send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Awaited<ReturnType<FetchLike>>> {
    try {
      return await this.fetchImpl(url, { ...init, signal: this.deadline(signal) })
    } catch (err) {
      if ((err as Error).name === 'TimeoutError' && signal?.aborted !== true) {
        throw new PluginError('TIMEOUT', `Google did not answer within ${this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS} ms`, { cause: err })
      }
      throw new PluginError('UPSTREAM_ERROR', `Google unreachable (${(err as Error).message})`, { cause: err })
    }
  }

  /**
   * Échange le code d'autorisation reçu sur la redirection contre un jeton de rafraîchissement,
   * adopté immédiatement. Le rend aussi à l'appelant : le serveur n'écrit pas `.env`.
   */
  async exchangeCode(code: string, signal?: AbortSignal): Promise<{ refreshToken: string }> {
    const token = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.opts.redirectUri }, signal)
    if (!token.refresh_token) {
      throw new PluginError('UPSTREAM_ERROR', 'Google returned no refresh token (the consent screen must be shown with access_type=offline)')
    }
    this.refreshToken = token.refresh_token
    return { refreshToken: token.refresh_token }
  }

  private async tokenRequest(params: Record<string, string>, signal?: AbortSignal) {
    const body = new URLSearchParams({ client_id: this.opts.clientId, client_secret: this.opts.clientSecret, ...params })
    const res = await this.send(OAUTH_TOKEN_URL, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString(),
    }, signal)
    const json = await res.json().catch(() => undefined)
    if (!res.ok) {
      const e = oauthErrorSchema.safeParse(json)
      const code = e.success ? e.data.error : undefined
      const detail = e.success && e.data.error_description ? ` (${e.data.error_description})` : ''
      // `invalid_grant` : code déjà consommé, ou jeton de rafraîchissement révoqué / expiré →
      // il faut refaire la liaison. Le reste (client_id / secret faux) est une erreur de config.
      if (code === 'invalid_grant') throw new PluginError('NEEDS_PAIRING', `Google refused the grant${detail}: link the account again`)
      throw new PluginError('UPSTREAM_ERROR', `Google OAuth HTTP ${res.status}${code ? ` ${code}` : ''}${detail}`)
    }
    const parsed = oauthTokenResponseSchema.safeParse(json)
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'unexpected token response from Google')
    this.accessToken = parsed.data.access_token
    this.accessTokenExpiresAt = this.opts.clock.now() + (parsed.data.expires_in ?? 3600) * 1000
    return parsed.data
  }

  /** Jeton d'accès valide, renouvelé si besoin. */
  private async accessTokenFor(signal?: AbortSignal): Promise<string> {
    if (!this.refreshToken) throw new PluginError('NEEDS_PAIRING', 'no Google account linked (NEST_REFRESH_TOKEN)')
    if (this.accessToken && this.opts.clock.now() < this.accessTokenExpiresAt - EXPIRY_MARGIN_MS) return this.accessToken
    await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.refreshToken }, signal)
    return this.accessToken!
  }

  /**
   * Requête SDM authentifiée. Les statuts de Google sont traduits en erreurs de plugin : 400 vient
   * d'une commande que l'appareil refuse dans son état (`FAILED_PRECONDITION` : consigne en éco…),
   * 404 d'un appareil qui n'est plus partagé, 403 d'un projet mal configuré — son message est
   * remonté tel quel, il dit exactement ce qui manque.
   */
  private async request(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const token = await this.accessTokenFor(signal)
    const res = await this.send(`${SDM_BASE_URL}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }, signal)
    const json = await res.json().catch(() => undefined)
    if (res.ok) return json
    const e = sdmErrorSchema.safeParse(json)
    const message = e.success ? e.data.error?.message : undefined
    const suffix = message ? ` (${message})` : ''
    if (res.status === 401) {
      this.accessToken = undefined                     // on retentera avec un jeton neuf au prochain appel
      throw new PluginError('NEEDS_PAIRING', `Google rejected the access token${suffix}`)
    }
    if (res.status === 400) throw new PluginError('UNSUPPORTED_COMMAND', `Google refused the command${suffix}`)
    if (res.status === 404) throw new PluginError('DEVICE_UNAVAILABLE', `device unknown to Google${suffix}`)
    if (res.status === 429) throw new PluginError('RATE_LIMITED', `Google SDM rate limit${suffix}`)
    throw new PluginError('UPSTREAM_ERROR', `Google SDM HTTP ${res.status}${suffix}`)
  }

  private devicesPath(): string { return `/enterprises/${encodeURIComponent(this.opts.projectId)}/devices` }

  /**
   * Tous les appareils partagés avec le projet. Validés un par un : un appareil d'une forme
   * inattendue ne prive pas la maison des autres. `raw` est la réponse telle que reçue, pour
   * relever une fixture réelle (`GET /api/plugins/nest/devices/raw`).
   */
  async listDevices(signal?: AbortSignal): Promise<{ raw: unknown; devices: SdmDevice[] }> {
    const raw = await this.request('GET', this.devicesPath(), undefined, signal)
    const envelope = sdmDevicesResponseSchema.safeParse(raw)
    if (!envelope.success) throw new PluginError('UPSTREAM_ERROR', 'unexpected device list from Google')
    const devices: SdmDevice[] = []
    for (const item of envelope.data.devices) {
      const r = sdmDeviceSchema.safeParse(item)
      if (r.success) devices.push(r.data)
      else this.opts.logger?.debug({ issues: r.error.issues }, 'Nest device skipped')
    }
    return { raw, devices }
  }

  /** Un appareil, relu après une commande pour publier l'état que Google a réellement retenu. */
  async getDevice(externalId: string, signal?: AbortSignal): Promise<SdmDevice> {
    const raw = await this.request('GET', `${this.devicesPath()}/${encodeURIComponent(externalId)}`, undefined, signal)
    const r = sdmDeviceSchema.safeParse(raw)
    if (!r.success) throw new PluginError('UPSTREAM_ERROR', 'unexpected device from Google')
    return r.data
  }

  /** `POST …/devices/<id>:executeCommand`. Résout à l'accusé de Google (200) avec ses `results`, s'il y en a. */
  async executeCommand(externalId: string, command: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const raw = await this.request('POST', `${this.devicesPath()}/${encodeURIComponent(externalId)}:executeCommand`, { command, params }, signal)
    const r = sdmCommandResponseSchema.safeParse(raw)
    return r.success ? r.data.results : undefined
  }

  // ---- flux RTSP (caméras de 1re génération) -----------------------------------------------
  // Google ouvre une session RTSP à la demande : l'URL vaut cinq minutes, et c'est le jeton de
  // prolongation qui la maintient — l'appelant doit prolonger AVANT l'échéance, puis arrêter la
  // session quand plus personne ne regarde (sinon elle court jusqu'à son expiration).

  async generateRtspStream(externalId: string, signal?: AbortSignal): Promise<SdmRtspStream> {
    const results = await this.executeCommand(externalId, 'sdm.devices.commands.CameraLiveStream.GenerateRtspStream', {}, signal)
    const r = sdmRtspStreamSchema.safeParse(results)
    if (!r.success) {
      this.opts.logger?.warn({ results }, 'unexpected GenerateRtspStream results')
      throw new PluginError('UPSTREAM_ERROR', 'unexpected RTSP stream response from Google')
    }
    return r.data
  }

  async extendRtspStream(externalId: string, streamExtensionToken: string, signal?: AbortSignal): Promise<{ streamExtensionToken: string; expiresAt?: string }> {
    const results = await this.executeCommand(externalId, 'sdm.devices.commands.CameraLiveStream.ExtendRtspStream', { streamExtensionToken }, signal)
    const r = sdmExtendStreamSchema.safeParse(results)
    if (!r.success) throw new PluginError('UPSTREAM_ERROR', 'unexpected ExtendRtspStream response from Google')
    return { streamExtensionToken: r.data.streamExtensionToken, ...(r.data.expiresAt ? { expiresAt: r.data.expiresAt } : {}) }
  }

  async stopRtspStream(externalId: string, streamExtensionToken: string, signal?: AbortSignal): Promise<void> {
    await this.executeCommand(externalId, 'sdm.devices.commands.CameraLiveStream.StopRtspStream', { streamExtensionToken }, signal)
  }
}
