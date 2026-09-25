import { BufferAttribute, BufferGeometry, type Color, DoubleSide, Mesh, MeshBasicMaterial, type Object3D } from 'three'

// Chauves-souris : quelques silhouettes qui tournent autour de la maison, dans le repère LOCAL de
// la maison (Z-up, l'objet est enfant de la racine), comme la pluie. Une chauve-souris = deux
// triangles (une aile de chaque côté du corps) qui battent ; toutes partagent UNE géométrie
// réécrite à chaque pas : un seul appel de dessin, aucune allocation par image.
//
// Pas de lumière : c'est une ombre chinoise (`MeshBasicMaterial`), d'une teinte que le style choisit. Elle ne porte pas d'ombre — la carte d'ombre n'est refaite qu'à la demande, pas à 20 Hz.

/** L'emprise à survoler (repère local, mètres) et la hauteur du toit, au-dessus duquel elles passent. */
export interface BatsArea { min: readonly [number, number]; max: readonly [number, number]; roofZ: number }

/** Demi-envergure (m) : plus grande que nature, sinon on ne la voit pas à l'échelle de la maison. */
const SPAN_M = 0.5
/** Battements par seconde. */
const FLAP_HZ = 5

interface Bat { radius: number; angle: number; speed: number; z: number; bob: number; phase: number }

export class Bats {
  readonly object: Object3D
  readonly count: number
  private readonly geometry: BufferGeometry
  private readonly material: MeshBasicMaterial
  private readonly positions: Float32Array
  private readonly bats: Bat[]
  private readonly cx: number
  private readonly cy: number
  private time = 0

  constructor(area: BatsArea, count: number, color: Color) {
    this.count = Math.max(0, Math.round(count))
    this.cx = (area.min[0] + area.max[0]) / 2
    this.cy = (area.min[1] + area.max[1]) / 2
    const reach = Math.hypot(area.max[0] - area.min[0], area.max[1] - area.min[1]) / 2
    this.bats = Array.from({ length: this.count }, () => ({
      // de l'aplomb des façades jusqu'un peu au-delà du jardin
      radius: reach * (0.35 + 0.55 * Math.random()),
      angle: Math.random() * Math.PI * 2,
      // rad/s, dans les deux sens : une nuée qui tourne dans le même sens fait manège
      speed: (0.25 + 0.3 * Math.random()) * (Math.random() < 0.5 ? -1 : 1),
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
    for (const b of this.bats) b.angle += b.speed * dt
    this.write()
  }

  private write(): void {
    const pos = this.positions
    const t = this.time
    this.bats.forEach((b, i) => {
      // un cercle qui ondule : le rayon respire et l'altitude monte et descend
      const r = b.radius * (1 + 0.15 * Math.sin(t * 0.7 + b.bob))
      const x = this.cx + Math.cos(b.angle) * r
      const y = this.cy + Math.sin(b.angle) * r
      const z = b.z + 0.6 * Math.sin(t * 1.3 + b.bob)
      // cap = tangente au cercle, côté = perpendiculaire horizontale
      const s = Math.sign(b.speed)
      const fx = -Math.sin(b.angle) * s, fy = Math.cos(b.angle) * s
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
