// La lune vue d'ici : phase, part éclairée, lever et coucher. Calcul PUR, comme `sun.ts` du paquet
// partagé — Open-Meteo ne donne rien sur la lune. Formules « basse précision » (celles de SunCalc,
// d'après Meeus) : la position à environ un degré, soit quelques minutes sur un lever ; la phase à
// quelques heures près. Largement assez pour une carte météo.

const RAD = Math.PI / 180
const OBLIQUITY = 23.4397 * RAD
const DAY_MS = 86_400_000
/** Mois synodique moyen, en jours : d'une nouvelle lune à la suivante. */
const SYNODIC_DAYS = 29.530589
/** Hauteur géocentrique du centre au lever et au coucher : parallaxe (~0,95°) moins réfraction et demi-disque. */
const MOON_HORIZON_DEG = 0.125

/** Jours (fractionnaires) écoulés depuis J2000.0. */
const days = (ms: number) => ms / DAY_MS + 2_440_587.5 - 2_451_545.0

interface Equatorial { ra: number; dec: number; distKm: number }

function eclipticToEquatorial(l: number, b: number, distKm: number): Equatorial {
  return {
    ra: Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l)),
    dec: Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l)),
    distKm,
  }
}

function sunCoords(d: number): Equatorial {
  const m = (357.5291 + 0.98560028 * d) * RAD
  const c = (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)) * RAD
  return eclipticToEquatorial(m + c + 102.9372 * RAD + Math.PI, 0, 149_598_000)
}

function moonCoords(d: number): Equatorial {
  const l = (218.316 + 13.176396 * d) * RAD // longitude moyenne
  const m = (134.963 + 13.064993 * d) * RAD // anomalie moyenne
  const f = (93.272 + 13.22935 * d) * RAD // argument de latitude
  return eclipticToEquatorial(l + 6.289 * Math.sin(m) * RAD, 5.128 * Math.sin(f) * RAD, 385_001 - 20_905 * Math.cos(m))
}

/** Hauteur géocentrique de la lune au-dessus de l'horizon, en degrés. */
export function moonAltitude(ms: number, lat: number, lon: number): number {
  const d = days(ms)
  const c = moonCoords(d)
  const h = (280.16 + 360.9856235 * d) * RAD + lon * RAD - c.ra // angle horaire
  const phi = lat * RAD
  return Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(h)) / RAD
}

export interface MoonIllumination {
  /** Part éclairée du disque, 0 à 1. */
  fraction: number
  /** Âge dans le cycle, 0 à 1 : 0 nouvelle lune, 0,25 premier quartier, 0,5 pleine, 0,75 dernier quartier. */
  phase: number
}

export function moonIllumination(ms: number): MoonIllumination {
  const d = days(ms)
  const s = sunCoords(d)
  const m = moonCoords(d)
  const elong = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra))
  const inc = Math.atan2(s.distKm * Math.sin(elong), m.distKm - s.distKm * Math.cos(elong))
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra))
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI }
}

export const MOON_PHASES = ['new', 'waxingCrescent', 'firstQuarter', 'waxingGibbous', 'full', 'waningGibbous', 'lastQuarter', 'waningCrescent'] as const
export type MoonPhaseName = (typeof MOON_PHASES)[number]

/** Nom de la phase : les quatre phases principales valent un jour de part et d'autre de leur instant. */
export function moonPhaseName(phase: number): MoonPhaseName {
  const tol = 1 / SYNODIC_DAYS
  const near = (target: number) => Math.abs(((phase - target + 1.5) % 1) - 0.5) < tol
  if (near(0)) return 'new'
  if (near(0.25)) return 'firstQuarter'
  if (near(0.5)) return 'full'
  if (near(0.75)) return 'lastQuarter'
  return phase < 0.25 ? 'waxingCrescent' : phase < 0.5 ? 'waxingGibbous' : phase < 0.75 ? 'waningGibbous' : 'waningCrescent'
}

/** Prochain instant où l'âge du cycle vaut `target` (0 nouvelle, 0,5 pleine), après `fromMs`. */
export function nextPhase(fromMs: number, target: number): number {
  // écart signé à la cible, dans ]-0,5, 0,5] : il passe de négatif à positif au moment cherché
  const gap = (ms: number) => ((moonIllumination(ms).phase - target + 1.5) % 1) - 0.5
  const step = DAY_MS / 4
  let prev = fromMs
  for (let t = fromMs + step; t <= fromMs + (SYNODIC_DAYS + 1) * DAY_MS; t += step) {
    const a = gap(prev)
    const b = gap(t)
    if (a < 0 && b >= 0 && b - a < 0.5) {
      let lo = prev
      let hi = t
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2
        if (gap(mid) < 0) lo = mid
        else hi = mid
      }
      return Math.round((lo + hi) / 2)
    }
    prev = t
  }
  return fromMs + ((target - moonIllumination(fromMs).phase + 1) % 1) * SYNODIC_DAYS * DAY_MS
}

export interface MoonTimes {
  /** Prochain lever après `fromMs` (dans les 26 h), en ms epoch. */
  rise?: number
  /** Prochain coucher après `fromMs` (dans les 26 h), en ms epoch. */
  set?: number
}

/**
 * Prochains lever et coucher à partir de maintenant — pas ceux « du jour » : la lune se lève chaque
 * jour ~50 min plus tard, et un jour sur vingt-neuf n'a pas de lever. Balayage par pas de 10 min puis
 * dichotomie, comme `sunTimes`. 26 h couvrent toujours un passage de chaque sorte, sauf aux hautes
 * latitudes où la lune peut rester levée ou couchée : le passage est alors absent.
 */
export function moonTimes(fromMs: number, lat: number, lon: number): MoonTimes {
  const alt = (t: number) => moonAltitude(t, lat, lon) - MOON_HORIZON_DEG
  const out: MoonTimes = {}
  const step = 10 * 60_000
  let prevT = fromMs
  let prevA = alt(fromMs)
  for (let t = fromMs + step; t <= fromMs + 26 * 3_600_000 && (out.rise === undefined || out.set === undefined); t += step) {
    const a = alt(t)
    const rising = prevA < 0 && a >= 0
    const setting = prevA >= 0 && a < 0
    if ((rising && out.rise === undefined) || (setting && out.set === undefined)) {
      let lo = prevT
      let hi = t
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2
        if ((alt(mid) < 0) === rising) lo = mid
        else hi = mid
      }
      out[rising ? 'rise' : 'set'] = Math.round((lo + hi) / 2)
    }
    prevT = t
    prevA = a
  }
  return out
}
