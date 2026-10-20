/** mulberry32 pseudo-random generator: fast, 32 bits, reproducible by seed. */
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

/** Uniform in [min, max). */
export const uniform = (rng: Rng, min: number, max: number) => min + rng() * (max - min)

/** Gaussian approximation (sum of 3 uniforms), mean 0, standard deviation ≈ 1. */
export const gauss = (rng: Rng) => (rng() + rng() + rng() - 1.5) * 2
