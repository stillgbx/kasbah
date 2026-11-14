import { Vector3, type Camera } from 'three'
import type { Node, TextureNode } from 'three/webgpu'
import { abs, float, max, mix, screenSize, screenUV, select, smoothstep, uniform, vec2, vec4 } from 'three/tsl'
import { OUTLINE_RAMP } from '../core/post'
import type { OutlineLook } from '../styles/types'

// The ink lines of `core/post.ts` (`SCENE_COPY_SHADER`) in TSL: the SECOND difference of the depth
// across the pixel, zero on a flat face, brought back to a change of slope by the size of a pixel.
// Read in the scene pass's own depth (the one the occlusion reads), before the occlusion and the bloom.

type Float = Node<'float'>

export function outline(camera: Camera, pixelRatio: () => number) {
  const cam = camera as Camera & { near: number; far: number; isOrthographicCamera?: boolean }
  const strength = uniform(0)
  const ink = uniform(new Vector3(0, 0, 0))
  const near = uniform(0.1).onRenderUpdate(() => cam.near)
  const far = uniform(500).onRenderUpdate(() => cam.far)
  const ortho = uniform(0).onRenderUpdate(() => (cam.isOrthographicCamera ? 1 : 0))
  const p5 = uniform(1).onRenderUpdate(() => cam.projectionMatrix.elements[5]!)
  // a step of one CSS pixel: the line keeps its width on a dense screen
  const step = uniform(1).onRenderUpdate(() => Math.max(1, Math.round(pixelRatio())))

  const apply = (color: Node<'vec4'>, depth: TextureNode): Node<'vec4'> => {
    const isOrtho = ortho.greaterThan(0.5)
    const w = (d: Float): Float => select(isOrtho, near.add(far.sub(near).mul(d)), far.sub(far.sub(near).mul(d)))
    const at = (dx: number, dy: number): Float => depth.sample(screenUV.add(vec2(dx, dy).mul(step).div(screenSize))).x as unknown as Float
    const pixelSize = step.mul(2).div(p5.mul(screenSize.y))
    const wc = w(at(0, 0))
    const crease = (a: Float, b: Float): Float => {
      const e = abs(w(a).add(w(b)).sub(wc.mul(2)))
      return select(isOrtho, e.div(pixelSize), e.div(wc.mul(pixelSize)))
    }
    const m = max(crease(at(-1, 0), at(1, 0)), crease(at(0, -1), at(0, 1)))
    const line = smoothstep(float(OUTLINE_RAMP[0]), float(OUTLINE_RAMP[1]), m)
    return vec4(mix(color.rgb, ink, line.mul(strength)), color.a)
  }

  return {
    apply,
    /** Whether the lines are in the graph: a style without them does not pay for their reads. */
    set(look: OutlineLook | null | undefined): boolean {
      strength.value = look?.strength ?? 0
      if (look) ink.value.set(...look.color)
      return strength.value > 0
    },
  }
}
