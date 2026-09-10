import type { Logger } from 'pino'
import { z } from 'zod'
import type { Clock } from '../../../core/clock'

// Pochette d'un morceau que l'appareil nomme SANS l'illustrer. Relevé sur la TV Android : l'appli
// YouTube publie titre et artiste (« Horizon » / « Northwind et Lumen ») mais aucune image,
// et son `contentId` est vide — la vignette de la vidéo n'est donc pas atteignable localement (le canal
// `youtube.mdx` ne rend qu'un `screenId`, voir le wiki 3_6_google-cast). Il reste le nom du morceau :
// deux catalogues publics le retrouvent SANS clé ni compte, et rendent la pochette de l'album.
//
//  - iTunes Search (`itunes.apple.com/search`) : couverture large, mais il répond TOUJOURS quelque
//    chose — relevé : un set piano de « SLOW RIVERS » lui a fait proposer Tim McGraw. C'est pourquoi la
//    correspondance est VÉRIFIÉE avant d'accepter une image (`matches`) : mieux vaut le logo de
//    l'appli qu'une pochette qui n'est pas celle du morceau.
//  - Deezer (`api.deezer.com/search`) en second recours : plus strict (il ne rend rien sur une vidéo
//    non musicale) et sa pochette monte à 1000 px, mais il ne nomme que l'artiste principal.
//
// Ce n'est pas la vignette de la vidéo mais la pochette de l'ALBUM : pour de la musique c'est ce qu'on
// veut voir ; pour tout le reste, aucune correspondance ne sera trouvée et l'appel n'a pas lieu deux
// fois (les échecs sont mémorisés — le plugin republie l'état toutes les dix secondes pendant une
// lecture). Non officiel au sens où aucune des deux API n'est contractuelle : tout échec est avalé.

const ITUNES = 'https://itunes.apple.com/search'
const DEEZER = 'https://api.deezer.com/search'
/** Une pochette ne change pas ; un échec peut venir d'un réseau qui tousse, on le retente plus tôt. */
const HIT_TTL_MS = 7 * 24 * 3_600_000
const MISS_TTL_MS = 6 * 3_600_000
const CACHE_MAX = 256
const REQUEST_TIMEOUT_MS = 6000
/** Taille demandée à iTunes : ses URL portent le gabarit, `100x100bb` par défaut. */
const ITUNES_SIZE = '600x600bb'

const itunesSchema = z.looseObject({
  results: z.array(z.looseObject({
    trackName: z.string().nullish(),
    artistName: z.string().nullish(),
    artworkUrl100: z.string().nullish(),
  })).nullish(),
})
const deezerSchema = z.looseObject({
  data: z.array(z.looseObject({
    title: z.string().nullish(),
    artist: z.looseObject({ name: z.string().nullish() }).nullish(),
    album: z.looseObject({ cover_big: z.string().nullish(), cover_xl: z.string().nullish() }).nullish(),
  })).nullish(),
})

/** Le strict nécessaire de `fetch` pour interroger un catalogue (réponse JSON). */
export type CoverFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface Track { title: string; artist: string }

/** Sans accents (décomposition NFD, marques combinantes retirées) et en minuscules. */
const strip = (s: string) => [...s.normalize('NFD')].filter((c) => c.codePointAt(0)! < 0x300 || c.codePointAt(0)! > 0x36f).join('').toLowerCase()
/** Titre comparable : sans accents, sans ce qui est entre parenthèses (« (Live) », « [Official Video] »), sans ponctuation. */
export const normTitle = (s: string) => strip(s).replace(/[([][^)\]]*[)\]]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
/**
 * Artiste comparable : en plus, les mots de liaison partent — un même duo s'écrit « A & B » chez
 * iTunes, « A et B » sur un appareil en français (relevé), « A feat. B » ailleurs.
 */
export const normArtist = (s: string) => normTitle(s).replace(/\b(feat|ft|featuring|avec|with|and|et)\b/g, ' ').replace(/\s+/g, ' ').trim()

const tokens = (s: string) => new Set(normArtist(s).split(' ').filter(Boolean))
const subset = (a: Set<string>, b: Set<string>) => a.size > 0 && [...a].every((t) => b.has(t))

/**
 * Le résultat parle-t-il DU morceau qui joue ? Titre identique une fois normalisé, et artistes
 * compatibles : l'un des deux jeux de mots contient l'autre, ce qui accepte « Northwind » (Deezer ne
 * nomme que le premier) face à « Northwind et Lumen », et refuse « Tim McGraw ».
 */
export function matches(played: Track, found: { title?: string | null; artist?: string | null }): boolean {
  if (!found.title || !found.artist) return false
  if (normTitle(found.title) !== normTitle(played.title)) return false
  const a = tokens(played.artist), b = tokens(found.artist)
  return subset(a, b) || subset(b, a)
}

export interface CoverFinderOptions {
  fetchImpl?: CoverFetch
  clock: Clock
  logger: Logger
  signal: AbortSignal
}

export class CoverFinder {
  private readonly cache = new Map<string, { url: string | null; at: number }>()
  private readonly pending = new Map<string, Promise<string | null>>()
  private readonly fetchImpl: CoverFetch

  constructor(private readonly opts: CoverFinderOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  }

  /** Clé de cache : ce qui identifie le morceau pour nous, indépendamment de la casse et des accents. */
  static key(track: Track): string { return `${normArtist(track.artist)}|${normTitle(track.title)}` }

  /** Pochette déjà trouvée (ou échec récent : `null`), sans requête ; `undefined` si jamais demandée ou périmée. */
  cached(track: Track): string | null | undefined {
    const hit = this.cache.get(CoverFinder.key(track))
    if (!hit) return undefined
    return this.opts.clock.now() - hit.at < (hit.url ? HIT_TTL_MS : MISS_TTL_MS) ? hit.url : undefined
  }

  /** Cherche la pochette (iTunes puis Deezer) ; une seule requête en vol par morceau, `null` si rien de sûr. */
  lookup(track: Track): Promise<string | null> {
    const known = this.cached(track)
    if (known !== undefined) return Promise.resolve(known)
    const key = CoverFinder.key(track)
    const inflight = this.pending.get(key)
    if (inflight) return inflight
    const p = this.search(track)
      .catch((err) => { this.opts.logger.debug({ track, err }, 'cover lookup failed'); return null })
      .then((url) => { this.remember(key, url); return url })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, p)
    return p
  }

  private remember(key: string, url: string | null): void {
    this.cache.delete(key)
    this.cache.set(key, { url, at: this.opts.clock.now() })
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!)
  }

  private async search(track: Track): Promise<string | null> {
    return (await this.fromItunes(track)) ?? (await this.fromDeezer(track))
  }

  private async get(url: string): Promise<unknown | null> {
    const res = await this.fetchImpl(url, { signal: AbortSignal.any([this.opts.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) })
    return res.ok ? res.json() : null
  }

  private async fromItunes(track: Track): Promise<string | null> {
    const term = encodeURIComponent(`${track.artist} ${track.title}`)
    const body = await this.get(`${ITUNES}?term=${term}&entity=song&media=music&limit=5`)
    const parsed = itunesSchema.safeParse(body ?? {})
    if (!parsed.success) return null
    for (const r of parsed.data.results ?? []) {
      if (!r.artworkUrl100 || !matches(track, { title: r.trackName, artist: r.artistName })) continue
      return r.artworkUrl100.replace(/\/100x100bb\.(jpg|png)$/, `/${ITUNES_SIZE}.$1`)
    }
    return null
  }

  private async fromDeezer(track: Track): Promise<string | null> {
    const q = encodeURIComponent(`${track.artist} ${track.title}`)
    const body = await this.get(`${DEEZER}?q=${q}&limit=5`)
    const parsed = deezerSchema.safeParse(body ?? {})
    if (!parsed.success) return null
    for (const r of parsed.data.data ?? []) {
      const cover = r.album?.cover_xl ?? r.album?.cover_big
      if (!cover || !matches(track, { title: r.title, artist: r.artist?.name })) continue
      return cover
    }
    return null
  }
}
