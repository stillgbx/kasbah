import type { TuyaDps } from '../types'

/**
 * Frames CAPTURED on the CREATE Windcalm (2026-09-21), anonymized.
 * The quirks are deliberate: `dp 64` at 239 and not 240 (4 h timer).
 *
 * Don't "fix" these values to match a spec — the test must replay reality.
 */

/** Full state on connection (`issueRefreshOnConnect: true`). */
export const CONNECT_FULL: TuyaDps = {
  '20': true,
  '23': 500,
  '60': false,
  '62': 3,
  '63': 'forward',
  '64': 0,
  '66': true,
}

/** Delta: light switched off from the RF remote. */
export const DELTA_LIGHT_OFF: TuyaDps = { '20': false }

/** Delta: temperature 2700 K (DP 1000) — measured: warm white / yellow. */
export const DELTA_TEMP_2700: TuyaDps = { '23': 1000 }

/** Delta: temperature 4000 K (DP 0) — measured: cool white. */
export const DELTA_TEMP_4000: TuyaDps = { '23': 0 }

/** Delta: fan on, speed 4. */
export const DELTA_FAN_SPEED_4: TuyaDps = { '60': true, '62': 4 }

/** Delta: reverse direction. */
export const DELTA_FAN_REVERSE: TuyaDps = { '63': 'reverse' }

/** Delta: 4 h timer — 239 minutes remaining, NOT 240. */
export const DELTA_TIMER_4H: TuyaDps = { '64': 239 }

/** Delta: beep re-enabled. */
export const DELTA_MUTE_OFF: TuyaDps = { '66': false }

/** Delta: fan off — the timer goes back to 0 (pitfall 6). */
export const DELTA_FAN_OFF_CLEARS_TIMER: TuyaDps = { '60': false, '64': 0 }
