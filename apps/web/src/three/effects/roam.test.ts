import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { type Obstacles, roam, type RoamArea } from './roam'

// un terrain en L de 50 × 45 m, la maison dans le coin rentrant
const TERRAIN = [[0, 0], [50, 0], [50, 20], [25, 20], [25, 45], [0, 45]] as const
const HOUSE = { min: [10, 8], max: [20, 16] } as const
const SITE: RoamArea = { terrain: TERRAIN, avoid: [HOUSE] }

/** Un hasard rejouable (mulberry32), pour tirer plusieurs parcours sans dépendre de la chance. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const inL = (x: number, y: number) => x > 0 && y > 0 && ((x < 50 && y < 20) || (x < 25 && y < 45))
const inHouse = (x: number, y: number, m = 0) => x > 10 - m && x < 20 + m && y > 8 - m && y < 16 + m

/** Un tour complet de la boucle, échantillonné finement. */
function lap(path: ReturnType<typeof roam>, speed: number): Vector3[] {
  const out: Vector3[] = []
  const p0 = path(0, new Vector3())
  for (let t = 0.1; t < 2000 / speed; t += 0.1) {
    const p = path(t, new Vector3())
    out.push(p)
    if (out.length > 50 && p.distanceTo(p0) < speed * 0.1) break   // revenu au départ
  }
  return out
}

describe('roam', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('tirage %i : reste dans le terrain et hors de la maison, sur tout un tour', (seed) => {
    const path = roam(SITE, 5, { rnd: seeded(seed) })
    for (const p of lap(path, 5)) {
      expect(inL(p.x, p.y)).toBe(true)
      expect(inHouse(p.x, p.y, 0.5)).toBe(false)
      expect(p.z).toBe(0)
    }
  })

  it('parcourt le terrain, et pas seulement les abords de la maison', () => {
    const path = roam(SITE, 5, { rnd: seeded(42) })
    const far = Math.max(...lap(path, 5).map((p) => Math.hypot(p.x - 15, p.y - 12)))
    expect(far).toBeGreaterThan(18)                      // la maison fait 10 × 8 : on est bien au-delà
  })

  it('avance à vitesse constante', () => {
    const path = roam(SITE, 4, { rnd: seeded(7) })
    const a = new Vector3(), b = new Vector3()
    for (let t = 0; t < 30; t += 1.7) {
      const d = path(t + 0.05, b).distanceTo(path(t, a)) / 0.05
      expect(d).toBeGreaterThan(3.6)
      expect(d).toBeLessThan(4.4)                 // la table d’abscisse curviligne est approchée
    }
  })

  it('sans maison à éviter, passe aussi par son emprise', () => {
    const hits = [1, 2, 3, 4, 5, 6].some((seed) => lap(roam({ terrain: TERRAIN, avoid: [] }, 5, { rnd: seeded(seed) }), 5).some((p) => inHouse(p.x, p.y)))
    expect(hits).toBe(true)
  })

  it('sur un terrain trop petit pour tourner, se rabat sur un cercle fini', () => {
    const path = roam({ terrain: [[9, 7], [21, 7], [21, 17], [9, 17]], avoid: [HOUSE] }, 3, { rnd: seeded(1) })
    const p = path(12.5, new Vector3())
    expect(Number.isFinite(p.x + p.y)).toBe(true)
    expect(inHouse(p.x, p.y)).toBe(false)
  })

  it.each([1, 2, 3, 4])('tirage %i : contourne aussi la piscine collée à la maison', (seed) => {
    const pool = { min: [20, 9], max: [24, 15] } as const
    for (const p of lap(roam({ terrain: TERRAIN, avoid: [HOUSE, pool] }, 5, { rnd: seeded(seed) }), 5)) {
      expect(inHouse(p.x, p.y, 0.5)).toBe(false)
      expect(p.x > 19.5 && p.x < 24.5 && p.y > 8.5 && p.y < 15.5).toBe(false)
    }
  })

  it.each([1, 2, 3, 4, 5, 6])('tirage %i : contourne un arbre posé SUR le parcours et une tondeuse qui le traverse, sans jamais sauter', (seed) => {
    const free = roam(SITE, 5, { rnd: seeded(seed) })
    const around: Obstacles = { list: [] }
    const path = roam({ ...SITE, around }, 5, { rnd: seeded(seed) })   // même tirage : même parcours de base
    const tree = free(7, new Vector3())                  // en plein milieu du passage
    const prev = new Vector3(), out = new Vector3()
    for (let t = 0; t < 60; t += 0.05) {
      // la tondeuse va et vient en travers du terrain, ~0,5 m/s (une vraie ne se téléporte pas)
      const mower = { x: 25 + 20 * Math.sin(t * 0.025), y: 4 + 3 * Math.sin(t * 0.07), r: 0.6 }
      around.list = [{ x: tree.x, y: tree.y, r: 1.5 }, mower]
      path(t, out)
      for (const o of around.list) expect(Math.hypot(out.x - o.x, out.y - o.y)).toBeGreaterThan(o.r)
      if (t > 0) expect(out.distanceTo(prev)).toBeLessThan(5 * 0.05 * 3)   // jamais plus de 3 fois le pas
      prev.copy(out)
    }
  })

  it.each([1, 2, 3, 4, 5, 6])('tirage %i : pas de demi-tour sec, le virage le plus serré garde plus de 1 m de rayon', (seed) => {
    // mesuré le 2026-10-01 : 0,6 à 0,7 m avant l'ordre de visite et l'arrondi des coins, 1,2 à 2,9 m après
    const pts = lap(roam(SITE, 5, { rnd: seeded(seed) }), 5)
    // cap sur deux cordes successives de 2 m (4 pas de 0,5 m) : rayon ≈ 2 m / angle
    for (let i = 0; i + 8 < pts.length; i++) {
      const h1 = Math.atan2(pts[i + 4]!.y - pts[i]!.y, pts[i + 4]!.x - pts[i]!.x)
      const h2 = Math.atan2(pts[i + 8]!.y - pts[i + 4]!.y, pts[i + 8]!.x - pts[i + 4]!.x)
      let turn = Math.abs(h2 - h1)
      if (turn > Math.PI) turn = 2 * Math.PI - turn
      expect(2 / turn).toBeGreaterThan(1)
    }
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('tirage %i : pas de nœud serré à petite échelle non plus', (seed) => {
    // un nœud de 20 cm se cachait sous la mesure à 2 m : cordes de 0,5 m ici
    const pts = lap(roam(SITE, 5, { rnd: seeded(seed) }), 5)
    for (let i = 0; i + 2 < pts.length; i++) {
      const h1 = Math.atan2(pts[i + 1]!.y - pts[i]!.y, pts[i + 1]!.x - pts[i]!.x)
      const h2 = Math.atan2(pts[i + 2]!.y - pts[i + 1]!.y, pts[i + 2]!.x - pts[i + 1]!.x)
      let turn = Math.abs(h2 - h1)
      if (turn > Math.PI) turn = 2 * Math.PI - turn
      expect(0.5 / turn).toBeGreaterThan(0.6)
    }
  })

  it.each([1, 2, 3, 4, 5, 6])('tirage %i : deux voitures garées côte à côte, sur le parcours : on contourne le tout', (seed) => {
    const free = roam(SITE, 5, { rnd: seeded(seed) })
    const at = free(9, new Vector3()), h = free(9.1, new Vector3()).sub(at).normalize()
    // côte à côte EN TRAVERS du passage, 5 m d'axe à axe : trop serré pour passer entre les deux
    const cars = [-2.5, 2.5].map((k) => ({ x: at.x - h.y * k, y: at.y + h.x * k, r: 2.6 }))
    const path = roam({ ...SITE, around: { list: cars } }, 5, { rnd: seeded(seed) })
    const out = new Vector3()
    for (let t = 0; t < 30; t += 0.05) {
      path(t, out)
      for (const c of cars) expect(Math.hypot(out.x - c.x, out.y - c.y)).toBeGreaterThan(c.r)
    }
  })

  it.each([1, 2, 3, 4, 5, 6])('tirage %i : contourne le jardin dès le tracé (un bosquet clairsemé ne se touche pas)', (seed) => {
    // une rangée d'arbres en travers du terrain, avec des trouées de 4 m, et quelques buissons
    const statics = [
      ...[2, 9, 16, 30, 37, 44].map((x) => ({ x, y: 4, r: 1.5 })),
      { x: 5, y: 30, r: 1 }, { x: 18, y: 38, r: 1 }, { x: 40, y: 15, r: 1.2 },
    ]
    const pts = lap(roam({ ...SITE, statics }, 5, { rnd: seeded(seed) }), 5)
    const touching = pts.filter((p) => statics.some((c) => Math.hypot(p.x - c.x, p.y - c.y) < c.r)).length
    expect(touching).toBe(0)
    for (const p of pts) expect(inL(p.x, p.y)).toBe(true)
  })

  it("un jardin touffu n'envoie personne hors du terrain : on frôle plutôt que de sortir", () => {
    // 150 disques serrés sur tout le terrain : aucune boucle ne passe sans contact
    const rnd = seeded(99)
    const statics = Array.from({ length: 150 }, () => ({ x: rnd() * 50, y: rnd() * 45, r: 0.5 + rnd() }))
    for (const seed of [1, 2, 3]) {
      for (const p of lap(roam({ ...SITE, statics }, 5, { rnd: seeded(seed) }), 5)) {
        expect(inL(p.x, p.y)).toBe(true)
        expect(inHouse(p.x, p.y, 0.5)).toBe(false)
      }
    }
  })
})
