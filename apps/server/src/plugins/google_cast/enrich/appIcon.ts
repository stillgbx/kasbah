import type { Logger } from 'pino'
import { z } from 'zod'
import type { Clock } from '../../../core/clock'

// Logo de l'appli en pochette de REPLI : quand ce qui joue n'a pas d'image (Netflix natif n'envoie rien,
// Crunchyroll rien avant enrichissement, une radio parfois rien), la ligne et le panneau restent nus alors
// qu'on sait au moins quelle appli est à l'écran. Source : le registre PUBLIC des applis Cast, celui que
// les téléphones interrogent pour afficher l'icône d'une appli (`clients3.google.com/cast/chromecast/device/app?a=<appId>`,
// sans clé) — `promo_assets[].icon_url`, une image carrée 512 px chez Google (relevé du 2026-09-10 :
// Netflix, YouTube, Spotify, Radio France). Réponse JSON précédée du garde `)]}'` à retirer.
//
// Une appli NATIVE d'un Chromecast avec Google TV ne porte pas son identifiant Cast (`appId: "Netflix"`,
// `AndroidNativeApp`) : une petite table par nom fait le lien. Une appli inconnue du registre reste sans
// logo — l'affichage garde ce qu'il a.

const REGISTRY = 'https://clients3.google.com/cast/chromecast/device/app?a='
/** Applis natives → identifiant du registre Cast (vérifiés le 2026-09-10). À compléter au fil des relevés. */
const NATIVE_APP_IDS: Record<string, string> = {
  Netflix: 'CA5E8412',
  YouTube: '233637DE',
  Spotify: 'CC32E753',
}
const HIT_TTL_MS = 24 * 3_600_000
const MISS_TTL_MS = 3_600_000
const CACHE_MAX = 64
const REQUEST_TIMEOUT_MS = 8000

const registrySchema = z.looseObject({
  promo_assets: z.array(z.looseObject({ icon_url: z.string().nullish() })).nullish(),
})

/** Le strict nécessaire de `fetch` pour lire le registre (texte, à cause du garde). */
export type RegistryFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

/** Identifiant sous lequel le registre connaît l'appli, ou `undefined` si on ne sait pas la nommer. */
export function registryAppId(app: { appId: string; displayName?: string | null }): string | undefined {
  if (/^[0-9A-F]{8}$/.test(app.appId)) return app.appId
  return app.displayName ? NATIVE_APP_IDS[app.displayName] : undefined
}

/** Retire le garde anti-hijacking `)]}'` que Google place devant le JSON. */
export function parseRegistry(text: string): string | null {
  const json = text.replace(/^\)\]\}'\s*/, '')
  const parsed = registrySchema.safeParse(JSON.parse(json))
  if (!parsed.success) return null
  return parsed.data.promo_assets?.find((a) => a.icon_url?.trim())?.icon_url?.trim() ?? null
}

export interface AppIconResolverOptions {
  fetchImpl?: RegistryFetch
  clock: Clock
  logger: Logger
  signal: AbortSignal
}

export class AppIconResolver {
  private readonly cache = new Map<string, { url: string | null; at: number }>()
  private readonly pending = new Map<string, Promise<string | null>>()
  private readonly fetchImpl: RegistryFetch

  constructor(private readonly opts: AppIconResolverOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  }

  /** Logo déjà connu (ou échec récent : `null`), sans requête ; `undefined` si jamais demandé ou périmé. */
  cached(registryId: string): string | null | undefined {
    const hit = this.cache.get(registryId)
    if (!hit) return undefined
    return this.opts.clock.now() - hit.at < (hit.url ? HIT_TTL_MS : MISS_TTL_MS) ? hit.url : undefined
  }

  /** Logo d'une appli du registre ; une seule requête en vol par identifiant, `null` si inconnue ou injoignable. */
  lookup(registryId: string): Promise<string | null> {
    const known = this.cached(registryId)
    if (known !== undefined) return Promise.resolve(known)
    const inflight = this.pending.get(registryId)
    if (inflight) return inflight
    const p = this.fetchIcon(registryId)
      .catch((err) => { this.opts.logger.debug({ registryId, err }, 'cast app icon lookup failed'); return null })
      .then((url) => { this.remember(registryId, url); return url })
      .finally(() => this.pending.delete(registryId))
    this.pending.set(registryId, p)
    return p
  }

  private remember(registryId: string, url: string | null): void {
    this.cache.delete(registryId)
    this.cache.set(registryId, { url, at: this.opts.clock.now() })
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!)
  }

  private async fetchIcon(registryId: string): Promise<string | null> {
    const res = await this.fetchImpl(`${REGISTRY}${encodeURIComponent(registryId)}`, { signal: AbortSignal.any([this.opts.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) })
    if (!res.ok) return null
    return parseRegistry(await res.text())
  }
}
