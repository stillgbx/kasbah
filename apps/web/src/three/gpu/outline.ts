import { Vector2, Vector3, type Camera, type DirectionalLight, type Scene } from 'three'
import type { Node, TextureNode } from 'three/webgpu'
import { abs, float, max, mix, screenSize, screenUV, select, smoothstep, uniform, vec2, vec4 } from 'three/tsl'
import { OUTLINE_RAMP, RIM_GAP, findSun, rimFrame } from '../core/post'
import type { OutlineLook, RimLook } from '../styles/types'

// The ink lines and the rim light of `core/post.ts` (`SCENE_COPY_SHADER`) in TSL, read in the scene
// pass's own depth (the one the occlusion reads), before the occlusion and the bloom.
//  - ink: the SECOND difference of the depth across the pixel, zero on a flat face, brought back to a
//    change of slope by the size of a pixel;
//  - rim: a pixel whose neighbour toward the light is far behind it is on the lit edge (`rimFrame`).
// Each enters the graph only when the style asks for it: a style that draws nothing reads no depth.

type Float = Node<'float'>

export function outline(camera: Camera, scene: Scene, pixelRatio: () => number) {
  const cam = camera as Camera & { near: number; far: number; isOrthographicCamera?: boolean }
  let ink: OutlineLook | null = null
  let rim: RimLook | null = null
  let sun: DirectionalLight | null = null
  const rimPx = new Vector2()

  const inkStrength = uniform(0)
  const inkColor = uniform(new Vector3(0, 0, 0))
  const rimColor = uniform(new Vector3(0, 0, 0))
  const near = uniform(0.1).onRenderUpdate(() => cam.near)
  const far = uniform(500).onRenderUpdate(() => cam.far)
  const ortho = uniform(0).onRenderUpdate(() => (cam.isOrthographicCamera ? 1 : 0))
  const p5 = uniform(1).onRenderUpdate(() => cam.projectionMatrix.elements[5]!)
  // a step of one CSS pixel: the line keeps its width on a dense screen
  const stepOf = () => Math.max(1, Math.round(pixelRatio()))
  const step = uniform(1).onRenderUpdate(stepOf)
  const rimAt = () => { sun ??= findSun(scene); return rimFrame(cam, sun, rim, stepOf(), rimPx) }
  const rimStrength = uniform(0).onRenderUpdate(rimAt)
  // in pixels; `screenUV` runs DOWN the screen, the light's side is counted up
  const rimOffset = uniform(new Vector2()).onRenderUpdate(() => { rimAt(); return new Vector2(rimPx.x, -rimPx.y) })

  const apply = (color: Node<'vec4'>, depth: TextureNode): Node<'vec4'> => {
    const isOrtho = ortho.greaterThan(0.5)
    const at = (offset: Node<'vec2'>): Float => depth.sample(screenUV.add(offset.div(screenSize))).x as unknown as Float
    const dc = at(vec2(0, 0))
    let rgb = color.rgb
    if (rim) {
      const z = (d: Float): Float => select(isOrtho, near.add(far.sub(near).mul(d)), near.mul(far).div(far.sub(far.sub(near).mul(d))))
      const zc = z(dc)
      const gap = z(at(rimOffset)).sub(zc).div(zc)
      const lit = smoothstep(float(RIM_GAP[0]), float(RIM_GAP[1]), gap).mul(rimStrength).mul(select(dc.lessThan(1), float(1), float(0)))
      rgb = rgb.add(rimColor.mul(lit))
    }
    if (ink) {
      const w = (d: Float): Float => select(isOrtho, near.add(far.sub(near).mul(d)), far.sub(far.sub(near).mul(d)))
      const px = (dx: number, dy: number): Float => at(vec2(dx, dy).mul(step))
      const pixelSize = step.mul(2).div(p5.mul(screenSize.y))
      const wc = w(dc)
      const crease = (a: Float, b: Float): Float => {
        const e = abs(w(a).add(w(b)).sub(wc.mul(2)))
        return select(isOrtho, e.div(pixelSize), e.div(wc.mul(pixelSize)))
      }
      const m = max(crease(px(-1, 0), px(1, 0)), crease(px(0, -1), px(0, 1)))
      const line = smoothstep(float(OUTLINE_RAMP[0]), float(OUTLINE_RAMP[1]), m)
      rgb = mix(rgb, inkColor, line.mul(inkStrength))
    }
    return vec4(rgb, color.a)
  }

  return {
    apply,
    /** What the graph needs, as a key: empty = the style draws nothing and the depth is not read. */
    set(outlineLook: OutlineLook | null | undefined, rimLook: RimLook | null | undefined): string {
      ink = outlineLook && outlineLook.strength > 0 ? outlineLook : null
      rim = rimLook && rimLook.strength > 0 ? rimLook : null
      inkStrength.value = ink?.strength ?? 0
      if (ink) inkColor.value.set(...ink.color)
      if (rim) rimColor.value.set(...rim.color)
      return `${ink ? 'ink' : ''}${rim ? '+rim' : ''}`
    },
  }
}
