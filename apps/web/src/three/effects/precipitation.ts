import { BufferAttribute, BufferGeometry, CanvasTexture, Color, LineBasicMaterial, LineSegments, Points, PointsMaterial, type Object3D, type Texture } from 'three'

// Rain and snow: particles above the plot, in the house's LOCAL reference frame (Z-up,
// the object is a child of the root). Rain is made of segments (a falling drop is a
// streak, not a point), snow of soft points. The wind tilts everything: the drops follow
// part of the wind, the flakes more, and each one falls back to the top of the volume when it touches
// the ground — a closed volume, hence a fixed number of particles and no allocation per frame.
//
// It is the only weather effect that COSTS: it forces the render loop to run as long as it rains
// (capped at 20 Hz like every decorative animation, `core/renderLoop.ts`). Hence the cutoff in
// low quality (`HouseScene.syncPrecipitation`) and the bounded number of particles.

export type PrecipitationKind = 'rain' | 'snow'

export interface PrecipitationParams {
  kind: PrecipitationKind
  /** 0 (a few drops) to 1 (downpour). Decides the number of particles and the opacity. */
  intensity: number
  windKmh: number
  /** Where the wind comes from (degrees from the plan's +y, clockwise — the weather convention, minus the house heading). */
  windDirDeg: number
}

/** The volume where it rains: the house footprint (local reference frame, meters) and the ceiling height. */
export interface PrecipitationBox { min: readonly [number, number]; max: readonly [number, number]; height: number }

/** Margin around the footprint: it also rains a little beyond the plot, otherwise the edge shows. */
const MARGIN_M = 3
const RAIN_MIN = 700, RAIN_MAX = 2600
const SNOW_MIN = 500, SNOW_MAX = 1600
/** Fall speed (m/s) and streak length of a drop (m). */
const RAIN_FALL_MS = 9, RAIN_STREAK_M = 0.4
const SNOW_FALL_MS = 1.2
/** Share of the wind the particle follows: a heavy drop little, a flake almost all. */
const RAIN_WIND = 0.35, SNOW_WIND = 0.7

/** Soft disc for a flake; `undefined` without a 2D context (tests without a graphical DOM). */
function softDisc(): Texture | undefined {
  if (typeof document === 'undefined') return undefined
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')
  if (!g) return undefined
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.6, 'rgba(255,255,255,0.6)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 32, 32)
  return new CanvasTexture(c)
}

export class Precipitation {
  readonly kind: PrecipitationKind
  readonly object: Object3D
  readonly count: number
  private readonly geometry: BufferGeometry
  private readonly material: LineBasicMaterial | PointsMaterial
  private readonly positions: Float32Array
  /** Head of each particle (x, y, z): the rain streaks are derived from the head and the velocity. */
  private readonly heads: Float32Array
  /** Phase of a flake's sway. */
  private readonly phases: Float32Array
  private readonly min: [number, number]
  private readonly max: [number, number]
  private readonly height: number
  private velocity: [number, number, number] = [0, 0, -RAIN_FALL_MS]
  private time = 0
  private intensity: number

  constructor(box: PrecipitationBox, params: PrecipitationParams) {
    this.kind = params.kind
    this.intensity = clamp01(params.intensity)
    this.min = [box.min[0] - MARGIN_M, box.min[1] - MARGIN_M]
    this.max = [box.max[0] + MARGIN_M, box.max[1] + MARGIN_M]
    this.height = box.height
    const rain = this.kind === 'rain'
    this.count = Math.round(rain ? RAIN_MIN + (RAIN_MAX - RAIN_MIN) * this.intensity : SNOW_MIN + (SNOW_MAX - SNOW_MIN) * this.intensity)
    this.heads = new Float32Array(this.count * 3)
    this.phases = new Float32Array(this.count)
    for (let i = 0; i < this.count; i++) {
      this.heads[i * 3] = lerp(this.min[0], this.max[0], Math.random())
      this.heads[i * 3 + 1] = lerp(this.min[1], this.max[1], Math.random())
      this.heads[i * 3 + 2] = Math.random() * this.height
      this.phases[i] = Math.random() * Math.PI * 2
    }
    // a streak = two vertices per drop; a flake = one vertex
    this.positions = new Float32Array(this.count * (rain ? 6 : 3))
    this.geometry = new BufferGeometry()
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3))
    if (rain) {
      this.material = new LineBasicMaterial({ color: new Color(0xa9c0d6), transparent: true, depthWrite: false })
      this.object = new LineSegments(this.geometry, this.material)
    } else {
      const map = softDisc()
      this.material = new PointsMaterial({ color: new Color(0xffffff), size: 0.14, sizeAttenuation: true, transparent: true, depthWrite: false, ...(map ? { map, alphaTest: 0.05 } : {}) })
      this.object = new Points(this.geometry, this.material)
    }
    // the positions move every frame: the bounding volume would be wrong, we don't sort
    this.object.frustumCulled = false
    this.object.name = `precipitation:${this.kind}`
    this.setParams(params)
    this.write()
  }

  /** Changes wind and intensity without rebuilding (the number of particles is fixed at creation). */
  setParams(params: PrecipitationParams): void {
    this.intensity = clamp01(params.intensity)
    const rain = this.kind === 'rain'
    // where the wind comes from → where it pushes: the opposite, in (east, north) = (x, y) of the local frame
    const a = (params.windDirDeg * Math.PI) / 180
    const wind = (params.windKmh / 3.6) * (rain ? RAIN_WIND : SNOW_WIND)
    this.velocity = [-Math.sin(a) * wind, -Math.cos(a) * wind, -(rain ? RAIN_FALL_MS : SNOW_FALL_MS)]
    this.material.opacity = rain ? 0.28 + 0.3 * this.intensity : 0.75 + 0.2 * this.intensity
  }

  /** Advances the particles by `dtS` seconds and rewrites the vertices. */
  step(dtS: number): void {
    const dt = Math.min(0.1, Math.max(0, dtS))
    this.time += dt
    const [vx, vy, vz] = this.velocity
    const snow = this.kind === 'snow'
    const w = this.max[0] - this.min[0], d = this.max[1] - this.min[1]
    for (let i = 0; i < this.count; i++) {
      const o = i * 3
      let x = this.heads[o]! + vx * dt
      let y = this.heads[o + 1]! + vy * dt
      let z = this.heads[o + 2]! + vz * dt
      if (snow) {
        // a flake does not fall straight: it sways
        const p = this.phases[i]!
        x += Math.sin(this.time * 1.4 + p) * 0.35 * dt
        y += Math.cos(this.time * 1.1 + p) * 0.35 * dt
      }
      // ground touched: falls back to the top, elsewhere on the plot; pushed out of the volume by the wind: comes back in through the other edge
      if (z < 0) { z += this.height; x = lerp(this.min[0], this.max[0], Math.random()); y = lerp(this.min[1], this.max[1], Math.random()) }
      if (x < this.min[0]) x += w; else if (x > this.max[0]) x -= w
      if (y < this.min[1]) y += d; else if (y > this.max[1]) y -= d
      this.heads[o] = x; this.heads[o + 1] = y; this.heads[o + 2] = z
    }
    this.write()
  }

  private write(): void {
    const pos = this.positions
    if (this.kind === 'rain') {
      // the streak follows the velocity: tilted by the wind, `RAIN_STREAK_M` long
      const [vx, vy, vz] = this.velocity
      const n = Math.hypot(vx, vy, vz) || 1
      const tx = (vx / n) * RAIN_STREAK_M, ty = (vy / n) * RAIN_STREAK_M, tz = (vz / n) * RAIN_STREAK_M
      for (let i = 0; i < this.count; i++) {
        const o = i * 3, p = i * 6
        pos[p] = this.heads[o]!; pos[p + 1] = this.heads[o + 1]!; pos[p + 2] = this.heads[o + 2]!
        pos[p + 3] = pos[p]! - tx; pos[p + 4] = pos[p + 1]! - ty; pos[p + 5] = pos[p + 2]! - tz
      }
    } else {
      pos.set(this.heads)
    }
    const attr = this.geometry.getAttribute('position') as BufferAttribute
    attr.needsUpdate = true
  }

  dispose(): void {
    this.object.removeFromParent()
    this.geometry.dispose()
    if (this.material instanceof PointsMaterial) this.material.map?.dispose()
    this.material.dispose()
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
