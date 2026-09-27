import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { Logger } from 'pino'

// Les agendas de la maison. L'adresse iCal secrète donne à elle seule accès à l'agenda : elle vit
// ici, dans `.state/` (hors dépôt, hors `.env`), et ne ressort jamais par l'API.

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
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify({ calendars }, null, 2), 'utf8')
      await rename(tmp, path)
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
