import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Logger } from 'pino'
import { writeFileAtomic } from '../../core/atomic-file'

// The TouteMonAnnée plugin's state, in `.state/` (outside the repo, mode 0600): the session cookies
// — they are as good as access to the account —, the filters chosen in the School view, the "done"
// checkboxes the site does not carry, and the last post seen. Never the password.

export const tmaStateSchema = z.object({
  account: z.object({ username: z.string() }).nullable().default(null),
  cookies: z.record(z.string(), z.string()).default({}),
  filters: z.object({
    hiddenJournals: z.array(z.string()).default([]),
    hiddenLevels: z.array(z.string()).default([]),
  }).default({ hiddenJournals: [], hiddenLevels: [] }),
  /** Homework checked "done" in Kasbah, when the teacher has not opened the site's checkbox. */
  done: z.array(z.number()).default([]),
  /** Id of the most recent post seen: beyond it, posts are "new". */
  postsSeen: z.number().default(0),
})
export type TmaState = z.infer<typeof tmaStateSchema>

export interface TmaStore {
  load(): Promise<TmaState>
  save(state: TmaState): Promise<void>
}

export const emptyTmaState = (): TmaState => tmaStateSchema.parse({})

export function createTmaFile(path: string, logger?: Logger): TmaStore {
  return {
    async load() {
      try {
        const parsed = tmaStateSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) { logger?.warn({ path }, 'toutemonannee state file is unreadable, starting empty'); return emptyTmaState() }
        return parsed.data
      } catch { return emptyTmaState() }
    },
    async save(state) {
      await writeFileAtomic(path, JSON.stringify(state, null, 2), { mode: 0o600 })
    },
  }
}

export function memoryTmaStore(initial: Partial<TmaState> = {}): TmaStore {
  let state = tmaStateSchema.parse(initial)
  return {
    async load() { return structuredClone(state) },
    async save(next) { state = structuredClone(next) },
  }
}
