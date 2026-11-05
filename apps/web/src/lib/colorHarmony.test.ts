import { describe, expect, it } from 'vitest'
import { hexToRgb, rgbToHsv } from '@kasbah/shared'
import { HARMONIES, harmonyColors, randomHarmony } from './colorHarmony'

const hsv = (hex: string) => rgbToHsv(hexToRgb(hex))
const hueGap = (a: string, b: string) => { const d = Math.abs(hsv(a).h - hsv(b).h) % 360; return Math.min(d, 360 - d) }

describe('harmonyColors', () => {
  it('gives as many colours as asked, between 2 and 5, all bright and all different', () => {
    for (const method of HARMONIES) {
      for (const count of [2, 3, 4, 5]) {
        const colors = harmonyColors(method, 200, count)
        expect(colors).toHaveLength(count)
        expect(new Set(colors).size).toBe(count)
        for (const c of colors) expect(hsv(c).v).toBeGreaterThan(0.99)
      }
    }
    expect(harmonyColors('triadic', 0, 9)).toHaveLength(5)
    expect(harmonyColors('triadic', 0, 1)).toHaveLength(2)
  })

  it('follows the rules of the wheel', () => {
    const [a, b] = harmonyColors('complementary', 30, 2)
    expect(hueGap(a!, b!)).toBeCloseTo(180, -1)
    const tri = harmonyColors('triadic', 10, 3)
    expect(hueGap(tri[0]!, tri[1]!)).toBeCloseTo(120, -1)
    expect(hueGap(tri[0]!, tri[2]!)).toBeCloseTo(120, -1)
    const split = harmonyColors('splitComplementary', 60, 3)
    expect(hueGap(split[0]!, split[1]!)).toBeCloseTo(150, -1)
    expect(hueGap(split[0]!, split[2]!)).toBeCloseTo(150, -1)
    const square = harmonyColors('tetradic', 0, 4)
    expect(hueGap(square[0]!, square[1]!)).toBeCloseTo(90, -1)
    expect(hueGap(square[0]!, square[2]!)).toBeCloseTo(180, -1)
  })

  it('keeps an analogous palette close around the base, and a monochromatic one on a single hue', () => {
    const near = harmonyColors('analogous', 180, 5)
    for (const c of near) expect(hueGap(c, '#00ffff')).toBeLessThanOrEqual(61)
    const mono = harmonyColors('monochromatic', 300, 4)
    for (const c of mono) expect(hueGap(c, mono[0]!)).toBeLessThan(3)
    expect(hsv(mono[3]!).s).toBeLessThan(hsv(mono[0]!).s)
  })

  it('a second round of a short rule is paler, so 4 complementary colours are 2 hues in 2 strengths', () => {
    const c = harmonyColors('complementary', 0, 4)
    expect(hsv(c[2]!).s).toBeLessThan(hsv(c[0]!).s)
  })
})

describe('randomHarmony', () => {
  it('never repeats the rule shown just before', () => {
    let previous = randomHarmony(3).method
    for (let i = 0; i < 50; i++) {
      const next = randomHarmony(3, previous).method
      expect(next).not.toBe(previous)
      previous = next
    }
  })
})
