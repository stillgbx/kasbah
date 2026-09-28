import { BufferAttribute, BufferGeometry, CanvasTexture, Color, LineBasicMaterial, LineSegments, Points, PointsMaterial, type Object3D, type Texture } from 'three'

// Pluie et neige : des particules au-dessus de la parcelle, dans le repère LOCAL de la maison (Z-up,
// l'objet est enfant de la racine). La pluie est faite de segments (une goutte qui tombe est un
// trait, pas un point), la neige de points doux. Le vent incline le tout : les gouttes suivent
// une part du vent, les flocons davantage, et chacune retombe en haut du volume quand elle touche
// le sol — un volume fermé, donc un nombre de particules fixe et aucune allocation par image.
//
// C'est le seul effet météo qui COÛTE : il oblige la boucle de rendu à tourner tant qu'il pleut
// (bridée à 20 Hz comme toute animation décorative, `core/renderLoop.ts`). D'où la coupure en
// qualité basse (`HouseScene.syncPrecipitation`) et le nombre de particules borné.

export type PrecipitationKind = 'rain' | 'snow'

export interface PrecipitationParams {
  kind: PrecipitationKind
  /** 0 (quelques gouttes) à 1 (averse). Décide du nombre de particules et de l'opacité. */
  intensity: number
  windKmh: number
  /** D'où vient le vent (degrés depuis le +y du plan, sens horaire — la convention météo, cap de la maison retranché). */
  windDirDeg: number
}

/** Le volume où il pleut : l'emprise de la maison (repère local, mètres) et la hauteur du plafond. */
export interface PrecipitationBox { min: readonly [number, number]; max: readonly [number, number]; height: number }

/** Marge autour de l'emprise : il pleut aussi un peu au-delà de la parcelle, sinon le bord se voit. */
const MARGIN_M = 3
const RAIN_MIN = 700, RAIN_MAX = 2600
const SNOW_MIN = 500, SNOW_MAX = 1600
/** Vitesse de chute (m/s) et longueur du trait d'une goutte (m). */
const RAIN_FALL_MS = 9, RAIN_STREAK_M = 0.4
const SNOW_FALL_MS = 1.2
/** Part du vent que suit la particule : une goutte lourde peu, un flocon presque tout. */
const RAIN_WIND = 0.35, SNOW_WIND = 0.7

/** Disque doux pour un flocon ; `undefined` sans contexte 2D (tests sans DOM graphique). */
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
  /** Tête de chaque particule (x, y, z) : les traits de pluie se déduisent de la tête et de la vitesse. */
  private readonly heads: Float32Array
  /** Phase du balancement d'un flocon. */
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
    // un trait = deux sommets par goutte ; un flocon = un sommet
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
    // les positions bougent à chaque image : le volume englobant serait faux, on ne trie pas
    this.object.frustumCulled = false
    this.object.name = `precipitation:${this.kind}`
    this.setParams(params)
    this.write()
  }

  /** Change vent et intensité sans reconstruire (le nombre de particules, lui, est fixé à la création). */
  setParams(params: PrecipitationParams): void {
    this.intensity = clamp01(params.intensity)
    const rain = this.kind === 'rain'
    // d'où vient le vent → vers où il pousse : l'opposé, en (est, nord) = (x, y) du repère local
    const a = (params.windDirDeg * Math.PI) / 180
    const wind = (params.windKmh / 3.6) * (rain ? RAIN_WIND : SNOW_WIND)
    this.velocity = [-Math.sin(a) * wind, -Math.cos(a) * wind, -(rain ? RAIN_FALL_MS : SNOW_FALL_MS)]
    this.material.opacity = rain ? 0.28 + 0.3 * this.intensity : 0.75 + 0.2 * this.intensity
  }

  /** Avance les particules de `dtS` secondes et réécrit les sommets. */
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
        // un flocon ne tombe pas droit : il se balance
        const p = this.phases[i]!
        x += Math.sin(this.time * 1.4 + p) * 0.35 * dt
        y += Math.cos(this.time * 1.1 + p) * 0.35 * dt
      }
      // sol touché : retombe en haut, ailleurs sur la parcelle ; sorti du volume par le vent : rentre par l'autre bord
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
      // le trait suit la vitesse : incliné par le vent, long de `RAIN_STREAK_M`
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
