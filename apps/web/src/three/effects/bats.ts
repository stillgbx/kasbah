import { BufferAttribute, BufferGeometry, type Color, DoubleSide, Mesh, MeshBasicMaterial, type Object3D, Vector3 } from 'three'
import { type Box, type Circle, type Obstacles, type Path, roam } from './roam'

// Chauves-souris : quelques silhouettes qui parcourent le terrain (`roam.ts`, la maison contournée), dans le repère LOCAL de
// la maison (Z-up, l'objet est enfant de la racine), comme la pluie. Une chauve-souris = deux
// triangles (une aile de chaque côté du corps) qui battent ; toutes partagent UNE géométrie
// réécrite à chaque pas : un seul appel de dessin, aucune allocation par image.
//
// Pas de lumière : c'est une ombre chinoise (`MeshBasicMaterial`), d'une teinte que le style choisit. Elle ne porte pas d'ombre — la carte d'ombre n'est refaite qu'à la demande, pas à 20 Hz.

/** Le terrain à parcourir, l'emprise bâtie à contourner (repère local, mètres) et la hauteur du toit. */
export interface BatsArea {
  terrain: readonly (readonly [number, number])[]
  building: Box
  /** Les autres emprises à contourner (la piscine). */
  pools?: readonly Box[]
  /** Le jardin, en disques, contourné dès le tracé. */
  statics?: readonly Circle[]
  /** Ce qui bouge (voitures, tondeuse), relu à chaque pas. */
  around?: () => readonly Circle[]
  roofZ: number
}

/** Demi-envergure (m) : plus grande que nature, sinon on ne la voit pas à l'échelle de la maison. */
const SPAN_M = 0.5
/** Battements par seconde. */
const FLAP_HZ = 5

interface Bat { path: Path; z: number; bob: number; phase: number }

const here = new Vector3(), ahead = new Vector3()

export class Bats {
  readonly object: Object3D
  readonly count: number
  private readonly geometry: BufferGeometry
  private readonly material: MeshBasicMaterial
  private readonly positions: Float32Array
  private readonly bats: Bat[]
  private readonly obstacles: Obstacles = { list: [] }
  private readonly readObstacles: () => readonly Circle[]
  private time = 0

  constructor(area: BatsArea, count: number, color: Color) {
    this.count = Math.max(0, Math.round(count))
    this.readObstacles = area.around ?? (() => [])
    this.obstacles.list = this.readObstacles()
    const site = { terrain: area.terrain, avoid: [area.building, ...(area.pools ?? [])], statics: area.statics, around: this.obstacles }
    this.bats = Array.from({ length: this.count }, () => ({
      // chacune son parcours, 2 à 4 m/s
      path: roam(site, 2 + 2 * Math.random(), { margin: 1.5 }),
      z: area.roofZ * (0.7 + 0.6 * Math.random()),
      bob: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
    }))
    // 2 triangles × 3 sommets × 3 coordonnées
    this.positions = new Float32Array(this.count * 18)
    this.geometry = new BufferGeometry()
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3))
    this.material = new MeshBasicMaterial({ color, side: DoubleSide })
    this.object = new Mesh(this.geometry, this.material)
    // les sommets bougent à chaque pas : le volume englobant serait faux
    this.object.frustumCulled = false
    this.object.name = 'bats'
    this.write()
  }

  /** Change la teinte sans refaire la nuée (l'heure tourne). */
  setColor(color: Color): void {
    this.material.color.copy(color)
  }

  /** Avance le vol de `dtS` secondes et réécrit les sommets. */
  step(dtS: number): void {
    const dt = Math.min(0.1, Math.max(0, dtS))
    this.time += dt
    this.obstacles.list = this.readObstacles()
    this.write()
  }

  private write(): void {
    const pos = this.positions
    const t = this.time
    this.bats.forEach((b, i) => {
      // sur son parcours, l'altitude qui monte et descend
      const { x, y } = b.path(t, here)
      const z = b.z + 0.6 * Math.sin(t * 1.3 + b.bob)
      // cap = tangente au parcours, côté = perpendiculaire horizontale
      b.path(t + 0.1, ahead)
      const l = Math.hypot(ahead.x - x, ahead.y - y) || 1
      const fx = (ahead.x - x) / l, fy = (ahead.y - y) / l
      const sx = -fy, sy = fx
      const flap = Math.sin(t * FLAP_HZ * Math.PI * 2 + b.phase) * SPAN_M * 0.7
      const o = i * 18
      for (const [k, side] of [[0, 1], [9, -1]] as const) {
        // nez, queue, bout de l'aile (un peu en arrière et qui bat)
        pos[o + k] = x + fx * 0.18; pos[o + k + 1] = y + fy * 0.18; pos[o + k + 2] = z
        pos[o + k + 3] = x - fx * 0.15; pos[o + k + 4] = y - fy * 0.15; pos[o + k + 5] = z
        pos[o + k + 6] = x + sx * SPAN_M * side - fx * 0.12
        pos[o + k + 7] = y + sy * SPAN_M * side - fy * 0.12
        pos[o + k + 8] = z + flap
      }
    })
    const attr = this.geometry.getAttribute('position') as BufferAttribute
    attr.needsUpdate = true
  }

  dispose(): void {
    this.object.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }
}
