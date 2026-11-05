import { describe, expect, it } from 'vitest'
import { calibratedToMotor, coverCalibrationSchema, motorToCalibrated, type CoverCalibration } from './cover-calibration'
import { commandSchema } from './command'

// Invented shutter: rests on the sill at motor 12, half covered at motor 40, clears the glass at motor 85.
const cal: CoverCalibration = [{ position: 0, motor: 12 }, { position: 50, motor: 40 }, { position: 100, motor: 85 }]

describe('cover calibration', () => {
  it('sends the measured motor value for each measured point', () => {
    expect(calibratedToMotor(cal, 0)).toBe(12)
    expect(calibratedToMotor(cal, 50)).toBe(40)
  })

  it('draws a straight line between two points', () => {
    expect(calibratedToMotor(cal, 25)).toBe(26)
    expect(calibratedToMotor(cal, 75)).toBe(63)
  })

  it('sends "open" to the top end stop, not to the top of the glass', () => {
    expect(calibratedToMotor(cal, 100)).toBe(100)
  })

  it('reads a measured motor value back as its real position', () => {
    expect(motorToCalibrated(cal, 40)).toEqual({ position: 50, sealed: false })
    expect(motorToCalibrated(cal, 26)).toEqual({ position: 25, sealed: false })
  })

  it('publishes the requested position when the motor stands where the request sent it', () => {
    // 75 % → motor 63 (62.5 rounded), which reads back as 76 % without the request
    expect(motorToCalibrated(cal, 63).position).toBe(76)
    expect(motorToCalibrated(cal, 63, 75).position).toBe(75)
    // stopped elsewhere: the request no longer says anything
    expect(motorToCalibrated(cal, 60, 75).position).toBe(72)
  })

  it('reads the dead zone at the top as fully open', () => {
    expect(motorToCalibrated(cal, 85).position).toBe(100)
    expect(motorToCalibrated(cal, 100).position).toBe(100)
  })

  it('tells the sill point (gaps open) from the bottom end stop (sealed)', () => {
    expect(motorToCalibrated(cal, 12)).toEqual({ position: 0, sealed: false })
    expect(motorToCalibrated(cal, 0)).toEqual({ position: 0, sealed: true })
    expect(motorToCalibrated(cal, 7)).toEqual({ position: 0, sealed: false })
    expect(motorToCalibrated(cal, 6)).toEqual({ position: 0, sealed: true })
  })

  it('treats a shutter whose sill point is the end stop as sealed when closed', () => {
    const flat: CoverCalibration = [{ position: 0, motor: 0 }, { position: 100, motor: 90 }]
    expect(motorToCalibrated(flat, 0)).toEqual({ position: 0, sealed: true })
  })

  it('demands the sill and top points, both rising', () => {
    expect(coverCalibrationSchema.safeParse(cal).success).toBe(true)
    expect(coverCalibrationSchema.safeParse([{ position: 0, motor: 12 }, { position: 50, motor: 40 }]).success).toBe(false)
    expect(coverCalibrationSchema.safeParse([{ position: 50, motor: 40 }, { position: 100, motor: 85 }]).success).toBe(false)
    expect(coverCalibrationSchema.safeParse([{ position: 0, motor: 50 }, { position: 50, motor: 40 }, { position: 100, motor: 85 }]).success).toBe(false)
  })

  it('accepts the command, with or without points', () => {
    expect(commandSchema.safeParse({ type: 'cover.set_calibration', points: cal }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'cover.set_calibration', points: null }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'cover.set_position', position: 30, motor: true }).success).toBe(true)
  })
})
