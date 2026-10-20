import { BufferAttribute, BufferGeometry, CanvasTexture, Color, Material, Points, PointsMaterial, SRGBColorSpace, Vector3, type Camera, type Object3D, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three'
import { footprintCeiling, padWeight, pointInPolygon, reliefNodeXY, reliefSurface, type ReliefGrid, type TerrainDescriptor } from '@kasbah/shared'
import { createDragDetector, type DragDetector, type TapEvent } from '../core/input'

// Editor of the RELIEF (Settings → 3D rendering → "Shape the terrain"): a dot per grid node,
// pulled up or down with the finger. A dot moves ALONE — its neighbors do not follow: one
// shapes node by node, and the smooth surface does the rest. The drag is VERTICAL ON SCREEN,
// converted to meters at the dot's depth: a centimeter of finger is worth more relief seen from
// afar than up close, as one would expect.
//
// The nodes UNDER the house have their dot too: they shape the surroundings (a bank that comes
// to touch a wall) without piercing the floors, the terrain being clipped under each floor. Their dot is
// at the height of the NODE, not of the clipped terrain, and is drawn through the walls, paler.
//
// SELECT, then drag: a tap selects a dot (or, in empty space, deselects all); only
// the selected dot can be dragged. A drag that starts elsewhere — even on another dot — orbits
// the camera: without that, a dot got moved every time one wanted to turn around.
//
// Every change (gesture, entry, import) can be undone and redone, over `RELIEF_HISTORY` steps.
//
// The grid lives here while editing; it is the scene that lays it on the terrain (`changed`) and the
// panel that saves it.

export interface ReliefEditorHost {
  canvas: HTMLCanvasElement
  camera: Camera
  /** Group in the HOUSE reference frame that carries the handles (the site). */
  parent: Object3D
  /** The terrain as drawn, draft included: it places the handles. */
  terrain(): TerrainDescriptor
  setControls(enabled: boolean): void
  invalidate(): void
  /** The grid moved; `final` at the end of the gesture (a drag sends one per frame before). */
  changed(final: boolean): void
  /** The selected dot changed (or the history): the panel updates, nothing of the terrain to redraw. */
  selectionChanged(): void
  accent: Color
}

/** Snap step of a drag (cm): fine enough for a bump, coarse enough to aim right. */
export const RELIEF_SNAP_CM = 5
const HANDLE_LIFT = 0.06
const HIT_PX = { mouse: 14, touch: 26 }
/** The finger must have traveled this far (px) before the dot moves: a tremor is not worth 5 cm. */
const DEAD_PX = 6
/** Undo steps kept. */
export const RELIEF_HISTORY = 10

export function dotTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  if (!g) return null
  g.fillStyle = '#ffffff'
  g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill()
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke()
  return new CanvasTexture(c)
}

/** The SELECTED dot: an accent ring around a white core, bigger than the others. */
export function ringTexture(accent: Color): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  if (!g) return null
  g.fillStyle = 'rgba(0,0,0,0.55)'
  g.beginPath(); g.arc(32, 32, 31, 0, Math.PI * 2); g.fill()
  g.fillStyle = `#${accent.getHexString()}`
  g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill()
  g.fillStyle = 'rgba(0,0,0,0.55)'
  g.beginPath(); g.arc(32, 32, 17, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#ffffff'
  g.beginPath(); g.arc(32, 32, 14, 0, Math.PI * 2); g.fill()
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace                 // the theme's accent, not a washed-out tint
  return tex
}

/**
 * The handles fade with DEPTH: farther, more transparent, smaller, darker
 * — the eye reads the plot in perspective and finds the near dots first. Everything is done
 * in the shader, over a [near, far] range readjusted every frame to the plot as seen from the
 * camera (`onBeforeRender`): no per-dot computation, and the range follows the zoom as well as the orbit.
 */
const FAR_ALPHA = 0.08, FAR_SIZE = 0.45, FAR_SHADE = 0.45

function fadeWithDepth(points: Points, material: PointsMaterial): void {
  const near = { value: 0 }, far = { value: 1 }
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => {
    Material.prototype.onBeforeCompile.call(material, shader, renderer)   // the shared hooks (level fade…)
    shader.uniforms.reliefNear = near
    shader.uniforms.reliefFar = far
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float reliefNear;\nuniform float reliefFar;\nvarying float reliefDepth;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
  reliefDepth = smoothstep( reliefNear, reliefFar, - mvPosition.z );
  gl_PointSize *= mix( 1.0, ${FAR_SIZE.toFixed(2)}, reliefDepth );`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float reliefDepth;')
      .replace('#include <alphatest_fragment>', `diffuseColor.rgb *= mix( 1.0, ${FAR_SHADE.toFixed(2)}, reliefDepth );
  diffuseColor.a *= mix( 1.0, ${FAR_ALPHA.toFixed(2)}, reliefDepth );
#include <alphatest_fragment>`)
  }
  material.customProgramCacheKey = () => 'kasbah-relief-handles'
  const center = new Vector3()
  points.onBeforeRender = (_renderer, _scene, camera) => {
    const bs = points.geometry.boundingSphere
    if (!bs) return
    center.copy(bs.center).applyMatrix4(points.matrixWorld)
    const d = center.distanceTo(camera.position)
    // the fading starts from the first row and is done before the far edge: the last third stays discreet
    near.value = Math.max(0, d - bs.radius)
    far.value = d + bs.radius * 0.6
  }
}

/** A set of handles: those of the garden (hidden by what is in front), or those under the house. */
interface HandleSet { points: Points; material: PointsMaterial; nodes: { i: number; j: number }[]; base: Color }

export class ReliefEditor {
  grid: ReliefGrid
  /** The node just pulled: the panel shows its height. */
  selected: { i: number; j: number } | null = null
  /** Last selection made by tap, and with what (mouse, pen, finger): the panel hands over to the field accordingly. */
  pick = { seq: 0, by: '' }
  private readonly sets: [HandleSet, HandleSet]
  private readonly map: CanvasTexture | null
  /** Marker of the selected dot: drawn over everything, it is not lost behind a bump or a wall. */
  private readonly mark: Points
  private drag: DragDetector | null = null
  private gesture: { k: number; startY: number; pxPerM: number; startCm: number; moved: boolean } | null = null
  /** Nodes that have a handle (`j * cols + i`): keyboard navigation skips the others. */
  private handled = new Set<number>()
  private undoStack: ReliefGrid[] = []
  private redoStack: ReliefGrid[] = []
  private enabled = true

  constructor(private readonly host: ReliefEditorHost, grid: ReliefGrid, headless: boolean) {
    this.grid = grid
    this.map = dotTexture()
    // outside tone mapping, and BELOW the bloom threshold: white, the handles bled into halos at night
    const make = (name: string, base: Color, depthTest: boolean): HandleSet => {
      // low threshold: a distant dot drops to 8 % alpha, a threshold at 0.4 would have made it disappear
      const material = new PointsMaterial({ size: 12, sizeAttenuation: false, vertexColors: true, transparent: true, alphaTest: 0.02, depthWrite: false, depthTest, toneMapped: false, ...(this.map ? { map: this.map } : {}) })
      const points = new Points(new BufferGeometry(), material)
      fadeWithDepth(points, material)
      points.name = name
      points.renderOrder = depthTest ? 5 : 6
      host.parent.add(points)
      return { points, material, nodes: [], base }
    }
    this.sets = [make('relief:handles', new Color(0.62, 0.62, 0.62), true), make('relief:handles-under', new Color(0.34, 0.36, 0.42), false)]
    const ring = ringTexture(host.accent)
    const markGeometry = new BufferGeometry()
    markGeometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
    this.mark = new Points(markGeometry, new PointsMaterial({ size: 24, sizeAttenuation: false, transparent: true, alphaTest: 0.3, depthTest: false, depthWrite: false, toneMapped: false, ...(ring ? { map: ring } : { color: host.accent }) }))
    this.mark.name = 'relief:selected'
    this.mark.renderOrder = 7
    this.mark.visible = false
    host.parent.add(this.mark)
    this.layout()
    if (!headless) {
      this.drag = createDragDetector(host.canvas, {
        hitTest: (ev) => { const n = this.enabled ? this.nearest(ev) : null, s = this.selected; return !!n && !!s && n.i === s.i && n.j === s.j },
        onStart: (ev) => this.start(ev),
        onMove: (ev) => this.move(ev),
        onEnd: () => this.end(),
      })
    }
  }

  /** True during a drag and right after: the closing tap is not one. */
  active(): boolean { return this.drag?.active() ?? false }

  /** Height (cm) of the selected node, `null` without a selection. */
  selectedCm(): number | null {
    const s = this.selected
    return s ? this.grid.cm[s.j * this.grid.cols + s.i]! : null
  }

  /** Sets the height (cm) of the selected dot; false if there is none, or if it does not change. */
  setSelectedCm(cm: number): boolean {
    const s = this.selected
    if (!s) return false
    const k = s.j * this.grid.cols + s.i
    if (this.grid.cm[k] === Math.round(cm)) return false
    this.record(this.snapshot())
    this.grid.cm[k] = Math.round(cm)
    return true
  }

  /** Shows (or hides) the handles: the Outline tab keeps the editor, without it responding. */
  setEnabled(on: boolean): void {
    this.enabled = on
    for (const set of this.sets) set.points.visible = on
    this.mark.visible = on && !!this.selected
    this.host.invalidate()
  }

  /**
   * The same grid, enlarged for an outline that was just extended (`extendReliefGrid`): not a history
   * step — no height changed. The selected dot follows its node.
   */
  adoptGrid(grid: ReliefGrid): void {
    const s = this.selected
    if (s) {
      const di = Math.round((this.grid.origin[0] - grid.origin[0]) / grid.step), dj = Math.round((this.grid.origin[1] - grid.origin[1]) / grid.step)
      this.selected = { i: s.i + di, j: s.j + dj }
    }
    this.grid = grid
    this.layout()
  }

  /** New grid (import): one history step, and the handles are rebuilt on its nodes. */
  setGrid(grid: ReliefGrid): void {
    this.record(this.snapshot())
    this.grid = grid
    this.selected = null
    this.layout()
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }

  /** Goes back to the previous step; false if there is none. The grid is a NEW object: read `grid` again. */
  undo(): boolean { return this.travel(this.undoStack, this.redoStack) }
  redo(): boolean { return this.travel(this.redoStack, this.undoStack) }

  private travel(from: ReliefGrid[], to: ReliefGrid[]): boolean {
    const g = from.pop()
    if (!g) return false
    to.push(this.snapshot())
    this.grid = g
    // the selected dot stays selected, if it exists in the restored grid (an import can change its size)
    if (this.selected && (this.selected.i >= g.cols || this.selected.j >= g.rows)) this.selected = null
    this.layout()
    return true
  }

  private snapshot(): ReliefGrid {
    return { ...this.grid, origin: [this.grid.origin[0], this.grid.origin[1]], cm: [...this.grid.cm] }
  }

  /** Records the state BEFORE a change; a new change clears what could have been redone. */
  private record(before: ReliefGrid): void {
    this.undoStack.push(before)
    if (this.undoStack.length > RELIEF_HISTORY) this.undoStack.shift()
    this.redoStack = []
  }

  /**
   * Moves to the neighboring dot in a SCREEN direction (`sx`, `sy`: (1, 0) = right, (0, 1) = up):
   * the best-aligned grid axis, projected on screen around the dot — ↑ moves away from the camera
   * whatever the view. A node without a handle is skipped. False without a selected dot or without a neighbor.
   */
  stepSelection(sx: number, sy: number): boolean {
    const s = this.selected
    if (!s) return false
    const [x, y] = reliefNodeXY(this.grid, s.i, s.j)
    const z = reliefSurface(this.host.terrain(), x, y)
    const r = this.host.canvas.getBoundingClientRect()
    const o = this.screenOf(x, y, z)
    const axis = (dx: number, dy: number) => {
      const p = this.screenOf(x + dx * this.grid.step, y + dy * this.grid.step, z)
      return [(p.x - o.x) * r.width, (p.y - o.y) * r.height] as const
    }
    let di = 0, dj = 0, best = -Infinity
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const [u, v] = axis(a, b)
      const score = (u * sx + v * sy) / (Math.hypot(u, v) || 1)
      if (score > best) { best = score; di = a; dj = b }
    }
    for (let n = 1; ; n++) {
      const i = s.i + di * n, j = s.j + dj * n
      if (i < 0 || j < 0 || i >= this.grid.cols || j >= this.grid.rows) return false
      if (!this.handled.has(j * this.grid.cols + i)) continue
      this.selected = { i, j }
      this.pick = { seq: this.pick.seq + 1, by: 'keyboard' }
      this.refresh()
      return true
    }
  }

  /** A tap: selects the dot under the finger, or none if the finger lands beside it. */
  tap(ev: TapEvent): void {
    this.selected = this.nearest(ev)
    this.pick = { seq: this.pick.seq + 1, by: ev.pointerType }
    this.refresh()
    this.host.selectionChanged()
  }

  /**
   * The nodes that have a handle: those of the plot, except around a pool, where the terrain stays
   * flat and a handle would do nothing. Under the house, they go into the second set.
   */
  layout(): void {
    const t = this.host.terrain()
    for (const set of this.sets) set.nodes = []
    for (let j = 0; j < this.grid.rows; j++) {
      for (let i = 0; i < this.grid.cols; i++) {
        const [x, y] = reliefNodeXY(this.grid, i, j)
        if (!pointInPolygon([x, y], t.polygon) || padWeight(t.pads, x, y) < 1) continue
        this.sets[footprintCeiling(t.footprints, x, y) === Infinity ? 0 : 1].nodes.push({ i, j })
      }
    }
    this.handled = new Set(this.sets.flatMap((set) => set.nodes.map(({ i, j }) => j * this.grid.cols + i)))
    for (const set of this.sets) {
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(new Float32Array(set.nodes.length * 3), 3))
      g.setAttribute('color', new BufferAttribute(new Float32Array(set.nodes.length * 3), 3))
      set.points.geometry.dispose()
      set.points.geometry = g
    }
    this.refresh()
  }

  /** Lays the handles back at the height of their node; the selected dot carries the ring and disappears from its set. */
  refresh(): void {
    const t = this.host.terrain()
    const s = this.selected
    this.mark.visible = this.enabled && !!s
    if (s) {
      const [x, y] = reliefNodeXY(this.grid, s.i, s.j)
      ;(this.mark.geometry.getAttribute('position') as BufferAttribute).setXYZ(0, x, y, reliefSurface(t, x, y) + HANDLE_LIFT)
      this.mark.geometry.getAttribute('position').needsUpdate = true
      this.mark.geometry.computeBoundingSphere()
    }
    for (const set of this.sets) {
      const pos = set.points.geometry.getAttribute('position') as BufferAttribute
      const col = set.points.geometry.getAttribute('color') as BufferAttribute
      set.nodes.forEach(({ i, j }, n) => {
        const [x, y] = reliefNodeXY(this.grid, i, j)
        pos.setXYZ(n, x, y, reliefSurface(t, x, y) + HANDLE_LIFT)
        col.setXYZ(n, set.base.r, set.base.g, set.base.b)
      })
      pos.needsUpdate = true
      col.needsUpdate = true
      set.points.geometry.computeBoundingSphere()
    }
    this.host.invalidate()
  }

  private screenOf(x: number, y: number, z: number, out = new Vector3()): Vector3 {
    this.host.parent.updateWorldMatrix(true, false)
    return out.set(x, y, z).applyMatrix4(this.host.parent.matrixWorld).project(this.host.camera)
  }

  /** The handle closest to the finger, within a few pixels; `null` if there is none. */
  private nearest(ev: TapEvent): { i: number; j: number } | null {
    const r = this.host.canvas.getBoundingClientRect()
    const limit = ev.pointerType === 'mouse' ? HIT_PX.mouse : HIT_PX.touch
    let best: { i: number; j: number } | null = null, bestD = limit
    const v = new Vector3()
    for (const set of this.sets) {
      const pos = set.points.geometry.getAttribute('position') as BufferAttribute
      for (let n = 0; n < set.nodes.length; n++) {
        this.screenOf(pos.getX(n), pos.getY(n), pos.getZ(n), v)
        if (v.z > 1) continue                                 // behind the camera
        const d = Math.hypot(((v.x - ev.ndc.x) * r.width) / 2, ((v.y - ev.ndc.y) * r.height) / 2)
        if (d < bestD) { bestD = d; best = set.nodes[n]! }
      }
    }
    return best
  }

  private start(ev: TapEvent): void {
    const s = this.selected
    if (!s) return
    this.host.setControls(false)
    const [x, y] = reliefNodeXY(this.grid, s.i, s.j)
    const z = reliefSurface(this.host.terrain(), x, y)
    const r = this.host.canvas.getBoundingClientRect()
    const a = this.screenOf(x, y, z), b = this.screenOf(x, y, z + 1)
    // a dot seen from straight above has no height on screen: a floor avoids meters per pixel
    const pxPerM = Math.max(8, Math.abs(((b.y - a.y) * r.height) / 2))
    const k = s.j * this.grid.cols + s.i
    this.gesture = { k, startY: ev.clientY, pxPerM, startCm: this.grid.cm[k]!, moved: false }
    this.refresh()
  }

  private move(ev: TapEvent): void {
    const g = this.gesture
    if (!g) return
    if (!g.moved && Math.abs(g.startY - ev.clientY) < DEAD_PX) return
    g.moved = true
    const dz = ((g.startY - ev.clientY) / g.pxPerM) * 100
    this.grid.cm[g.k] = g.startCm + Math.round(dz / RELIEF_SNAP_CM) * RELIEF_SNAP_CM
    this.host.changed(false)
  }

  private end(): void {
    const g = this.gesture
    if (!g) return
    this.gesture = null
    if (this.grid.cm[g.k] !== g.startCm) {
      const before = this.snapshot()
      before.cm[g.k] = g.startCm
      this.record(before)
    }
    this.host.setControls(true)
    this.host.changed(true)
  }

  dispose(): void {
    this.drag?.detach()
    this.drag = null
    if (this.gesture) this.host.setControls(true)
    for (const set of this.sets) {
      set.points.removeFromParent()
      set.points.geometry.dispose()
      set.material.dispose()
    }
    this.map?.dispose()
    const markMaterial = this.mark.material as PointsMaterial
    this.mark.removeFromParent()
    this.mark.geometry.dispose()
    markMaterial.map?.dispose()
    markMaterial.dispose()
  }
}
