import { describe, expect, it } from 'vitest'
import './textures/prebake' // cuit les matières à l'import, hors du délai du premier test
import { parseHouse } from '@kasbah/shared'
import { HouseScene } from './HouseScene'
import { DEMO_PROPERTIES } from '../api/demoProperties'

// La scène charge chacune des trois propriétés de démonstration : toit à deux pans et terrasse
// d'étage, toit plat en L et champs sur châssis, appartement en étage sans toit ni jardin.
describe('demo properties in the scene', () => {
  it.each(DEMO_PROPERTIES.map((p) => [p.id, p] as const))('%s loads', (_id, p) => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    expect(() => scene.load(parseHouse(p.house))).not.toThrow()
  }, 30_000)   // les Tilleuls (relief, jardin, 17 pièces) : 2,3 s seuls, ~8 s sous la charge de la suite complète
})
