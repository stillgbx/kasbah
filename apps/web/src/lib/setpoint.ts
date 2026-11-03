// Setpoint arithmetic shared by the heating card and the 3D panel.
//
// The keys move by HALF-DEGREES on the grid of degrees and half-degrees: from 19.8, "+" gives 20.0
// and "−" 19.5, never 20.3. A finer value is TYPED (tap on the figure) — twenty clicks for two
// degrees was the alternative (the user's choice of 2026-11-03). Both keep to what the device holds
// (`meta.climate.stepC`): a MELCloud controller only keeps half-degrees.

const KEY_STEP_C = 0.5
/** Below a hundredth of a degree, two setpoints are the same one: 20 / 0.1 is not 200 in floating point. */
const EPS = 1e-6

const tenth = (v: number): number => Math.round(v * 10) / 10
const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, v))

/** The next setpoint on the key grid, upwards (`dir` 1) or downwards (-1). */
export function stepSetpoint(value: number, dir: 1 | -1, bounds: readonly [number, number], stepC = 0.1): number {
  const unit = Math.max(KEY_STEP_C, stepC)
  const n = dir > 0 ? Math.floor(value / unit + EPS) + 1 : Math.ceil(value / unit - EPS) - 1
  return tenth(clamp(n * unit, bounds))
}

/**
 * A typed setpoint, comma or point ("19,8", "19.8"), rounded to the device's step and kept within
 * its range. `null` when the text is not a number: the edit is then dropped, nothing is sent.
 */
export function typedSetpoint(text: string, bounds: readonly [number, number], stepC = 0.1): number | null {
  const v = Number(text.trim().replace(',', '.'))
  if (text.trim() === '' || !Number.isFinite(v)) return null
  return tenth(clamp(Math.round(v / stepC) * stepC, bounds))
}
