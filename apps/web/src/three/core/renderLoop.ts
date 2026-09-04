import type { Tween } from './tween'

// Rendu À LA DEMANDE : la boucle ne tourne que si quelque chose bouge (contrôles amortis, tween,
// animation de marqueur). Sur tablette, c'est la différence entre 0 % et 30 % de CPU au repos.

export interface Animation { step(now: number, dtS: number): boolean }

export interface RenderLoopOptions {
  render(): void
  /** Retourne true si les contrôles ont encore bougé (amortissement). */
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
  let last = now()

  const frame = () => {
    handle = null
    if (disposed || paused) return
    const t = now()
    const dtS = Math.min(0.1, (t - last) / 1000)
    last = t
    let busy = false
    for (const tw of tweens) { if (tw.step(t)) busy = true; else tweens.delete(tw) }
    for (const a of animations) { if (a.step(t, dtS)) busy = true; else animations.delete(a) }
    if (opts.updateControls()) busy = true
    opts.render()
    dirty = false
    if (busy) schedule()
  }
  const schedule = () => { if (handle === null && !disposed && !paused) handle = raf(frame) }

  return {
    get running() { return handle !== null },
    get animationCount() { return animations.size },
    invalidate() { dirty = true; schedule() },
    addTween(t) { tweens.add(t); schedule() },
    addAnimation(a) { animations.add(a); schedule(); return () => animations.delete(a) },
    setPaused(p) { paused = p; if (!p && (dirty || tweens.size || animations.size)) { last = now(); schedule() } },
    dispose() { disposed = true; if (handle !== null) caf(handle); tweens.clear(); animations.clear() },
  }
}
