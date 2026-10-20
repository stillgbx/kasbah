import type { Color, MeshStandardMaterial, Texture, WebGLRenderer } from 'three'
import {
  AdditiveBlending, InstancedBufferGeometry, LinearFilter, LinearMipmapLinearFilter, Mesh, OrthographicCamera,
  PlaneGeometry, RepeatWrapping, Scene, ShaderMaterial, Color as ThreeColor, Vector3, WebGLRenderTarget,
} from 'three'
import { applyLevelLight } from '../core/levelLight'
import { applyHeightMist } from '../core/heightMist'
import { applyLevelFade } from '../core/levelFade'
import { applyRoomFocus } from '../core/roomFocus'

// Pool water that no longer pretends. Three moves, on the two materials of the basin
// (`builders/materials.ts`):
//  - the SURFACE ripples: a swell of some twenty waves tilts the normal (the sun's highlight, reflection
//    of the sky), and it follows FRESNEL: transparent seen from above, a mirror seen at a grazing angle;
//  - the BOTTOM receives CAUSTICS by REFRACTION: each point of a grid on the surface bends
//    the light according to its slope, and where the rays converge on the tiling, the light
//    concentrates. It is the method of *WebGL Water* (Evan Wallace, MIT) taken up by clearwater
//    (Aureliengmz, MIT); the lines are rewritten here;
//  - the bottom is seen THROUGH the water: the light loses its colors there according to the path traveled (the
//    red first), and the water scatters its own tint instead. Hence the blue that deepens with
//    depth and with the angle.
//
// What it costs: a 512 × 512 px pass per animation step (the refracted grid, additive)
// and a few dozen instructions on the POOL'S PIXELS. The real cost remains the render loop
// that animated water keeps running (`core/renderLoop.ts`); it is `HouseScene.syncWater` that
// decides when.

/** The role of the patched material: the water sheet, or the walls and the bottom seen from inside. */
export type WaterRole = 'surface' | 'basin'

/** The animation time, in seconds. SHARED: swell and caustics must beat together. */
export type WaterTime = { value: number }

/** What stays adjustable afterward: 0 = frozen water (the "maquette" style, low quality). */
export type WaterStrength = { value: number }

/** What the two materials share: the time, the caustics map, the water tint. */
export interface WaterUniforms {
  time: WaterTime
  caustics: { value: Texture | null }
  /** Tint the water SCATTERS (the style's), and what it absorbs per meter, derived from it. */
  tint: { value: Color }
  sigma: { value: Vector3 }
  /** The sunlight ENTERING the water (world, downward), and that ray once refracted by flat water. */
  light: { value: Vector3 }
  refracted: { value: Vector3 }
  /** The wind: (x, y) = where it pushes, in the world xz plane (unit); z = swell amplitude (1 = a 10 km/h breeze). */
  wind: { value: Vector3 }
}

/** Name of the basin's vertex attribute: its depth under the water sheet, in meters. */
export const WATER_DEPTH_ATTRIBUTE = 'waterDepth'

/**
 * The pattern is PERIODIC over a 5 m tile: all waves have a whole number of
 * periods in it, so the caustics map repeats seamlessly over the bottom — and at 5 m, more than the
 * length of half a basin, the repetition no longer reads.
 */
const TILE_M = 5
/** Distance from the water sheet to the bottom (`POOL_DEPTH − POOL_WATER_DROP` of `buildHouse`): where the light concentrates. */
const FLOOR_DEPTH_M = 1.38
const CAUSTIC_PX = 512
const CAUSTIC_GRID = 256
/** The caustics average 1 and climb to ~4 on the lines: stored at a quarter in 8 bits. */
const CAUSTIC_RANGE = 4
/** What the water absorbs, per meter, of what is NOT its tint (-ln of the tint × this factor). */
const ABSORPTION_PER_M = 0.3

/** A wave: wave vector (rad/m), amplitude (m), angular frequency (rad/s), phase at the origin. */
export interface Wave { kx: number; ky: number; a: number; w: number; phase: number }

/**
 * The swell: some twenty DRAWN waves (fixed seed, so the same water at every load), not
 * chosen — eight hand-placed waves made a network that was too regular. Wavelengths from
 * 25 cm to 2.5 m, spread logarithmically; directions grouped around the wind (±70°), a third as
 * free chop; random phases, otherwise all the crests meet at the origin. The waves
 * are drawn in the WIND FRAME (+x = where it pushes): the shader brings each point into it
 * (`kasbahToWind`), and the swell turns with the real wind without being redrawn.
 *
 * It is the CURVATURE (A·k²) that concentrates the light: at a 1.4 m bottom ~3 is needed for a sharp
 * line. Each wave carries ~0.6; it is their meetings that draw the network. The amplitude
 * is capped at 1.2 cm: the long waves make the reflections, not beach waves. Each
 * vector is rounded onto the tile grid (periodicity). The angular frequency follows the dispersion of
 * gravity waves (√gk), slowed down.
 */
function drawWaves(): Wave[] {
  let seed = 0x6b617362
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const k0 = (2 * Math.PI) / TILE_M
  const wind = 0
  const seen = new Set<string>()
  const waves: Wave[] = []
  while (waves.length < 20) {
    const lambda = 0.25 * Math.pow(10, rand())
    const dir = rand() < 0.66 ? wind + (rand() - 0.5) * 2.4 : rand() * 2 * Math.PI
    const k = (2 * Math.PI) / lambda
    const m = Math.round((k * Math.cos(dir)) / k0), n = Math.round((k * Math.sin(dir)) / k0)
    if ((m === 0 && n === 0) || seen.has(`${m},${n}`)) continue
    seen.add(`${m},${n}`)
    const kl = k0 * Math.hypot(m, n)
    waves.push({
      kx: m * k0, ky: n * k0,
      a: Math.min((0.6 * (0.7 + 0.6 * rand())) / (kl * kl), 0.012),
      w: 0.3 * Math.sqrt(9.81 * kl),
      phase: rand() * 2 * Math.PI,
    })
  }
  return waves
}
/** Exported for the tests: that they do start downwind. */
export const WAVES: readonly Wave[] = drawWaves()

const glsl = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x))

/**
 * The wind frame: `uWaterWind.xy` is the direction it pushes (world xz plane). The waves are
 * drawn in it; a world point enters it through `kasbahToWind`, a slope leaves it through `kasbahFromWind`.
 * The caustics map is a tile of THIS frame: the bottom therefore reads it through `kasbahToWind` too.
 */
const WIND_FRAME = /* glsl */`
uniform vec3 uWaterWind;
vec2 kasbahToWind(vec2 w) { return vec2(dot(w, uWaterWind.xy), dot(w, vec2(-uWaterWind.y, uWaterWind.x))); }
vec2 kasbahFromWind(vec2 v) { return vec2(v.x * uWaterWind.x - v.y * uWaterWind.y, v.x * uWaterWind.y + v.y * uWaterWind.x); }
`

/**
 * The SLOPE of the swell (its gradient), not its height: it is what tilts the normal. `px` is
 * the size of a pixel on the ground (m): a wave shorter than a few pixels fades out instead of
 * flickering. The caustics pass asks for it at 0 (it wants all the waves). The phase is
 * `k·p − ωt`: each wave ADVANCES in the direction of its vector, hence downwind. `p` and the
 * result are in the wind frame, the amplitude is the wind's (`uWaterWind.z`).
 */
const WAVE_GRAD = /* glsl */`
vec2 kasbahWaveGrad(vec2 p, float t, float px) {
  vec2 g = vec2(0.0);
  vec2 k;
${WAVES.map(({ kx, ky, a, w, phase }) => `  k = vec2(${glsl(kx)}, ${glsl(ky)});
  g += k * (${glsl(a)} * cos(dot(k, p) - ${glsl(w)} * t + ${glsl(phase)}) * (1.0 - smoothstep(0.15, 0.5, px * ${glsl(Math.hypot(kx, ky) / (2 * Math.PI))})));`).join('\n')}
  return g * uWaterWind.z;
}
`

const COMMON = /* glsl */`
varying vec3 vWaterPos;
uniform float uWaterTime;
uniform float uWaterStrength;
${WIND_FRAME}`

const BASIN_COMMON = /* glsl */`
varying float vWaterDepth;
uniform sampler2D uWaterCaustics;
uniform vec3 uWaterTint;
uniform vec3 uWaterSigma;
uniform vec3 uWaterRefracted;
`

/**
 * The surface: the swell tilts the normal (slope in the WORLD frame, the water plane is horizontal;
 * `normal` in the CAMERA frame — hence `viewMatrix`), then Fresnel decides the opacity: seen from above
 * one sees the bottom (which `BASIN_*` tints), seen at a grazing angle one only sees the reflection. F₀ = 0.02,
 * that of water.
 */
const SURFACE = /* glsl */`
  float waterPx = length(fwidth(vWaterPos.xz));
  vec2 waveG = kasbahFromWind(kasbahWaveGrad(kasbahToWind(vWaterPos.xz), uWaterTime, waterPx)) * uWaterStrength;
  normal = normalize(normal + (viewMatrix * vec4(-waveG.x, 0.0, -waveG.y, 0.0)).xyz);
  float waterCos = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float waterFresnel = 0.02 + 0.98 * pow(1.0 - waterCos, 5.0);
  diffuseColor.a = mix(diffuseColor.a * 0.55, 1.0, waterFresnel);
`

/**
 * The basin, before lighting: where does it fall in the caustics map? The map is that of the
 * BOTTOM; a wall point reads in it the spot where the sun ray hitting it would have ended its course
 * (extended down to the bottom, along the refracted sun's axis). The wall facing the sun therefore
 * receives the network, the one turning its back on it does not (three's lighting already leaves it without direct
 * sun). The closer a point is to the surface, the less the swell has concentrated the light there: the weight
 * follows the depth.
 */
const BASIN_PRE = /* glsl */`
  float causticDepth = clamp(vWaterDepth, 0.0, ${glsl(FLOOR_DEPTH_M)});
  vec2 causticAt = vWaterPos.xz + uWaterRefracted.xz * ((${glsl(FLOOR_DEPTH_M)} - causticDepth) / -uWaterRefracted.y);
  float caustic = texture2D(uWaterCaustics, kasbahToWind(causticAt) * ${glsl(1 / TILE_M)}).r * ${glsl(CAUSTIC_RANGE)};
  float causticWeight = sqrt(causticDepth * ${glsl(1 / FLOOR_DEPTH_M)});
`

/**
 * The caustics redistribute the DIRECT light (the sun): they go out by themselves in the shade
 * and at night, and their average stays 1 — the bottom is not lighter, it is patterned.
 */
const BASIN_LIGHT = /* glsl */`
  reflectedLight.directDiffuse *= mix(1.0, caustic, causticWeight * uWaterStrength);
`

/**
 * The bottom seen through the water: the path of the light (down to the bottom, back up toward
 * the eye, all the longer as the gaze grazes), the absorption that results, and the tint that the water
 * scatters instead, in proportion to the light received here.
 */
const BASIN_POST = /* glsl */`
  float waterUp = max(normalize(cameraPosition - vWaterPos).y, 0.1);
  float waterPath = min(max(vWaterDepth, 0.0) * (1.0 + 1.0 / waterUp), 12.0);
  vec3 waterT = exp(-uWaterSigma * waterPath);
  float waterLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight = outgoingLight * waterT + uWaterTint * waterLum * (1.0 - waterT);
`

/** The shared uniforms, neutral tint until the first `setWaterTint`. */
export function createWaterUniforms(): WaterUniforms {
  return {
    time: { value: 0 },
    caustics: { value: null },
    tint: { value: new ThreeColor(1, 1, 1) },
    sigma: { value: new Vector3() },
    light: { value: new Vector3(0, -1, 0) },
    refracted: { value: new Vector3(0, -1, 0) },
    wind: { value: new Vector3(1, 0, 1) },
  }
}

/** Index of water: air over water, for `refract`. */
const ETA = 1 / 1.333
/** A sun lower than this (or set: the moon follows the same path) is held at this elevation. */
const MIN_SUN_ELEVATION = Math.sin((5 * Math.PI) / 180)

/**
 * The direction of the sun (three world, TOWARD it): the caustics follow it. A low sun enters
 * at a slant — the network shifts and stretches along its axis, and it is the wall facing it that
 * receives it. Refraction brings the ray back toward the vertical (at most 48.6°, the critical angle of water).
 */
export function setWaterSun(u: WaterUniforms, sunDir: Vector3): void {
  const l = u.light.value.copy(sunDir).normalize().negate()
  if (-l.y < MIN_SUN_ELEVATION) {
    const h = Math.hypot(l.x, l.z) || 1
    const c = Math.sqrt(1 - MIN_SUN_ELEVATION * MIN_SUN_ELEVATION)
    l.set((l.x / h) * c, -MIN_SUN_ELEVATION, (l.z / h) * c)
  }
  // refract(l, n = (0, 1, 0), ETA), written out flat: calm water
  const cosI = -l.y
  const k = Math.sqrt(1 - ETA * ETA * (1 - cosI * cosI))
  u.refracted.value.set(ETA * l.x, ETA * l.y + (ETA * cosI - k), ETA * l.z).normalize()
}

/** Without wind, the pool does not quite sleep (the filtration); in strong wind, the swell caps out. */
const CALM_WAVES = 0.15
const MAX_WAVES = 1.5

/**
 * The wind (weather convention: `windDirDeg` is where it COMES FROM, clockwise, counted from the plan's
 * +y — the house heading already subtracted by the caller): the swell
 * heads downwind, and its amplitude follows the square root of the speed — 1 at 10 km/h, the former swell.
 * three frame: plan +x = +x, plan +y = −z.
 */
export function setWaterWind(u: WaterUniforms, windKmh: number, windDirDeg: number): void {
  const a = (windDirDeg * Math.PI) / 180
  const amp = Math.min(MAX_WAVES, CALM_WAVES + (1 - CALM_WAVES) * Math.sqrt(Math.max(windKmh, 0) / 10))
  u.wind.value.set(-Math.sin(a), Math.cos(a), amp)
}

/** The water tint (the style's, linear): what it scatters, and therefore what it absorbs. */
export function setWaterTint(u: WaterUniforms, tint: Color): void {
  u.tint.value.copy(tint)
  const s = (c: number) => -Math.log(Math.max(c, 0.03)) * ABSORPTION_PER_M
  u.sigma.value.set(s(tint.r), s(tint.g), s(tint.b))
}

/**
 * Makes a water material ALIVE. The patch survives style changes: `applyLook` mutates the
 * same materials (it does not recreate them), and a recompilation goes through `onBeforeCompile` again.
 * The strength is returned: it is the only setting that moves afterward, frame after frame.
 */
export function makeWaterAlive(mat: MeshStandardMaterial, role: WaterRole, water: WaterUniforms): WaterStrength {
  const strength: WaterStrength = { value: 0 }
  const basin = role === 'basin'
  // the water is in the garden: no indoor lamp reaches it (`core/levelLight.ts`)
  mat.userData.noLamps = true
  mat.onBeforeCompile = (shader) => {
    applyLevelLight(shader, mat)
    applyHeightMist(shader, mat)
    applyLevelFade(shader, mat)
    applyRoomFocus(shader, mat)
    shader.uniforms.uWaterTime = water.time
    shader.uniforms.uWaterStrength = strength
    shader.uniforms.uWaterWind = water.wind
    if (basin) {
      shader.uniforms.uWaterCaustics = water.caustics
      shader.uniforms.uWaterTint = water.tint
      shader.uniforms.uWaterSigma = water.sigma
      shader.uniforms.uWaterRefracted = water.refracted
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWaterPos;${basin ? `\nattribute float ${WATER_DEPTH_ATTRIBUTE};\nvarying float vWaterDepth;` : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n  vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;${basin ? `\n  vWaterDepth = ${WATER_DEPTH_ATTRIBUTE};` : ''}`)
    let frag = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}${basin ? BASIN_COMMON : WAVE_GRAD}`)
      // after the emissive: the normal is set there (maps included) and `lights_fragment_begin`,
      // which will read it, has not run yet.
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${basin ? BASIN_PRE : SURFACE}`)
    if (basin) {
      frag = frag
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${BASIN_LIGHT}`)
        .replace('#include <opaque_fragment>', `${BASIN_POST}\n#include <opaque_fragment>`)
    }
    shader.fragmentShader = frag
  }
  // Without its own key, three would reuse the program of a standard material with the same settings —
  // and the water would be rendered by a shader that did not receive the patch.
  mat.customProgramCacheKey = () => `kasbah-water-${role}`
  mat.needsUpdate = true
  return strength
}

const CAUSTIC_VERTEX = /* glsl */`
uniform float uTime;
uniform vec3 uLight;
out vec2 vOld;
out vec2 vNew;
${WIND_FRAME}${WAVE_GRAD}
void main() {
  // nine copies of the tile (3 × 3): a ray bent out of the tile lands in the neighboring one
  vec2 offset = vec2(float(gl_InstanceID % 3) - 1.0, float(gl_InstanceID / 3) - 1.0);
  vec2 p = position.xy * ${glsl(TILE_M)};
  vec2 g = kasbahWaveGrad(p, uTime, 0.0);
  // the tile is in the wind frame: the sun enters it too
  vec2 l = kasbahToWind(uLight.xz);
  vec3 r = refract(vec3(l.x, uLight.y, l.y), normalize(vec3(-g.x, 1.0, -g.y)), ${glsl(ETA)});
  vec2 q = p + r.xz * (${glsl(FLOOR_DEPTH_M)} / -r.y);
  vOld = p;
  vNew = q;
  gl_Position = vec4((q * ${glsl(1 / TILE_M)} + offset) * 2.0 - 1.0, 0.0, 1.0);
}
`

// The intensity: the area of a cell at the surface over the area it covers at the bottom. Folded
// cells overlap, and additive blending sums them.
const CAUSTIC_FRAGMENT = /* glsl */`
in vec2 vOld;
in vec2 vNew;
void main() {
  vec2 ox = dFdx(vOld), oy = dFdy(vOld), nx = dFdx(vNew), ny = dFdy(vNew);
  float ratio = abs(ox.x * oy.y - ox.y * oy.x) / max(abs(nx.x * ny.y - nx.y * ny.x), 1e-12);
  gl_FragColor = vec4(vec3(ratio * ${glsl(1 / CAUSTIC_RANGE)}), 1.0);
}
`

const clearColor = new ThreeColor()

/**
 * The caustics map: a bottom tile, redrawn when the water or the sun has moved. Rendered
 * BEFORE the frame, by `HouseScene.render`; read by the basin material, repeated.
 */
export class WaterCaustics {
  readonly target = new WebGLRenderTarget(CAUSTIC_PX, CAUSTIC_PX, {
    depthBuffer: false, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
    wrapS: RepeatWrapping, wrapT: RepeatWrapping,
  })
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera()
  private readonly material: ShaderMaterial
  private readonly geometry = new InstancedBufferGeometry()
  private drawnAt = Number.NaN
  private readonly drawnLight = new Vector3()
  private readonly drawnWind = new Vector3()

  constructor(private readonly water: WaterUniforms) {
    const plane = new PlaneGeometry(1, 1, CAUSTIC_GRID, CAUSTIC_GRID).translate(0.5, 0.5, 0)
    this.geometry.index = plane.index
    this.geometry.setAttribute('position', plane.getAttribute('position'))
    this.geometry.instanceCount = 9
    this.material = new ShaderMaterial({
      uniforms: { uTime: water.time, uLight: water.light, uWaterWind: water.wind },
      vertexShader: CAUSTIC_VERTEX,
      fragmentShader: CAUSTIC_FRAGMENT,
      blending: AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    })
    const mesh = new Mesh(this.geometry, this.material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
  }

  get texture(): Texture { return this.target.texture }

  /** Redraws the map if the water, the sun or the wind has moved since; puts the renderer back as it found it. */
  update(r: WebGLRenderer): void {
    const w = this.water
    if (w.time.value === this.drawnAt && w.light.value.equals(this.drawnLight) && w.wind.value.equals(this.drawnWind)) return
    this.drawnAt = w.time.value
    this.drawnLight.copy(w.light.value)
    this.drawnWind.copy(w.wind.value)
    const prevTarget = r.getRenderTarget()
    const prevAlpha = r.getClearAlpha()
    r.getClearColor(clearColor)
    r.setRenderTarget(this.target)
    r.setClearColor(0x000000, 1)
    r.clear(true, false, false)
    r.render(this.scene, this.camera)
    r.setClearColor(clearColor, prevAlpha)
    r.setRenderTarget(prevTarget)
  }

  dispose(): void {
    this.target.dispose()
    this.geometry.dispose()
    this.material.dispose()
  }
}
