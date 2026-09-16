// La prévision AROME de Météo-France au pas de 15 minutes, telle qu'Open-Meteo la publie en fichiers
// `.om` sur un seau S3 ouvert (`data_spatial/<modèle>/<AAAA>/<MM>/<JJ>/<HH>00Z/<AAAA-MM-JJ>T<HHMM>.om`).
// Le rendu se fait dans le navigateur par `@openmeteo/weather-map-layer` (protocole MapLibre `om://`).
//
// On ne passe PAS par le `latest.json?time_step=…` de la bibliothèque : elle bâtit le nom du fichier
// avec des minutes à zéro (`T${HH}00.om`), donc les pas de 15 minutes s'écrasent tous sur l'heure
// pleine. On lit `latest.json` nous-mêmes (il donne le run et ses échéances) et on construit l'URL
// exacte de chaque pas. Tout ici est pur : testable sans carte.

export const AROME_DOMAIN = 'meteofrance_arome_france_hd_15min'
export const AROME_BASE = `https://openmeteo.s3.amazonaws.com/data_spatial/${AROME_DOMAIN}`
export const AROME_META_URL = `${AROME_BASE}/latest.json`
/** La variable dessinée : cumul de précipitations du pas (mm), même palette que la pluie du site d'Open-Meteo. */
export const AROME_VARIABLE = 'precipitation'

export interface AromeMeta {
  /** Le run est complet (sinon il manque des échéances). */
  completed?: boolean
  /** Heure du run (ISO). */
  reference_time: string
  /** Échéances disponibles (ISO, pas de 15 min). */
  valid_times: string[]
  variables?: string[]
}

export interface AromeFrame {
  /** Échéance (secondes epoch, comme les images RainViewer). */
  time: number
  /** URL HTTPS du fichier `.om` de ce pas. */
  url: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Chemin du fichier `.om` d'une échéance pour un run donné. */
export function aromeFileUrl(referenceTime: Date, validTime: Date): string {
  const r = referenceTime, v = validTime
  return `${AROME_BASE}/${r.getUTCFullYear()}/${pad(r.getUTCMonth() + 1)}/${pad(r.getUTCDate())}/${pad(r.getUTCHours())}00Z/`
    + `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}T${pad(v.getUTCHours())}${pad(v.getUTCMinutes())}.om`
}

/**
 * Les pas à montrer APRÈS maintenant, bornés à `horizonMin` minutes : la prévision prend la suite du
 * radar observé. Un run qui ne porte pas la variable, ou qui n'a rien au-delà de maintenant (run
 * vieux), ne donne aucun pas — le radar reste seul.
 */
export function aromeFrames(meta: AromeMeta, nowMs: number, horizonMin = 360): AromeFrame[] {
  if (meta.variables && !meta.variables.includes(AROME_VARIABLE)) return []
  const ref = new Date(meta.reference_time)
  if (Number.isNaN(ref.getTime())) return []
  const out: AromeFrame[] = []
  for (const iso of meta.valid_times) {
    const t = new Date(iso)
    const ms = t.getTime()
    if (Number.isNaN(ms) || ms <= nowMs || ms > nowMs + horizonMin * 60_000) continue
    out.push({ time: Math.floor(ms / 1000), url: aromeFileUrl(ref, t) })
  }
  return out
}

/** L'URL `om://` que MapLibre demande : le fichier, la variable, et la palette du thème. */
export function aromeSourceUrl(frame: AromeFrame, dark: boolean): string {
  return `om://${frame.url}?variable=${AROME_VARIABLE}${dark ? '&dark=true' : ''}`
}
