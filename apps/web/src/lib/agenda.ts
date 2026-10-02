import type { AgendaEvent } from '../api/transport'

// Calcul de la vue Agenda, sans Vue : périodes affichées (mois de six semaines, semaine du lundi,
// jour), répartition des occurrences par jour, et colonnes des rendez-vous qui se chevauchent.
// Tout est en heure LOCALE du navigateur (celle de la maison).

export type AgendaMode = 'month' | 'week' | 'day'
export const AGENDA_MODES: AgendaMode[] = ['month', 'week', 'day']

/** Jour local `YYYY-MM-DD` (la forme des journées entières du serveur). */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
/** La semaine commence le lundi. */
export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -((d.getDay() + 6) % 7))
}

/**
 * Les jours affichés pour un mode autour d'une date. Le mois a TOUJOURS six semaines : la grille
 * garde la même hauteur de février à mars.
 */
export function visibleDays(mode: AgendaMode, anchor: Date): Date[] {
  if (mode === 'day') return [startOfDay(anchor)]
  const first = mode === 'week' ? startOfWeek(anchor) : startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  return Array.from({ length: mode === 'week' ? 7 : 42 }, (_, i) => addDays(first, i))
}

/** La date de la période suivante (`+1`) ou précédente (`-1`). */
export function shift(mode: AgendaMode, anchor: Date, dir: 1 | -1): Date {
  if (mode === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1)
  return addDays(anchor, dir * (mode === 'week' ? 7 : 1))
}

/** Les jours (clés) que touche une occurrence. Un rendez-vous sans durée tient dans son jour. */
export function eventDays(e: AgendaEvent): string[] {
  const out: string[] = []
  if (e.allDay) {
    for (let d = fromKey(e.start); dayKey(d) < e.end; d = addDays(d, 1)) out.push(dayKey(d))
    return out.length ? out : [e.start]
  }
  const last = startOfDay(new Date(Math.max(e.start, e.end - 1)))
  for (let d = startOfDay(new Date(e.start)); d <= last; d = addDays(d, 1)) out.push(dayKey(d))
  return out
}

/** Terminée à `now` : une journée entière l'est le lendemain de son dernier jour (fin exclusive). */
export function isPast(e: AgendaEvent, now: number): boolean {
  if (!e.allDay) return e.end <= now
  const today = dayKey(new Date(now))
  return e.start < today && e.end <= today
}

/** Occurrences par jour, journées entières d'abord, puis par heure de début. */
export function byDay(events: AgendaEvent[]): Map<string, AgendaEvent[]> {
  const map = new Map<string, AgendaEvent[]>()
  for (const e of events) {
    for (const k of eventDays(e)) {
      const list = map.get(k)
      if (list) list.push(e)
      else map.set(k, [e])
    }
  }
  for (const list of map.values()) list.sort(compareEvents)
  return map
}

function compareEvents(a: AgendaEvent, b: AgendaEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  if (a.allDay && b.allDay) return a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title)
  return (a.start as number) - (b.start as number) || (b.end as number) - (a.end as number)
}

/** Un rendez-vous posé dans la colonne d'un jour : minutes depuis minuit, colonne parmi `cols`. */
export interface PlacedEvent { event: AgendaEvent; startMin: number; endMin: number; col: number; cols: number }

/** Durée minimale affichée : un rendez-vous de cinq minutes reste lisible et touchable. */
export const MIN_BLOCK_MIN = 30

/**
 * Les rendez-vous (hors journées entières) d'un jour, rognés au jour et répartis en colonnes : des
 * blocs qui se chevauchent se partagent la largeur, un groupe qui ne chevauche rien la garde entière.
 */
export function layoutDay(events: AgendaEvent[], day: Date): PlacedEvent[] {
  const dayStart = startOfDay(day).getTime()
  const dayEnd = addDays(day, 1).getTime()
  const items = events
    .filter((e): e is AgendaEvent & { allDay: false } => !e.allDay && e.start < dayEnd && (e.end > dayStart || (e.end === e.start && e.start >= dayStart)))
    .map((event) => {
      // minutes réelles (le décalage d'heure d'été est ignoré : la grille compte 24 heures)
      const startMin = Math.max(0, Math.round((event.start - dayStart) / 60_000))
      const endMin = Math.min(24 * 60, Math.round((event.end - dayStart) / 60_000))
      return { event, startMin, endMin: Math.max(endMin, startMin + MIN_BLOCK_MIN), col: 0, cols: 1 }
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)

  let group: PlacedEvent[] = []
  let groupEnd = -1
  let colEnds: number[] = []
  const close = () => { for (const p of group) p.cols = colEnds.length }
  for (const p of items) {
    if (p.startMin >= groupEnd) { close(); group = []; colEnds = []; groupEnd = -1 }
    const free = colEnds.findIndex((end) => end <= p.startMin)
    p.col = free === -1 ? colEnds.length : free
    colEnds[p.col] = p.endMin
    group.push(p)
    groupEnd = Math.max(groupEnd, p.endMin)
  }
  close()
  return items
}
