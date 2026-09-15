import type { Tween } from './tween'

// Rendu À LA DEMANDE : la boucle ne tourne que si quelque chose bouge (contrôles amortis, tween,
// animation de marqueur). Sur tablette, c'est la différence entre 0 % et 30 % de CPU au repos.
//
// Avec une nuance qui compte autant que la règle. Une animation DÉCORATIVE — l'onde d'un lecteur qui
// joue (période 5,75 s), le souffle d'une batterie qui charge (2,6 s) — suffisait à faire tourner la
// boucle en permanence, à la cadence de l'écran. Une maison où une enceinte joue redessinait donc
// TOUT (deux passes, ~280 appels de dessin, la chaîne d'effets, quarante étiquettes déplacées)
// soixante fois par seconde, pour un anneau qui avance d'une fraction de pixel par image. Et ce
// chargement permanent se cumulait à tout le reste : la file de composition du navigateur ne se
// vidait jamais vraiment.
//
// Ces animations tournent donc à `ANIMATION_HZ`, pas à la cadence de l'écran. Tout ce qui vient d'un
// GESTE — une orbite, un vol de caméra, une demande explicite par `invalidate` — garde la cadence
// pleine : c'est là que l'œil voit la saccade, pas sur une onde de cinq secondes.

export interface Animation { step(now: number, dtS: number): boolean }

export interface RenderLoopOptions {
  /**
   * `interactive` : cette image suit un GESTE (orbite, vol de caméra, demande explicite) et non le
   * simple réveil d'une animation décorative. Seules celles-là s'enchaînent à la cadence de l'écran,
   * donc seules celles-là disent quelque chose du temps passé HORS du dessin.
   */
  render(interactive: boolean): void
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

/** Cadence des animations décoratives, en images par seconde. Une onde de 5,75 s y est lisse. */
const ANIMATION_HZ = 20
const ANIMATION_FRAME_MS = 1000 / ANIMATION_HZ

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
    // `moving` dit s'il faut CONTINUER après cette image ; `dirty` dit seulement que celle-ci est
    // demandée. Les confondre ferait tourner la boucle indéfiniment après un simple `invalidate`.
    let moving = false
    for (const tw of tweens) { if (tw.step(t)) moving = true; else tweens.delete(tw) }
    if (opts.updateControls()) moving = true
    const interactive = moving || dirty

    // Rien que du décor à animer, et pas encore l'heure : on rend la main sans rien redessiner.
    const due = t - lastAnimation >= ANIMATION_FRAME_MS
    if (!interactive && animations.size > 0 && !due) { schedule(); return }

    if (animations.size > 0) {
      const dtS = Math.min(0.1, (t - lastAnimation) / 1000)   // borné : une longue pause ne fait pas un bond
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
