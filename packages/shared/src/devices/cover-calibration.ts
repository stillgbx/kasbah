import { z } from 'zod'

// Calibration of a shutter: what the motor's percentage really covers.
//
// A motor measures its TRAVEL between its two end stops, not the share of the window it hides. Over
// that travel, three things happen: the apron leaves the box without covering anything yet (dead
// zone at the top), then it goes down with its slats hanging apart (light passes between them), and
// once the last slat rests on the sill the rest of the travel only presses the slats together until
// the gaps close. Add a roller whose diameter shrinks as the apron unrolls, and "50 %" of the motor
// rarely hides half the window.
//
// The calibration is a few points measured by eye: "at this motor position, the window is this
// open". Both values on the contract's scale (0 = closed, 100 = open). Two points are mandatory:
//  - `position: 100`: the bottom of the apron at the top of the glass (above it, nothing is covered);
//  - `position: 0`: the apron resting on the sill, slats still apart (the window is covered, light
//    still passes between the slats).
// Points in between (25, 50, 75) absorb the curve of the roller. Between two points: a straight line.
//
// Below the sill point, the window is entirely covered and the slats are pressing together: the
// position stays 0 and `sealed` says whether the gaps are closed. `cover.close` goes to the motor's
// end stop (sealed), `cover.set_position 0` stops on the sill point (gaps open).

const pct = z.number().min(0).max(100)

export const calibrationPointSchema = z.object({
  /** Real opening of the window at this point (0 = covered, 100 = clear). */
  position: pct,
  /** The motor's own position at this point, same scale. */
  motor: pct,
})
export type CalibrationPoint = z.infer<typeof calibrationPointSchema>

/** Sorted by position, from 0 (sill) to 100 (top of the glass), the motor rising strictly with it. */
export const coverCalibrationSchema = z.array(calibrationPointSchema).min(2).max(11).superRefine((points, ctx) => {
  if (points[0]!.position !== 0) ctx.addIssue({ code: 'custom', message: 'the first point must be position 0 (apron on the sill)' })
  if (points[points.length - 1]!.position !== 100) ctx.addIssue({ code: 'custom', message: 'the last point must be position 100 (top of the glass)' })
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.position <= points[i - 1]!.position || points[i]!.motor <= points[i - 1]!.motor) {
      ctx.addIssue({ code: 'custom', message: 'positions and motor values must both rise strictly' })
      return
    }
  }
})
export type CoverCalibration = z.infer<typeof coverCalibrationSchema>

/** Straight line between the two points that frame `x` (`xs` strictly rising). */
function lerp(x: number, xs: readonly number[], ys: readonly number[]): number {
  let i = 1
  while (i < xs.length - 1 && x > xs[i]!) i++
  const x0 = xs[i - 1]!, x1 = xs[i]!, y0 = ys[i - 1]!, y1 = ys[i]!
  return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0)
}

/**
 * Real position → motor position to send. 100 goes to the motor's top end stop and not to the "top of
 * the glass" point: above it the apron is in its box, and "open" means fully up.
 */
export function calibratedToMotor(cal: CoverCalibration, position: number): number {
  if (position >= 100) return 100
  return Math.round(lerp(Math.max(0, position), cal.map((p) => p.position), cal.map((p) => p.motor)))
}

/**
 * Motor position (reported by the device) → real position, and whether the slats are pressed
 * together. `sealed`: the motor is past the sill point, closer to its bottom end stop than to that
 * point — what a "close" leaves, and not what a "position 0" leaves.
 *
 * `requested`: the real position last asked for. The motor only takes whole percentages, so 75 % sent
 * as motor 68 would read back as 76 %; when the motor stands exactly where that request sent it, the
 * request is what is published.
 */
export function motorToCalibrated(cal: CoverCalibration, motor: number, requested?: number): { position: number; sealed: boolean } {
  const sill = cal[0]!.motor
  const top = cal[cal.length - 1]!.motor
  const sealed = motor <= sill / 2
  if (requested !== undefined && calibratedToMotor(cal, requested) === motor) return { position: requested, sealed }
  if (motor <= sill) return { position: 0, sealed }
  if (motor >= top) return { position: 100, sealed }
  return { position: Math.round(lerp(motor, cal.map((p) => p.motor), cal.map((p) => p.position))), sealed }
}
