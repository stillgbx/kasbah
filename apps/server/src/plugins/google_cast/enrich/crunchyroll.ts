import type { Logger } from 'pino'
import { z } from 'zod'
import type { Clock } from '../../../core/clock'

// Enrichissement Crunchyroll — NON OFFICIEL. L'appli Crunchyroll d'un Chromecast n'envoie au récepteur
// que le titre de l'épisode (métadonnées génériques). Son identifiant de contenu (`GE…`) suffit pourtant
// à retrouver, par l'API interne que le site utilise pour un visiteur NON connecté, la série, la saison,
// le numéro et les vignettes. Essai du 2026-09-10 (voir le wiki, 3_6_google-cast) :
//  - jeton anonyme : `POST /auth/v1/token`, `grant_type=client_id`, client web public (pas de secret),
//    valable une heure, portée `content` ;
//  - `GET /content/v2/cms/objects/<id>` : `episode_metadata` (série, saison, épisode) + `images.thumbnail` ;
//  - `GET /content/v2/cms/series/<series_id>` : `images.poster_tall` (affiche portrait, 9 tailles) — c'est elle
//    qu'on met en pochette (choix de l'utilisateur), une par série et non une capture par épisode ;
//  - l'hôte `www.crunchyroll.com` répond 403 Cloudflare à Node (empreinte TLS), l'hôte des applis,
//    `beta-api.crunchyroll.com`, accepte.
// Aucun compte n'est nécessaire. Tout échec est avalé (journal en debug) et mémorisé un moment : l'UI
// garde alors ce que l'appareil a donné. Peut casser quand Crunchyroll change son API.

const HOST = 'https://beta-api.crunchyroll.com'
/** Identifiant du client web public de crunchyroll.com (celui que le site envoie à tout visiteur) ; pas de secret. */
const WEB_CLIENT_BASIC = Buffer.from('noaihdevm_6iyg0a8l0q:').toString('base64')
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

const TOKEN_MARGIN_MS = 60_000
const HIT_TTL_MS = 24 * 3_600_000
const MISS_TTL_MS = 10 * 60_000
const CACHE_MAX = 128
const REQUEST_TIMEOUT_MS = 8000
/** Largeur de vignette visée pour la pochette de repli : la première au moins aussi large, sinon la plus grande. */
const THUMB_MIN_WIDTH = 640
/** Largeur d'affiche portrait visée (480 × 720 : nette dans un panneau de 380 px, légère). */
const POSTER_MIN_WIDTH = 480

const tokenSchema = z.looseObject({ access_token: z.string().min(1), expires_in: z.number().optional() })
const imageSchema = z.looseObject({ width: z.number().nullish(), height: z.number().nullish(), source: z.string().nullish() })
const objectSchema = z.looseObject({
  data: z.array(z.looseObject({
    type: z.string().nullish(),
    title: z.string().nullish(),
    episode_metadata: z.looseObject({
      series_title: z.string().nullish(),
      season_title: z.string().nullish(),
      season_number: z.number().nullish(),
      episode_number: z.number().nullish(),
      series_id: z.string().nullish(),
    }).nullish(),
    images: z.looseObject({ thumbnail: z.array(z.array(imageSchema)).nullish() }).nullish(),
  })),
})
const seriesSchema = z.looseObject({
  data: z.array(z.looseObject({
    title: z.string().nullish(),
    images: z.looseObject({ poster_tall: z.array(z.array(imageSchema)).nullish() }).nullish(),
  })),
})

export interface Enrichment {
  /** Titre de l'épisode : l'appareil l'omet parfois complètement (constaté en réel). */
  title?: string
  series?: string
  seasonNumber?: number
  episodeNumber?: number
  /** Pochette : affiche portrait de la série, sinon vignette de l'épisode (URL Crunchyroll, à relayer). */
  artwork?: string
}

/** Le strict nécessaire de `fetch` (le `fetch` global convient). */
export type EnrichFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

interface Cached { value: Enrichment | null; at: number }

export interface CrunchyrollEnricherOptions {
  fetchImpl?: EnrichFetch
  clock: Clock
  logger: Logger
  signal: AbortSignal
}

/** Reconnaît l'appli Crunchyroll d'un récepteur Cast (appli native : `AndroidNativeApp` + nom du paquet). */
export function isCrunchyrollApp(app: { displayName?: string | null; statusText?: string | null }): boolean {
  return /crunchyroll/i.test(app.displayName ?? '') || /crunchyroll/i.test(app.statusText ?? '')
}

export class CrunchyrollEnricher {
  private token: { value: string; until: number } | null = null
  private readonly cache = new Map<string, Cached>()
  /** Affiche portrait par série : une seule requête par série, même durée de vie que les épisodes. */
  private readonly posters = new Map<string, { url: string | null; at: number }>()
  private readonly pending = new Map<string, Promise<Enrichment | null>>()
  private readonly fetchImpl: EnrichFetch

  constructor(private readonly opts: CrunchyrollEnricherOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  }

  /** Résultat déjà connu (succès ou échec récent), sans requête ; `undefined` si jamais demandé ou périmé. */
  cached(contentId: string): Enrichment | null | undefined {
    const hit = this.cache.get(contentId)
    if (!hit) return undefined
    const ttl = hit.value ? HIT_TTL_MS : MISS_TTL_MS
    return this.opts.clock.now() - hit.at < ttl ? hit.value : undefined
  }

  /** Enrichissement d'un contenu ; une seule requête en vol par identifiant, `null` si Crunchyroll ne sait pas ou ne répond pas. */
  lookup(contentId: string): Promise<Enrichment | null> {
    const known = this.cached(contentId)
    if (known !== undefined) return Promise.resolve(known)
    const inflight = this.pending.get(contentId)
    if (inflight) return inflight
    const p = this.fetchEnrichment(contentId)
      .catch((err) => { this.opts.logger.debug({ contentId, err }, 'crunchyroll enrichment failed'); return null })
      .then((value) => { this.remember(contentId, value); return value })
      .finally(() => this.pending.delete(contentId))
    this.pending.set(contentId, p)
    return p
  }

  private remember(contentId: string, value: Enrichment | null): void {
    this.cache.delete(contentId)
    this.cache.set(contentId, { value, at: this.opts.clock.now() })
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!)
  }

  private signal(): AbortSignal { return AbortSignal.any([this.opts.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) }

  private async accessToken(): Promise<string> {
    const now = this.opts.clock.now()
    if (this.token && now < this.token.until) return this.token.value
    const res = await this.fetchImpl(`${HOST}/auth/v1/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${WEB_CLIENT_BASIC}`, 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT, accept: 'application/json' },
      body: 'grant_type=client_id',
      signal: this.signal(),
    })
    if (!res.ok) throw new Error(`token HTTP ${res.status}`)
    const tok = tokenSchema.parse(await res.json())
    this.token = { value: tok.access_token, until: now + Math.max(0, (tok.expires_in ?? 3600) * 1000 - TOKEN_MARGIN_MS) }
    return tok.access_token
  }

  private async fetchEnrichment(contentId: string): Promise<Enrichment | null> {
    const token = await this.accessToken()
    const res = await this.fetchImpl(`${HOST}/content/v2/cms/objects/${encodeURIComponent(contentId)}?locale=fr-FR`, {
      headers: { authorization: `Bearer ${token}`, 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: this.signal(),
    })
    if (res.status === 401) { this.token = null; throw new Error('token rejected') }
    if (!res.ok) throw new Error(`object HTTP ${res.status}`)
    const parsed = objectSchema.safeParse(await res.json())
    if (!parsed.success) throw new Error('unexpected object shape')
    const d = parsed.data.data[0]
    if (!d || d.type !== 'episode') return null
    const ep = d.episode_metadata ?? {}
    const thumbs = (d.images?.thumbnail?.[0] ?? []).filter((i) => i.source && i.width)
    const thumb = thumbs.find((i) => (i.width ?? 0) >= THUMB_MIN_WIDTH) ?? thumbs.at(-1)
    const poster = ep.series_id ? await this.seriesPoster(ep.series_id, token) : null
    const artwork = poster ?? thumb?.source ?? undefined
    const out: Enrichment = {
      ...(d.title?.trim() ? { title: d.title.trim() } : {}),
      ...(ep.series_title?.trim() ? { series: ep.series_title.trim() } : {}),
      ...(typeof ep.season_number === 'number' ? { seasonNumber: ep.season_number } : {}),
      ...(typeof ep.episode_number === 'number' ? { episodeNumber: ep.episode_number } : {}),
      ...(artwork ? { artwork } : {}),
    }
    return Object.keys(out).length ? out : null
  }

  /** Affiche portrait de la série (≥ 480 px de large, sinon la plus grande) ; `null` si la fiche n'en a pas ou ne répond pas. */
  private async seriesPoster(seriesId: string, token: string): Promise<string | null> {
    const hit = this.posters.get(seriesId)
    if (hit && this.opts.clock.now() - hit.at < (hit.url ? HIT_TTL_MS : MISS_TTL_MS)) return hit.url
    let url: string | null = null
    try {
      const res = await this.fetchImpl(`${HOST}/content/v2/cms/series/${encodeURIComponent(seriesId)}?locale=fr-FR`, {
        headers: { authorization: `Bearer ${token}`, 'user-agent': USER_AGENT, accept: 'application/json' },
        signal: this.signal(),
      })
      if (res.ok) {
        const parsed = seriesSchema.safeParse(await res.json())
        const posters = (parsed.success ? parsed.data.data[0]?.images?.poster_tall?.[0] ?? [] : []).filter((i) => i.source && i.width)
        url = (posters.find((i) => (i.width ?? 0) >= POSTER_MIN_WIDTH) ?? posters.at(-1))?.source ?? null
      }
    } catch (err) {
      this.opts.logger.debug({ seriesId, err }, 'crunchyroll series poster failed')
    }
    this.posters.set(seriesId, { url, at: this.opts.clock.now() })
    return url
  }
}
