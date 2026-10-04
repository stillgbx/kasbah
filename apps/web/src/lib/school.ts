import type { SchoolData, SchoolFilters, SchoolHomework } from '../api/transport'

// Lectures de la vue École, hors composant pour être testées : ce qui reste visible une fois les
// filtres posés, les devoirs rangés par jour, et les nombres des pastilles d'onglet.

/** L'ordre de l'école élémentaire : les puces de niveau se rangent ainsi, pas par ordre alphabétique. */
const LEVEL_ORDER = ['CP', 'CE1', 'CE2', 'CM1', 'CM2']
const LEVEL_RE = /\b(CP|CE1|CE2|CM1|CM2)\b/gi

/** Les niveaux qu'on peut filtrer : ceux que nomment les classes (« CE1-CE2 ») et les entrées. */
export function levelOptions(data: Pick<SchoolData, 'journals' | 'homework' | 'messages' | 'posts'>): string[] {
  const found = new Set<string>()
  for (const j of data.journals) for (const m of j.name.matchAll(LEVEL_RE)) found.add(m[1]!.toUpperCase())
  for (const list of [data.homework, data.messages, data.posts]) for (const e of list) for (const l of e.levels) found.add(l)
  return [...found].sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b))
}

/**
 * Une entrée reste visible si sa classe l'est, et si elle ne nomme aucun niveau (elle parle à toute
 * la classe) ou au moins un niveau gardé.
 */
export function isVisible(e: { journalId: string; levels: string[] }, f: SchoolFilters): boolean {
  if (f.hiddenJournals.includes(e.journalId)) return false
  return e.levels.length === 0 || e.levels.some((l) => !f.hiddenLevels.includes(l))
}

export interface HomeworkDay { date: string; items: SchoolHomework[] }

/** Les devoirs rangés par jour à rendre, séparés en jours passés et jours à venir (aujourd'hui compris). */
export function homeworkDays(homework: SchoolHomework[], today: string): { past: HomeworkDay[]; upcoming: HomeworkDay[] } {
  const byDate = new Map<string, SchoolHomework[]>()
  for (const h of [...homework].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
    const list = byDate.get(h.date)
    if (list) list.push(h)
    else byDate.set(h.date, [h])
  }
  const days = [...byDate].map(([date, items]) => ({ date, items }))
  return { past: days.filter((d) => d.date < today).reverse(), upcoming: days.filter((d) => d.date >= today) }
}

/** Le prochain jour où quelque chose est à rendre APRÈS aujourd'hui : « pour demain » au sens de l'élève. */
export function nextDueDate(homework: SchoolHomework[], today: string): string | null {
  return homework.map((h) => h.date).filter((d) => d > today).sort()[0] ?? null
}

/** Pastilles des onglets : devoirs non faits du prochain jour, messages non lus, publications nouvelles. */
export function badges(data: SchoolData, today: string): { homework: number; messages: number; posts: number } {
  const f = data.filters
  const homework = data.homework.filter((h) => isVisible(h, f))
  const due = nextDueDate(homework, today)
  return {
    homework: due ? homework.filter((h) => h.date === due && !h.done).length : 0,
    messages: data.messages.filter((m) => isVisible(m, f) && !m.read).length,
    posts: data.posts.filter((p) => isVisible(p, f) && p.id > data.postsSeen).length,
  }
}

/** `YYYY-MM-DD` local d'un instant. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Écart en jours entre deux dates locales `YYYY-MM-DD` (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number)
  const [yb, mb, db] = b.split('-').map(Number)
  return Math.round((Date.UTC(yb!, mb! - 1, db!) - Date.UTC(ya!, ma! - 1, da!)) / 86_400_000)
}
