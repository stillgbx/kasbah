import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Logger } from 'pino'
import { writeFileAtomic } from '../../core/atomic-file'

// The house's calendars. The secret iCal address alone grants access to the calendar: it lives
// here, in `.state/` (outside the repo, outside `.env`), and never comes back out through the API.

export const calendarSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  url: z.string().url(),
})
export type StoredCalendar = z.infer<typeof calendarSchema>

export interface CalendarsStore {
  load(): Promise<StoredCalendar[]>
  save(calendars: StoredCalendar[]): Promise<void>
}

const fileSchema = z.object({ calendars: z.array(calendarSchema) })

export function createCalendarsFile(path: string, logger?: Logger): CalendarsStore {
  return {
    async load() {
      try {
        const parsed = fileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) { logger?.warn({ path }, 'agenda calendars file is unreadable, starting empty'); return [] }
        return parsed.data.calendars
      } catch { return [] }
    },
    async save(calendars) {
      await writeFileAtomic(path, JSON.stringify({ calendars }, null, 2), { mode: 0o600 })
    },
  }
}

export function memoryCalendars(initial: StoredCalendar[] = []): CalendarsStore {
  let calendars = [...initial]
  return {
    async load() { return [...calendars] },
    async save(next) { calendars = [...next] },
  }
}
