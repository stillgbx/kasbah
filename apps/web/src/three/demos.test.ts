import { describe, expect, it } from 'vitest'
import './textures/prebake' // bakes the materials at import, outside the first test's timeout
import { parseHouse } from '@kasbah/shared'
import { HouseScene } from './HouseScene'
import { DEMO_PROPERTIES } from '../api/demoProperties'

// The scene loads each of the three demo properties: gable roof and upper-floor
// terrace, flat L-shaped roof and rack-mounted arrays, upper-floor apartment with neither roof nor garden.
describe('demo properties in the scene', () => {
  it.each(DEMO_PROPERTIES.map((p) => [p.id, p] as const))('%s loads', (_id, p) => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    expect(() => scene.load(parseHouse(p.house))).not.toThrow()
  }, 30_000)   // les Tilleuls (relief, garden, 17 rooms): 2.3 s alone, ~8 s under the full suite's load
})
