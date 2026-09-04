// Détection de « tap » et de survol au-dessus des pointer events, en parallèle d'OrbitControls
// (qui ne stoppe pas la propagation). Un tap = appui court sans glissement.

export interface TapEvent { ndc: { x: number; y: number }; pointerType: string; clientX: number; clientY: number }

export interface TapDetectorOptions {
  onTap(ev: TapEvent): void
  onHover?(ev: TapEvent | null): void
  maxDurationMs?: number
  maxMoveMouse?: number
  maxMoveTouch?: number
}

export function toNdc(el: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  return { x: ((clientX - r.left) / r.width) * 2 - 1, y: -(((clientY - r.top) / r.height) * 2 - 1) }
}

export function createTapDetector(el: HTMLElement, opts: TapDetectorOptions): () => void {
  const maxDuration = opts.maxDurationMs ?? 350
  let down: { x: number; y: number; t: number; id: number; type: string } | null = null
  let hoverFrame = 0
  let pending: TapEvent | null = null

  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary) { down = null; return }
    down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, type: e.pointerType }
  }
  const onUp = (e: PointerEvent) => {
    if (!down || e.pointerId !== down.id) return
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
    const limit = down.type === 'mouse' ? (opts.maxMoveMouse ?? 8) : (opts.maxMoveTouch ?? 14)
    const ok = performance.now() - down.t <= maxDuration && moved <= limit
    down = null
    if (ok) opts.onTap({ ndc: toNdc(el, e.clientX, e.clientY), pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY })
  }
  const onCancel = () => { down = null }
  const onMove = (e: PointerEvent) => {
    if (!opts.onHover || e.pointerType !== 'mouse' || e.buttons !== 0) return
    pending = { ndc: toNdc(el, e.clientX, e.clientY), pointerType: 'mouse', clientX: e.clientX, clientY: e.clientY }
    if (!hoverFrame) hoverFrame = requestAnimationFrame(() => { hoverFrame = 0; if (pending) opts.onHover!(pending) })
  }
  const onLeave = () => { pending = null; opts.onHover?.(null) }

  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onCancel)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerleave', onLeave)
  return () => {
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onCancel)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerleave', onLeave)
    if (hoverFrame) cancelAnimationFrame(hoverFrame)
  }
}
