import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { consumptionPointSchema } from '@kasbah/shared'
import { writeFileAtomic } from '../../core/atomic-file'

// What the plugin keeps between two starts: the consumption history ALREADY COMPUTED (never the
// station's raw readings, nor the cursor used to date the next delta — see `history.ts` on why that
// cursor does NOT survive a restart). Bounded by construction (48 hourly points, 62 daily — see
// `HOURLY_POINTS_MAX`/`DAILY_POINTS_MAX` in `history.ts`): about a hundred numbers, a few kilobytes.
// Atomic write via `rename`, modeled on `automower/state.ts`.

export const comapHistorySchema = z.object({
  hourly: z.array(consumptionPointSchema),
  daily: z.array(consumptionPointSchema),
})
export type ComapHistoryState = z.infer<typeof comapHistorySchema>

export const EMPTY_HISTORY: ComapHistoryState = { hourly: [], daily: [] }

export interface HistoryStore {
  load(): Promise<ComapHistoryState | null>
  save(h: ComapHistoryState): Promise<void>
}

/** Atomic write (temporary file then rename); an unreadable read counts as "nothing". */
export function createHistoryFile(path: string, logger?: Logger): HistoryStore {
  return {
    async load() {
      try {
        const parsed = comapHistorySchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) { logger?.warn({ path }, 'COMAP history file is unreadable (or from an older version), starting over'); return null }
        return parsed.data
      } catch { return null }
    },
    async save(h) {
      try { await writeFileAtomic(path, JSON.stringify(h, null, 2)) }
      catch (err) { logger?.warn({ err, path }, 'could not write the COMAP history file') }
    },
  }
}
