import { Texture } from 'three'
import type { Node } from 'three/webgpu'
import { convertToTexture, length, max, min, mix, screenSize, screenUV, smoothstep, texture, vec2, vec3, vec4 } from 'three/tsl'
import { LENS_COVER, LENS_REFRACT, LENS_RIM, LENS_RING, LENS_SOFT } from '../core/post'

// The water on the lens of `core/post.ts` (`LENS_WATER_SHADER`) in TSL: same numbers. `screenUV` has
// its origin at the TOP, the water map's normal points UP: the map is read upside down and the
// vertical shift changes sign.

export function lensWater() {
  // a node needs a texture when the graph is built: a blank one, swapped for the map when it rains
  const map = texture(new Texture())

  return {
    apply(input: Node): Node {
      const tex = convertToTexture(input)
      const base = tex.sample(screenUV)
      // the canvas is uploaded bottom row first (`flipY`), as WebGL reads it: back to the top here
      const w = map.sample(vec2(screenUV.x, screenUV.y.oneMinus()))
      const n = w.rg.mul(2).sub(1)
      const r = min(length(n), 1)
      const aspect = screenSize.x.div(screenSize.y)
      const at = screenUV.sub(vec2(n.x.div(aspect), n.y.negate()).mul(LENS_REFRACT))
      // out of focus: the centre and a ring of eight taps
      let seen: Node<'vec3'> = tex.sample(at).rgb.mul(0.2)
      for (const [x, y] of LENS_RING) seen = seen.add(tex.sample(at.add(vec2(aspect.reciprocal().mul(x * LENS_SOFT), -y * LENS_SOFT))).rgb.mul(0.1))
      const lit = seen.mul(smoothstep(LENS_RIM, 1, r).mul(0.3).oneMinus().add(0.1))
        .add(smoothstep(0.5, 0, length(n.sub(vec2(-0.3, 0.38)))).mul(0.12))
      const c = mix(lit, vec3(0.93, 0.95, 0.98), w.b)
      const cover = smoothstep(LENS_COVER[0], LENS_COVER[1], w.a)
      return vec4(mix(base.rgb, c, cover), max(base.a, cover))
    },
    set(tex: Texture | null) { if (tex) map.value = tex },
  }
}
