/** Générateur pseudo-aléatoire mulberry32 : rapide, 32 bits, reproductible par graine. */
export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniforme dans [min, max). */
export const uniform = (rng: Rng, min: number, max: number) => min + rng() * (max - min)

/** Approximation gaussienne (somme de 3 uniformes), moyenne 0, écart-type ≈ 1. */
export const gauss = (rng: Rng) => (rng() + rng() + rng() - 1.5) * 2
