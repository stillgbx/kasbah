import { Color, Group, Raycaster, SpotLight, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { Disco } from './disco'

const AREA = { min: [0, 0] as const, max: [10, 8] as const, roofZ: 7 }
const COLORS = [new Color(0xff0000), new Color(0x0000ff)]
const spotsOf = (d: Disco) => d.object.children.filter((o): o is SpotLight => o instanceof SpotLight)

describe('Disco', () => {
  it('pose la boule au-dessus du toit et autant de projecteurs que demandé', () => {
    const d = new Disco(AREA, 4, COLORS)
    expect(spotsOf(d)).toHaveLength(4)
    const ball = d.object.children[0]!
    expect(ball.position.z).toBeGreaterThan(AREA.roofZ)
    d.dispose()
  })

  it('fait balayer les projecteurs et glisser leur couleur', () => {
    const d = new Disco(AREA, 2, COLORS)
    const spot = spotsOf(d)[0]!
    const aim0 = spot.target.position.clone()
    const color0 = spot.color.clone()
    d.step(0.1); d.step(0.1); d.step(0.1)
    expect(spot.target.position.distanceTo(aim0)).toBeGreaterThan(0.01)
    expect(spot.color.equals(color0)).toBe(false)
    d.dispose()
  })

  it('ne prend aucun clic : un faisceau couvre les appareils', () => {
    const d = new Disco(AREA, 4, COLORS)
    d.object.updateMatrixWorld(true)
    const ray = new Raycaster(new Vector3(5, 4, 30), new Vector3(0, 0, -1))
    expect(ray.intersectObject(d.object, true)).toHaveLength(0)
    d.dispose()
  })

  it('se détache de la scène au dispose', () => {
    const root = new Group()
    const d = new Disco(AREA, 3, COLORS)
    root.add(d.object)
    d.dispose()
    expect(root.children).toHaveLength(0)
  })
})
