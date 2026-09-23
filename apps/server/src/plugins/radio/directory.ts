import { z } from 'zod'
import { PluginError } from '../../core/plugin'

// Annuaire radio-browser.info : libre, sans clé, ~50 000 stations. Il demande un User-Agent qui
// nomme l'appli, et qu'on lui signale chaque écoute (`/json/url/:uuid`) — c'est ce qui classe les
// stations par popularité pour tout le monde.

const USER_AGENT = 'Kasbah/0.1 (domotique perso)'
const LIMIT = 60
/** Une recherche demande large sur UN mot, puis garde ce qui contient tous les autres. */
const SEARCH_WIDE = 400

/** Pour comparer des noms : minuscules, sans accents ni ponctuation (« ★ Radio Dijon Campus » → « radio dijon campus »). */
export function foldName(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, ' ').trim()
}

/**
 * Les mots d'une recherche, et celui qu'on envoie à l'annuaire : il ne sait chercher qu'une suite
 * exacte (« campus dijon » ne trouve pas « Dijon Campus »). Le plus long mot est le plus sélectif.
 */
export function searchWords(q: string): { words: string[]; probe: string } {
  const words = foldName(q).split(' ').filter(Boolean)
  const probe = [...words].sort((a, b) => b.length - a.length)[0] ?? ''
  return { words, probe }
}

const rawStationSchema = z.object({
  stationuuid: z.string(),
  name: z.string(),
  url_resolved: z.string().optional().default(''),
  url: z.string().optional().default(''),
  favicon: z.string().optional().default(''),
  country: z.string().optional().default(''),
  countrycode: z.string().optional().default(''),
  tags: z.string().optional().default(''),
  codec: z.string().optional().default(''),
  bitrate: z.number().optional().default(0),
  hls: z.number().optional().default(0),
  lastcheckok: z.number().optional().default(1),
})

export interface Station {
  id: string
  name: string
  /** Flux direct (après redirections, playlists .pls/.m3u déjà résolues par l'annuaire). */
  url: string
  favicon?: string
  country?: string
  countryCode?: string
  tags: string[]
  codec?: string
  bitrateKbps?: number
}

export const stationSchema: z.ZodType<Station> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  favicon: z.string().optional(),
  country: z.string().optional(),
  countryCode: z.string().optional(),
  tags: z.array(z.string()),
  codec: z.string().optional(),
  bitrateKbps: z.number().optional(),
})

const httpUrl = (u: string) => /^https?:\/\//i.test(u.trim())

export function toStation(raw: z.infer<typeof rawStationSchema>): Station | null {
  const url = (raw.url_resolved || raw.url).trim()
  const name = raw.name.trim()
  if (!name || !httpUrl(url)) return null
  const codec = raw.codec.trim()
  return {
    id: raw.stationuuid,
    name,
    url,
    ...(httpUrl(raw.favicon) ? { favicon: raw.favicon.trim() } : {}),
    ...(raw.country.trim() ? { country: raw.country.trim() } : {}),
    ...(raw.countrycode.trim() ? { countryCode: raw.countrycode.trim().toUpperCase() } : {}),
    tags: raw.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6),
    ...(codec && codec !== 'UNKNOWN' ? { codec } : {}),
    ...(raw.bitrate > 0 ? { bitrateKbps: raw.bitrate } : {}),
  }
}

export interface RadioDirectory {
  search(q: string): Promise<Station[]>
  /** Les plus écoutées d'un pays (code ISO à deux lettres). */
  top(countryCode: string): Promise<Station[]>
  byId(id: string): Promise<Station | null>
  /** Signale une écoute à l'annuaire ; jamais bloquant, jamais une erreur pour l'appelant. */
  click(id: string): Promise<void>
}

export function createRadioDirectory(base: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): RadioDirectory {
  const root = base.replace(/\/+$/, '')
  async function get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const qs = new URLSearchParams(params).toString()
    let res: Response
    try {
      res = await fetchImpl(`${root}${path}${qs ? `?${qs}` : ''}`, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        ...(signal ? { signal } : {}),
      })
    } catch (err) {
      throw new PluginError('DEVICE_UNAVAILABLE', `radio directory unreachable: ${(err as Error).message}`)
    }
    if (!res.ok) throw new PluginError('DEVICE_UNAVAILABLE', `radio directory answered ${res.status}`)
    return res.json()
  }
  async function list(path: string, params: Record<string, string>): Promise<Station[]> {
    const raw = z.array(z.unknown()).parse(await get(path, params))
    const out: Station[] = []
    for (const r of raw) {
      const parsed = rawStationSchema.safeParse(r)
      if (!parsed.success || parsed.data.lastcheckok === 0) continue
      const s = toStation(parsed.data)
      if (s) out.push(s)
    }
    return out
  }
  const ranked = { hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: String(LIMIT) }
  return {
    async search(q) {
      const { words, probe } = searchWords(q)
      if (!probe) return []
      const wide = await list('/json/stations/search', { ...ranked, limit: String(SEARCH_WIDE), name: probe })
      return wide.filter((s) => { const name = foldName(s.name); return words.every((w) => name.includes(w)) }).slice(0, LIMIT)
    },
    top: (countryCode) => list('/json/stations/search', { ...ranked, countrycode: countryCode.toUpperCase() }),
    async byId(id) {
      const found = await list('/json/stations/byuuid', { uuids: id })
      return found[0] ?? null
    },
    async click(id) {
      try { await get(`/json/url/${encodeURIComponent(id)}`) } catch { /* compteur de popularité : sans conséquence */ }
    },
  }
}
