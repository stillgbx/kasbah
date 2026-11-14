import { DirectionalLightNode, PhongLightingModel, PhysicalLightingModel, type Node, type NodeBuilder } from 'three/webgpu'
import { float, floor, fract, max, mix, normalView, reference, renderGroup, select, smoothstep } from 'three/tsl'
import { sharedUniform } from './shared'
import { toonUniforms } from '../core/toonShading'

// `core/toonShading.ts` in TSL: the sun's share on a face in flat bands, the hard edge of the cast
// shadow. Same uniform object as the GLSL, same curves. No shader text to patch: three's lighting
// models are wrapped, once, for every material.
//
// The models compute `irradiance = dotNL × lightColor` internally: the light colour they receive is
// scaled by `toon(dotNL) / dotNL`, which gives exactly the GLSL's `toon(dotNL) × lightColor` for the
// diffuse AND the specular, as in the patched chunk. Off (0 bands), the factor is 1.

type Vec3 = Node<'vec3'>
interface LightData { lightDirection: Vec3; lightColor: Vec3 }

const bands = sharedUniform(0).onRenderUpdate(() => toonUniforms.kasbahToonBands.value)
const on = bands.greaterThan(0)

/** Rounded to the nearest step, a ramp of 0.1 band: `kasbahToon` of the GLSL. */
function toon(x: Node<'float'>): Node<'float'> {
  const n = max(bands, 1)
  const v = x.mul(n).add(0.5)
  return floor(v).sub(1).add(smoothstep(0, 0.1, fract(v))).div(n)
}

for (const Model of [PhysicalLightingModel, PhongLightingModel]) {
  type Direct = typeof Model.prototype.direct
  const direct = Model.prototype.direct
  Model.prototype.direct = function (this: unknown, ...[input, builder]: Parameters<Direct>) {
    const data = input as unknown as LightData
    const dotNL = normalView.dot(data.lightDirection).clamp()
    const k = select(on, toon(dotNL).div(max(dotNL, 1e-4)), float(1))
    return direct.call(this as InstanceType<typeof Model>, { ...input, lightColor: data.lightColor.mul(k) } as Parameters<Direct>[0], builder)
  }
}

// The sun's shadow: `getShadow` returns mix( 1, shadow, intensity ), the hard edge is taken on the shadow alone.
interface ShadowedLight {
  light: { shadow: object }
  shadowNode?: Node<'float'>
  baseColorNode?: Vec3
  colorNode: Vec3
}
const setupShadow = DirectionalLightNode.prototype.setupShadow as (this: ShadowedLight, builder: NodeBuilder) => void
DirectionalLightNode.prototype.setupShadow = function (this: ShadowedLight, builder: NodeBuilder) {
  setupShadow.call(this, builder)
  const s = this.shadowNode
  // the context's own shadow (a shadow mask pass) is left alone, as is a light without one
  if (!s || !this.baseColorNode || (builder.context as { getShadow?: unknown }).getShadow) return
  const intensity = reference('intensity', 'float', this.light.shadow).setGroup(renderGroup) as unknown as Node<'float'>
  const lo = intensity.oneMinus()
  const hard = mix(lo, 1, smoothstep(0.4, 0.6, s.sub(lo).div(max(intensity, 1e-4))))
  this.colorNode = this.baseColorNode.mul(select(on.and(intensity.greaterThan(0)), hard, s))
} as typeof DirectionalLightNode.prototype.setupShadow
