import { BufferAttribute, Color, DataTexture, InstancedBufferGeometry, Mesh, NearestFilter, ShaderMaterial, Vector2, Vector3, type Camera, type Object3D, type PerspectiveCamera } from 'three'
import type { HouseGeometry, Vec3 } from '@kasbah/shared'

// Rain and snow: particles above the plot, in the house's LOCAL reference frame (Z-up, the object
// is a child of the root). Everything is drawn by the GPU: ONE quad, instanced `count` times, that
// the vertex shader places from the instance number. Nothing per particle lives on the CPU — `step`
// only moves a shared offset (the fall and the wind) and a clock (the flakes' sway), so wind and
// intensity change without a jump and without rebuilding a buffer.
//
// A drop is a STREAK: a quad stretched along its velocity, turned to face the camera, at least a
// couple of pixels wide whatever the distance (the former 1-pixel lines were barely visible). A flake
// is a soft disc facing the camera. Each particle falls back to the top of the volume, at a new spot
// drawn from its lap number: the volume is closed, nothing is allocated per frame.
//
// It does not rain INSIDE the house: a cover map (one cell per 20 cm of the plan) holds the height of
// what covers each point — a roof slope, a flat roof, the top of a level's closed rooms — and a
// particle below it is not drawn. It stops there even when the roof is hidden (cut-away view): an
// invisible lid rather than rain falling on the furniture.
//
// It is the only weather effect that COSTS: it forces the render loop to run as long as it rains
// (capped at 20 Hz like every decorative animation, `core/renderLoop.ts`). Hence the cutoff in low
// quality (`HouseScene.syncPrecipitation`). The particles themselves cost almost nothing: what costs
// is redrawing the scene.
//
// Its WebGPU twin is `gpu/precipitation.ts` (tag `precipitation`, `gpu/shaderMaterials.ts`): same
// numbers, same uniform objects.

export type PrecipitationKind = 'rain' | 'snow'

export interface PrecipitationParams {
  kind: PrecipitationKind
  /** 0 (a few drops) to 1 (downpour). Decides the number of particles and the opacity. */
  intensity: number
  windKmh: number
  /** Where the wind comes from (degrees from the plan's +y, clockwise — the weather convention, minus the house heading). */
  windDirDeg: number
}

/** A surface the precipitation stops on: a polygon in plan, and its height at a point of it. */
export interface PrecipitationCover { polygon: readonly (readonly [number, number])[]; zAt: (x: number, y: number) => number }

/** The volume where it rains: the house footprint (local reference frame, meters), the ceiling height, and what covers the house. */
export interface PrecipitationBox { min: readonly [number, number]; max: readonly [number, number]; height: number; covers?: readonly PrecipitationCover[] }

/** Margin around the footprint: it also rains a little beyond the plot, otherwise the edge shows. */
const MARGIN_M = 3
const RAIN_MIN = 1500, RAIN_MAX = 6000
const SNOW_MIN = 1000, SNOW_MAX = 3500
/** Fall speed (m/s). */
const RAIN_FALL_MS = 9
const SNOW_FALL_MS = 1.2
/** Share of the wind the particle follows: a heavy drop little, a flake almost all. */
const RAIN_WIND = 0.35, SNOW_WIND = 0.7

/** Streak length of a drop (m), its width (m), and the least width on screen (share of the image height). */
export const RAIN_STREAK_M = 0.45
export const RAIN_WIDTH_M = 0.012
export const RAIN_MIN_SCREEN = 0.0022
/** Diameter of a flake (m) and the least one on screen (share of the image height). */
export const SNOW_SIZE_M = 0.06
export const SNOW_MIN_SCREEN = 0.004
/** How far a flake sways (m), and the two frequencies of its sway (rad/s). */
export const SNOW_SWAY_M = 0.25
export const SNOW_SWAY_X = 1.4, SNOW_SWAY_Y = 1.1
/** The sway's clock loops on a common period of both frequencies (20π s): it never grows out of precision. */
const SWAY_PERIOD_S = 20 * Math.PI
/** Laps after which a particle falls again at a spot it already used: the fall offset loops on them. */
export const LAPS = 16
/** Height (m) under the ceiling over which a particle appears, instead of popping in. */
export const TOP_FADE_M = 1

/** Cell of the cover map (m), and its largest side (texels). */
const COVER_CELL_M = 0.2
const COVER_MAX_PX = 256

/**
 * What stops the precipitation above the house: each roof slope (its top surface), a flat roof (its
 * top), and the top of each level's closed rooms — a house without a roof, or a part no roof covers.
 * Terraces and balconies stay open to the sky.
 */
export function precipitationCovers(g: HouseGeometry): PrecipitationCover[] {
  const covers: PrecipitationCover[] = []
  for (const roof of g.roofs) {
    if (roof.faces.length === 0) {
      const top = roof.zBase + roof.thickness
      covers.push({ polygon: roof.outline, zAt: () => top })
      continue
    }
    for (const face of roof.faces) {
      const zAt = planeOf(face, roof.thickness)
      // a gable or a high wall is vertical: nothing falls on it from above
      if (zAt) covers.push({ polygon: face.map((p) => [p[0], p[1]] as const), zAt })
    }
  }
  for (const level of g.levels) {
    const top = level.elevation + level.height
    for (const floor of level.floors) {
      if (floor.kind !== 'terrace' && floor.kind !== 'balcony') covers.push({ polygon: floor.polygon, zAt: () => top })
    }
  }
  return covers
}

/** Height of a flat face's plane above a point, raised by `lift`; `null` for a vertical face. */
function planeOf(face: readonly Vec3[], lift: number): ((x: number, y: number) => number) | null {
  const [a, b, c] = face
  if (!a || !b || !c) return null
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  if (Math.abs(nz) < 1e-6 * Math.hypot(nx, ny, nz)) return null
  return (x, y) => a[2] + lift - (nx * (x - a[0]) + ny * (y - a[1])) / nz
}

/**
 * The cover map over the volume's plan: per cell, the height under which nothing falls, as a share
 * of the volume's height (red channel, 0-255, rounded UP: a drop never shows just under a roof).
 */
export function coverMap(min: { x: number; y: number }, size: { x: number; y: number; z: number }, covers: readonly PrecipitationCover[]): { data: Uint8Array; width: number; height: number } {
  const width = Math.min(COVER_MAX_PX, Math.max(1, Math.ceil(size.x / COVER_CELL_M)))
  const height = Math.min(COVER_MAX_PX, Math.max(1, Math.ceil(size.y / COVER_CELL_M)))
  const data = new Uint8Array(width * height * 4)
  const cw = size.x / width, ch = size.y / height
  for (const { polygon, zAt } of covers) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of polygon) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
    const i0 = Math.max(0, Math.floor((x0 - min.x) / cw)), i1 = Math.min(width - 1, Math.floor((x1 - min.x) / cw))
    const j0 = Math.max(0, Math.floor((y0 - min.y) / ch)), j1 = Math.min(height - 1, Math.floor((y1 - min.y) / ch))
    for (let j = j0; j <= j1; j++) {
      const y = min.y + (j + 0.5) * ch
      for (let i = i0; i <= i1; i++) {
        const x = min.x + (i + 0.5) * cw
        if (!inside(polygon, x, y)) continue
        const v = Math.ceil(clamp01(zAt(x, y) / size.z) * 255)
        const k = (j * width + i) * 4
        if (v > data[k]!) data[k] = v
      }
    }
  }
  for (let k = 3; k < data.length; k += 4) data[k] = 255
  return { data, width, height }
}

/** Even-odd test: is (x, y) inside the polygon? */
function inside(polygon: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!, [xj, yj] = polygon[j]!
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/** The uniforms of one precipitation, shared by the GLSL and its TSL twin. */
export interface PrecipitationUniforms {
  uBoxMin: { value: Vector3 }
  uBoxSize: { value: Vector3 }
  uOffset: { value: Vector3 }
  uVelocity: { value: Vector3 }
  uTime: { value: number }
  /** x: metres per image height (at 1 m in perspective), y: 1 in perspective, 0 in orthographic. */
  uScreen: { value: Vector2 }
  /** The cover map (`coverMap`): red = height under which nothing falls, share of `uBoxSize.z`. */
  uCover: { value: DataTexture }
  uColor: { value: Color }
  uOpacity: { value: number }
}

const glsl = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x))

// The same placement as `gpu/precipitation.ts`. `kFmod` = GLSL's `mod`, written out so both
// languages floor the same way (WGSL's `%` truncates).
const VERTEX = /* glsl */`
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec3 uOffset;
uniform vec3 uVelocity;
uniform float uTime;
uniform vec2 uScreen;
uniform sampler2D uCover;
varying vec2 vQuad;
varying float vFade;
float kHash(float n) { return fract(sin(n) * 43758.5453123); }
float kFmod(float a, float b) { return a - b * floor(a / b); }
void main() {
  float id = float(gl_InstanceID);
  vec3 seed = vec3(kHash(id * 0.137 + 1.0), kHash(id * 0.731 + 2.0), kHash(id * 0.419 + 3.0));
  // the fall: height in the volume, and the lap, which gives each fall its own spot
  float z = seed.z * uBoxSize.z - uOffset.z;
  float lap = floor(z / uBoxSize.z);
  z -= lap * uBoxSize.z;
  float l = kFmod(lap, ${glsl(LAPS)});
  vec2 spot = fract(seed.xy + vec2(kHash(id * 0.37 + l * 17.13), kHash(id * 0.59 + l * 9.71))) * uBoxSize.xy;
  vec2 xy = vec2(kFmod(spot.x + uOffset.x, uBoxSize.x), kFmod(spot.y + uOffset.y, uBoxSize.y)) + uBoxMin.xy;
#ifdef SNOW
  float phase = seed.x * 40.0 + seed.y * 13.0;
  xy += vec2(sin(uTime * ${glsl(SNOW_SWAY_X)} + phase), cos(uTime * ${glsl(SNOW_SWAY_Y)} + phase)) * ${glsl(SNOW_SWAY_M)};
#endif
  vec3 head = vec3(xy, z);
  vec3 h = (modelViewMatrix * vec4(head, 1.0)).xyz;
  // metres per image height at this particle's distance
  float metres = uScreen.x * mix(1.0, -h.z, uScreen.y);
#ifdef SNOW
  float size = max(${glsl(SNOW_SIZE_M)}, metres * ${glsl(SNOW_MIN_SCREEN)});
  vQuad = vec2(position.x * 2.0 - 1.0, position.y);
  vec3 p = h + vec3(vQuad * size * 0.5, 0.0);
#else
  // the streak: from the head back along the velocity, widened across the line of sight
  vec3 t = (modelViewMatrix * vec4(head - normalize(uVelocity) * ${glsl(RAIN_STREAK_M)}, 1.0)).xyz;
  vec3 c = cross(t - h, h);
  float len = length(c);
  vec3 side = len > 1e-6 ? c / len : vec3(1.0, 0.0, 0.0);
  float width = max(${glsl(RAIN_WIDTH_M)}, metres * ${glsl(RAIN_MIN_SCREEN)});
  vQuad = position.xy;
  vec3 p = mix(h, t, position.x) + side * position.y * width * 0.5;
#endif
  vFade = smoothstep(uBoxSize.z, uBoxSize.z - ${glsl(TOP_FADE_M)}, z);
  // under a roof or a level: out of the clip volume, the particle is not drawn
  float cover = textureLod(uCover, (xy - uBoxMin.xy) / uBoxSize.xy, 0.0).r * uBoxSize.z;
  gl_Position = z < cover ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * vec4(p, 1.0);
}
`

const FRAGMENT = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vQuad;
varying float vFade;
void main() {
#ifdef SNOW
  float a = smoothstep(1.0, 0.0, length(vQuad));
#else
  // soft across, bright at the head, fading toward the tail
  float a = (1.0 - abs(vQuad.y)) * mix(1.0, 0.2, vQuad.x);
#endif
  gl_FragColor = vec4(uColor, uOpacity * a * vFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** The quad: x along the streak (0 head, 1 tail) or across the flake, y across (−1 to 1). */
function quad(count: number): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]), 3))
  g.setIndex([0, 2, 1, 2, 3, 1])
  g.instanceCount = count
  return g
}

export class Precipitation {
  readonly kind: PrecipitationKind
  readonly object: Object3D
  readonly count: number
  readonly uniforms: PrecipitationUniforms
  private readonly geometry: InstancedBufferGeometry
  private readonly material: ShaderMaterial

  constructor(box: PrecipitationBox, params: PrecipitationParams) {
    this.kind = params.kind
    const intensity = clamp01(params.intensity)
    const rain = this.kind === 'rain'
    this.count = Math.round(rain ? RAIN_MIN + (RAIN_MAX - RAIN_MIN) * intensity : SNOW_MIN + (SNOW_MAX - SNOW_MIN) * intensity)
    const min = new Vector3(box.min[0] - MARGIN_M, box.min[1] - MARGIN_M, 0)
    const size = new Vector3(box.max[0] + MARGIN_M - min.x, box.max[1] + MARGIN_M - min.y, box.height)
    const map = coverMap(min, size, box.covers ?? [])
    const cover = new DataTexture(map.data, map.width, map.height)
    cover.magFilter = cover.minFilter = NearestFilter
    cover.needsUpdate = true
    this.uniforms = {
      uBoxMin: { value: min },
      uBoxSize: { value: size },
      uOffset: { value: new Vector3() },
      uVelocity: { value: new Vector3(0, 0, -RAIN_FALL_MS) },
      uTime: { value: 0 },
      uScreen: { value: new Vector2(1, 1) },
      uCover: { value: cover },
      uColor: { value: new Color(rain ? 0xa9c0d6 : 0xffffff) },
      uOpacity: { value: 1 },
    }
    this.geometry = quad(this.count)
    this.material = new ShaderMaterial({
      uniforms: this.uniforms as unknown as ShaderMaterial['uniforms'],
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      defines: rain ? {} : { SNOW: '' },
      transparent: true, depthWrite: false,
    })
    this.material.userData.kasbahGpu = 'precipitation'   // its TSL twin: `gpu/shaderMaterials.ts`
    this.material.userData.kasbahPrecipitation = this.kind
    const mesh = new Mesh(this.geometry, this.material)
    // the shader moves the vertices: the bounding volume would be wrong
    mesh.frustumCulled = false
    mesh.name = `precipitation:${this.kind}`
    // the least size on screen depends on the camera that draws
    mesh.onBeforeRender = (_r, _s, camera: Camera) => this.readCamera(camera)
    this.object = mesh
    this.setParams(params)
  }

  /** Changes wind and intensity without rebuilding (the number of particles is fixed at creation). */
  setParams(params: PrecipitationParams): void {
    const intensity = clamp01(params.intensity)
    const rain = this.kind === 'rain'
    // where the wind comes from → where it pushes: the opposite, in (east, north) = (x, y) of the local frame
    const a = (params.windDirDeg * Math.PI) / 180
    const wind = (params.windKmh / 3.6) * (rain ? RAIN_WIND : SNOW_WIND)
    this.uniforms.uVelocity.value.set(-Math.sin(a) * wind, -Math.cos(a) * wind, -(rain ? RAIN_FALL_MS : SNOW_FALL_MS))
    this.uniforms.uOpacity.value = rain ? 0.35 + 0.3 * intensity : 0.75 + 0.2 * intensity
  }

  /** Advances the fall by `dtS` seconds: one offset and one clock, the GPU places the particles. */
  step(dtS: number): void {
    const dt = Math.min(0.1, Math.max(0, dtS))
    const u = this.uniforms
    const size = u.uBoxSize.value, v = u.uVelocity.value, o = u.uOffset.value
    // the offset loops on whole volumes (laps for the height): the shader sees no jump, and the
    // numbers stay small however long it rains
    o.set(wrap(o.x + v.x * dt, size.x), wrap(o.y + v.y * dt, size.y), wrap(o.z - v.z * dt, size.z * LAPS))
    u.uTime.value = wrap(u.uTime.value + dt, SWAY_PERIOD_S)
  }

  private readCamera(camera: Camera): void {
    const scaleY = camera.projectionMatrix.elements[5]!
    const perspective = (camera as PerspectiveCamera).isPerspectiveCamera === true
    this.uniforms.uScreen.value.set(2 / scaleY, perspective ? 1 : 0)
  }

  dispose(): void {
    this.object.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
    this.uniforms.uCover.value.dispose()
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const wrap = (v: number, m: number) => ((v % m) + m) % m
