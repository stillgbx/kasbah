import { describe, expect, it } from 'vitest'
import { computeHouseGeometry } from './geometry'
import { lintHouse, parseHouse } from './validate'
import tilleuls from '../../../../house/demos/tilleuls.json'
import embruns from '../../../../house/demos/embruns.json'
import belvedere from '../../../../house/demos/belvedere.json'

// Les trois propriétés de démonstration (`house/demos/`) : valides, sans avertissement, et chacune
// sa forme de toit — deux pans, plat, aucun (un appartement n'a pas de toit à lui).

const RAW: Record<string, unknown> = { tilleuls, embruns, belvedere }
const demo = (id: string) => parseHouse(RAW[id])

describe('demo properties', () => {
  it.each([
    ['tilleuls', 'gable'],
    ['embruns', 'flat'],
    ['belvedere', undefined],
  ] as const)('%s is valid, lint-clean, with a %s roof', (id, roof) => {
    const house = demo(id)
    expect(house.id).toBe(id)
    expect(lintHouse(house)).toEqual([])
    expect(house.roof?.type).toBe(roof)
    const g = computeHouseGeometry(house)
    expect(g.roof !== undefined).toBe(roof !== undefined)
    expect(g.levels.length).toBe(house.levels.length)
  })

  it('every demo says which simulated park populates it', () => {
    for (const id of ['tilleuls', 'embruns', 'belvedere']) {
      expect((demo(id).meta?.demo as { scenario?: string }).scenario).toBe(id)
    }
  })
})
