import type { VehicleLease } from '@kasbah/shared'

/**
 * Where a lease stands: the mileage driven against what the allowance authorizes AS OF TODAY, pro
 * rata to the elapsed time — a multi-year allowance is not consumed all at once, and
 * it is the gap to the pace that says whether one is "on track".
 */
export interface LeaseProgress {
  /** Driven since the key handover (`odometer − startKm`). */
  drivenKm: number
  /** Authorized as of today: allowance × share of the contract elapsed. */
  allowedKm: number
  /** Share of the allowance consumed (0 → 1, beyond that, overrun). */
  usedShare: number
  /** Share of the contract elapsed (0 → 1): the pace marker on the gauge. */
  elapsedShare: number
  /** At the current pace, the lease's odometer at the due date; `null` too early to extrapolate. */
  projectedKm: number | null
  ended: boolean
}

const DAY_MS = 86_400_000
/**
 * No projection before a month: a week of vacation in the first fortnight would read
 * as 60,000 km at the due date.
 */
export const LEASE_PROJECTION_MIN_DAYS = 30

/** `YYYY-MM-DD` → midnight UTC: the computation is done in whole days, without depending on the time zone. */
const dayMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))

/** `null` without a reading: we track nothing without knowing how far the car has driven. */
export function leaseProgress(lease: VehicleLease, odometerKm: number | undefined, nowMs: number): LeaseProgress | null {
  if (odometerKm === undefined) return null
  const start = dayMs(lease.start)
  const span = dayMs(lease.end) - start
  const elapsedMs = Math.min(Math.max(nowMs - start, 0), span)
  const elapsedShare = elapsedMs / span
  const drivenKm = Math.max(0, odometerKm - (lease.startKm ?? 0))
  const allowedKm = Math.round(lease.km * elapsedShare)
  return {
    drivenKm,
    allowedKm,
    usedShare: drivenKm / lease.km,
    elapsedShare,
    projectedKm: elapsedMs >= LEASE_PROJECTION_MIN_DAYS * DAY_MS ? Math.round(drivenKm / elapsedShare) : null,
    ended: nowMs >= start + span,
  }
}

/**
 * The contract's anniversaries (start + 1 year, + 2 years…) strictly before the due date: `share` as a
 * share of the contract — on the gauge, it is also the share of the allowance authorized at that date — and `km`
 * what it authorizes.
 */
export function leaseYearMarks(lease: VehicleLease): { share: number; date: string; km: number }[] {
  const start = dayMs(lease.start)
  const span = dayMs(lease.end) - start
  const [y, m, d] = [Number(lease.start.slice(0, 4)), Number(lease.start.slice(5, 7)) - 1, Number(lease.start.slice(8, 10))]
  const out: { share: number; date: string; km: number }[] = []
  for (let n = 1; ; n++) {
    const at = Date.UTC(y + n, m, d)
    if (at - start >= span) return out
    const share = (at - start) / span
    out.push({ share, date: new Date(at).toISOString().slice(0, 10), km: Math.round(lease.km * share) })
  }
}

/** Ahead of the allowance: more kilometers than the pro rata authorizes. */
export const leaseOverPace = (p: LeaseProgress) => p.drivenKm > p.allowedKm
