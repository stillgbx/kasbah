import { BufferAttribute, BufferGeometry, type Color, DoubleSide, Mesh, MeshBasicMaterial, type Object3D, Vector3 } from 'three'
import { type Box, type Circle, type Obstacles, type Path, roam } from './roam'

// Bats: a few silhouettes roaming the terrain (`roam.ts`, the house skirted), in the LOCAL reference frame of
// the house (Z-up, the object is a child of the root), like the rain. A bat = two
// triangles (one wing on each side of the body) that flap; they all share ONE geometry
// rewritten at every step: a single draw call, no allocation per frame.
//
// No light: it is a shadow puppet (`MeshBasicMaterial`), in a tint the style chooses. It casts no shadow — the shadow map is only redone on demand, not at 20 Hz.

/** The terrain to roam, the building footprint to skirt (local reference frame, meters) and the roof height. */
export interface BatsArea {
  terrain: readonly (readonly [number, number])[]
  building: Box
  /** The other footprints to skirt (the pool). */
  pools?: readonly Box[]
  /** The garden, as discs, skirted from the path onward. */
  statics?: readonly Circle[]
  /** What moves (cars, mower), read again at every step. */
  around?: () => readonly Circle[]
  roofZ: number
}

/** Half wingspan (m): larger than life, otherwise it cannot be seen at the scale of the house. */
const SPAN_M = 0.5
/** Wingbeats per second. */
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
      // each its own course, 2 to 4 m/s
      path: roam(site, 2 + 2 * Math.random(), { margin: 1.5 }),
      z: area.roofZ * (0.7 + 0.6 * Math.random()),
      bob: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
    }))
    // 2 triangles × 3 vertices × 3 coordinates
    this.positions = new Float32Array(this.count * 18)
    this.geometry = new BufferGeometry()
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3))
    this.material = new MeshBasicMaterial({ color, side: DoubleSide })
    this.object = new Mesh(this.geometry, this.material)
    // the vertices move at every step: the bounding volume would be wrong
    this.object.frustumCulled = false
    this.object.name = 'bats'
    this.write()
  }

  /** Changes the tint without rebuilding the swarm (the hour turns). */
  setColor(color: Color): void {
    this.material.color.copy(color)
  }

  /** Advances the flight by `dtS` seconds and rewrites the vertices. */
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
      // along its course, the altitude rising and falling
      const { x, y } = b.path(t, here)
      const z = b.z + 0.6 * Math.sin(t * 1.3 + b.bob)
      // heading = tangent to the course, side = horizontal perpendicular
      b.path(t + 0.1, ahead)
      const l = Math.hypot(ahead.x - x, ahead.y - y) || 1
      const fx = (ahead.x - x) / l, fy = (ahead.y - y) / l
      const sx = -fy, sy = fx
      const flap = Math.sin(t * FLAP_HZ * Math.PI * 2 + b.phase) * SPAN_M * 0.7
      const o = i * 18
      for (const [k, side] of [[0, 1], [9, -1]] as const) {
        // nose, tail, wingtip (a little behind, and flapping)
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
