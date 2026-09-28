import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { Logger } from 'pino'
import { REPEAT_MODES } from './queue'

// La dernière écoute de chaque lecteur : sa file, la piste où elle en était, la position atteinte.
// Les sessions et les files vivent en mémoire — un redémarrage du serveur les perd, et l'enceinte
// garde une URL morte. Ce fichier permet à la barre de montrer le titre interrompu, en pause à sa
// position, et de le relancer de là (`POST /api/music/resume`). Écrit en `.tmp` + rename.

const trackSchema = z.object({
  source: z.string(),
  id: z.string(),
  title: z.string().optional(),
  artist: z.string().optional(),
  artUrl: z.string().optional(),
  durationS: z.number().positive().optional(),
  explicit: z.boolean().optional(),
})
const entrySchema = z.object({
  items: z.array(trackSchema).min(1),
  index: z.number().int().min(0),
  repeat: z.enum(REPEAT_MODES),
  positionS: z.number().min(0),
  durationS: z.number().positive().nullable(),
  at: z.number(),
}).refine((e) => e.index < e.items.length)
const fileSchema = z.record(z.string(), entrySchema)
export type LastPlayed = z.infer<typeof entrySchema>
export type LastPlayedByDevice = z.infer<typeof fileSchema>

export interface LastPlayedStore {
  load(): Promise<LastPlayedByDevice>
  save(all: LastPlayedByDevice): Promise<void>
}

export function createLastPlayedFile(path: string, logger?: Logger): LastPlayedStore {
  return {
    async load() {
      try {
        const parsed = fileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (parsed.success) return parsed.data
        logger?.warn({ path }, 'music state file is unreadable, starting empty')
      } catch { /* pas encore de fichier */ }
      return {}
    },
    async save(all) {
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8')
      await rename(tmp, path)
    },
  }
}

export function memoryLastPlayed(initial: LastPlayedByDevice = {}): LastPlayedStore {
  let all = structuredClone(initial)
  return {
    async load() { return structuredClone(all) },
    async save(next) { all = structuredClone(next) },
  }
}
