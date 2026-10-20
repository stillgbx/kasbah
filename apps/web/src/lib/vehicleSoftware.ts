// Software update of a vehicle: what the view computes itself, assuming nothing about the
// vendor. The contract says where the update stands (`softwareUpdate`); here, we go from a chosen
// time ("02:00") to the delay the command expects, and from a date to a readable label.

/**
 * Seconds from now to the next occurrence of `hhmm` (local time): today if it has not
 * passed, otherwise tomorrow. Never 0 — "now" is another gesture —, never more than 24 h, which is what
 * the `vehicle.schedule_update` command accepts.
 */
export function delayUntil(hhmm: string, now: number): number {
  const [h, m] = hhmm.split(':').map(Number)
  const at = new Date(now)
  at.setHours(h ?? 0, m ?? 0, 0, 0)
  if (at.getTime() <= now) at.setDate(at.getDate() + 1)
  // rounded UP: a delay rounded to the nearest landed at 01:59:59, and the confirmation said "01:59"
  return Math.ceil((at.getTime() - now) / 1000)
}

/** Where `at` falls relative to `now`: today, tomorrow, or further (the date is then stated). */
export function dayOf(at: number, now: number): 'today' | 'tomorrow' | 'later' {
  const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
  const diff = Math.round((day(at) - day(now)) / 86_400_000)
  return diff <= 0 ? 'today' : diff === 1 ? 'tomorrow' : 'later'
}
