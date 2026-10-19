import type { VehicleLease } from '@kasbah/shared'

/**
 * Où en est une LOA : le kilométrage parcouru contre ce que le forfait autorise À CE JOUR, au
 * prorata du temps écoulé — le forfait de plusieurs années ne se consomme pas d'un coup, et
 * c'est l'écart au rythme qui dit si l'on « est dans les clous ».
 */
export interface LeaseProgress {
  /** Parcourus depuis la remise des clés (`compteur − startKm`). */
  drivenKm: number
  /** Autorisés à ce jour : forfait × part du contrat écoulée. */
  allowedKm: number
  /** Part du forfait consommée (0 → 1, au-delà en dépassement). */
  usedShare: number
  /** Part du contrat écoulée (0 → 1) : le repère du rythme sur la jauge. */
  elapsedShare: number
  /** Au rythme actuel, le compteur de la LOA à l'échéance ; `null` trop tôt pour extrapoler. */
  projectedKm: number | null
  ended: boolean
}

const DAY_MS = 86_400_000
/**
 * Pas de projection avant un mois : une semaine de vacances sur la première quinzaine se lirait
 * comme 60 000 km à l'échéance.
 */
export const LEASE_PROJECTION_MIN_DAYS = 30

/** `AAAA-MM-JJ` → minuit UTC : le calcul se fait en jours entiers, sans dépendre du fuseau. */
const dayMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))

/** `null` sans compteur lu : on ne suit rien sans savoir combien la voiture a roulé. */
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
 * Les anniversaires du contrat (début + 1 an, + 2 ans…) strictement avant l'échéance : `share` en
 * part du contrat — sur la jauge, c'est aussi la part du forfait autorisée à cette date — et `km`
 * ce qu'elle autorise.
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

/** En avance sur le forfait : plus de kilomètres que le prorata n'en autorise. */
export const leaseOverPace = (p: LeaseProgress) => p.drivenKm > p.allowedKm
