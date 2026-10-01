import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { loginSchema, petkitEnvelopeSchema, regionServersSchema } from './types'
import { writeFileAtomic } from '../../core/atomic-file'

// Authentification PetKit — le cloud privé de l'application mobile, seule voie d'accès : les
// appareils ne parlent à rien d'autre, et les fontaines n'ont même pas de Wi-Fi.
//
// CE QUI DISTINGUE CE PLUGIN DE MELCLOUD ET DE RENAULT : il n'y a pas de mot de passe. Le compte de
// l'utilisateur se connecte par CODE — on demande à PetKit d'envoyer un code à six chiffres par
// courriel, valable dix minutes, et c'est lui qu'on échange contre une session. Bonne nouvelle pour
// la sécurité (aucun mot de passe ne traverse jamais le serveur) et contrainte forte pour
// l'exploitation, qui commande tout le reste de ce fichier :
//
//   **une session perdue ne se reprend pas toute seule.** Il faut un humain, sa boîte aux lettres
//   et dix minutes. Donc on prolonge la session BIEN AVANT son échéance (`REFRESH_AT_RATIO`), et
//   quand elle est malgré tout perdue on le dit franchement (`needs_pairing`) au lieu de marteler.
//
// Deux pièges relevés chez les bibliothèques tierces, traités ici :
//
//  1. **Une nouvelle connexion invalide la précédente.** Le serveur et le téléphone de
//     l'utilisateur se déconnecteraient mutuellement en boucle sur un même compte. D'où la consigne
//     d'appairage : un compte PetKit DÉDIÉ, à qui l'on partage les appareils.
//  2. **Deux connexions concurrentes condamnent la session pour la durée de son bail** (~36 h) :
//     les deux voient le jeton périmé, les deux se reconnectent, l'un des deux jetons est mort-né
//     et toutes les requêtes échouent ensuite en silence. D'où le verrou d'une seule connexion en
//     vol à la fois (`inFlight`) — ce n'est pas une optimisation, c'est la correction d'un bug
//     connu et coûteux.

/** Là où l'on demande la liste des passerelles régionales ; elle n'est pas régionale elle-même. */
export const DEFAULT_PASSPORT_URL = 'https://passport.petkt.com/'
/** Repli si la découverte échoue : la passerelle européenne, celle de cette maison. */
export const DEFAULT_GATEWAY = 'https://api.eu-pet.com/latest/'
const REQUEST_TIMEOUT_MS = 20_000

/**
 * On renouvelle la session à la moitié de son bail. Un tiers serait plus prudent, la moitié suffit :
 * même un serveur arrêté une nuit se réveille avec une session encore valide sur un bail de 36 h,
 * et c'est exactement le cas qu'il faut éviter — celui où il faut réveiller l'utilisateur pour un
 * code.
 */
export const REFRESH_AT_RATIO = 0.5

/** Ce que PetKit annonce comme client. En configuration : le fabricant peut se mettre à le vérifier. */
export const DEFAULT_APP_VERSION = '13.2.1'

// Le téléphone que l'on prétend être. PetKit vérifie la COHÉRENCE de ces trois-là entre l'en-tête
// `X-Client` et le champ `client` de la connexion ; ils sont donc posés à un seul endroit.
const ANDROID_OS_VERSION = '16.1'
const ANDROID_MODEL = '23127PN0CG'
const USER_AGENT = 'okhttp/3.14.9'

export interface StoredSession {
  /** Jeton de session, posé en `X-Session` ET `F-Session` sur chaque appel. */
  id: string
  /** Passerelle régionale retenue à la connexion : la session n'est valable que sur celle-là. */
  gateway: string
  /** Millisecondes epoch : émission et échéance, pour décider du renouvellement. */
  createdAt: number
  expiresAt: number
  /** Adresse du compte, seulement pour l'afficher dans les Réglages. */
  account: string | null
}

const storedSessionSchema = z.object({
  id: z.string().min(1),
  gateway: z.string().min(1),
  createdAt: z.number(),
  expiresAt: z.number(),
  account: z.string().nullable().default(null),
})

export interface SessionStore {
  load(): Promise<StoredSession | null>
  save(session: StoredSession): Promise<void>
  clear(): Promise<void>
}

/** Fichier JSON atomique en 0600 (même forme que MELCloud) : illisible = pas de session, jamais une erreur fatale. */
export function createSessionFile(path: string, logger?: Logger): SessionStore {
  return {
    async load(): Promise<StoredSession | null> {
      let raw: string
      try { raw = await readFile(path, 'utf8') } catch { return null }
      const parsed = storedSessionSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger?.warn({ path }, 'unreadable PetKit session cache, ignoring it'); return null }
      return parsed.data
    },
    async save(session: StoredSession): Promise<void> {
      try { await writeFileAtomic(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, 'could not write PetKit session cache') }
    },
    async clear(): Promise<void> {
      try { await writeFileAtomic(path, '{}\n', { mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, 'could not clear PetKit session cache') }
    },
  }
}

export interface PetkitAuthOptions {
  passportUrl: string
  /** Passerelle forcée par la configuration ; sinon découverte depuis la région. */
  gateway: string | null
  region: string
  timezone: string
  appVersion: string
  fetchImpl: FetchLike
  store: SessionStore | null
  logger?: Logger
  now?: () => number
  requestTimeoutMs?: number
}

/** Ce que l'API renvoie quand la session n'est plus acceptée — vu en HTTP 200, dans le corps. */
const SESSION_ERROR_CODES = new Set([5, '5'])

export class PetkitAuth {
  private session: StoredSession | null = null
  /** Une seule connexion en vol : voir le piège n°2 en tête de fichier. */
  private inFlight: Promise<StoredSession> | null = null
  /** Passerelle et région résolues une fois pour toutes (la liste des serveurs ne bouge pas). */
  private resolved: { gateway: string; region: string } | null = null

  constructor(private readonly opts: PetkitAuthOptions) {}

  get linked(): boolean { return this.session !== null }
  get sessionId(): string | null { return this.session?.id ?? null }
  get account(): string | null { return this.session?.account ?? null }
  get gateway(): string { return this.session?.gateway ?? this.opts.gateway ?? DEFAULT_GATEWAY }
  get expiresAt(): number | null { return this.session?.expiresAt ?? null }

  private now(): number { return this.opts.now?.() ?? Date.now() }

  /** Au démarrage : reprend la session du cache, si elle n'est pas déjà périmée. */
  async restore(): Promise<boolean> {
    const cached = (await this.opts.store?.load()) ?? null
    this.session = cached && cached.expiresAt > this.now() ? cached : null
    if (cached && !this.session) this.opts.logger?.info('cached PetKit session expired, pairing needed')
    return this.linked
  }

  /**
   * Passerelle ET région retenues. Deux choses à ne pas confondre, et c'est ce qui a coûté un
   * premier 502 : la RÉGION de configuration (« FR ») sert à trouver le serveur, mais ce que
   * PetKit attend ensuite dans `region` est l'IDENTIFIANT de ce serveur, en minuscules.
   *
   * `v1/regionservers` est un **GET** — l'appeler en POST échouait, et l'échec étant rattrapé, on
   * retombait en silence sur la passerelle européenne sans jamais résoudre la région.
   *
   * Échec de découverte = repli plutôt que blocage : une liste de serveurs indisponible ne veut
   * pas dire que le compte est inutilisable.
   */
  async resolveEndpoint(signal?: AbortSignal): Promise<{ gateway: string; region: string }> {
    const wanted = this.opts.region.toLowerCase()
    if (this.opts.gateway) return { gateway: this.opts.gateway, region: wanted }
    if (this.resolved) return this.resolved
    try {
      const body = await this.get(`${this.opts.passportUrl.replace(/\/$/, '')}/v1/regionservers`, {}, {}, signal)
      const parsed = regionServersSchema.safeParse(body)
      const hit = parsed.success
        ? parsed.data.list?.find((srv) => [srv.id, srv.name].some((v) => String(v ?? '').toLowerCase() === wanted))
        : undefined
      this.resolved = hit
        ? { gateway: hit.gateway, region: String(hit.id ?? wanted).toLowerCase() }
        : { gateway: DEFAULT_GATEWAY, region: wanted }
    } catch (err) {
      this.opts.logger?.warn({ err }, 'PetKit region server lookup failed, falling back to the European gateway')
      this.resolved = { gateway: DEFAULT_GATEWAY, region: wanted }
    }
    return this.resolved
  }

  /**
   * Étape 1 de l'appairage : demander à PetKit d'envoyer un code à l'adresse du compte. Le code
   * vaut dix minutes — c'est le fabricant qui le dit, pas nous, et rien ici ne le prolonge.
   *
   * **C'est un GET, avec l'adresse en paramètre d'URL**, et non un POST de formulaire comme le
   * reste de l'API. Envoyé en POST, PetKit refuse — le 502 du premier essai.
   */
  async requestCode(email: string, signal?: AbortSignal): Promise<void> {
    const { gateway } = await this.resolveEndpoint(signal)
    await this.get(`${gateway.replace(/\/$/, '')}/user/sendcodeforquicklogin`, { username: email }, {}, signal)
  }

  /**
   * Étape 2 : échanger le code contre une session. Aucun mot de passe n'entre ici, le compte n'en
   * utilise pas.
   */
  async loginWithCode(email: string, code: string, signal?: AbortSignal): Promise<StoredSession> {
    const { gateway, region } = await this.resolveEndpoint(signal)
    const body = await this.post(`${gateway.replace(/\/$/, '')}/user/login`, {
      username: email, validCode: code.trim(), encrypt: '1', region, oldVersion: this.opts.appVersion,
      // Descriptif du client, en UN champ sérialisé — c'est la forme que l'application mobile
      // envoie. En JSON plutôt qu'en pseudo-dictionnaire Python comme le fait la bibliothèque de
      // référence : un analyseur tolérant accepte les deux, un analyseur strict n'accepte que JSON.
      client: JSON.stringify(this.clientFields()),
    }, {}, signal)
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'PetKit login: unexpected response shape')
    const created = this.now()
    // Bail par défaut prudent (12 h) si PetKit ne le dit pas : mieux vaut renouveler pour rien que
    // découvrir une session morte au moment de servir un repas.
    const lifetimeS = parsed.data.session.expiresIn ?? 12 * 3600
    const session: StoredSession = {
      id: parsed.data.session.id,
      gateway,
      createdAt: created,
      expiresAt: created + lifetimeS * 1000,
      account: email,
    }
    this.session = session
    await this.opts.store?.save(session)
    return session
  }

  /**
   * Prolonge la session si elle a passé la moitié de son bail. Ne se connecte JAMAIS toute seule :
   * sans mot de passe, une reconnexion exigerait un code que seul l'utilisateur peut lire.
   */
  async ensureFresh(signal?: AbortSignal): Promise<void> {
    const s = this.session
    if (!s) throw new PluginError('NEEDS_PAIRING', 'PetKit account not linked')
    if (this.now() < s.createdAt + (s.expiresAt - s.createdAt) * REFRESH_AT_RATIO) return
    if (this.inFlight) { await this.inFlight; return }
    this.inFlight = this.refresh(s, signal).finally(() => { this.inFlight = null })
    await this.inFlight
  }

  private async refresh(s: StoredSession, signal?: AbortSignal): Promise<StoredSession> {
    let body: unknown
    try {
      body = await this.post(`${s.gateway.replace(/\/$/, '')}/user/refreshsession`, this.clientFields(), this.headers(s.id), signal)
    } catch (err) {
      // Un renouvellement raté n'est pas forcément une session morte (le réseau existe) : on garde
      // la session, l'appel suivant retentera. C'est `invalidate()` qui tranche, sur un refus net.
      this.opts.logger?.warn({ err }, 'PetKit session refresh failed, keeping the current session')
      return s
    }
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) return s
    const created = this.now()
    const lifetimeS = parsed.data.session.expiresIn ?? (s.expiresAt - s.createdAt) / 1000
    const next: StoredSession = { ...s, id: parsed.data.session.id, createdAt: created, expiresAt: created + lifetimeS * 1000 }
    this.session = next
    await this.opts.store?.save(next)
    return next
  }

  /**
   * La session est refusée : on la JETTE. Sans mot de passe il n'y a rien à retenter, et garder une
   * session morte ferait échouer chaque appel en silence — le bug exact qu'on cherche à éviter.
   */
  async invalidate(): Promise<void> {
    this.session = null
    this.inFlight = null
    await this.opts.store?.clear()
  }

  async unlink(): Promise<void> { await this.invalidate() }

  /** En-têtes de session : PetKit veut le MÊME jeton sous deux noms. */
  headers(id = this.sessionId): Record<string, string> {
    if (!id) throw new PluginError('NEEDS_PAIRING', 'PetKit account not linked')
    return { 'X-Session': id, 'F-Session': id }
  }

  /** Vrai si ce corps de réponse dit « session morte » (l'API répond 200 et met l'échec dedans). */
  static isSessionError(body: unknown): boolean {
    const parsed = petkitEnvelopeSchema.safeParse(body)
    const code = parsed.success ? parsed.data.error?.code : undefined
    return code !== undefined && SESSION_ERROR_CODES.has(code as number | string)
  }

  /**
   * Descriptif du client, tel que l'application mobile le sérialise dans le champ `client` de la
   * connexion. Les clés et leur ORTHOGRAPHE viennent des deux implémentations tierces qui
   * fonctionnent en production ; `token` y est vide et `timezone` est un décalage en HEURES, pas
   * un fuseau nommé (`timezoneId` porte celui-ci).
   */
  private clientFields(): Record<string, string> {
    return {
      locale: 'fr-FR',
      source: 'app.petkit-android',
      platform: 'android',
      osVersion: ANDROID_OS_VERSION,
      timezone: tzOffsetHours(this.opts.timezone),
      timezoneId: this.opts.timezone,
      version: this.opts.appVersion,
      token: '',
      name: ANDROID_MODEL,
    }
  }

  /**
   * En-têtes envoyés sur CHAQUE requête, authentifiée ou non. Ce n'est pas du décor : sans eux,
   * PetKit répond « Request is incorrect. (code 3) » — le refus obtenu au premier appairage réel,
   * le 21/09, avec des en-têtes réduits au strict minimum. Le jeu ci-dessous est celui de deux
   * implémentations tierces en production.
   */
  baseHeaders(): Record<string, string> {
    return {
      'Accept': '*/*',
      'Accept-Language': 'fr-FR;q=1, en-US;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
      'X-Api-Version': this.opts.appVersion,
      'X-Client': `android(${ANDROID_OS_VERSION};${ANDROID_MODEL})`,
      'X-Locale': 'fr-FR',
      'X-Hour': '24',
      'X-TimezoneId': this.opts.timezone,
      'X-Timezone': tzOffsetHours(this.opts.timezone),
      'User-Agent': USER_AGENT,
    }
  }

  private get(url: string, query: Record<string, string>, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const qs = new URLSearchParams(query).toString()
    return this.send('GET', qs ? `${url}?${qs}` : url, undefined, headers, signal)
  }

  private post(url: string, form: Record<string, string>, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    return this.send('POST', url, new URLSearchParams(form).toString(), headers, signal)
  }

  /**
   * Un aller-retour, et la traduction de ce que PetKit répond. Le message d'erreur porte le
   * CHEMIN, le statut et un extrait du corps : sans eux, un refus arrive dans l'interface sous
   * la forme d'un « 502 » qui ne dit rien et n'oriente vers rien.
   */
  private async send(method: 'GET' | 'POST', url: string, body: string | undefined, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => { ctrl.abort() }, this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    const where = url.split('?')[0]!
    try {
      const res = await this.opts.fetchImpl(url, {
        method,
        headers: {
          ...this.baseHeaders(),
          ...(body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body }),
        signal: signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal,
      })
      const text = await res.text()
      if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `PetKit ${where}: HTTP ${res.status} ${excerpt(text)}`)
      // Une réponse qui n'est pas du JSON (page d'erreur, portail) doit se lire dans le message,
      // pas se perdre dans une exception d'analyse syntaxique.
      let parsedBody: unknown
      try { parsedBody = JSON.parse(text) }
      catch { throw new PluginError('UPSTREAM_ERROR', `PetKit ${where}: non-JSON response ${excerpt(text)}`) }
      const env = petkitEnvelopeSchema.safeParse(parsedBody)
      if (env.success && env.data.error) {
        const msg = String(env.data.error.msg ?? 'refused')
        const code = env.data.error.code === undefined ? '' : ` (code ${String(env.data.error.code)})`
        // Refus de session : c'est l'appairage qui est en cause, pas le réseau.
        throw new PluginError(PetkitAuth.isSessionError(parsedBody) ? 'NEEDS_PAIRING' : 'UPSTREAM_ERROR', `PetKit ${where}: ${msg}${code}`)
      }
      return env.success && env.data.result !== undefined ? env.data.result : parsedBody
    } finally { clearTimeout(timer) }
  }
}

/** Extrait court d'une réponse, pour un message d'erreur lisible sans noyer le journal. */
const excerpt = (text: string): string => (text.length > 200 ? `${text.slice(0, 200)}…` : text).replace(/\s+/g, ' ').trim()

/**
 * Décalage horaire d'un fuseau, en heures et avec une décimale (« 2.0 », « -5.0 ») — la forme que
 * PetKit attend, et qui n'est pas celle d'un fuseau nommé. Calculé maintenant, donc heure d'été
 * comprise. Un fuseau inconnu vaut UTC plutôt que de faire échouer la connexion entière.
 */
function tzOffsetHours(timeZone: string, at = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(at)
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name)
    if (!m) return '0.0'
    const hours = Number(m[2]) + Number(m[3] ?? 0) / 60
    return `${m[1] === '-' ? '-' : ''}${hours.toFixed(1)}`
  } catch { return '0.0' }
}
