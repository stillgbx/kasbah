import { readFile } from 'node:fs/promises'
import type { StatePatch } from '@kasbah/shared'
import { VEHICLE_FINISHES, releaseNoteSchema } from '@kasbah/shared'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../../core/atomic-file'

// What the Tesla plugin keeps between two startups, and which is neither a secret nor a token:
//
//  1. The LAST STATE of each vehicle. Without it, a server restart starts again from an empty card
//     ("Never read", 0 %) until the next reading — which may take hours, until the car wakes up
//     on its own. These are the last known values: they were already displayed as such (`readAt`
//     dates them), nothing is invented.
//
//  2. The PAINT (`vehicle_config`): color and finish read from a full reading. Missing from the
//     vehicle list, it would disappear on restart if the car is asleep — and the 3D scene would
//     fall back on the theme color until the next wake-up.
//
//  3. The billing cycle's USAGE. Tesla offers $10 per month per account, and counts in CALENDAR
//     months ("Billing cycles are monthly, starting on the first day",
//     developer.tesla.com/docs/fleet-api/billing-and-limits). So the counter must survive a
//     restart, otherwise the gauge starts again from zero and no longer means anything.

/** Fleet API unit prices, in dollars (recorded on 2026-09-13, rates in force since 2025-01-01). */
export const PRICE_USD = {
  /** Data read: $1 per 500 (`vehicle_data`; the vehicle LIST, for its part, costs nothing). */
  data: 1 / 500,
  /** Wake-up: $1 per 50. Ten times the price of a read, hence the explicit action in the UI. */
  wake: 1 / 50,
  /** Command: $1 per 1000. */
  command: 1 / 1000,
} as const
export type BillableKind = keyof typeof PRICE_USD

/** Credit offered by Tesla, per account and per month: the quota the user wants not to exceed. */
export const MONTHLY_CREDIT_USD = 10

/**
 * What a call COSTS, based on its path. `null` = nothing to count.
 *
 * **The vehicle LIST (`GET /api/1/vehicles`) costs nothing**: the documentation doesn't publish its
 * pricing category, but the vendor's console settled it on 2026-09-14 — it recorded 3 "Data"
 * requests per day where the plugin made 144 just by listing. Only the full read, the wake-up and
 * the commands are billed. A read's path starts with the list's: it's `vehicle_data` that must be
 * recognized, not the prefix.
 */
export function billableKind(path: string): BillableKind | null {
  if (path.includes('/wake_up')) return 'wake'
  if (path.includes('/command/')) return 'command'
  // RELEASE NOTES cost nothing: the vendor's console settled it on 2026-10-02 — five
  // `release_notes` calls alone, then one full read: "Data" only went up by 1
  if (path.includes('/vehicle_data')) return 'data'
  return null
}

/**
 * Start of the cycle, in milliseconds: the **1st of the month at 00:00 UTC**. The vendor's console
 * says so unambiguously ("billing cycles start on the 1st of each month"): the account linking
 * date counts for nothing, and displaying it would suggest a rolling cycle. DERIVED from the month,
 * never stored — a field that is recomputed can't lie after a restart.
 */
export function cycleStart(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)
}

/** Calendar month of a date, in UTC (`2026-09`): the billing cycle key. */
export function cycleKey(now: number): string {
  const d = new Date(now)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export const cycleSchema = z.object({
  /** Month of the cycle (`2026-09`). A different month = we start again from zero. */
  month: z.string(),
  data: z.number().min(0).default(0),
  wakes: z.number().min(0).default(0),
  commands: z.number().min(0).default(0),
})
export type Cycle = z.infer<typeof cycleSchema>

export const vehiclePaintSchema = z.object({
  color: z.string().optional(),
  finish: z.enum(VEHICLE_FINISHES).optional(),
})
export type VehiclePaint = z.infer<typeof vehiclePaintSchema>

const notesVersionSchema = z.object({ version: z.string(), notes: z.array(releaseNoteSchema) })

/**
 * A vehicle's release notes, as we read them. They only change with a version: re-read when `key`
 * (installed version, pending version) no longer matches, or when their illustrations — signed
 * URLs — approach their expiry (`expiresAt`).
 *
 * `history` GROWS as updates come: Tesla only returns the versions since the last major update,
 * Kasbah keeps the previous ones. Their illustrations end up expiring; the text, for its part,
 * remains.
 */
export const releaseNotesCacheSchema = z.object({
  key: z.string(),
  fetchedAt: z.number(),
  expiresAt: z.number().optional(),
  installedVersion: z.string().optional(),
  pending: notesVersionSchema.optional(),
  history: z.record(z.string(), z.array(releaseNoteSchema)).default({}),
  /** Tesla returned the SAME texts as in English for this language: it doesn't publish it, we serve English. */
  ignored: z.boolean().optional(),
})
export type ReleaseNotesCache = z.infer<typeof releaseNotesCacheSchema>

export const teslaStateSchema = z.object({
  cycle: cycleSchema.optional(),
  /**
   * Last known state per VIN. Deliberately LENIENT schema (`z.unknown()` per key): the device
   * contract may gain fields, and a file written by a previous version must not make startup fail.
   * The registry validates what we emit to it anyway.
   */
  vehicles: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  /** Paint per VIN: survives restart when the car is asleep (not in the Fleet list). */
  paints: z.record(z.string(), vehiclePaintSchema).default({}),
  /**
   * Release notes per VIN, then per language (`en`, `fr`…): see `releaseNotesCacheSchema`. A cache
   * of another shape is FORGOTTEN, never blocking (`catch`): it's only content we re-read. Without
   * this, a file written by a previous version was rejected IN FULL, the month's counter included
   * (seen on 2026-10-02: the whole of October 1 lost).
   */
  releaseNotes: z.record(z.string(), z.record(z.string(), releaseNotesCacheSchema)).default({}).catch({}),
  /**
   * Languages in which the notes were REQUESTED (English, the fallback, is always read as well):
   * the server doesn't know the app's language, it learns the ones it's asked for.
   */
  releaseNotesLangs: z.array(z.string()).default([]).catch([]),
})
export type TeslaState = z.infer<typeof teslaStateSchema>

export const emptyState = (): TeslaState => ({ vehicles: {}, paints: {}, releaseNotes: {}, releaseNotesLangs: [] })

/** The current cycle, reset if the month changed. Mutates nothing: returns the cycle to use. */
export function currentCycle(state: TeslaState, now: number): Cycle {
  const month = cycleKey(now)
  if (state.cycle?.month === month) return state.cycle
  return { month, data: 0, wakes: 0, commands: 0 }
}

/** Counts a billable call in the current cycle (rolling it over if the month changed). */
export function countCall(state: TeslaState, kind: BillableKind, now: number): Cycle {
  const cycle = { ...currentCycle(state, now) }
  if (kind === 'data') cycle.data += 1
  else if (kind === 'wake') cycle.wakes += 1
  else cycle.commands += 1
  state.cycle = cycle
  return cycle
}

/** Estimated spend of the cycle, in dollars. An ESTIMATE: only the vendor bills. */
export function cycleCostUsd(cycle: Cycle | undefined): number {
  if (!cycle) return 0
  const usd = cycle.data * PRICE_USD.data + cycle.wakes * PRICE_USD.wake + cycle.commands * PRICE_USD.command
  return Math.round(usd * 1000) / 1000
}

export interface TeslaStateStore {
  load(): Promise<TeslaState | null>
  save(state: TeslaState): Promise<void>
}

/**
 * Atomic JSON file (`.tmp` then `rename`). Missing or unreadable file = empty state, never a fatal
 * error: the plugin must start even if the disk refuses — it will read the car again, that's all.
 */
export function createStateFile(path: string, logger?: Logger): TeslaStateStore {
  return {
    async load() {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return null }
      const parsed = teslaStateSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger?.warn({ path }, 'unreadable Tesla state cache, starting fresh'); return null }
      return parsed.data
    },
    async save(state) {
      // `persist()` doesn't wait: the `writeFileAtomic` queue separates two close writes
      try { await writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`) }
      catch (err) { logger?.warn({ err, path }, 'could not write Tesla state cache') }
    },
  }
}

/** A vehicle's state patch as we keep it (the contract validates it on emission). */
export type StoredVehicleState = StatePatch<'vehicle'>
