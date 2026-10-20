import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { SPECIES, speciesOf, speciesSchema } from './species'
import { speciesShape } from './speciesShape'
import { SEASONS, seasonAt } from './season'

const files = import.meta.glob<{ default: unknown }>('./species/*.json', { eager: true })

describe('garden species', () => {
  it('every recipe is valid (otherwise the catalog would silently drop the file)', () => {
    for (const [path, mod] of Object.entries(files)) {
      const parsed = speciesSchema.safeParse(mod.default)
      expect(parsed.success, `${path} : ${parsed.error?.issues[0]?.message}`).toBe(true)
    }
    expect(SPECIES.length).toBe(Object.keys(files).length)
  })

  it('every season builds a tree of height 1, bare when the foliage drops to zero', () => {
    for (const s of SPECIES) {
      for (const season of SEASONS) {
        const shape = speciesShape(s, 0, season)
        const box = new Box3()
        for (const { geometry } of shape.parts) box.union(geometry.boundingBox!)
        expect(box.max.z, `${s.id} ${season}`).toBeLessThanOrEqual(1 + 1e-6)
        expect(box.min.z).toBeGreaterThanOrEqual(-0.01)   // the foot of a leaning trunk dips barely below the ground
        const bare = s.seasons?.[season]?.foliage === 0
        expect(shape.parts.some((p) => p.part === 'leaf'), `${s.id} ${season}`).toBe(!bare)
      }
    }
  })

  it('under a style\'s palette, a species loses its colors but keeps its silhouette', () => {
    const cherry = SPECIES.find((s) => s.id === 'cherry')!
    const leaf = speciesShape(cherry, 0, 'summer', { foliage: 1 }).parts.find((p) => p.part === 'leaf')!
    const c = leaf.geometry.getAttribute('color')
    expect(c.getX(0)).toBeCloseTo(c.getY(0), 5)              // gray: the tint will come from the instance
    expect(c.getY(0)).toBeCloseTo(c.getZ(0), 5)
    const natural = speciesShape(cherry, 0, 'summer').parts.find((p) => p.part === 'leaf')!.geometry.getAttribute('color')
    expect(natural.getY(0)).toBeGreaterThan(natural.getX(0))  // the species' green
    // a style that thins the foliage reveals the tiered branching, even in summer
    const bark = (style?: { foliage: number }) => speciesShape(cherry, 0, 'summer', style).parts.find((p) => p.part === 'bark')!.geometry.getAttribute('position').count
    expect(bark({ foliage: 0.45 })).toBeGreaterThan(bark())
  })

  it('forkAt makes the main branches start from the bottom of the trunk, and the bark rise into the crown', () => {
    const cherry = SPECIES.find((s) => s.id === 'cherry')!
    const at = (forkAt?: number, season: 'summer' | 'winter' = 'summer') => speciesShape({ ...cherry, trunk: { ...cherry.trunk, forkAt } }, 0, season)
      .parts.find((p) => p.part === 'bark')!.geometry.getAttribute('position')
    // bark vertices near the ground: the trunk's foot alone without forkAt, plus the foot of each main branch with it
    const low = (pos: ReturnType<typeof at>) => {
      let n = 0
      for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < 0.1) n++
      return n
    }
    const topZ = (pos: ReturnType<typeof at>) => Math.max(...Array.from({ length: pos.count }, (_, i) => pos.getZ(i)))
    expect(topZ(at(0.02))).toBeGreaterThan(topZ(at()))   // in summer, stems and central trunk go into the foliage
    for (const season of ['summer', 'winter'] as const) expect(low(at(0.02, season)), season).toBeGreaterThan(low(at(undefined, season)) * 2)
  })

  it('spread spaces out the feet of the main branches instead of a single point', () => {
    const fig = SPECIES.find((s) => s.id === 'fig')!
    const bark = (spread?: number) => speciesShape({ ...fig, trunk: { ...fig.trunk, forkAt: 0.02, spread } }, 0, 'summer')
      .parts.find((p) => p.part === 'bark')!.geometry.getAttribute('position')
    // maximum horizontal spread of the vertices at the foot (z < 0.05), far from the axis when the culms are spread
    const foot = (pos: ReturnType<typeof bark>) => {
      let d = 0
      for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < 0.05) d = Math.max(d, Math.hypot(pos.getX(i), pos.getY(i)))
      return d
    }
    expect(foot(bark(0.1))).toBeGreaterThan(foot(bark()) * 1.5)
  })

  it('tiered lays flat platforms, stacked and narrower and narrower', () => {
    const cherry = SPECIES.find((s) => s.id === 'cherry')!
    const recipe = { ...cherry, trunk: { ...cherry.trunk, height: 0.3 }, crown: { ...cherry.crown, shape: 'tiered' as const, width: 1.2, tiers: 3 } }
    const leaf = speciesShape(recipe, 0, 'summer').parts.find((p) => p.part === 'leaf')!.geometry
    leaf.computeBoundingBox()
    const box = leaf.boundingBox!
    expect(box.max.x - box.min.x).toBeGreaterThan(box.max.z - box.min.z)   // wider than tall
    // low slice wider than high slice
    const pos = leaf.getAttribute('position')
    const span = (lo: number, hi: number) => {
      let d = 0
      for (let i = 0; i < pos.count; i++) if (pos.getZ(i) >= lo && pos.getZ(i) < hi) d = Math.max(d, Math.hypot(pos.getX(i), pos.getY(i)))
      return d
    }
    const mid = (box.min.z + box.max.z) / 2
    expect(span(box.min.z, mid)).toBeGreaterThan(span(mid, box.max.z))
  })

  it('a species from another family is ignored', () => {
    expect(speciesOf({ kind: 'fruit', species: 'cherry' })?.id).toBe('cherry')
    expect(speciesOf({ kind: 'palm', species: 'cherry' })).toBeUndefined()
  })

  it('the seasons follow the hemisphere', () => {
    expect(seasonAt(new Date(2026, 3, 15), 45)).toBe('spring')
    expect(seasonAt(new Date(2026, 0, 15), 45)).toBe('winter')
    expect(seasonAt(new Date(2026, 0, 15), -22)).toBe('summer')
  })
})
