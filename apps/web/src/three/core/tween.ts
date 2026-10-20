// Minimal interpolation (no library): a tween = a progress function called by the render loop
// until it is finished.

export type Easing = (t: number) => number
export const easeInOutCubic: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3)
export const easeInCubic: Easing = (t) => t * t * t
export const linear: Easing = (t) => t

export interface Tween {
  /** Advances to time `now` (ms); returns true while it is active. */
  step(now: number): boolean
  cancel(): void
  readonly done: boolean
}

export function createTween(opts: { durationMs: number; now: number; easing?: Easing; onUpdate: (k: number) => void; onDone?: () => void }): Tween {
  const easing = opts.easing ?? easeInOutCubic
  let done = false
  return {
    get done() { return done },
    step(now) {
      if (done) return false
      const t = Math.min(1, opts.durationMs <= 0 ? 1 : (now - opts.now) / opts.durationMs)
      opts.onUpdate(easing(t))
      if (t >= 1) { done = true; opts.onDone?.() }
      return !done
    },
    cancel() { done = true },
  }
}

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k
