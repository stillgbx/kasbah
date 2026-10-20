import type { Logger } from 'pino'
import { z } from 'zod'
import type { Clock } from '../../../core/clock'

// App logo as a FALLBACK cover: when what is playing has no image (native Netflix sends nothing,
// Crunchyroll nothing before enrichment, a radio sometimes nothing), the row and the panel stay bare even
// though we at least know which app is on screen. Source: the PUBLIC Cast app registry, the one phones
// query to show an app's icon (`clients3.google.com/cast/chromecast/device/app?a=<appId>`, no key) —
// `promo_assets[].icon_url`, a 512 px square image hosted by Google (survey of 2026-09-10: Netflix,
// YouTube, Spotify, Radio France). JSON response preceded by the `)]}'` guard, to be stripped.
//
// A NATIVE app on a Chromecast with Google TV does not carry its Cast id (`appId: "Netflix"`,
// `AndroidNativeApp`): a small table by name makes the link. An app unknown to the registry stays
// without a logo — the display keeps what it has.

const REGISTRY = 'https://clients3.google.com/cast/chromecast/device/app?a='
/**
 * Native apps → Cast registry id (verified 2026-09-10: the registry does return `display_name` and an
 * icon for each). To be extended as surveys come in.
 */
const NATIVE_APP_IDS: Record<string, string> = {
  Netflix: 'CA5E8412',
  YouTube: '233637DE',
  Spotify: 'CC32E753',
  'Prime Video': '17608BC8',
}
const HIT_TTL_MS = 24 * 3_600_000
const MISS_TTL_MS = 3_600_000
const CACHE_MAX = 64
const REQUEST_TIMEOUT_MS = 8000

const registrySchema = z.looseObject({
  promo_assets: z.array(z.looseObject({ icon_url: z.string().nullish() })).nullish(),
})

/** The bare minimum of `fetch` to read the registry (text, because of the guard). */
export type RegistryFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

/** Id under which the registry knows the app, or `undefined` if we cannot name it. */
export function registryAppId(app: { appId: string; universalAppId?: string | null; displayName?: string | null }): string | undefined {
  // `universalAppId` FIRST: it is the app's canonical id, the one carrying its visuals. Observed on an
  // Android TV: YouTube runs under `appId: 2C6A6E3D` (Android TV variant, known to the registry but
  // WITHOUT any `promo_assets`) and `universalAppId: 233637DE`, which has seventeen. Taking one for the
  // other gives a valid response… and an empty background.
  for (const id of [app.universalAppId, app.appId]) if (id && /^[0-9A-F]{8}$/.test(id)) return id
  return app.displayName ? NATIVE_APP_IDS[app.displayName] : undefined
}

/** Strips the `)]}'` anti-hijacking guard Google puts in front of the JSON. */
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

  /** Logo already known (or recent failure: `null`), without a request; `undefined` if never asked or stale. */
  cached(registryId: string): string | null | undefined {
    const hit = this.cache.get(registryId)
    if (!hit) return undefined
    return this.opts.clock.now() - hit.at < (hit.url ? HIT_TTL_MS : MISS_TTL_MS) ? hit.url : undefined
  }

  /** Logo of a registry app; a single request in flight per id, `null` if unknown or unreachable. */
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
