import { sunTimes, type TimeTrigger } from '@kasbah/shared'

// Prochaine échéance d'un déclencheur horaire. Tout se raisonne en HEURE MURALE LOCALE (fuseau du
// process, comme le reste du serveur) : un jour se construit par `new Date(a, m, j + k)` et jamais en
// ajoutant 24 h, sans quoi un changement d'heure décalerait d'une heure toutes les échéances
// suivantes. Une heure qui n'existe pas (02:30 le jour du passage à l'heure d'été) est normalisée
// par `Date` à 03:30 ; une heure qui existe deux fois n'est prise qu'une fois.

/** Au plus un an d'avance : au-delà, une période ou des jours qui ne se rencontrent jamais. */
const HORIZON_DAYS = 366

export interface Site { lat: number; lon: number }

/** « AAAA-MM-JJ » du jour local, pour comparer aux bornes d'une période. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Instant d'une heure murale « HH:MM » le jour local `day`. */
export function wallClock(day: Date, hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime()
}

/** Heure du déclencheur le jour `day`, ou `undefined` si le soleil n'y passe pas ce jour-là. */
export function occurrenceOn(trigger: TimeTrigger, day: Date, site: Site): number | undefined {
  const at = trigger.at
  if (at.kind === 'clock') return wallClock(day, at.time)
  // midi local : `sunTimes` découpe le jour qui CONTIENT la date donnée
  const base = sunTimes(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12), site.lat, site.lon)[at.event]
  if (base === undefined) return undefined
  let t = base + (at.offsetMin ?? 0) * 60_000
  if (at.notBefore) t = Math.max(t, wallClock(day, at.notBefore))
  if (at.notAfter) t = Math.min(t, wallClock(day, at.notAfter))
  return t
}

/** Le jour est-il retenu par les jours de la semaine et la période du déclencheur ? */
function dayAllowed(trigger: TimeTrigger, day: Date): boolean {
  if (trigger.days && !trigger.days.includes(day.getDay())) return false
  if (trigger.dateRange) {
    const d = isoDay(day)
    if (d < trigger.dateRange.from || d > trigger.dateRange.to) return false
  }
  return true
}

/** Première échéance STRICTEMENT après `fromMs`, ou `undefined` s'il n'y en a plus dans l'année. */
export function nextOccurrence(trigger: TimeTrigger, fromMs: number, site: Site): number | undefined {
  const from = new Date(fromMs)
  for (let k = 0; k <= HORIZON_DAYS; k++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + k)
    if (!dayAllowed(trigger, day)) continue
    const t = occurrenceOn(trigger, day, site)
    if (t !== undefined && t > fromMs) return t
  }
  return undefined
}
