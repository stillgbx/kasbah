import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Logger } from 'pino'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { melcloudLoginSchema } from './types'

// Authentification MELCloud — le portail cloud de Mitsubishi Electric.
//
// Comme Renault, et pour la même raison (aucune voie officielle pour un particulier), il n'y a PAS
// d'OAuth : le seul moyen d'entrer est l'identifiant et le mot de passe du compte. La décision
// prise avec l'utilisateur borne le dégât, exactement comme pour Renault :
//
//   le mot de passe traverse le serveur UNE fois (POST /api/plugins/melcloud/login), il n'est
//   jamais écrit sur disque, jamais journalisé, jamais rangé dans une variable d'environnement.
//   Seule survit la `ContextKey` que MELCloud rend en échange — révocable en changeant le mot de
//   passe du compte, et qui ne permet pas de le changer.
//
// Piège central, le même que Gigya : **MELCloud RÉPOND TOUJOURS EN HTTP 200**. Un mot de passe
// faux, une clé périmée — tout arrive en 200 avec un `ErrorId` dans le corps.

export const DEFAULT_BASE_URL = 'https://app.melcloud.com/Mitsubishi.Wifi.Client'
/**
 * Version d'application annoncée à la connexion. MELCloud l'exige ; sa valeur exacte n'a jamais
 * bloqué personne, mais elle est en configuration parce que le fabricant peut se mettre à la
 * vérifier — une valeur neuve se poserait dans `.env` sans toucher au code.
 */
export const DEFAULT_APP_VERSION = '1.34.12.0'
const REQUEST_TIMEOUT_MS = 20_000

/** `ErrorId` que MELCloud rend pour un identifiant ou un mot de passe refusé. */
const MELCLOUD_INVALID_CREDENTIALS = 1

export interface StoredSession {
  /** `LoginData.ContextKey` : la clé de session. Le mot de passe, lui, n'est jamais gardé. */
  contextKey: string
  /** Nom du compte, seulement pour l'afficher dans les Réglages. */
  name: string | null
}

const storedSessionSchema = z.object({
  contextKey: z.string().min(1),
  name: z.string().nullable().default(null),
})

export interface SessionStore {
  load(): Promise<StoredSession | null>
  save(session: StoredSession): Promise<void>
  clear(): Promise<void>
}

/**
 * Fichier JSON atomique (`.tmp` puis `rename`), en 0600. Fichier absent ou illisible = pas de
 * session, jamais une erreur fatale : le plugin doit démarrer même si le disque refuse.
 */
export function createSessionFile(path: string, logger?: Logger): SessionStore {
  return {
    async load(): Promise<StoredSession | null> {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return null }
      const parsed = storedSessionSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger?.warn({ path }, 'unreadable MELCloud session cache, ignoring it'); return null }
      return parsed.data
    },
    async save(session: StoredSession): Promise<void> {
      const tmp = `${path}.${process.pid}.tmp`
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(tmp, `${JSON.stringify(session, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        await rename(tmp, path)
      } catch (err) {
        logger?.warn({ err, path }, 'could not write MELCloud session cache')
      }
    },
    async clear(): Promise<void> {
      try { await writeFile(path, '{}\n', { encoding: 'utf8', mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, 'could not clear MELCloud session cache') }
    },
  }
}

export interface MelcloudAuthOptions {
  baseUrl: string
  appVersion: string
  fetchImpl: FetchLike
  store: SessionStore | null
  logger?: Logger
  requestTimeoutMs?: number
}

/**
 * Session MELCloud : connexion par mot de passe (une fois), puis une `ContextKey` durable.
 *
 * Plus simple que Renault : il n'y a qu'UN jeton, pas deux. Rien à renouveler tant que MELCloud ne
 * le refuse pas — et quand il le refuse, il n'y a rien à rafraîchir, il faut le mot de passe. D'où
 * `invalidate()` : la clé est jetée pour que `health()` dise `needs_pairing` tout de suite, au lieu
 * de laisser le plugin réessayer indéfiniment une clé morte.
 */
export class MelcloudAuth {
  private session: StoredSession | null = null

  constructor(private readonly opts: MelcloudAuthOptions) {}

  get linked(): boolean { return this.session !== null }
  get contextKey(): string | null { return this.session?.contextKey ?? null }
  get accountName(): string | null { return this.session?.name ?? null }

  /** Au démarrage : reprend la session du cache s'il y en a une. */
  async restore(): Promise<boolean> {
    this.session = (await this.opts.store?.load()) ?? null
    return this.linked
  }

  /**
   * Relie le compte. Le mot de passe ne sert QUE dans cet appel : il n'est ni gardé en mémoire
   * au-delà, ni écrit, ni journalisé. Ce qui survit est la `ContextKey`.
   */
  async login(email: string, password: string, signal?: AbortSignal): Promise<StoredSession> {
    const body = {
      Email: email,
      Password: password,
      Language: 0,
      AppVersion: this.opts.appVersion,
      // la clé est durable : c'est ce qui évite de redemander le mot de passe à chaque démarrage
      Persist: true,
      CaptchaResponse: null,
    }
    const res = await this.post('Login/ClientLogin', body, signal)
    const parsed = melcloudLoginSchema.safeParse(res)
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'unexpected response from MELCloud sign-in')

    const errorId = parsed.data.ErrorId
    if (typeof errorId === 'number' && errorId !== 0) {
      if (errorId === MELCLOUD_INVALID_CREDENTIALS) {
        throw new PluginError('NEEDS_PAIRING', 'MELCloud refused the e-mail or password')
      }
      throw new PluginError('UPSTREAM_ERROR', `MELCloud sign-in refused the account (error ${errorId})`)
    }
    const data = parsed.data.LoginData
    if (!data) throw new PluginError('UPSTREAM_ERROR', 'MELCloud sign-in returned no context key')

    this.session = { contextKey: data.ContextKey, name: typeof data.Name === 'string' ? data.Name : null }
    await this.opts.store?.save(this.session)
    return this.session
  }

  /** Oublie le compte (l'utilisateur délie, ou MELCloud a rejeté la clé). */
  async forget(): Promise<void> {
    this.session = null
    await this.opts.store?.clear()
  }

  /**
   * La clé de session à poser en en-tête. Une clé absente n'est pas une panne : c'est un compte
   * pas encore relié, et l'UI a une carte pour ça.
   */
  key(): string {
    const key = this.session?.contextKey
    if (!key) throw new PluginError('NEEDS_PAIRING', 'no MELCloud account linked: POST /api/plugins/melcloud/login')
    return key
  }

  /**
   * MELCloud a rejeté la clé. Il n'y a rien à rafraîchir — seul le mot de passe peut en refaire
   * une — donc on la jette, et la carte des Réglages redemande la liaison au lieu de laisser le
   * plugin marteler une clé morte.
   */
  async invalidate(): Promise<void> {
    await this.forget()
  }

  /** Un appel JSON non authentifié (la connexion). Le mot de passe n'apparaît dans aucun message. */
  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.opts.fetchImpl(`${this.opts.baseUrl}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (err) {
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      throw new PluginError(aborted ? 'TIMEOUT' : 'UPSTREAM_ERROR', `MELCloud unreachable on ${path}`, { cause: err })
    }
    const text = await res.text()
    // le statut ne dit presque rien (tout arrive en 200), mais un 5xx reste un 5xx
    if (res.status >= 400) throw new PluginError('UPSTREAM_ERROR', `MELCloud returned HTTP ${res.status} on ${path}`)
    const parsed = ((): unknown => { try { return JSON.parse(text) } catch { return null } })()
    if (parsed === null) throw new PluginError('UPSTREAM_ERROR', `MELCloud sent invalid JSON on ${path}`)
    return parsed
  }
}
