import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../../core/atomic-file'

// What the plugin keeps between two starts: the request count of the current WINDOW. The vendor's
// developer portal (read on 2026-09-16) caps each application key at **21 000 requests per
// seven-day window**, aligned on the application's creation ("Resets at 2026-09-23 17:00" for an
// application created on the 16th at 5 pm) — and not 10 000 per month as the third-party
// documentation said. It only counts calls to the Automower Connect API: tokens requested from the
// authentication server are not in it (33 on their side, 35 on ours before this fix). Without
// memory, the gauge would start from zero on every restart.

/** An application key's quota per window, as the developer portal displays it. */
export const WINDOW_REQUESTS = 21_000
/** The vendor's window: seven days, sliding in whole steps from its anchor. */
export const WINDOW_MS = 7 * 86_400_000

export const usageSchema = z.object({
  /** Start of the current window (ms epoch). */
  windowStart: z.number().int(),
  requests: z.number().int().min(0),
  /** The reset instant realigned on the portal (`POST /usage`), kept to align the following windows. */
  anchor: z.number().int().optional(),
})
export type AutomowerUsage = z.infer<typeof usageSchema>

export interface UsageStore {
  load(): Promise<AutomowerUsage | null>
  save(u: AutomowerUsage): Promise<void>
}

/**
 * The start of the window containing `now`, on the seven-day grid anchored on `anchor` — a known
 * reset instant (past or future, no matter: the grid is periodic).
 */
export function windowStartOf(anchor: number, now: number): number {
  return anchor + Math.floor((now - anchor) / WINDOW_MS) * WINDOW_MS
}

/**
 * The count of the CURRENT window. Anchor: the configured instant (`AUTOMOWER_QUOTA_RESET_AT`) if
 * there is one, otherwise the start of the already known window, otherwise now — the first
 * request, which comes shortly after the application's creation. An elapsed window restarts from
 * zero on the same grid.
 */
export function currentUsage(saved: AutomowerUsage | null, now: number, anchor?: number): AutomowerUsage {
  const kept = anchor ?? saved?.anchor
  const start = windowStartOf(kept ?? saved?.windowStart ?? now, now)
  if (saved && saved.windowStart === start) return saved
  return { windowStart: start, requests: 0, ...(kept === undefined ? {} : { anchor: kept }) }
}

/** Atomic write (temporary file then rename); an unreadable read counts as "nothing". */
export function createUsageFile(path: string, logger?: Logger): UsageStore {
  return {
    async load() {
      try {
        const parsed = usageSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) { logger?.warn({ path }, 'Automower usage file is unreadable (or from an older version), starting over'); return null }
        return parsed.data
      } catch { return null }
    },
    async save(u) {
      try { await writeFileAtomic(path, JSON.stringify(u, null, 2)) }
      catch (err) { logger?.warn({ err, path }, 'could not write the Automower usage file') }
    },
  }
}
