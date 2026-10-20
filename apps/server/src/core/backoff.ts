export interface BackoffOptions {
  initialMs?: number
  maxMs?: number
  factor?: number
  /** Relative jitter ±jitter (0.2 → ±20 %). */
  jitter?: number
  rng?: () => number
}

export interface Backoff {
  /** Next delay (ms), and advances the sequence. */
  next(): number
  reset(): void
  readonly attempts: number
}

/** Bounded exponential delays with jitter: 1 s, 2 s, 4 s … maxMs. */
export function createBackoff(opts: BackoffOptions = {}): Backoff {
  const initial = opts.initialMs ?? 1000, max = opts.maxMs ?? 60_000, factor = opts.factor ?? 2, jitter = opts.jitter ?? 0.2
  const rng = opts.rng ?? Math.random
  let attempts = 0
  return {
    get attempts() { return attempts },
    next() {
      const base = Math.min(max, initial * Math.pow(factor, attempts))
      attempts++
      const j = jitter > 0 ? 1 + (rng() * 2 - 1) * jitter : 1
      return Math.round(base * j)
    },
    reset() { attempts = 0 },
  }
}
