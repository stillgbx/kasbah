import { RENDER_QUALITIES, type RenderQuality } from '../three/core/post'
import type { HouseScene, ScenePrepareStage } from '../three/HouseScene'

// 3D test launched from the diagnostic page (`public/diag.html`). The app opened with `?probe=<test>`
// applies the test's switches to the scene WITHOUT touching the saved settings, then reports each
// step of the scene's startup to the server log (`POST /api/diag`) and to the diag page that frames
// it. When the browser kills the tab (memory), the last step received tells where it died; a gap
// between two beats tells how long the page was frozen.

export interface SceneProbeConfig {
  test: string
  shadows?: boolean
  /** Photo materials (`kasbah.sceneAssets`). */
  assets?: boolean
  quality?: RenderQuality
}

/** A beat every… : a gap between two of them is a freeze. */
const BEAT_MS = 2000
/** The camera turns this long once the house is shown, to measure frames that are really drawn. */
const ORBIT_MS = 20_000
const ORBIT_STEP_MS = 100
/** Whatever happens, the probe stops after this. */
const MAX_MS = 120_000

export function readSceneProbe(search: string): SceneProbeConfig | null {
  const q = new URLSearchParams(search)
  const test = q.get('probe')
  if (!test) return null
  const flag = (k: string) => (q.get(k) === '0' ? false : q.get(k) === '1' ? true : undefined)
  const config: SceneProbeConfig = { test }
  const shadows = flag('shadows'), assets = flag('assets'), quality = q.get('quality') as RenderQuality | null
  if (shadows !== undefined) config.shadows = shadows
  if (assets !== undefined) config.assets = assets
  if (quality && RENDER_QUALITIES.includes(quality)) config.quality = quality
  return config
}

/** The probe of this page, read once (`null`: no test in progress). */
export const sceneProbe: SceneProbeConfig | null = typeof location === 'undefined' ? null : readSceneProbe(location.search)

/** Starts reporting; returns the function that stops it. */
export function startSceneProbe(scene: HouseScene, canvas: HTMLCanvasElement, config: SceneProbeConfig): () => void {
  const run = Math.random().toString(36).slice(2, 8)
  const t0 = performance.now()
  const heapMo = () => {
    const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    return m ? Math.round(m.usedJSHeapSize / 1048576) : null
  }
  const send = (step: string, extra: Record<string, unknown> = {}) => {
    const probe = { run, test: config.test, step, t: Math.round(performance.now() - t0), heapMo: heapMo(), ...extra }
    const body = JSON.stringify({ probe })
    // `sendBeacon` leaves even when the page dies right after: that is the whole point here
    if (!navigator.sendBeacon?.('/api/diag', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
    }
    if (window.parent !== window) window.parent.postMessage({ kasbahProbe: probe }, location.origin)
  }

  const timers: ReturnType<typeof setInterval>[] = []
  let stopped = false
  const stop = (why: string) => {
    if (stopped) return
    stopped = true
    timers.forEach(clearInterval)
    offPrepare()
    canvas.removeEventListener('webglcontextlost', onLost)
    canvas.removeEventListener('webglcontextrestored', onRestored)
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    send('end', { why })
  }

  let stage: ScenePrepareStage | null | undefined
  let progress: { done: number; total: number } | null = null
  const offPrepare = scene.on('prepare', (next, p) => {
    if (next === stage) { progress = p; return }
    send(next ? `prepare:${next}` : 'shown', { previous: stage ?? null, progress, stats: scene.debugStats() })
    stage = next
    progress = p
    if (next === null) orbit()
  })
  const onLost = () => send('contextlost')
  const onRestored = () => send('contextrestored')
  const onError = (e: ErrorEvent) => send('error', { message: e.message })
  const onRejection = (e: PromiseRejectionEvent) => send('error', { message: String(e.reason) })
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  // the scene only draws on demand: once shown, the camera turns so that frames are really drawn
  const orbit = () => {
    const turning = setInterval(() => scene.orbitBy(0.02), ORBIT_STEP_MS)
    timers.push(turning)
    setTimeout(() => { clearInterval(turning); stop('done') }, ORBIT_MS)
  }

  send('start', { config, supported: scene.supported, window: `${innerWidth}×${innerHeight}`, dpr: devicePixelRatio })
  timers.push(setInterval(() => send('beat', { stage: stage ?? null, progress, stats: scene.debugStats() }), BEAT_MS))
  setTimeout(() => stop('timeout'), MAX_MS)
  return () => stop('unmounted')
}
