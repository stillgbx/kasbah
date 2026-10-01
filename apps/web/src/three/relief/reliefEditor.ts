import { BufferAttribute, BufferGeometry, CanvasTexture, Color, Material, Points, PointsMaterial, SRGBColorSpace, Vector3, type Camera, type Object3D, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three'
import { footprintCeiling, padWeight, pointInPolygon, reliefNodeXY, reliefSurface, type ReliefGrid, type TerrainDescriptor } from '@kasbah/shared'
import { createDragDetector, type DragDetector, type TapEvent } from '../core/input'

// Éditeur du RELIEF (Réglages → Rendu 3D → « Modeler le terrain ») : un point par nœud de la grille,
// qu'on tire vers le haut ou le bas au doigt. Un point bouge SEUL — ses voisins ne suivent pas : on
// modèle nœud par nœud, et la surface lisse fait le reste. Le glissement est VERTICAL À L'ÉCRAN,
// converti en mètres à la profondeur du point : un centimètre de doigt vaut plus de relief vu de
// loin que de près, comme on s'y attend.
//
// Les nœuds SOUS la maison ont aussi leur point : ils modèlent les abords (un talus qui vient
// toucher un mur) sans percer les sols, le terrain étant écrêté sous chaque plancher. Leur point est
// à la hauteur du NŒUD, pas du terrain écrêté, et se dessine à travers les murs, plus pâle.
//
// CHOISIR, puis glisser : un tap choisit un point (ou, dans le vide, n'en choisit plus aucun) ; seul
// le point choisi se glisse. Un glissement qui part ailleurs — même sur un autre point — fait
// orbiter la caméra : sans cela, on déplaçait un point chaque fois qu'on voulait tourner autour.
//
// Chaque modification (geste, saisie, import) s'annule et se rétablit, sur `RELIEF_HISTORY` pas.
//
// La grille vit ici tant qu'on édite ; c'est la scène qui la pose sur le terrain (`changed`) et le
// panneau qui l'enregistre.

export interface ReliefEditorHost {
  canvas: HTMLCanvasElement
  camera: Camera
  /** Groupe en repère MAISON qui porte les poignées (le site). */
  parent: Object3D
  /** Le terrain tel qu'il est dessiné, brouillon compris : il place les poignées. */
  terrain(): TerrainDescriptor
  setControls(enabled: boolean): void
  invalidate(): void
  /** La grille a bougé ; `final` à la fin du geste (un glissement en envoie un par image avant). */
  changed(final: boolean): void
  /** Le point choisi a changé (ou l'historique) : le panneau se remet à jour, rien à redessiner du terrain. */
  selectionChanged(): void
  accent: Color
}

/** Pas d'accroche d'un glissement (cm) : assez fin pour une bosse, assez gros pour viser juste. */
export const RELIEF_SNAP_CM = 5
const HANDLE_LIFT = 0.06
const HIT_PX = { mouse: 14, touch: 26 }
/** Le doigt doit avoir parcouru ça (px) avant que le point bouge : un tremblement ne vaut pas 5 cm. */
const DEAD_PX = 6
/** Pas d'annulation retenus. */
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

/** Le point CHOISI : un anneau d'accent autour d'un cœur blanc, plus gros que les autres. */
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
  tex.colorSpace = SRGBColorSpace                 // l'accent du thème, pas une teinte délavée
  return tex
}

/**
 * Les poignées s'effacent avec la PROFONDEUR : plus loin, plus transparentes, plus petites, plus
 * sombres — l'œil lit la parcelle en perspective et trouve d'abord les points proches. Tout se fait
 * dans le shader, sur une plage [près, loin] recalée à chaque image sur la parcelle vue de la
 * caméra (`onBeforeRender`) : aucun calcul par point, et la plage suit le zoom comme l'orbite.
 */
const FAR_ALPHA = 0.08, FAR_SIZE = 0.45, FAR_SHADE = 0.45

function fadeWithDepth(points: Points, material: PointsMaterial): void {
  const near = { value: 0 }, far = { value: 1 }
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => {
    Material.prototype.onBeforeCompile.call(material, shader, renderer)   // les crochets communs (fondu des étages…)
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
    // l'effacement part du premier rang et a fini avant le bord du fond : le dernier tiers reste discret
    near.value = Math.max(0, d - bs.radius)
    far.value = d + bs.radius * 0.6
  }
}

/** Un jeu de poignées : celles du jardin (cachées par ce qui est devant), ou celles sous la maison. */
interface HandleSet { points: Points; material: PointsMaterial; nodes: { i: number; j: number }[]; base: Color }

export class ReliefEditor {
  grid: ReliefGrid
  /** Le nœud qu'on vient de tirer : le panneau affiche sa hauteur. */
  selected: { i: number; j: number } | null = null
  /** Dernier choix fait au tap, et avec quoi (souris, stylet, doigt) : le panneau y donne la main au champ. */
  pick = { seq: 0, by: '' }
  private readonly sets: [HandleSet, HandleSet]
  private readonly map: CanvasTexture | null
  /** Marqueur du point choisi : dessiné par-dessus tout, on ne le perd pas derrière une bosse ou un mur. */
  private readonly mark: Points
  private drag: DragDetector | null = null
  private gesture: { k: number; startY: number; pxPerM: number; startCm: number; moved: boolean } | null = null
  /** Nœuds qui ont une poignée (`j * cols + i`) : la navigation au clavier saute les autres. */
  private handled = new Set<number>()
  private undoStack: ReliefGrid[] = []
  private redoStack: ReliefGrid[] = []
  private enabled = true

  constructor(private readonly host: ReliefEditorHost, grid: ReliefGrid, headless: boolean) {
    this.grid = grid
    this.map = dotTexture()
    // hors tone mapping, et SOUS le seuil du bloom : blanches, les poignées bavaient en halos la nuit
    const make = (name: string, base: Color, depthTest: boolean): HandleSet => {
      // seuil bas : un point lointain descend à 8 % d’alpha, un seuil à 0,4 l’aurait fait disparaître
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

  /** Vrai pendant un glissement et juste après : le tap de fin n'en est pas un. */
  active(): boolean { return this.drag?.active() ?? false }

  /** Hauteur (cm) du nœud choisi, `null` sans choix. */
  selectedCm(): number | null {
    const s = this.selected
    return s ? this.grid.cm[s.j * this.grid.cols + s.i]! : null
  }

  /** Pose la hauteur (cm) du point choisi ; faux s'il n'y en a pas, ou si elle ne change pas. */
  setSelectedCm(cm: number): boolean {
    const s = this.selected
    if (!s) return false
    const k = s.j * this.grid.cols + s.i
    if (this.grid.cm[k] === Math.round(cm)) return false
    this.record(this.snapshot())
    this.grid.cm[k] = Math.round(cm)
    return true
  }

  /** Montre (ou cache) les poignées : l'onglet Contour garde l'éditeur, sans qu'il réponde. */
  setEnabled(on: boolean): void {
    this.enabled = on
    for (const set of this.sets) set.points.visible = on
    this.mark.visible = on && !!this.selected
    this.host.invalidate()
  }

  /**
   * La même grille, agrandie pour un contour qu'on vient d'étendre (`extendReliefGrid`) : pas un pas
   * d'historique — rien n'a changé de hauteur. Le point choisi suit son nœud.
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

  /** Nouvelle grille (import) : un pas d'historique, et les poignées se refont sur ses nœuds. */
  setGrid(grid: ReliefGrid): void {
    this.record(this.snapshot())
    this.grid = grid
    this.selected = null
    this.layout()
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }

  /** Revient au pas précédent ; faux s'il n'y en a pas. La grille est un NOUVEL objet : relire `grid`. */
  undo(): boolean { return this.travel(this.undoStack, this.redoStack) }
  redo(): boolean { return this.travel(this.redoStack, this.undoStack) }

  private travel(from: ReliefGrid[], to: ReliefGrid[]): boolean {
    const g = from.pop()
    if (!g) return false
    to.push(this.snapshot())
    this.grid = g
    // le point choisi le reste, s'il existe dans la grille retrouvée (un import peut en changer la taille)
    if (this.selected && (this.selected.i >= g.cols || this.selected.j >= g.rows)) this.selected = null
    this.layout()
    return true
  }

  private snapshot(): ReliefGrid {
    return { ...this.grid, origin: [this.grid.origin[0], this.grid.origin[1]], cm: [...this.grid.cm] }
  }

  /** Retient l'état d'AVANT une modification ; une nouvelle modification efface ce qu'on pouvait rétablir. */
  private record(before: ReliefGrid): void {
    this.undoStack.push(before)
    if (this.undoStack.length > RELIEF_HISTORY) this.undoStack.shift()
    this.redoStack = []
  }

  /**
   * Passe au point voisin dans une direction de l'ÉCRAN (`sx`, `sy` : (1, 0) = droite, (0, 1) = haut) :
   * l'axe de la grille le mieux aligné, projeté à l'écran autour du point — ↑ s'éloigne de la caméra
   * quelle que soit la vue. Un nœud sans poignée est sauté. Faux sans point choisi ou sans voisin.
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

  /** Un tap : choisit le point sous le doigt, ou aucun si le doigt tombe à côté. */
  tap(ev: TapEvent): void {
    this.selected = this.nearest(ev)
    this.pick = { seq: this.pick.seq + 1, by: ev.pointerType }
    this.refresh()
    this.host.selectionChanged()
  }

  /**
   * Les nœuds qui ont une poignée : ceux de la parcelle, sauf autour d'un bassin, où le terrain reste
   * plat et une poignée ne ferait rien. Sous la maison, ils vont dans le second jeu.
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

  /** Reposent les poignées à la hauteur de leur nœud ; le point choisi porte l'anneau et s'efface de son jeu. */
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

  /** La poignée la plus proche du doigt, à quelques pixels près ; `null` s'il n'y en a pas. */
  private nearest(ev: TapEvent): { i: number; j: number } | null {
    const r = this.host.canvas.getBoundingClientRect()
    const limit = ev.pointerType === 'mouse' ? HIT_PX.mouse : HIT_PX.touch
    let best: { i: number; j: number } | null = null, bestD = limit
    const v = new Vector3()
    for (const set of this.sets) {
      const pos = set.points.geometry.getAttribute('position') as BufferAttribute
      for (let n = 0; n < set.nodes.length; n++) {
        this.screenOf(pos.getX(n), pos.getY(n), pos.getZ(n), v)
        if (v.z > 1) continue                                 // derrière la caméra
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
    // un point vu d'aplomb n'a pas de hauteur à l'écran : un plancher évite des mètres par pixel
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
