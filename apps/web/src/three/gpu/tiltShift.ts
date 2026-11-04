import type { Node } from 'three/webgpu'
import { abs, convertToTexture, screenSize, screenUV, smoothstep, uniform, vec2, vec4 } from 'three/tsl'
import { TILT_FALLOFF, TILT_MAX_PX } from '../core/post'

// The tilt-shift of `core/post.ts` in TSL: a sharp horizontal band, the blur rising toward the top and
// the bottom, in two separable passes of nine samples. Same curve as `tiltBlurFactor`, which the pills
// follow: `screenUV` has its origin at the top, the band's centre is counted from the bottom.

const TAPS = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((i) => ({ i, w: Math.exp((-i * i) / 8) }))
const WEIGHTS = TAPS.reduce((s, t) => s + t.w, 0)

export function tiltShift() {
  const strength = uniform(0)
  const center = uniform(0.5)
  const width = uniform(0.18)

  const blur = (input: Node, horizontal: boolean): Node => {
    const tex = convertToTexture(input)
    const fromBottom = screenUV.y.oneMinus()
    const k = smoothstep(width, width.add(TILT_FALLOFF), abs(fromBottom.sub(center)))
    const radius = k.mul(strength).mul(TILT_MAX_PX)
    const step = (horizontal ? vec2(1, 0) : vec2(0, 1)).div(screenSize).mul(radius)
    let sum: Node<'vec4'> = vec4(0)
    for (const { i, w } of TAPS) sum = sum.add(tex.sample(screenUV.add(step.mul(i))).mul(w))
    return sum.div(WEIGHTS)
  }

  return {
    apply: (input: Node): Node => blur(blur(input, true), false),
    set(look: { strength: number; center: number; width: number } | null | undefined) {
      if (!look) return
      strength.value = look.strength
      center.value = look.center
      width.value = look.width
    },
  }
}
