import type { JournalEntry, JournalSeverity } from '@kasbah/shared'

// Le journal d'un appareil, côté affichage : ce qui se décide sans composant (testable) et que la
// carte satellite, la scène 3D et les deux surfaces (vue Robots, panneau détail) partagent.

/** Une ligne du journal QUI SAIT où elle s'est produite : ce que la carte et la scène posent. */
export interface JournalPoint {
  at: number
  lat: number
  lon: number
  severity: JournalSeverity
  label: string
}

/** Les lignes positionnées, dans l'ordre du journal (le plus récent d'abord). */
export function journalPoints(entries: readonly JournalEntry[]): JournalPoint[] {
  return entries.flatMap((e) => (e.location
    ? [{ at: e.at, lat: e.location.lat, lon: e.location.lon, severity: e.severity, label: journalLabel(e) }]
    : []))
}

/** « No loop signal · code 2 » — le texte du fabricant, puis son code, celui que le support demande. */
export function journalLabel(e: JournalEntry): string {
  return e.code === undefined ? e.message : `${e.message} · ${e.code}`
}

/**
 * Teintes de gravité, les mêmes partout : neutre pour une information, l'orangé des avertissements
 * des Réglages, le rouge des erreurs, et le même rouge pour une erreur grave — que la pastille
 * distingue par un cerclage, et la scène par une taille.
 */
export const JOURNAL_COLORS: Record<JournalSeverity, string> = {
  info: '#8a94a6',
  warning: '#d38b22',
  error: '#d24a43',
  fatal: '#d24a43',
}

/**
 * « 16/09 18:22 » : le journal court sur des semaines (un jour de la semaine seul ne dirait pas
 * laquelle), et la date doit faire TOUJOURS la même largeur pour que les lignes s'alignent en
 * monospace — jour et mois à deux chiffres, heure sur 24 h ; « 7 juil. » et « 16 sept. » ne
 * faisaient pas la même longueur.
 */
export function journalWhen(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at))
}
