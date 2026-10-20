import type { Tween } from './tween'

// ON-DEMAND rendering: the loop only runs if something moves (damped controls, tween,
// marker animation). On a tablet, that is the difference between 0 % and 30 % CPU at rest.
//
// With a nuance that matters as much as the rule. A DECORATIVE animation — the wave of a player that
// is playing (period 5.75 s), the breathing of a charging battery (2.6 s) — was enough to keep the
// loop running permanently, at the screen's refresh rate. A house where a speaker was playing thus redrew
// EVERYTHING (two passes, ~280 draw calls, the effect chain, forty labels moved)
// sixty times per second, for a ring that advances a fraction of a pixel per frame. And this
// permanent load added up with everything else: the browser's compositing queue never
// really emptied.
//
// These animations therefore run at `ANIMATION_HZ`, not at the screen's refresh rate. Everything that comes from a
// GESTURE — an orbit, a camera flight, an explicit request through `invalidate` — keeps the full
// rate: that is where the eye sees stutter, not on a five-second wave.

export interface Animation {
  step(now: number, dtS: number): boolean
  /**
   * This animation's OWN rate, in frames per second (default `ANIMATION_HZ`). Rippling water
   * makes do with 10 Hz where a downpour needs 20. The fastest of the running animations
   * sets the tempo — one redrawn frame serves them all.
   */
  readonly hz?: number
}

export interface RenderLoopOptions {
  /**
   * `interactive`: this frame follows a GESTURE (orbit, camera flight, explicit request) and not the
   * mere wake-up of a decorative animation. Only those chain at the screen's refresh rate,
   * so only those say something about the time spent OUTSIDE drawing.
   */
  render(interactive: boolean): void
  /** Returns true if the controls moved again (damping). */
  updateControls(): boolean
  requestFrame?: (cb: (now: number) => void) => number
  cancelFrame?: (h: number) => void
  now?: () => number
}

export interface RenderLoop {
  invalidate(): void
  addTween(t: Tween): void
  addAnimation(a: Animation): () => void
  readonly running: boolean
  readonly animationCount: number
  setPaused(paused: boolean): void
  dispose(): void
}

/** Default rate of the decorative animations, in frames per second. A 5.75 s wave is smooth at it. */
const ANIMATION_HZ = 20

export function createRenderLoop(opts: RenderLoopOptions): RenderLoop {
  const raf = opts.requestFrame ?? ((cb) => requestAnimationFrame(cb))
  const caf = opts.cancelFrame ?? ((h) => cancelAnimationFrame(h))
  const now = opts.now ?? (() => performance.now())
  const tweens = new Set<Tween>()
  const animations = new Set<Animation>()
  let handle: number | null = null
  let dirty = false
  let paused = false
  let disposed = false
  let lastAnimation = now()

  const frame = () => {
    handle = null
    if (disposed || paused) return
    const t = now()
    // `moving` says whether to CONTINUE after this frame; `dirty` only says that this one is
    // requested. Mixing them up would make the loop run forever after a simple `invalidate`.
    let moving = false
    // A tween that ENDS on this frame has just set its final state (a pill hidden, a level
    // set down): the frame must be drawn. Without this, a decorative animation not yet due made
    // the drawing get skipped — the pill stayed displayed, full, until the decor's next tick.
    let finished = false
    for (const tw of tweens) { if (tw.step(t)) moving = true; else { tweens.delete(tw); finished = true } }
    if (opts.updateControls()) moving = true
    const interactive = moving || dirty || finished

    // Nothing but decor to animate, and not yet time: hand back without redrawing anything.
    let hz = 0
    for (const a of animations) hz = Math.max(hz, a.hz ?? ANIMATION_HZ)
    const due = hz > 0 && t - lastAnimation >= 1000 / hz
    if (!interactive && animations.size > 0 && !due) { schedule(); return }

    if (animations.size > 0) {
      const dtS = Math.min(0.1, (t - lastAnimation) / 1000)   // clamped: a long pause does not make a jump
      lastAnimation = t
      for (const a of animations) { if (!a.step(t, dtS)) animations.delete(a) }
    }
    opts.render(interactive)
    dirty = false
    if (moving || animations.size > 0) schedule()
  }
  const schedule = () => { if (handle === null && !disposed && !paused) handle = raf(frame) }

  return {
    get running() { return handle !== null },
    get animationCount() { return animations.size },
    invalidate() { dirty = true; schedule() },
    addTween(t) { tweens.add(t); schedule() },
    addAnimation(a) { animations.add(a); schedule(); return () => animations.delete(a) },
    setPaused(p) { paused = p; if (!p && (dirty || tweens.size || animations.size)) { lastAnimation = now(); schedule() } },
    dispose() { disposed = true; if (handle !== null) caf(handle); tweens.clear(); animations.clear() },
  }
}
