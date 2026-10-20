import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Logger } from 'pino'
import { stationSchema, type Station } from './directory'
import { writeFileAtomic } from '../../core/atomic-file'

// The HOUSE's favorite radios (not the browser's): the whole station is kept, so that the list shows
// and plays even when the directory does not answer.

export interface FavoritesStore {
  load(): Promise<Station[]>
  save(stations: Station[]): Promise<void>
}

const fileSchema = z.object({ stations: z.array(stationSchema) })

export function createFavoritesFile(path: string, logger?: Logger): FavoritesStore {
  return {
    async load() {
      try {
        const parsed = fileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) { logger?.warn({ path }, 'radio favorites file is unreadable, starting empty'); return [] }
        return parsed.data.stations
      } catch { return [] }
    },
    async save(stations) {
      await writeFileAtomic(path, JSON.stringify({ stations }, null, 2))
    },
  }
}

export function memoryFavorites(initial: Station[] = []): FavoritesStore {
  let stations = [...initial]
  return {
    async load() { return [...stations] },
    async save(next) { stations = [...next] },
  }
}
