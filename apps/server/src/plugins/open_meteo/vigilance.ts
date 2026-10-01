import { fetch as undiciFetch } from 'undici'
import { z } from 'zod'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { REQUEST_TIMEOUT_MS } from './client'

// Vigilance météo de Météo-France, lue par le flux MeteoAlarm (`feeds.meteoalarm.org`, JSON, sans
// clé ni compte, CC BY 4.0) : Météo-France y publie ses vigilances département par département, en
// CAP. Open-Meteo n'en dit rien. Le flux ne porte PAS de polygones, seulement le nom du département
// (`areaDesc`) : la position devient un département par l'API Géo de l'État (`geo.api.gouv.fr`,
// sans clé elle non plus). Métropole seule : l'outre-mer n'est pas dans le flux France, et un
// département absent du flux y voudrait dire « vert » à tort.
//
// Le flux mêle les messages du jour et du lendemain, leurs mises à jour et les retours au vert
// (niveau 1). Pour chaque phénomène : le message le plus RÉCENT (`sent`) qui couvre l'instant dit
// le niveau du moment ; le plus récent qui commence plus tard dit le suivant. Deux fenêtres
// contiguës au même niveau n'en font qu'une (« jusqu'à demain minuit » plutôt que deux lignes).

export const VIGILANCE_ATTRIBUTION = 'MeteoAlarm.org (CC BY 4.0) / Météo-France'
export const VIGILANCE_WEB = 'https://vigilance.meteofrance.fr/'

/** Phénomènes MeteoAlarm (`awareness_type`), numérotation commune aux services européens. */
const TYPES: Record<string, string> = {
  1: 'wind', 2: 'snow_ice', 3: 'thunderstorm', 4: 'fog', 5: 'heat', 6: 'cold', 7: 'coastal',
  8: 'forest_fire', 9: 'avalanche', 10: 'rain', 12: 'flood', 13: 'rain_flood',
}
const LEVELS = ['yellow', 'orange', 'red'] as const
export type VigilanceLevel = (typeof LEVELS)[number]

export interface VigilanceWarning {
  /** Phénomène (`thunderstorm`, `wind`…), `other` pour un numéro inconnu. */
  type: string
  level: VigilanceLevel
  /** Début et fin, en ms epoch. */
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

/** « Côte-d'Or » = « cote d or » = « COTE-D'OR » : sans accents, ni casse, ni ponctuation. */
const norm = (s: string) => s.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase()

/** Les vigilances d'un département (au moins jaunes), en cours puis à venir, la plus forte d'abord. Pur. */
export function vigilanceFor(feed: MeteoAlarmFeed, area: string, now: number): VigilanceWarning[] {
  const key = norm(area)
  type Msg = { type: string; level: number; onset: number; expires: number; sent: number }
  const byType = new Map<string, Msg[]>()
  for (const { alert } of feed.warnings) {
    // les langues d'un message disent la même chose : la première suffit
    const i = alert.info.find((x) => x.area.some((a) => norm(a.areaDesc) === key))
    if (!i) continue
    const p = (name: string) => i.parameter.find((x) => x.valueName === name)?.value
    const typeNo = p('awareness_type')?.split(';')[0]?.trim() ?? ''
    const msg: Msg = {
      type: TYPES[typeNo] ?? 'other',
      // « 2; yellow; Moderate » ; un message annulé ramène au vert
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
  /** Durée de vie du flux en cache : celle du sondage météo. */
  ttlMs: number
  now: () => number
  feedUrl?: string
  geoBase?: string
}

/** Le flux (un seul, partagé, relu au plus une fois par `ttlMs`) et les départements par position. */
export class VigilanceClient {
  private readonly fetchImpl: FetchLike
  private feed: { at: number; data: Promise<MeteoAlarmFeed> } | null = null
  private readonly areas = new Map<string, Promise<string | null>>()

  constructor(private readonly opts: VigilanceClientOptions) {
    this.fetchImpl = opts.fetchImpl
      ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
  }

  /** `null` = hors de la métropole : pas de vigilance Météo-France à lire ici. */
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
      // un échec ne reste pas en cache : la prochaine demande réessaie
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
