import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { Logger } from 'pino'
import { stationSchema, type Station } from './directory'

// Les radios favorites de la MAISON (pas du navigateur) : la station entière est gardée, pour que la
// liste s'affiche et se lance même quand l'annuaire ne répond pas.

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
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify({ stations }, null, 2), 'utf8')
      await rename(tmp, path)
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
