import type { SchoolData, SchoolFilters, SchoolHomework } from '../api/transport'

// Readings of the School view, outside the component to be tested: what stays visible once the
// filters are set, homework arranged by day, and the numbers of the tab pills.

/** The order of elementary school: the level chips line up this way, not alphabetically. */
const LEVEL_ORDER = ['CP', 'CE1', 'CE2', 'CM1', 'CM2']
const LEVEL_RE = /\b(CP|CE1|CE2|CM1|CM2)\b/gi

/** The levels that can be filtered: those named by the classes ("CE1-CE2") and the entries. */
export function levelOptions(data: Pick<SchoolData, 'journals' | 'homework' | 'messages' | 'posts'>): string[] {
  const found = new Set<string>()
  for (const j of data.journals) for (const m of j.name.matchAll(LEVEL_RE)) found.add(m[1]!.toUpperCase())
  for (const list of [data.homework, data.messages, data.posts]) for (const e of list) for (const l of e.levels) found.add(l)
  return [...found].sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b))
}

/**
 * An entry stays visible if its class is, and if it names no level (it speaks to the whole
 * class) or at least one kept level.
 */
export function isVisible(e: { journalId: string; levels: string[] }, f: SchoolFilters): boolean {
  if (f.hiddenJournals.includes(e.journalId)) return false
  return e.levels.length === 0 || e.levels.some((l) => !f.hiddenLevels.includes(l))
}

export interface HomeworkDay { date: string; items: SchoolHomework[] }

/** Homework arranged by due day, split into past days and upcoming days (today included). */
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

/** The next day something is due AFTER today: "for tomorrow" in the student's sense. */
export function nextDueDate(homework: SchoolHomework[], today: string): string | null {
  return homework.map((h) => h.date).filter((d) => d > today).sort()[0] ?? null
}

/** Tab pills: undone homework of the next day, unread messages, new posts. */
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

/** Local `YYYY-MM-DD` of an instant. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Difference in days between two local dates `YYYY-MM-DD` (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number)
  const [yb, mb, db] = b.split('-').map(Number)
  return Math.round((Date.UTC(yb!, mb! - 1, db!) - Date.UTC(ya!, ma! - 1, da!)) / 86_400_000)
}
