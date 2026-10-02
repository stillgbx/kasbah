// Où est le soleil, vu d'ici, maintenant. Calcul PUR (aucun réseau, aucune API) : la maison est
// géoréférencée (`origin`, lat/lon — voir `doc/2_maison/2_0_format-house-json.md`)
// et l'heure vient de l'horloge. C'est ce qui permet à la scène d'avoir sa propre heure, indépendante
// du thème clair/sombre de l'application.
//
// Algorithme « low-precision » de l'Astronomical Almanac (le même que le calculateur solaire de la
// NOAA) : à quelques dixièmes de degré près sur un siècle, très largement assez pour poser une
// lumière. Ce qui compterait davantage — la réfraction près de l'horizon, l'équation du temps fine —
// se perd de toute façon dans le choix artistique du style.

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

export interface SunPosition {
  /** Hauteur au-dessus de l'horizon, en degrés. Négative la nuit. */
  altitudeDeg: number
  /** Azimut en degrés depuis le NORD, sens horaire (90 = est, 180 = sud) — la convention de la maison. */
  azimuthDeg: number
}

/** Jours (fractionnaires) écoulés depuis J2000.0, l'origine des éphémérides. */
function daysSinceJ2000(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545.0
}

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const n = daysSinceJ2000(date)

  // Position du soleil sur l'écliptique, puis sur l'équateur céleste.
  const meanLon = (280.46 + 0.9856474 * n) * RAD
  const meanAnom = (357.528 + 0.9856003 * n) * RAD
  const ecl = meanLon + (1.915 * Math.sin(meanAnom) + 0.02 * Math.sin(2 * meanAnom)) * RAD
  const obl = (23.439 - 0.0000004 * n) * RAD
  const ra = Math.atan2(Math.cos(obl) * Math.sin(ecl), Math.cos(ecl))
  const dec = Math.asin(Math.sin(obl) * Math.sin(ecl))

  // Angle horaire : de combien le ciel a tourné depuis que le soleil est passé au méridien du lieu.
  const gmstHours = 18.697375 + 24.065709824419 * n
  const lmstDeg = (gmstHours * 15 + lon) % 360
  let haDeg = lmstDeg - ra * DEG
  haDeg = ((haDeg + 180) % 360 + 360) % 360 - 180        // ramené dans [-180, 180[
  const ha = haDeg * RAD
  const phi = lat * RAD

  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha)
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)))
  // `acos` ne rend que [0, π] : il ne sait pas distinguer le matin du soir. C'est le signe de l'angle
  // horaire qui tranche — positif = l'après-midi, donc le soleil est passé à l'ouest.
  const cosAz = (Math.sin(dec) - Math.sin(phi) * sinAlt) / (Math.cos(phi) * Math.cos(alt) || 1e-9)
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz)))
  if (Math.sin(ha) > 0) az = 2 * Math.PI - az

  return { altitudeDeg: alt * DEG, azimuthDeg: ((az * DEG) % 360 + 360) % 360 }
}

/**
 * Course APPROCHÉE, quand la maison n'est pas géoréférencée : on ne sait ni où elle est ni quand le
 * soleil s'y lève, alors on prend l'heure locale du navigateur et une journée type (lever 7 h,
 * coucher 21 h, culmination à 55°). Faux de plusieurs degrés — mais la scène n'a besoin de savoir
 * qu'une chose : s'il fait jour, et de quel côté vient la lumière.
 */
export function approximateSunPosition(date: Date): SunPosition {
  const hours = date.getHours() + date.getMinutes() / 60
  const day = (hours - 7) / 14                            // 0 au lever, 1 au coucher
  const altitudeDeg = 55 * Math.sin(Math.PI * day)        // négatif hors de la plage : il fait nuit
  return { altitudeDeg, azimuthDeg: 90 + 180 * Math.min(1, Math.max(0, day)) }
}

// Heures de passage du soleil — ce qu'une automatisation attend (« 15 min avant le crépuscule »).
// Calculées sur `sunPosition` seul, sans nouvelle astronomie : balayage du jour local par pas de
// 10 min, puis dichotomie sur chaque passage. Précision de l'ordre de la seconde, bien en deçà de
// l'algorithme lui-même (quelques dixièmes de degré, soit une à deux minutes au lever).

/** Hauteur du lever et du coucher « officiels » : bord supérieur du disque, réfraction comprise. */
export const SUN_HORIZON_DEG = -0.833
/** Crépuscule CIVIL : le soleil 6° sous l'horizon — on ne lit plus dehors sans lumière. */
export const CIVIL_TWILIGHT_DEG = -6

export interface SunTimes {
  /** Aube civile (−6°), en ms epoch. */
  dawn?: number
  sunrise?: number
  sunset?: number
  /** Crépuscule civil (−6°), en ms epoch. */
  dusk?: number
}

const STEP_MS = 10 * 60_000

/**
 * Passages du soleil pendant le jour LOCAL (fuseau du process) qui contient `day`. Un passage absent
 * = il n'a pas lieu ce jour-là (jour ou nuit polaire, ou crépuscule qui ne finit pas en été au-delà
 * de ~60° de latitude).
 */
export function sunTimes(day: Date, lat: number, lon: number): SunTimes {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  const alt = (t: number) => sunPosition(new Date(t), lat, lon).altitudeDeg

  const samples: { t: number; alt: number }[] = []
  for (let t = start; t < end; t += STEP_MS) samples.push({ t, alt: alt(t) })
  samples.push({ t: end, alt: alt(end) })

  // Le midi solaire coupe le jour en deux : on MONTE avant, on DESCEND après. Sans ce partage, au-delà
  // de ~55° en été, le crépuscule de la VEILLE (passé minuit) serait pris pour celui du jour.
  const noon = samples.reduce((best, s) => (s.alt > best.alt ? s : best))

  /** Passage de `threshold`, en montée avant midi ou en descente après, affiné par dichotomie. */
  const crossing = (threshold: number, rising: boolean): number | undefined => {
    const half = rising ? samples.filter((s) => s.t <= noon.t) : samples.filter((s) => s.t >= noon.t)
    let prev = half[0]
    for (const cur of half) {
      if (prev && prev !== cur && (rising ? prev.alt < threshold && cur.alt >= threshold : prev.alt >= threshold && cur.alt < threshold)) {
        let lo = prev.t
        let hi = cur.t
        for (let k = 0; k < 25; k++) {
          const mid = (lo + hi) / 2
          if ((alt(mid) < threshold) === rising) lo = mid
          else hi = mid
        }
        return Math.round((lo + hi) / 2)
      }
      prev = cur
    }
    return undefined
  }

  return {
    dawn: crossing(CIVIL_TWILIGHT_DEG, true),
    sunrise: crossing(SUN_HORIZON_DEG, true),
    sunset: crossing(SUN_HORIZON_DEG, false),
    dusk: crossing(CIVIL_TWILIGHT_DEG, false),
  }
}
