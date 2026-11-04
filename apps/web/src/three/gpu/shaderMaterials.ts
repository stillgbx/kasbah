import { Texture, type Color, type Vector2 } from 'three'
import { NodeMaterial, type NodeBuilder } from 'three/webgpu'
import { atan, cos, float, mix, positionLocal, texture, uniform, uv, vec4 } from 'three/tsl'
import { causticPass } from './water'

// Our `ShaderMaterial`s in TSL. `WebGPURenderer` cannot draw GLSL: it converts a material through
// its node library (`NodeLibrary.fromMaterial`), which copies every property of the original — its
// `uniforms` and `userData` included, by reference. Registered for the `ShaderMaterial` type, this
// class reads the material's tag (`userData.kasbahGpu`) and builds the same image from the same
// uniform objects: the WebGL code only has to tag its material.
//
// Each tagged material gets its own shader (`materialHooks.ts` adds its uuid to the cache key): the
// uniforms below are read from THIS material's objects.

export type GpuShaderTag = 'marker-wave' | 'screen-art' | 'water-caustics'

type Uniforms = Record<string, { value: unknown }>
const follow = (u: { value: unknown }) => uniform(u.value as number).onRenderUpdate(() => u.value as number)
const BLANK = new Texture()

export class KasbahShaderNodeMaterial extends NodeMaterial {
  declare uniforms: Uniforms

  override setup(builder: NodeBuilder): void {
    const u = this.uniforms
    switch ((this.userData as { kasbahGpu?: GpuShaderTag }).kasbahGpu) {
      // `markers.ts`, `waveMaterial`: flat colour, the opacity of the animation, and for a device that
      // looks somewhere a fade around the ring (1 in front, +y local, almost nothing behind)
      case 'marker-wave': {
        const front = cos(atan(positionLocal.x, positionLocal.y)).mul(0.5).add(0.5)
        const fade = mix(float(1), front.mul(front).mul(0.9).add(0.1), follow(u.uDirectional!))
        this.colorNode = vec4(uniform(u.uColor!.value as Color), follow(u.uOpacity!).mul(fade))
        break
      }
      // `screenArt.ts`, `artMaterial`: the framed image, under a black veil that darkens toward the bottom
      case 'screen-art': {
        const map = texture((u.uMap!.value as Texture | null) ?? BLANK).onRenderUpdate(() => (u.uMap!.value as Texture | null) ?? BLANK)
        const c = map.sample(uv().mul(uniform(u.uCrop!.value as Vector2)).add(uniform(u.uCropOffset!.value as Vector2)))
        const shade = uniform(u.uShade!.value as Vector2)
        this.colorNode = vec4(c.rgb.mul(mix(shade.y, shade.x, uv().y).oneMinus()), c.a)
        break
      }
      // `water.ts`, `WaterCaustics`: the refracted grid, drawn additively into the caustics map
      case 'water-caustics': {
        const { vertex, colour } = causticPass(u)
        this.vertexNode = vertex
        this.colorNode = colour
        break
      }
    }
    super.setup(builder)
  }
}
