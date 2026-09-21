import type { TuyaDps } from '../types'

/**
 * Trames CAPTURÉES sur le CREATE Windcalm (2026-09-21), anonymisées.
 * Les bizarreries sont volontaires : `dp 64` à 239 et non 240 (minuterie 4 h).
 *
 * Ne pas « corriger » ces valeurs pour coller à une spec — le test doit rejouer le réel.
 */

/** État complet à la connexion (`issueRefreshOnConnect: true`). */
export const CONNECT_FULL: TuyaDps = {
  '20': true,
  '23': 500,
  '60': false,
  '62': 3,
  '63': 'forward',
  '64': 0,
  '66': true,
}

/** Delta : lumière éteinte depuis la télécommande RF. */
export const DELTA_LIGHT_OFF: TuyaDps = { '20': false }

/** Delta : température 2700 K (DP 1000) — mesuré : blanc chaud / jaune. */
export const DELTA_TEMP_2700: TuyaDps = { '23': 1000 }

/** Delta : température 4000 K (DP 0) — mesuré : blanc froid. */
export const DELTA_TEMP_4000: TuyaDps = { '23': 0 }

/** Delta : ventilateur allumé, vitesse 4. */
export const DELTA_FAN_SPEED_4: TuyaDps = { '60': true, '62': 4 }

/** Delta : sens reverse. */
export const DELTA_FAN_REVERSE: TuyaDps = { '63': 'reverse' }

/** Delta : minuterie 4 h — 239 minutes restantes, PAS 240. */
export const DELTA_TIMER_4H: TuyaDps = { '64': 239 }

/** Delta : bip réactivé. */
export const DELTA_MUTE_OFF: TuyaDps = { '66': false }

/** Delta : ventilateur éteint — la minuterie repasse à 0 (piège 6). */
export const DELTA_FAN_OFF_CLEARS_TIMER: TuyaDps = { '60': false, '64': 0 }
