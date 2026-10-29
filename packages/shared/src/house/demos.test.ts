import { describe, expect, it } from 'vitest'
import { computeHouseGeometry, roofsOf } from './geometry'
import { lintHouse, parseHouse } from './validate'
import tilleuls from '../../../../house/demos/tilleuls.json'
import embruns from '../../../../house/demos/embruns.json'
import belvedere from '../../../../house/demos/belvedere.json'

// The three demo properties (`house/demos/`): valid, without warnings, and each
// with its own roofs — a gable house and its single-slope garden shed, flat, none (an
// apartment has no roof of its own).

const RAW: Record<string, unknown> = { tilleuls, embruns, belvedere }
const demo = (id: string) => parseHouse(RAW[id])

describe('demo properties', () => {
  it.each([
    ['tilleuls', ['gable', 'shed']],
    ['embruns', ['flat']],
    ['belvedere', []],
  ] as const)('%s is valid, lint-clean, with roofs %j', (id, roofs) => {
    const house = demo(id)
    expect(house.id).toBe(id)
    expect(lintHouse(house)).toEqual([])
    expect(roofsOf(house).map((r) => r.type)).toEqual(roofs)
    const g = computeHouseGeometry(house)
    expect(g.roofs.map((r) => r.type)).toEqual(roofs)
    expect(g.levels.length).toBe(house.levels.length)
  })

  it('every demo says which simulated device set populates it', () => {
    for (const id of ['tilleuls', 'embruns', 'belvedere']) {
      expect((demo(id).meta?.demo as { scenario?: string }).scenario).toBe(id)
    }
  })
})
