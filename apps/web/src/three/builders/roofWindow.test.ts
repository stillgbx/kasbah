import { describe, expect, it } from 'vitest'
import '../textures/prebake' // cuit les matières à l'import, hors du délai du premier test
import { Vector3 } from 'three'
import { computeHouseGeometry, parseHouse, type OpeningRect, type Vec3 } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { buildPane } from './buildHouse'
import { createMaterials } from './materials'
import { defaultLook, defaultSceneTheme } from '../styles'

const geo = computeHouseGeometry(parseHouse(demo))
const roof = geo.roof!
const velux = geo.levels.flatMap((l) => l.openings).find((o) => o.host === 'roof')!
const mats = createMaterials(defaultSceneTheme(), defaultLook())

/** Normale montante d'une face de toit. */
const faceNormal = (face: readonly Vec3[]): Vector3 => {
  const [a, b, c] = face.map((p) => new Vector3(...p))
  const n = new Vector3().crossVectors(b!.clone().sub(a!), c!.clone().sub(a!)).normalize()
  return n.z < 0 ? n.negate() : n
}

describe('vitrage d’une fenêtre de toit', () => {
  // le Velux de la démo descend vers −y (cap 180) ; le même, retourné vers +y, sur l'autre versant
  const cases: [string, OpeningRect, number][] = [
    ['versant sud, cap 180', velux, 0],
    ['versant nord, cap 0', { ...velux, yaw: 0, u: [1, 0], origin: [velux.origin[0] - 1, 5, velux.origin[2]] }, 1],
  ]
  it.each(cases)('épouse la pente du toit (%s)', (_, rect, faceIndex) => {
    const pane = buildPane(rect, mats)
    pane.updateMatrixWorld()
    // la normale de la dalle de verre (son axe z local) est celle du versant
    const n = new Vector3(0, 0, 1).transformDirection(pane.matrixWorld)
    expect(n.angleTo(faceNormal(roof.faces[faceIndex]!))).toBeLessThan(1e-6)
  })

  it('suit la pente même quand le JSON lui donne un autre cap', () => {
    // cap 0 écrit sur le versant sud (qui descend vers −y) : la géométrie reprend la descente
    const doc = JSON.parse(JSON.stringify(demo)) as typeof demo
    const o = doc.rooms.find((r) => r.id === 'chambre1')!.openings.find((x) => x.id === 'velux-ch1')!
    Object.assign(o, { yaw: 0 })
    const g2 = computeHouseGeometry(parseHouse(doc))
    const rect = g2.levels.flatMap((l) => l.openings).find((x) => x.host === 'roof')!
    expect(rect.yaw).toBe(180)
    const pane = buildPane(rect, mats)
    pane.updateMatrixWorld()
    const n = new Vector3(0, 0, 1).transformDirection(pane.matrixWorld)
    expect(n.angleTo(faceNormal(g2.roof!.faces[0]!))).toBeLessThan(1e-6)
  })

  it('remplit exactement le trou du toit : même taille, même place, dans le plan du versant', () => {
    const hole = roof.holes!.find((h) => h.openingId === velux.openingId)!.corners!.map((p) => new Vector3(...p))
    const pane = buildPane(velux, mats)
    pane.updateMatrixWorld()
    const elevation = geo.levels.find((l) => l.levelId === velux.levelId)!.elevation
    // les quatre coins du plan médian de la dalle de verre, en repère maison
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy]) =>
      new Vector3((sx! * velux.width) / 2, (sy! * velux.height) / 2, 0).applyMatrix4(pane.matrixWorld).add(new Vector3(0, 0, elevation)))
    // la longueur saisie se mesure le long de la pente : c'est la vraie taille du Velux…
    expect(hole[0]!.distanceTo(hole[3]!)).toBeCloseTo(velux.height, 6)
    expect(hole[0]!.distanceTo(hole[1]!)).toBeCloseTo(velux.width, 6)
    // …et chaque coin du verre tombe sur un coin du trou
    for (const c of corners) expect(Math.min(...hole.map((h) => h.distanceTo(c)))).toBeLessThan(1e-6)
  })
})
