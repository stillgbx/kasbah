import { hsvToRgb, rgbToHex } from '@kasbah/shared'

// Colours that go together, by the classic rules of the colour wheel: picked from a random base hue
// for the "random" button of the hand-picked light palette. Always full value and high saturation:
// a light shows colour, a dull tint just looks dim.

export const HARMONIES = ['analogous', 'complementary', 'splitComplementary', 'triadic', 'tetradic', 'monochromatic'] as const
export type Harmony = (typeof HARMONIES)[number]

/** Hue offsets (°) from the base, in the order they are used. */
const OFFSETS: Record<Exclude<Harmony, 'analogous'>, readonly number[]> = {
  complementary: [0, 180],
  splitComplementary: [0, 150, 210],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
  monochromatic: [0],
}
/** Step between two neighbours of an analogous palette (°). */
const ANALOGOUS_STEP = 30

const wrap = (h: number) => ((h % 360) + 360) % 360

/**
 * `count` colours (2..5) following `method` from `baseHue`. When the rule has fewer hues than
 * colours asked for, the next round takes the same hues paler and slightly turned, so no two
 * colours are the same. Analogous spreads its neighbours evenly around the base.
 */
export function harmonyColors(method: Harmony, baseHue: number, count: number): string[] {
  const n = Math.min(5, Math.max(2, Math.round(count)))
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    let h: number
    let s: number
    if (method === 'analogous') {
      h = baseHue + (i - (n - 1) / 2) * ANALOGOUS_STEP
      s = 0.9
    } else if (method === 'monochromatic') {
      h = baseHue
      s = 1 - (i * 0.5) / (n - 1)          // from full colour down to a pastel of the same hue
    } else {
      const offsets = OFFSETS[method]
      const round = Math.floor(i / offsets.length)
      h = baseHue + offsets[i % offsets.length]! + round * 12
      s = round === 0 ? 0.92 : 0.6
    }
    out.push(rgbToHex(hsvToRgb({ h: wrap(h), s, v: 1 })))
  }
  return out
}

/** A random rule (never `avoid`, the one shown just before) on a random base hue. */
export function randomHarmony(count: number, avoid?: Harmony, rand: () => number = Math.random): { method: Harmony; colors: string[] } {
  const choices = HARMONIES.filter((m) => m !== avoid)
  const method = choices[Math.floor(rand() * choices.length) % choices.length]!
  return { method, colors: harmonyColors(method, rand() * 360, count) }
}
