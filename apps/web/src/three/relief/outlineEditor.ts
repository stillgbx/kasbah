import { BufferAttribute, BufferGeometry, Color, Line, LineBasicMaterial, Plane, Points, PointsMaterial, Raycaster, Vector2, Vector3, type Camera, type CanvasTexture, type Object3D } from 'three'
import { isSimplePolygon, type Vec2 } from '@kasbah/shared'
import { createDragDetector, type DragDetector, type TapEvent } from '../core/input'
import { dotTexture, ringTexture } from './reliefEditor'

// Éditeur du CONTOUR du terrain (onglet « Contour » de « Modeler le terrain ») : un point par sommet
// du polygone, et une poignée plus petite au milieu de chaque côté.
//
// Même règle que le relief : CHOISIR, puis glisser. Un tap choisit un sommet ; un tap sur une poignée
// de milieu y AJOUTE un sommet, déjà choisi, qu'on glisse ensuite. Seul le sommet choisi se glisse ;
// un glissement qui part ailleurs fait orbiter la caméra. Le sommet glisse À PLAT, sur le plan
// horizontal de sa hauteur, arrondi à `OUTLINE_SNAP_M`.
//
// Un contour qui se croiserait est REFUSÉ au fil du geste : le sommet reste à sa dernière place
// valide. Chaque modification (geste, saisie, ajout, retrait) s'annule et se rétablit.
//
// Le polygone vit ici tant qu'on édite ; c'est la scène qui le pose sur le terrain (`changed`) et le
// panneau qui l'enregistre.

export interface OutlineEditorHost {
  canvas: HTMLCanvasElement
  camera: Camera
  /** Groupe en repère MAISON qui porte les poignées (le site). */
  parent: Object3D
  /** Hauteur absolue du terrain dessiné en (x, y) : les poignées et le trait s'y posent. */
  ground(x: number, y: number): number
  setControls(enabled: boolean): void
  invalidate(): void
  /** Le contour a bougé ; `final` à la fin du geste (un glissement en envoie un par image avant). */
  changed(final: boolean): void
  /** Le sommet choisi a changé (ou l'historique) : le panneau se remet à jour. */
  selectionChanged(): void
  accent: Color
}

/** Pas d'accroche d'un glissement (m). */
export const OUTLINE_SNAP_M = 0.1
/** Pas d'annulation retenus. */
export const OUTLINE_HISTORY = 20
const HANDLE_LIFT = 0.08
const HIT_PX = { mouse: 14, touch: 26 }
const DEAD_PX = 6
/** Le trait suit le relief : un point tous les `LINE_STEP_M` le long de chaque côté. */
const LINE_STEP_M = 1

const snap = (v: number) => Math.round(v / OUTLINE_SNAP_M) * OUTLINE_SNAP_M
const clone = (p: readonly Vec2[]): Vec2[] => p.map(([x, y]) => [x, y])

/** Ce qu'une poignée désigne : un sommet, ou le milieu du côté `k` → `k + 1`. */
type Hit = { vertex: number } | { edge: number }

export class OutlineEditor {
  polygon: Vec2[]
  /** Indice du sommet choisi. */
  selected: number | null = null
  /** Dernier choix fait au tap, et avec quoi (souris, stylet, doigt) : le panneau y donne la main au champ. */
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
    // gris, hors tone mapping et SOUS le seuil du bloom (comme les points du relief) : blancs, ils bavaient en halos la nuit
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

  /** Vrai pendant un glissement et juste après : le tap de fin n'en est pas un. */
  active(): boolean { return this.drag?.active() ?? false }

  /** Montre (ou cache) les poignées : l'onglet Relief garde l'éditeur, sans qu'il réponde. */
  setEnabled(on: boolean): void {
    this.enabled = on
    for (const o of [this.vertices, this.mids, this.line]) o.visible = on
    this.mark.visible = on && this.selected !== null
    this.host.invalidate()
  }

  /** Position du sommet choisi, `null` sans choix. */
  selectedXY(): Vec2 | null {
    return this.selected === null ? null : [this.polygon[this.selected]![0], this.polygon[this.selected]![1]]
  }

  /** Déplace le sommet choisi (saisie) ; faux sans choix, sans changement, ou si le contour se croiserait. */
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

  /** Un sommet de plus peut-il partir : il en reste au moins trois, et le contour ne se croise pas. */
  get canRemove(): boolean {
    const k = this.selected
    if (k === null || this.polygon.length <= 3) return false
    return isSimplePolygon(this.polygon.filter((_, i) => i !== k))
  }

  /** Retire le sommet choisi ; le suivant est choisi à sa place (on retire en série). */
  removeSelected(): boolean {
    const k = this.selected
    if (k === null || !this.canRemove) return false
    this.record(clone(this.polygon))
    this.polygon = this.polygon.filter((_, i) => i !== k)
    this.selected = k % this.polygon.length
    this.refresh()
    return true
  }

  /** Ajoute un sommet au milieu du côté `edge` → `edge + 1`, et le choisit. */
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

  /** Retient l'état d'AVANT une modification ; une nouvelle modification efface ce qu'on pouvait rétablir. */
  private record(before: Vec2[]): void {
    this.undoStack.push(before)
    if (this.undoStack.length > OUTLINE_HISTORY) this.undoStack.shift()
    this.redoStack = []
  }

  /** Un tap : choisit le sommet sous le doigt, ajoute un sommet sur une poignée de milieu, ou ne choisit plus rien. */
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

  /** Reposent sommets, milieux, trait et anneau sur le terrain dessiné. */
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

  /** La poignée la plus proche du doigt, à quelques pixels près ; un sommet l'emporte sur un milieu. */
  private nearest(ev: TapEvent): Hit | null {
    const r = this.host.canvas.getBoundingClientRect()
    const limit = ev.pointerType === 'mouse' ? HIT_PX.mouse : HIT_PX.touch
    const v = new Vector3()
    const closest = (pts: Points): { k: number; d: number } | null => {
      const pos = pts.geometry.getAttribute('position') as BufferAttribute | undefined
      let best: { k: number; d: number } | null = null
      for (let k = 0; k < (pos?.count ?? 0); k++) {
        this.screenOf(pos!.getX(k), pos!.getY(k), pos!.getZ(k), v)
        if (v.z > 1) continue                                 // derrière la caméra
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

  /** Le doigt en repère maison, sur le plan horizontal du geste. */
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
    // plan horizontal du MONDE (y vers le haut) à la hauteur du sommet ; écart doigt–sommet conservé
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
    if (!isSimplePolygon(next)) return                     // le sommet reste à sa dernière place valide
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
