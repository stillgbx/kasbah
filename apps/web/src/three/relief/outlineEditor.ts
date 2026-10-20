import { BufferAttribute, BufferGeometry, Color, Line, LineBasicMaterial, Plane, Points, PointsMaterial, Raycaster, Vector2, Vector3, type Camera, type CanvasTexture, type Object3D } from 'three'
import { isSimplePolygon, type Vec2 } from '@kasbah/shared'
import { createDragDetector, type DragDetector, type TapEvent } from '../core/input'
import { dotTexture, ringTexture } from './reliefEditor'

// Editor of the terrain OUTLINE ("Outline" tab of "Shape the terrain"): a dot per vertex
// of the polygon, and a smaller handle in the middle of each side.
//
// Same rule as the relief: SELECT, then drag. A tap selects a vertex; a tap on a middle
// handle ADDS a vertex there, already selected, which is then dragged. Only the selected vertex can be dragged;
// a drag that starts elsewhere orbits the camera. The vertex slides FLAT, on the horizontal
// plane of its height, rounded to `OUTLINE_SNAP_M`.
//
// An outline that would cross itself is REFUSED as the gesture goes: the vertex stays at its last valid
// place. Every change (gesture, entry, addition, removal) can be undone and redone.
//
// The polygon lives here while editing; it is the scene that lays it on the terrain (`changed`) and the
// panel that saves it.

export interface OutlineEditorHost {
  canvas: HTMLCanvasElement
  camera: Camera
  /** Group in the HOUSE reference frame that carries the handles (the site). */
  parent: Object3D
  /** Absolute height of the drawn terrain at (x, y): the handles and the stroke sit on it. */
  ground(x: number, y: number): number
  setControls(enabled: boolean): void
  invalidate(): void
  /** The outline moved; `final` at the end of the gesture (a drag sends one per frame before). */
  changed(final: boolean): void
  /** The selected vertex changed (or the history): the panel updates. */
  selectionChanged(): void
  accent: Color
}

/** Snap step of a drag (m). */
export const OUTLINE_SNAP_M = 0.1
/** Undo steps kept. */
export const OUTLINE_HISTORY = 20
const HANDLE_LIFT = 0.08
const HIT_PX = { mouse: 14, touch: 26 }
const DEAD_PX = 6
/** The stroke follows the relief: a point every `LINE_STEP_M` along each side. */
const LINE_STEP_M = 1

const snap = (v: number) => Math.round(v / OUTLINE_SNAP_M) * OUTLINE_SNAP_M
const clone = (p: readonly Vec2[]): Vec2[] => p.map(([x, y]) => [x, y])

/** What a handle designates: a vertex, or the middle of side `k` → `k + 1`. */
type Hit = { vertex: number } | { edge: number }

export class OutlineEditor {
  polygon: Vec2[]
  /** Index of the selected vertex. */
  selected: number | null = null
  /** Last selection made by tap, and with what (mouse, pen, finger): the panel hands over to the field accordingly. */
  pick = { seq: 0, by: '' }
  private enabled = true
  private readonly vertices: Points
  private readonly mids: Points
  private readonly mark: Points
  private readonly line: Line
  private readonly map: CanvasTexture | null
  private drag: DragDetector | null = null
  private gesture: { k: number; before: Vec2[]; plane: Plane; offset: Vector3; startX: number; startY: number; moved: boolean } | null = null
  private readonly raycaster = new Raycaster()
  private undoStack: Vec2[][] = []
  private redoStack: Vec2[][] = []

  constructor(private readonly host: OutlineEditorHost, polygon: readonly Vec2[], headless: boolean) {
    this.polygon = clone(polygon)
    this.map = dotTexture()
    const points = (name: string, size: number, color: Color, order: number) => {
      const p = new Points(new BufferGeometry(), new PointsMaterial({ size, sizeAttenuation: false, color, transparent: true, alphaTest: 0.02, depthTest: false, depthWrite: false, toneMapped: false, ...(this.map ? { map: this.map } : {}) }))
      p.name = name
      p.renderOrder = order
      host.parent.add(p)
      return p
    }
    // gray, outside tone mapping and BELOW the bloom threshold (like the relief dots): white, they bled into halos at night
    this.vertices = points('outline:vertices', 14, new Color(0.62, 0.62, 0.62), 6)
    this.mids = points('outline:mids', 9, new Color(0.42, 0.43, 0.46), 6)
    this.line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: host.accent, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false }))
    this.line.name = 'outline:line'
    this.line.renderOrder = 5
    host.parent.add(this.line)
    const ring = ringTexture(host.accent)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
    this.mark = new Points(g, new PointsMaterial({ size: 24, sizeAttenuation: false, transparent: true, alphaTest: 0.3, depthTest: false, depthWrite: false, toneMapped: false, ...(ring ? { map: ring } : { color: host.accent }) }))
    this.mark.name = 'outline:selected'
    this.mark.renderOrder = 7
    host.parent.add(this.mark)
    this.refresh()
    if (!headless) {
      this.drag = createDragDetector(host.canvas, {
        hitTest: (ev) => { const h = this.enabled ? this.nearest(ev) : null; return !!h && 'vertex' in h && h.vertex === this.selected },
        onStart: (ev) => this.start(ev),
        onMove: (ev) => this.move(ev),
        onEnd: () => this.end(),
      })
    }
  }

  /** True during a drag and right after: the closing tap is not one. */
  active(): boolean { return this.drag?.active() ?? false }

  /** Shows (or hides) the handles: the Relief tab keeps the editor, without it responding. */
  setEnabled(on: boolean): void {
    this.enabled = on
    for (const o of [this.vertices, this.mids, this.line]) o.visible = on
    this.mark.visible = on && this.selected !== null
    this.host.invalidate()
  }

  /** Position of the selected vertex, `null` without a selection. */
  selectedXY(): Vec2 | null {
    return this.selected === null ? null : [this.polygon[this.selected]![0], this.polygon[this.selected]![1]]
  }

  /** Moves the selected vertex (entry); false without a selection, without a change, or if the outline would cross itself. */
  setSelectedXY(xy: Vec2): boolean {
    const k = this.selected
    if (k === null) return false
    const p: Vec2 = [snap(xy[0]), snap(xy[1])]
    const cur = this.polygon[k]!
    if (p[0] === cur[0] && p[1] === cur[1]) return false
    const next = clone(this.polygon)
    next[k] = p
    if (!isSimplePolygon(next)) return false
    this.record(clone(this.polygon))
    this.polygon = next
    this.refresh()
    return true
  }

  /** Whether one more vertex can go: at least three remain, and the outline does not cross itself. */
  get canRemove(): boolean {
    const k = this.selected
    if (k === null || this.polygon.length <= 3) return false
    return isSimplePolygon(this.polygon.filter((_, i) => i !== k))
  }

  /** Removes the selected vertex; the next one is selected in its place (removal in series). */
  removeSelected(): boolean {
    const k = this.selected
    if (k === null || !this.canRemove) return false
    this.record(clone(this.polygon))
    this.polygon = this.polygon.filter((_, i) => i !== k)
    this.selected = k % this.polygon.length
    this.refresh()
    return true
  }

  /** New outline (cadastre import): one history step, no selected vertex anymore. */
  setPolygon(polygon: readonly Vec2[]): void {
    this.record(clone(this.polygon))
    this.polygon = clone(polygon)
    this.selected = null
    this.refresh()
  }

  /** Adds a vertex in the middle of side `edge` → `edge + 1`, and selects it. */
  insertOnEdge(edge: number): void {
    const n = this.polygon.length
    const a = this.polygon[edge]!, b = this.polygon[(edge + 1) % n]!
    this.record(clone(this.polygon))
    this.polygon.splice(edge + 1, 0, [snap((a[0] + b[0]) / 2), snap((a[1] + b[1]) / 2)])
    this.selected = edge + 1
    this.refresh()
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  undo(): boolean { return this.travel(this.undoStack, this.redoStack) }
  redo(): boolean { return this.travel(this.redoStack, this.undoStack) }

  private travel(from: Vec2[][], to: Vec2[][]): boolean {
    const p = from.pop()
    if (!p) return false
    to.push(clone(this.polygon))
    this.polygon = p
    if (this.selected !== null && this.selected >= p.length) this.selected = null
    this.refresh()
    return true
  }

  /** Records the state BEFORE a change; a new change clears what could have been redone. */
  private record(before: Vec2[]): void {
    this.undoStack.push(before)
    if (this.undoStack.length > OUTLINE_HISTORY) this.undoStack.shift()
    this.redoStack = []
  }

  /** A tap: selects the vertex under the finger, adds a vertex on a middle handle, or selects nothing anymore. */
  tap(ev: TapEvent): void {
    const h = this.nearest(ev)
    this.pick = { seq: this.pick.seq + 1, by: ev.pointerType }
    if (h && 'edge' in h) {
      this.insertOnEdge(h.edge)
      this.host.changed(true)
      return
    }
    this.selected = h ? h.vertex : null
    this.refresh()
    this.host.selectionChanged()
  }

  /** Lays vertices, midpoints, stroke and ring back on the drawn terrain. */
  refresh(): void {
    const p = this.polygon, n = p.length
    const z = (x: number, y: number) => this.host.ground(x, y) + HANDLE_LIFT
    const put = (pts: Points, xyz: number[]) => {
      pts.geometry.dispose()
      pts.geometry = new BufferGeometry()
      pts.geometry.setAttribute('position', new BufferAttribute(new Float32Array(xyz), 3))
      pts.geometry.computeBoundingSphere()
    }
    put(this.vertices, p.flatMap(([x, y]) => [x, y, z(x, y)]))
    put(this.mids, p.flatMap(([x, y], k) => {
      const [bx, by] = p[(k + 1) % n]!
      const mx = (x + bx) / 2, my = (y + by) / 2
      return [mx, my, z(mx, my)]
    }))
    const line: number[] = []
    for (let k = 0; k <= n; k++) {
      const [ax, ay] = p[k % n]!
      if (k === n) { line.push(ax, ay, z(ax, ay)); break }
      const [bx, by] = p[(k + 1) % n]!
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / LINE_STEP_M))
      for (let s = 0; s < steps; s++) {
        const x = ax + ((bx - ax) * s) / steps, y = ay + ((by - ay) * s) / steps
        line.push(x, y, z(x, y))
      }
    }
    this.line.geometry.dispose()
    this.line.geometry = new BufferGeometry()
    this.line.geometry.setAttribute('position', new BufferAttribute(new Float32Array(line), 3))
    const s = this.selected
    this.mark.visible = this.enabled && s !== null
    if (s !== null) {
      const [x, y] = p[s]!
      ;(this.mark.geometry.getAttribute('position') as BufferAttribute).setXYZ(0, x, y, z(x, y))
      this.mark.geometry.getAttribute('position').needsUpdate = true
      this.mark.geometry.computeBoundingSphere()
    }
    this.host.invalidate()
  }

  private screenOf(x: number, y: number, z: number, out = new Vector3()): Vector3 {
    this.host.parent.updateWorldMatrix(true, false)
    return out.set(x, y, z).applyMatrix4(this.host.parent.matrixWorld).project(this.host.camera)
  }

  /** The handle closest to the finger, within a few pixels; a vertex wins over a midpoint. */
  private nearest(ev: TapEvent): Hit | null {
    const r = this.host.canvas.getBoundingClientRect()
    const limit = ev.pointerType === 'mouse' ? HIT_PX.mouse : HIT_PX.touch
    const v = new Vector3()
    const closest = (pts: Points): { k: number; d: number } | null => {
      const pos = pts.geometry.getAttribute('position') as BufferAttribute | undefined
      let best: { k: number; d: number } | null = null
      for (let k = 0; k < (pos?.count ?? 0); k++) {
        this.screenOf(pos!.getX(k), pos!.getY(k), pos!.getZ(k), v)
        if (v.z > 1) continue                                 // behind the camera
        const d = Math.hypot(((v.x - ev.ndc.x) * r.width) / 2, ((v.y - ev.ndc.y) * r.height) / 2)
        if (d < limit && (!best || d < best.d)) best = { k, d }
      }
      return best
    }
    const vx = closest(this.vertices)
    if (vx) return { vertex: vx.k }
    const mid = closest(this.mids)
    return mid ? { edge: mid.k } : null
  }

  /** The finger in the house reference frame, on the gesture's horizontal plane. */
  private groundPoint(ev: TapEvent, plane: Plane): Vector3 | null {
    this.raycaster.setFromCamera(new Vector2(ev.ndc.x, ev.ndc.y), this.host.camera)
    const hit = this.raycaster.ray.intersectPlane(plane, new Vector3())
    return hit ? this.host.parent.worldToLocal(hit) : null
  }

  private start(ev: TapEvent): void {
    const k = this.selected
    if (k === null) return
    this.host.setControls(false)
    const [x, y] = this.polygon[k]!
    this.host.parent.updateWorldMatrix(true, false)
    const world = new Vector3(x, y, this.host.ground(x, y)).applyMatrix4(this.host.parent.matrixWorld)
    // horizontal WORLD plane (y up) at the vertex height; finger–vertex offset preserved
    const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), world)
    const hit = this.groundPoint(ev, plane)
    const offset = hit ? hit.sub(new Vector3(x, y, hit.z)) : new Vector3()
    offset.z = 0
    this.gesture = { k, before: clone(this.polygon), plane, offset, startX: ev.clientX, startY: ev.clientY, moved: false }
  }

  private move(ev: TapEvent): void {
    const g = this.gesture
    if (!g) return
    if (!g.moved && Math.hypot(ev.clientX - g.startX, ev.clientY - g.startY) < DEAD_PX) return
    g.moved = true
    const hit = this.groundPoint(ev, g.plane)
    if (!hit) return
    const p: Vec2 = [snap(hit.x - g.offset.x), snap(hit.y - g.offset.y)]
    const cur = this.polygon[g.k]!
    if (p[0] === cur[0] && p[1] === cur[1]) return
    const next = clone(this.polygon)
    next[g.k] = p
    if (!isSimplePolygon(next)) return                     // the vertex stays at its last valid place
    this.polygon = next
    this.refresh()
    this.host.changed(false)
  }

  private end(): void {
    const g = this.gesture
    if (!g) return
    this.gesture = null
    const moved = g.before.some(([x, y], i) => x !== this.polygon[i]![0] || y !== this.polygon[i]![1])
    if (moved) this.record(g.before)
    this.host.setControls(true)
    this.host.changed(true)
  }

  dispose(): void {
    this.drag?.detach()
    this.drag = null
    if (this.gesture) this.host.setControls(true)
    for (const o of [this.vertices, this.mids, this.mark]) {
      o.removeFromParent()
      o.geometry.dispose()
      const m = o.material as PointsMaterial
      if (o === this.mark) m.map?.dispose()
      m.dispose()
    }
    this.line.removeFromParent()
    this.line.geometry.dispose()
    ;(this.line.material as LineBasicMaterial).dispose()
    this.map?.dispose()
  }
}
