import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../../core/atomic-file'

// Historique de LUMINOSITÉ des volets solaires : le maximum atteint par heure et par jour, le mois
// se déduisant des jours. L'API locale n'en sert aucun (le graphe heure / jour / mois de l'appli
// Somfy vient du cloud) : il est donc construit ICI, au fil des événements de la box.
//
// Le MAXIMUM et pas une moyenne : c'est ce que montre l'appli (« 4 000 lx hier »), et c'est exact
// sans échantillonnage — la box n'émet `core:LuminanceState` que quand la valeur change, donc entre
// deux trames la luminance est celle de la précédente. D'où le report : une heure sans trame (la
// nuit, un ciel constant) vaut la dernière valeur connue, à condition que CE processus l'ait vue
// pendant tout ce temps. Une heure où le serveur ne tournait pas reste ABSENTE, jamais à zéro.

const HOUR_MS = 3_600_000
/** Deux jours d'heures : de quoi afficher « les dernières 24 h » à toute heure. */
export const HOURLY_POINTS_MAX = 48
/** Treize mois de jours : la vue mensuelle couvre l'année écoulée, mois en cours compris. */
export const DAILY_POINTS_MAX = 400

export const lightPointSchema = z.object({
  /** Début du pas (ms epoch) : heure pleine, ou minuit local. */
  t: z.number().int(),
  /** Plus forte luminance vue dans ce pas, en lux. */
  maxLux: z.number().min(0),
})
export type LightPoint = z.infer<typeof lightPointSchema>

const seriesSchema = z.object({ hourly: z.array(lightPointSchema), daily: z.array(lightPointSchema) })
type Series = z.infer<typeof seriesSchema>

export const lightHistorySchema = z.object({
  /** Par `externalId` de capteur. */
  sensors: z.record(z.string(), seriesSchema),
})
export type LightHistoryState = z.infer<typeof lightHistorySchema>

export interface LightSnapshot { hourly: LightPoint[]; daily: LightPoint[]; monthly: LightPoint[] }

const hourStart = (at: number): number => Math.floor(at / HOUR_MS) * HOUR_MS
const nextHour = (t: number): number => t + HOUR_MS
function dayStart(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
function nextDay(t: number): number {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}
function monthStart(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

/** Porte le maximum du pas `t` à au moins `lux` (en ouvrant le pas au besoin). @returns pas ouvert. */
function bump(points: LightPoint[], t: number, lux: number, max: number): boolean {
  const last = points[points.length - 1]
  if (last && last.t === t) { if (lux > last.maxLux) last.maxLux = lux; return false }
  if (last && last.t > t) return false                      // horloge qui recule : on n'écrit pas le passé
  points.push({ t, maxLux: lux })
  if (points.length > max) points.splice(0, points.length - max)
  return true
}

/** Reporte `lux` sur chaque pas de `from` à `to` inclus — la valeur n'a pas changé entre-temps. */
function carry(points: LightPoint[], from: number, to: number, next: (t: number) => number, lux: number, max: number): boolean {
  let opened = false
  for (let t = from; t <= to; t = next(t)) opened = bump(points, t, lux, max) || opened
  return opened
}

export class LightHistory {
  private readonly series = new Map<string, Series>()
  /** Dernière valeur vue PAR CE PROCESSUS, et depuis quand : seule base honnête d'un report. */
  private readonly live = new Map<string, { lux: number; since: number }>()

  constructor(initial?: LightHistoryState | null) {
    for (const [id, s] of Object.entries(initial?.sensors ?? {})) {
      this.series.set(id, { hourly: s.hourly.map((p) => ({ ...p })), daily: s.daily.map((p) => ({ ...p })) })
    }
  }

  /** Une luminance lue (setup ou trame). @returns `true` quand une nouvelle heure s'est ouverte. */
  record(id: string, lux: number, at: number): boolean {
    let s = this.series.get(id)
    if (!s) { s = { hourly: [], daily: [] }; this.series.set(id, s) }
    const opened = this.advanceOne(id, s, at)
    const h = bump(s.hourly, hourStart(at), lux, HOURLY_POINTS_MAX)
    bump(s.daily, dayStart(at), lux, DAILY_POINTS_MAX)
    this.live.set(id, { lux, since: at })
    return opened || h
  }

  /** Reporte la dernière valeur connue jusqu'à `at`, pour tous les capteurs. @returns heure ouverte. */
  advance(at: number): boolean {
    let opened = false
    for (const [id, s] of this.series) opened = this.advanceOne(id, s, at) || opened
    return opened
  }

  snapshot(id: string, at: number): LightSnapshot | undefined {
    const s = this.series.get(id)
    if (!s) return undefined
    this.advanceOne(id, s, at)
    const hourly = s.hourly.filter((p) => p.t > hourStart(at) - HOURLY_POINTS_MAX * HOUR_MS)
    const monthly: LightPoint[] = []
    for (const p of s.daily) {
      const m = monthStart(p.t)
      const last = monthly[monthly.length - 1]
      if (last && last.t === m) last.maxLux = Math.max(last.maxLux, p.maxLux)
      else monthly.push({ t: m, maxLux: p.maxLux })
    }
    return { hourly: hourly.map((p) => ({ ...p })), daily: s.daily.map((p) => ({ ...p })), monthly }
  }

  toState(): LightHistoryState {
    const sensors: LightHistoryState['sensors'] = {}
    for (const [id, s] of this.series) sensors[id] = { hourly: s.hourly.map((p) => ({ ...p })), daily: s.daily.map((p) => ({ ...p })) }
    return { sensors }
  }

  private advanceOne(id: string, s: Series, at: number): boolean {
    const prev = this.live.get(id)
    if (!prev || at <= prev.since) return false
    const opened = carry(s.hourly, hourStart(prev.since), hourStart(at), nextHour, prev.lux, HOURLY_POINTS_MAX)
    carry(s.daily, dayStart(prev.since), dayStart(at), nextDay, prev.lux, DAILY_POINTS_MAX)
    this.live.set(id, { lux: prev.lux, since: at })
    return opened
  }
}

export interface LightHistoryStore {
  load(): Promise<LightHistoryState | null>
  save(h: LightHistoryState): Promise<void>
}

/** Écriture atomique (fichier temporaire puis renommage) ; une lecture illisible vaut « rien ». */
export function createLightHistoryFile(path: string, logger?: Logger): LightHistoryStore {
  return {
    async load() {
      try {
        const parsed = lightHistorySchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) { logger?.warn({ path }, 'TaHoma light history file is unreadable, starting over'); return null }
        return parsed.data
      } catch { return null }
    },
    async save(h) {
      try { await writeFileAtomic(path, JSON.stringify(h)) }
      catch (err) { logger?.warn({ err, path }, 'could not write the TaHoma light history file') }
    },
  }
}
