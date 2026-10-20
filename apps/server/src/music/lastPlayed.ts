import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Logger } from 'pino'
import { REPEAT_MODES } from './queue'
import { writeFileAtomic } from '../core/atomic-file'

// The last listening of each player: its queue, the track it was at, the position reached.
// Sessions and queues live in memory — a server restart loses them, and the speaker keeps a dead
// URL. This file lets the bar show the interrupted track, paused at its position, and restart it
// from there (`POST /api/music/resume`). Written as `.tmp` + rename.

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
      } catch { /* no file yet */ }
      return {}
    },
    async save(all) {
      await writeFileAtomic(path, JSON.stringify(all, null, 2))
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
