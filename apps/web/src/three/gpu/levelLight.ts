import { PointLight } from 'three'
import { PointLightNode, type Node, type NodeBuilder } from 'three/webgpu'
import { float, mix, positionWorld, select, step, uniform } from 'three/tsl'
import { levelLightUniforms } from '../core/levelLight'

// `core/levelLight.ts` in TSL: an indoor lamp only lights the slice of its level. Same rule as the
// GLSL patch — shadow-casting lamps (garden) are not tested, a `noLamps` material receives no tested
// lamp, the pixel is raised by 5 mm so a slab top belongs to the level it carries. There is no
// shader text to patch here: three's point light node is replaced, once, for every material.
//
// One difference: the GLSL loop SKIPS a masked lamp (`if ( directLight.visible )`), the node
// multiplies its light by 0. Not measurable on the demo house (2026-11-04).

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
  private readonly testedNode = uniform(1)

  override update(frame: Parameters<PointLightNode['update']>[0]) {
    const result = super.update(frame)
    const light = this.light as PointLight
    this.bandNode.value = bandOf(light.matrixWorld.elements[13]!)
    this.testedNode.value = light.castShadow ? 0 : 1
    return result
  }

  override setupDirect(builder: NodeBuilder) {
    const direct = super.setupDirect(builder)!
    const noLamps = !!(builder.material as { userData?: { noLamps?: boolean } } | null)?.userData?.noLamps
    const reaches = noLamps ? float(0) : select(fragBand.equal(this.bandNode), float(1), float(0))
    return { ...direct, lightColor: (direct.lightColor as ReturnType<typeof float>).mul(mix(float(1), reaches, this.testedNode)) }
  }
}

;(PointLight as unknown as { registerNode(c: unknown): void }).registerNode(LevelPointLightNode)
