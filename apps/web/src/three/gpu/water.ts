import { Texture, type Material, type Vector3 } from 'three'
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, NodeMaterial, type Node, type NodeBuilder } from 'three/webgpu'
import {
  abs, attribute, cameraPosition, cameraViewMatrix, clamp, cos, dFdx, dFdy, dot, exp, float, fwidth, instanceIndex, length, materialOpacity,
  max, min, mix, normalView, normalize, positionGeometry, positionView, positionWorld, refract, smoothstep, sqrt, varying, vec2, vec3, vec4,
} from 'three/tsl'
import { sharedTexture, sharedUniform } from './shared'
import { CAUSTIC_RANGE, ETA, FLOOR_DEPTH_M, TILE_M, WATER_DEPTH_ATTRIBUTE, WAVES, waterOf } from '../effects/water'

// `effects/water.ts` in TSL: the swell of the surface, the caustics on the bottom, the water seen
// through. Same numbers, same uniform objects (`waterOf` gives each water material's own); the
// caustics map is drawn by the same `WaterCaustics` class, its material being redone in
// `shaderMaterials.ts` from `causticVertex` / `causticColour` below.

type V2 = Node<'vec2'>
type F = Node<'float'>

const follow = (u: { value: number }) => sharedUniform(u.value).onRenderUpdate(() => u.value)
const BLANK = new Texture()

/** The wind frame (`WIND_FRAME` in the GLSL): the waves are drawn in it. */
const toWind = (w: V2, wind: Node<'vec3'>): V2 => vec2(dot(w, wind.xy), dot(w, vec2(wind.y.negate(), wind.x)))
const fromWind = (v: V2, wind: Node<'vec3'>): V2 => vec2(v.x.mul(wind.x).sub(v.y.mul(wind.y)), v.x.mul(wind.y).add(v.y.mul(wind.x)))

/** The SLOPE of the swell, in the wind frame (`kasbahWaveGrad`); `px` = 0 keeps every wave. */
function waveGrad(p: V2, t: F, px: F | null, wind: Node<'vec3'>): V2 {
  let g: V2 = vec2(0, 0)
  for (const { kx, ky, a, w, phase } of WAVES) {
    const k = vec2(kx, ky)
    let term: F = cos(dot(k, p).sub(t.mul(w)).add(phase)).mul(a)
    if (px) term = term.mul(smoothstep(0.15, 0.5, px.mul(Math.hypot(kx, ky) / (2 * Math.PI))).oneMinus())
    g = g.add(k.mul(term)) as V2
  }
  return g.mul(wind.z) as V2
}

// —— the surface: the swell tilts the normal, Fresnel decides the opacity ——————————————

const setup = NodeMaterial.prototype.setup
NodeMaterial.prototype.setup = function (this: NodeMaterial, builder: NodeBuilder) {
  const w = waterOf(builder.material)
  if (w?.role === 'surface') {
    const wind = sharedUniform(w.water.wind.value)
    const at = positionWorld.xz
    const g = fromWind(waveGrad(toWind(at, wind), follow(w.water.time), length(fwidth(at)), wind), wind).mul(follow(w.strength))
    const n = normalize(normalView.add(cameraViewMatrix.mul(vec4(g.x.negate(), 0, g.y.negate(), 0)).xyz))
    this.normalNode = n
    // F₀ = 0.02, that of water: transparent seen from above, a mirror at a grazing angle
    const fresnel = clamp(dot(n, normalize(positionView.negate())), 0, 1).oneMinus().pow(5).mul(0.98).add(0.02)
    this.opacityNode = mix(materialOpacity.mul(0.55), float(1), fresnel)
  }
  return setup.call(this, builder)
}

// —— the bottom: caustics on the direct light, then the water it is seen through ——————————

const depthUnderWater = attribute(WATER_DEPTH_ATTRIBUTE, 'float') as unknown as F

/** Where the bottom reads the caustics map, and how much (`BASIN_PRE`): the multiplier of the direct diffuse light. */
function causticFactor(material: Material): F | null {
  const w = waterOf(material)
  if (w?.role !== 'basin') return null
  const { water } = w
  const wind = sharedUniform(water.wind.value)
  const refracted = sharedUniform(water.refracted.value as Vector3)
  const map = sharedTexture(water.caustics.value ?? BLANK).onRenderUpdate(() => water.caustics.value ?? BLANK)
  const d = clamp(depthUnderWater, 0, FLOOR_DEPTH_M)
  const at = positionWorld.xz.add(refracted.xz.mul(float(FLOOR_DEPTH_M).sub(d).div(refracted.y.negate())))
  const caustic = map.sample(toWind(at, wind).mul(1 / TILE_M)).r.mul(CAUSTIC_RANGE)
  const weight = sqrt(d.mul(1 / FLOOR_DEPTH_M))
  return mix(float(1), caustic, weight.mul(follow(w.strength)))
}

// The caustics redistribute the DIRECT diffuse light only (`BASIN_LIGHT`). When `finish` runs, three
// has already summed it into the outgoing light: the same product is reached by adding its excess.
type LightingModel = { finish(builder: NodeBuilder): void }
for (const MaterialClass of [MeshStandardNodeMaterial, MeshPhysicalNodeMaterial]) {
  // three passes the builder (`NodeMaterial.setupLighting`), its typings do not say so
  const proto = MaterialClass.prototype as unknown as { setupLightingModel(builder: NodeBuilder): LightingModel | null }
  const setupLightingModel = proto.setupLightingModel
  proto.setupLightingModel = function (this: NodeMaterial, builder: NodeBuilder) {
    const model = setupLightingModel.call(this, builder)
    const factor = causticFactor(builder.material)
    if (!factor || !model) return model
    const finish = model.finish.bind(model)
    model.finish = (b: NodeBuilder) => {
      finish(b)
      const { outgoingLight, reflectedLight } = (b as unknown as { context: { outgoingLight: Node<'vec3'>; reflectedLight: { directDiffuse: Node<'vec3'> } } }).context
      outgoingLight.addAssign(reflectedLight.directDiffuse.mul(factor.sub(1)))
    }
    return model
  }
}

/** The bottom seen through the water (`BASIN_POST`): absorption along the path, the water's tint scattered instead. */
export function basinThroughWater(material: Material, out: Node<'vec4'>): Node<'vec4'> {
  const w = waterOf(material)
  if (w?.role !== 'basin') return out
  const sigma = sharedUniform(w.water.sigma.value)
  const tint = sharedUniform(w.water.tint.value)
  const up = max(normalize(cameraPosition.sub(positionWorld)).y, 0.1)
  const path = min(max(depthUnderWater, 0).mul(float(1).add(float(1).div(up))), 12)
  const through = exp(sigma.negate().mul(path))
  const lum = dot(out.rgb, vec3(0.2126, 0.7152, 0.0722))
  return vec4(out.rgb.mul(through).add(tint.mul(lum).mul(through.oneMinus())), out.a)
}

// —— the caustics map (`CAUSTIC_VERTEX`, `CAUSTIC_FRAGMENT`) ————————————————————————

/** The refracted grid: nine copies of the tile, each point moved to where its ray meets the bottom. */
export function causticPass(uniforms: Record<string, { value: unknown }>): { vertex: Node<'vec4'>; colour: Node<'vec4'> } {
  const time = follow(uniforms.uTime as { value: number })
  const light = sharedUniform(uniforms.uLight!.value as Vector3)
  const wind = sharedUniform(uniforms.uWaterWind!.value as Vector3)
  const offset = vec2(float(instanceIndex.mod(3)).sub(1), float(instanceIndex.div(3)).sub(1))
  const p = positionGeometry.xy.mul(TILE_M)
  const g = waveGrad(p, time, null, wind)
  const l = toWind(light.xz, wind)
  const r = refract(vec3(l.x, light.y, l.y), normalize(vec3(g.x.negate(), 1, g.y.negate())), ETA)
  const q = p.add(r.xz.mul(float(FLOOR_DEPTH_M).div(r.y.negate())))
  const before = varying(p), after = varying(q)
  const vertex = vec4(q.mul(1 / TILE_M).add(offset).mul(2).sub(1), 0, 1)
  // the intensity: the area of a cell at the surface over the area it covers at the bottom
  const ox = dFdx(before), oy = dFdy(before), nx = dFdx(after), ny = dFdy(after)
  const ratio = abs(ox.x.mul(oy.y).sub(ox.y.mul(oy.x))).div(max(abs(nx.x.mul(ny.y).sub(nx.y.mul(ny.x))), 1e-12))
  return { vertex, colour: vec4(vec3(ratio.mul(1 / CAUSTIC_RANGE)), 1) }
}
