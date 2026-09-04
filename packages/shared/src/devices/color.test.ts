import { describe, expect, it } from 'vitest'
import { hexToRgb, hsvToRgb, kelvinToMirek, mirekToKelvin, mirekToRgb, rgbToHex, rgbToHsv, rgbToXy, xyToRgb } from './color'

describe('color conversions', () => {
  it('white maps close to the D65 white point (Hue wide-gamut matrix)', () => {
    const xy = rgbToXy({ r: 1, g: 1, b: 1 })
    expect(xy.x).toBeCloseTo(0.32, 1)
    expect(xy.y).toBeCloseTo(0.33, 1)
  })
  it('xy → rgb → xy is stable for a saturated red', () => {
    const xy = rgbToXy({ r: 1, g: 0, b: 0 })
    const rgb = xyToRgb(xy.x, xy.y)
    expect(rgb.r).toBeGreaterThan(0.9)
    expect(rgb.g).toBeLessThan(0.2)
    const back = rgbToXy(rgb)
    expect(back.x).toBeCloseTo(xy.x, 1)
    expect(back.y).toBeCloseTo(xy.y, 1)
  })
  it('hsv ↔ rgb', () => {
    expect(hsvToRgb({ h: 120, s: 1, v: 1 })).toEqual({ r: 0, g: 1, b: 0 })
    const hsv = rgbToHsv({ r: 0, g: 0, b: 1 })
    expect(hsv.h).toBeCloseTo(240)
    expect(hsv.s).toBe(1)
    expect(hsv.v).toBe(1)
  })
  it('mirek ↔ kelvin', () => {
    expect(mirekToKelvin(370)).toBe(2703)
    expect(kelvinToMirek(4000)).toBe(250)
  })
  it('warm white is redder than cold white', () => {
    const warm = mirekToRgb(454), cold = mirekToRgb(153)
    expect(warm.b).toBeLessThan(cold.b)
    expect(warm.r).toBeGreaterThanOrEqual(cold.r - 1e-6)
  })
  it('hex round-trip', () => {
    expect(rgbToHex(hexToRgb('#3366cc'))).toBe('#3366cc')
    expect(hexToRgb('nope')).toEqual({ r: 1, g: 1, b: 1 })
  })
})
