// "Tap" and hover detection on top of pointer events, alongside OrbitControls
// (which does not stop propagation). A tap = a short press without dragging.

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

function toTapEvent(el: HTMLElement, e: PointerEvent): TapEvent {
  return { ndc: toNdc(el, e.clientX, e.clientY), pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY }
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
    if (ok) opts.onTap(toTapEvent(el, e))
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

// Dragging an object ("move a device" mode). A press only starts a drag if
// `hitTest` accepts it; otherwise it follows its normal course (orbit, tap). The tap detector also sees
// the final pointerup: `DragDetector.active()` lets it ignore that false tap.

export interface DragDetectorOptions {
  hitTest(ev: TapEvent): boolean
  onStart(ev: TapEvent): void
  onMove(ev: TapEvent): void
  onEnd(ev: TapEvent, moved: boolean): void
}

export interface DragDetector {
  detach(): void
  /** True during the drag and right after it ends (the final pointerup is still being dispatched). */
  active(): boolean
}

const AFTER_END_MS = 150

export function createDragDetector(el: HTMLElement, opts: DragDetectorOptions): DragDetector {
  let id: number | null = null
  let moved = false
  let endedAt = -Infinity

  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary || id !== null) return
    const ev = toTapEvent(el, e)
    if (!opts.hitTest(ev)) return
    id = e.pointerId
    moved = false
    try { el.setPointerCapture(e.pointerId) } catch { /* pointer already released */ }
    opts.onStart(ev)
  }
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== id) return
    moved = true
    opts.onMove(toTapEvent(el, e))
  }
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== id) return
    id = null
    endedAt = performance.now()
    opts.onEnd(toTapEvent(el, e), moved)
  }

  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)
  return {
    detach() {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    },
    active: () => id !== null || performance.now() - endedAt < AFTER_END_MS,
  }
}
