import type { JournalEntry, JournalSeverity } from '@kasbah/shared'

// A device's log, display side: what is decided without a component (testable) and that the
// satellite map, the 3D scene and the two surfaces (Robots view, detail panel) share.

/** A log line THAT KNOWS where it occurred: what the map and the scene place. */
export interface JournalPoint {
  at: number
  lat: number
  lon: number
  severity: JournalSeverity
  label: string
}

/** The positioned lines, in log order (most recent first). */
export function journalPoints(entries: readonly JournalEntry[]): JournalPoint[] {
  return entries.flatMap((e) => (e.location
    ? [{ at: e.at, lat: e.location.lat, lon: e.location.lon, severity: e.severity, label: journalLabel(e) }]
    : []))
}

/** "No loop signal · code 2" — the vendor's text, then its code, the one support asks for. */
export function journalLabel(e: JournalEntry): string {
  return e.code === undefined ? e.message : `${e.message} · ${e.code}`
}

/**
 * Severity tints, the same everywhere: neutral for information, the orange of the Settings
 * warnings, the red of errors, and the same red for a severe error — which the pill
 * distinguishes by a ring, and the scene by a size.
 */
export const JOURNAL_COLORS: Record<JournalSeverity, string> = {
  info: '#8a94a6',
  warning: '#d38b22',
  error: '#d24a43',
  fatal: '#d24a43',
}

/**
 * "16/09 18:22": the log spans weeks (a weekday alone would not say which),
 * and the date must ALWAYS have the same width so that the lines align in
 * monospace — day and month on two digits, hour on 24 h; "7 juil." and "16 sept." did
 * not have the same length.
 */
export function journalWhen(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at))
}
