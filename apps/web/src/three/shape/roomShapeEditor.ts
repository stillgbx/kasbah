import { BufferAttribute, BufferGeometry, Color, Line, LineBasicMaterial, Plane, Points, PointsMaterial, Raycaster, Vector2, Vector3, type Camera, type CanvasTexture, type Object3D } from 'three'
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { Vec2 } from '@kasbah/shared'
import { createDragDetector, type DragDetector, type TapEvent } from '../core/input'
import { DECOR_LAYER } from '../core/layers'
import { dotTexture, ringTexture } from '../relief/reliefEditor'

// Éditeur de la FORME d'une pièce (mode édition, section « Dimensions ») : ses cotes — la ligne
// du relevé, au milieu des cloisons — avec un point par SOMMET, une poignée au milieu de chaque MUR,
// et la longueur de chaque côté.
//
// Gestes, sans « choisir d'abord » : on attrape directement une poignée. Un MUR glisse le long de sa
// normale (le geste rend le déplacement, arrondi au centimètre, depuis le début du geste) ; un
// SOMMET glisse à plat. Ailleurs, le glissement fait orbiter la caméra. L'éditeur ne calcule rien de
// la maison : il rend des intentions (`wall`, `corner`) que le store traduit en cotes — voisine
// entraînée comprise — et la scène lui renvoie la forme recalculée (`setShape`).

export type ShapeSelection = { corner: number } | { wall: number } | null

export interface RoomShapeHost {
  canvas: HTMLCanvasElement
  camera: Camera
  /** Groupe en repère du NIVEAU (z = 0 au sol fini) qui porte les poignées. */
  parent: Object3D
  /** Groupe qui porte les étiquettes de longueur. */
  labels: Object3D
  note(): CSS2DObject
  setControls(enabled: boolean): void
  invalidate(): void
  /** Mur `edge` poussé de `delta` m vers l'extérieur depuis le début du geste ; `final` à la fin. */
  wall(edge: number, delta: number, final: boolean): void
  /** Sommet `index` amené en `xy` (m, repère maison) ; `final` à la fin. */
  corner(index: number, xy: Vec2, final: boolean): void
  /** La sélection a changé (le panneau suit). */
  select(sel: ShapeSelection): void
  accent: Color
}

/** Pas d'accroche d'un glissement (m) : le centimètre, l'unité du relevé. */
export const SHAPE_SNAP_M = 0.01
const LIFT = 0.06
const NOTE_INSET_M = 0.45
const HIT_PX = { mouse: 14, touch: 26 }
const DEAD_PX = 4

const snap = (v: number) => Math.round(v / SHAPE_SNAP_M) * SHAPE_SNAP_M

export class RoomShapeEditor {
  private shape: Vec2[] = []
  selection: ShapeSelection = null
  private readonly corners: Points
  private readonly walls: Points
  private readonly mark: Points
  private readonly line: Line
  private readonly map: CanvasTexture | null
  private notes: CSS2DObject[] = []
  private drag: DragDetector | null = null
  private gesture: { sel: NonNullable<ShapeSelection>; plane: Plane; start: Vector3; normal: Vec2; origin: Vec2; startX: number; startY: number; moved: boolean; last: number | Vec2 | null } | null = null
  private readonly raycaster = new Raycaster()

  constructor(private readonly host: RoomShapeHost, headless: boolean) {
    this.map = dotTexture()
    const points = (name: string, size: number, color: Color, order: number) => {
      const p = new Points(new BufferGeometry(), new PointsMaterial({ size, sizeAttenuation: false, color, transparent: true, alphaTest: 0.02, depthTest: false, depthWrite: false, toneMapped: false, ...(this.map ? { map: this.map } : {}) }))
      p.name = name
      p.renderOrder = order
      p.layers.set(DECOR_LAYER)
      host.parent.add(p)
      return p
    }
    // gris sous le seuil du bloom, comme les poignées du terrain ; les murs un ton d'accent, plus gros
    this.corners = points('shape:corners', 13, new Color(0.62, 0.62, 0.62), 8)
    this.walls = points('shape:walls', 17, host.accent.clone().multiplyScalar(0.8), 8)
    this.line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: host.accent, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false }))
    this.line.name = 'shape:line'
    this.line.renderOrder = 7
    this.line.layers.set(DECOR_LAYER)
    host.parent.add(this.line)
    const ring = ringTexture(host.accent)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
    this.mark = new Points(g, new PointsMaterial({ size: 26, sizeAttenuation: false, transparent: true, alphaTest: 0.3, depthTest: false, depthWrite: false, toneMapped: false, ...(ring ? { map: ring } : { color: host.accent }) }))
    this.mark.name = 'shape:selected'
    this.mark.renderOrder = 9
    this.mark.layers.set(DECOR_LAYER)
    this.mark.visible = false
    host.parent.add(this.mark)
    if (!headless) {
      this.drag = createDragDetector(host.canvas, {
        hitTest: (ev) => !!this.nearest(ev),
        onStart: (ev) => this.start(ev),
        onMove: (ev) => this.move(ev),
        onEnd: () => this.end(),
      })
    }
  }

  /** Vrai pendant un glissement et juste après : le tap de fin n'en est pas un. */
  active(): boolean { return this.drag?.active() ?? false }
  /** Un geste est en cours : la forme reçue de la scène ne doit pas en effacer la sélection. */
  get dragging(): boolean { return this.gesture !== null }

  /** La forme à montrer (cotes en m, repère maison). Garde la sélection si elle existe encore. */
  setShape(shape: readonly Vec2[]): void {
    this.shape = shape.map(([x, y]) => [x, y])
    const sel = this.selection
    if (sel && (('corner' in sel ? sel.corner : sel.wall) >= this.shape.length)) this.selection = null
    this.refresh()
  }

  setSelection(sel: ShapeSelection): void {
    this.selection = sel
    this.refresh()
    this.host.select(sel)
  }

  /** Un tap sur une poignée la choisit (vrai) ; ailleurs, l'éditeur laisse le tap à la scène (faux). */
  tap(ev: TapEvent): boolean {
    const h = this.nearest(ev)
    if (!h) return false
    this.setSelection(h)
    return true
  }

  private mid(k: number): Vec2 {
    const a = this.shape[k]!, b = this.shape[(k + 1) % this.shape.length]!
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  }
  /** Normale extérieure du côté `k` (forme CCW). */
  private normal(k: number): Vec2 {
    const a = this.shape[k]!, b = this.shape[(k + 1) % this.shape.length]!
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [(b[1] - a[1]) / L, -(b[0] - a[0]) / L]
  }

  refresh(): void {
    const p = this.shape, n = p.length
    const put = (pts: Points | Line, xyz: number[]) => {
      pts.geometry.dispose()
      pts.geometry = new BufferGeometry()
      pts.geometry.setAttribute('position', new BufferAttribute(new Float32Array(xyz), 3))
      pts.geometry.computeBoundingSphere()
    }
    put(this.corners, p.flatMap(([x, y]) => [x, y, LIFT]))
    put(this.walls, p.flatMap((_, k) => [...this.mid(k), LIFT]))
    put(this.line, n ? [...p, p[0]!].flatMap(([x, y]) => [x, y, LIFT]) : [])
    // une étiquette de longueur par côté, un peu dans la pièce : la poignée du mur reste dégagée
    while (this.notes.length > n) { const o = this.notes.pop()!; o.element.remove(); o.removeFromParent() }
    while (this.notes.length < n) { const o = this.host.note(); this.host.labels.add(o); this.notes.push(o) }
    this.notes.forEach((o, k) => {
      const a = p[k]!, b = p[(k + 1) % n]!
      const [mx, my] = this.mid(k), [nx, ny] = this.normal(k)
      o.element.textContent = `${Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(2)} m`
      o.position.set(mx - nx * NOTE_INSET_M, my - ny * NOTE_INSET_M, LIFT)
      o.updateWorldMatrix(true, false)
    })
    const sel = this.selection
    this.mark.visible = !!sel && n > 0
    if (sel && n) {
      const [x, y] = 'corner' in sel ? p[sel.corner]! : this.mid(sel.wall)
      ;(this.mark.geometry.getAttribute('position') as BufferAttribute).setXYZ(0, x, y, LIFT)
      this.mark.geometry.getAttribute('position').needsUpdate = true
      this.mark.geometry.computeBoundingSphere()
    }
    this.host.invalidate()
  }

  /** La poignée la plus proche du doigt ; un sommet l'emporte sur un mur. */
  private nearest(ev: TapEvent): NonNullable<ShapeSelection> | null {
    if (!this.shape.length) return null
    const r = this.host.canvas.getBoundingClientRect()
    const limit = ev.pointerType === 'mouse' ? HIT_PX.mouse : HIT_PX.touch
    this.host.parent.updateWorldMatrix(true, false)
    const v = new Vector3()
    const closest = (pts: readonly Vec2[]) => {
      let best: { k: number; d: number } | null = null
      pts.forEach(([x, y], k) => {
        v.set(x, y, LIFT).applyMatrix4(this.host.parent.matrixWorld).project(this.host.camera)
        if (v.z > 1) return
        const d = Math.hypot(((v.x - ev.ndc.x) * r.width) / 2, ((v.y - ev.ndc.y) * r.height) / 2)
        if (d < limit && (!best || d < best.d)) best = { k, d }
      })
      return best as { k: number; d: number } | null
    }
    const c = closest(this.shape)
    if (c) return { corner: c.k }
    const w = closest(this.shape.map((_, k) => this.mid(k)))
    return w ? { wall: w.k } : null
  }

  /** Le doigt en repère du niveau, sur le plan horizontal du geste. */
  private planePoint(ev: TapEvent, plane: Plane): Vector3 | null {
    this.raycaster.setFromCamera(new Vector2(ev.ndc.x, ev.ndc.y), this.host.camera)
    const hit = this.raycaster.ray.intersectPlane(plane, new Vector3())
    return hit ? this.host.parent.worldToLocal(hit) : null
  }

  private start(ev: TapEvent): void {
    const sel = this.nearest(ev)
    if (!sel) return
    this.host.setControls(false)
    this.setSelection(sel)
    const origin: Vec2 = 'corner' in sel ? [...this.shape[sel.corner]!] : this.mid(sel.wall)
    this.host.parent.updateWorldMatrix(true, false)
    const world = new Vector3(origin[0], origin[1], LIFT).applyMatrix4(this.host.parent.matrixWorld)
    const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), world)
    const start = this.planePoint(ev, plane) ?? new Vector3(origin[0], origin[1], LIFT)
    const normal = 'wall' in sel ? this.normal(sel.wall) : [0, 0] as Vec2
    this.gesture = { sel, plane, start, normal, origin, startX: ev.clientX, startY: ev.clientY, moved: false, last: null }
  }

  private move(ev: TapEvent): void {
    const g = this.gesture
    if (!g) return
    if (!g.moved && Math.hypot(ev.clientX - g.startX, ev.clientY - g.startY) < DEAD_PX) return
    g.moved = true
    const hit = this.planePoint(ev, g.plane)
    if (!hit) return
    const dx = hit.x - g.start.x, dy = hit.y - g.start.y
    if ('wall' in g.sel) {
      const delta = snap(dx * g.normal[0] + dy * g.normal[1])
      if (delta === g.last) return
      g.last = delta
      this.host.wall(g.sel.wall, delta, false)
    } else {
      const xy: Vec2 = [snap(g.origin[0] + dx), snap(g.origin[1] + dy)]
      const last = g.last as Vec2 | null
      if (last && last[0] === xy[0] && last[1] === xy[1]) return
      g.last = xy
      this.host.corner(g.sel.corner, xy, false)
    }
  }

  private end(): void {
    const g = this.gesture
    if (!g) return
    this.gesture = null
    this.host.setControls(true)
    if (!g.moved || g.last === null) return
    if ('wall' in g.sel) this.host.wall(g.sel.wall, g.last as number, true)
    else this.host.corner(g.sel.corner, g.last as Vec2, true)
  }

  dispose(): void {
    this.drag?.detach()
    this.drag = null
    if (this.gesture) this.host.setControls(true)
    for (const o of [this.corners, this.walls, this.mark]) {
      o.removeFromParent()
      o.geometry.dispose()
      const m = o.material as PointsMaterial
      if (o === this.mark) m.map?.dispose()
      m.dispose()
    }
    this.line.removeFromParent()
    this.line.geometry.dispose()
    ;(this.line.material as LineBasicMaterial).dispose()
    for (const o of this.notes) { o.element.remove(); o.removeFromParent() }
    this.notes = []
    this.map?.dispose()
  }
}
