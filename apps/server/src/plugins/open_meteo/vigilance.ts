import { fetch as undiciFetch } from 'undici'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { REQUEST_TIMEOUT_MS } from './client'

// Météo-France weather warnings ("vigilance"), read through the MeteoAlarm feed
// (`feeds.meteoalarm.org`, JSON, no key or account, CC BY 4.0): Météo-France publishes its warnings
// there department by department, in CAP. Open-Meteo says nothing about them. The feed carries NO
// polygons, only the department's name (`areaDesc`): the position becomes a department through
// the French state's Géo API (`geo.api.gouv.fr`, no key either). Mainland France only: overseas
// territories are not in the France feed, and a department missing from the feed would wrongly
// mean "green" there.
//
// The feed mixes today's and tomorrow's messages, their updates and the returns to green (level 1).
// For each phenomenon: the most RECENT message (`sent`) covering the instant gives the current
// level; the most recent one starting later gives the next. Two contiguous windows at the same
// level make just one ("until midnight tomorrow" rather than two lines).

export const VIGILANCE_ATTRIBUTION = 'MeteoAlarm.org (CC BY 4.0) / Météo-France'
export const VIGILANCE_WEB = 'https://vigilance.meteofrance.fr/'

/** MeteoAlarm phenomena (`awareness_type`), numbering shared by the European services. */
const TYPES: Record<string, string> = {
  1: 'wind', 2: 'snow_ice', 3: 'thunderstorm', 4: 'fog', 5: 'heat', 6: 'cold', 7: 'coastal',
  8: 'forest_fire', 9: 'avalanche', 10: 'rain', 12: 'flood', 13: 'rain_flood',
}
const LEVELS = ['yellow', 'orange', 'red'] as const
export type VigilanceLevel = (typeof LEVELS)[number]

export interface VigilanceWarning {
  /** Phenomenon (`thunderstorm`, `wind`…), `other` for an unknown number. */
  type: string
  level: VigilanceLevel
  /** Start and end, in epoch ms. */
  onset: number
  expires: number
}

const param = z.looseObject({ valueName: z.string(), value: z.string() })
const info = z.looseObject({
  onset: z.string().optional(),
  effective: z.string().optional(),
  expires: z.string(),
  parameter: z.array(param).default([]),
  area: z.array(z.looseObject({ areaDesc: z.string() })).default([]),
})
export const meteoAlarmFeedSchema = z.looseObject({
  warnings: z.array(z.looseObject({
    alert: z.looseObject({ msgType: z.string().optional(), sent: z.string(), info: z.array(info).default([]) }),
  })),
})
export type MeteoAlarmFeed = z.infer<typeof meteoAlarmFeedSchema>

const communesSchema = z.array(z.looseObject({ departement: z.looseObject({ code: z.string(), nom: z.string() }).optional() }))

/** "Côte-d'Or" = "cote d or" = "COTE-D'OR": no accents, case or punctuation. */
const norm = (s: string) => s.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase()

/** A department's warnings (at least yellow), current then upcoming, the strongest first. Pure. */
export function vigilanceFor(feed: MeteoAlarmFeed, area: string, now: number): VigilanceWarning[] {
  const key = norm(area)
  type Msg = { type: string; level: number; onset: number; expires: number; sent: number }
  const byType = new Map<string, Msg[]>()
  for (const { alert } of feed.warnings) {
    // a message's languages say the same thing: the first one is enough
    const i = alert.info.find((x) => x.area.some((a) => norm(a.areaDesc) === key))
    if (!i) continue
    const p = (name: string) => i.parameter.find((x) => x.valueName === name)?.value
    const typeNo = p('awareness_type')?.split(';')[0]?.trim() ?? ''
    const msg: Msg = {
      type: TYPES[typeNo] ?? 'other',
      // "2; yellow; Moderate"; a cancelled message brings back green
      level: alert.msgType === 'Cancel' ? 1 : Number(p('awareness_level')?.split(';')[0] ?? 1),
      onset: Date.parse(i.onset ?? i.effective ?? ''),
      expires: Date.parse(i.expires),
      sent: Date.parse(alert.sent),
    }
    if (!Number.isFinite(msg.onset) || !Number.isFinite(msg.expires) || !(msg.expires > msg.onset)) continue
    byType.set(msg.type, [...(byType.get(msg.type) ?? []), msg])
  }
  const latest = (ms: Msg[]) => ms.reduce<Msg | undefined>((a, b) => (!a || b.sent > a.sent ? b : a), undefined)
  const out: VigilanceWarning[] = []
  for (const [type, msgs] of byType) {
    const current = latest(msgs.filter((m) => m.onset <= now && now < m.expires))
    const next = latest(msgs.filter((m) => m.onset > now))
    const keep = (m: Msg | undefined): m is Msg => !!m && m.level >= 2 && m.level <= 4
    if (keep(current) && keep(next) && next.level === current.level && next.onset <= current.expires) {
      out.push({ type, level: LEVELS[current.level - 2]!, onset: current.onset, expires: next.expires })
      continue
    }
    for (const m of [current, next].filter(keep)) out.push({ type, level: LEVELS[m.level - 2]!, onset: m.onset, expires: m.expires })
  }
  const rank = (w: VigilanceWarning) => LEVELS.indexOf(w.level)
  return out.sort((a, b) => (a.onset <= now) !== (b.onset <= now) ? (a.onset <= now ? -1 : 1) : rank(b) - rank(a) || a.onset - b.onset)
}

export interface VigilanceClientOptions {
  fetchImpl?: FetchLike
  requestTimeoutMs?: number
  /** Lifetime of the cached feed: that of the weather poll. */
  ttlMs: number
  now: () => number
  feedUrl?: string
  geoBase?: string
}

/** The feed (a single shared one, re-read at most once per `ttlMs`) and the departments by position. */
export class VigilanceClient {
  private readonly fetchImpl: FetchLike
  private feed: { at: number; data: Promise<MeteoAlarmFeed> } | null = null
  private readonly areas = new Map<string, Promise<string | null>>()

  constructor(private readonly opts: VigilanceClientOptions) {
    this.fetchImpl = opts.fetchImpl
      ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
  }

  /** `null` = outside mainland France: no Météo-France warning to read here. */
  async at(lat: number, lon: number, signal: AbortSignal): Promise<{ area: string | null; warnings: VigilanceWarning[] }> {
    const area = await this.area(lat, lon, signal)
    if (!area) return { area: null, warnings: [] }
    return { area, warnings: vigilanceFor(await this.readFeed(signal), area, this.opts.now()) }
  }

  private area(lat: number, lon: number, signal: AbortSignal): Promise<string | null> {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`
    let hit = this.areas.get(key)
    if (!hit) {
      const url = `${this.opts.geoBase ?? 'https://geo.api.gouv.fr'}/communes?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&fields=departement&format=json`
      hit = this.getJson(url, signal, 'geo.api.gouv.fr').then((json) => {
        const parsed = communesSchema.safeParse(json)
        if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'unexpected geo.api.gouv.fr response')
        const d = parsed.data[0]?.departement
        return d && !d.code.startsWith('97') ? d.nom : null
      })
      // a failure doesn't stay cached: the next request retries
      hit.catch(() => this.areas.delete(key))
      this.areas.set(key, hit)
      if (this.areas.size > 24) this.areas.delete(this.areas.keys().next().value!)
    }
    return hit
  }

  private readFeed(signal: AbortSignal): Promise<MeteoAlarmFeed> {
    const now = this.opts.now()
    if (this.feed && now - this.feed.at < this.opts.ttlMs) return this.feed.data
    const data = this.getJson(this.opts.feedUrl ?? 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-france', signal, 'MeteoAlarm').then((json) => {
      const parsed = meteoAlarmFeedSchema.safeParse(json)
      if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', `unexpected MeteoAlarm response: ${parsed.error.issues[0]?.message ?? '?'}`)
      return parsed.data
    })
    const entry = { at: now, data }
    data.catch(() => { if (this.feed === entry) this.feed = null })
    this.feed = entry
    return data
  }

  private async getJson(url: string, signal: AbortSignal, who: string): Promise<unknown> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)])
    let res: Awaited<ReturnType<FetchLike>>
    try { res = await this.fetchImpl(url, { signal: deadline, headers: { accept: 'application/json' } }) }
    catch (err) {
      if (deadline.aborted && !signal.aborted) throw new PluginError('TIMEOUT', `${who} did not answer in time`, { cause: err })
      throw new PluginError('UPSTREAM_ERROR', `${who} unreachable: ${(err as Error).message}`, { cause: err })
    }
    if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `${who} answered ${res.status}`)
    return res.json()
  }
}
