import { PointLight } from 'three'
import { PointLightNode, type Node, type NodeBuilder } from 'three/webgpu'
import { If, float, positionWorld, step, vec3 } from 'three/tsl'
import { sharedUniform as uniform } from './shared'
import { levelLightUniforms } from '../core/levelLight'

// `core/levelLight.ts` in TSL: an indoor lamp only lights the slice of its level. Same rule as the
// GLSL patch — shadow-casting lamps (garden) are not tested, a `noLamps` material receives no tested
// lamp, the pixel is raised by 5 mm so a slab top belongs to the level it carries. There is no
// shader text to patch here: three's point light node is replaced, once, for every material.
//
// A masked lamp is SKIPPED, as in the GLSL loop (`if ( directLight.visible )`), and so is a lamp
// that is off. three writes every point light out in full in every shader: multiplying a masked
// lamp's light by 0 still paid for it, 4-7 ms of GPU per frame on the demo house, lamps off
// included (integrated Radeon, 2026-11-04). The `If` brings it back to the cost of no lamps at all.

const MAX_BOUNDS = levelLightUniforms.kasbahLevelY.value.length
const levelY = Array.from({ length: MAX_BOUNDS }, (_, i) => uniform(0).onRenderUpdate(() => levelLightUniforms.kasbahLevelY.value[i]!))
const levelOn = Array.from({ length: MAX_BOUNDS }, (_, i) => uniform(0).onRenderUpdate(() => (i < levelLightUniforms.kasbahLevelCount.value ? 1 : 0)))

function bandOf(y: number): number {
  const { kasbahLevelY, kasbahLevelCount } = levelLightUniforms
  let b = 0
  for (let i = 0; i < kasbahLevelCount.value; i++) if (y >= kasbahLevelY.value[i]!) b = i + 1
  return b
}

/** The pixel's slice: how many bounds it is above (the bounds are sorted ascending). */
const fragBand = (() => {
  const y = positionWorld.y.add(0.005)
  let band: Node<'float'> = float(0)
  for (let i = 0; i < MAX_BOUNDS; i++) band = band.add(step(levelY[i]! as Node<'float'>, y).mul(levelOn[i]!)) as Node<'float'>
  return band
})()

class LevelPointLightNode extends PointLightNode {
  private readonly bandNode = uniform(0)

  override update(frame: Parameters<PointLightNode['update']>[0]) {
    const result = super.update(frame)
    this.bandNode.value = bandOf((this.light as PointLight).matrixWorld.elements[13]!)
    return result
  }

  // `castShadow` is in the lights' cache key: a lamp that starts casting a shadow rebuilds the shader
  override setup(builder: NodeBuilder) {
    if ((this.light as PointLight).castShadow) return super.setup(builder)
    if ((builder.material as { userData?: { noLamps?: boolean } } | null)?.userData?.noLamps) return
    // the light's colour × intensity (`AnalyticLightNode.colorNode`, untyped): 0 when the lamp is off
    const on = (this as unknown as { colorNode: Node<'vec3'> }).colorNode.dot(vec3(1)).greaterThan(0)
    If(on.and(fragBand.equal(this.bandNode)), () => { super.setup(builder) })
  }
}

;(PointLight as unknown as { registerNode(c: unknown): void }).registerNode(LevelPointLightNode)
