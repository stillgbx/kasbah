import { describe, expect, it } from 'vitest'
import '../textures/prebake' // bakes the materials at import, outside the first test's timeout
import { Vector3 } from 'three'
import { computeHouseGeometry, parseHouse, type OpeningRect, type Vec3 } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { buildPane } from './buildHouse'
import { createMaterials } from './materials'
import { defaultLook, defaultSceneTheme } from '../styles'

const geo = computeHouseGeometry(parseHouse(demo))
const roof = geo.roofs[0]!
const velux = geo.levels.flatMap((l) => l.openings).find((o) => o.host === 'roof')!
const mats = createMaterials(defaultSceneTheme(), defaultLook())

/** Upward normal of a roof face. */
const faceNormal = (face: readonly Vec3[]): Vector3 => {
  const [a, b, c] = face.map((p) => new Vector3(...p))
  const n = new Vector3().crossVectors(b!.clone().sub(a!), c!.clone().sub(a!)).normalize()
  return n.z < 0 ? n.negate() : n
}

describe('roof window glazing', () => {
  // the demo's Velux faces down toward −y (heading 180); the same one, turned toward +y, on the other slope
  const cases: [string, OpeningRect, number][] = [
    ['versant sud, cap 180', velux, 0],
    ['versant nord, cap 0', { ...velux, yaw: 0, u: [1, 0], origin: [velux.origin[0] - 1, 5, velux.origin[2]] }, 1],
  ]
  it.each(cases)('follows the roof slope (%s)', (_, rect, faceIndex) => {
    const pane = buildPane(rect, mats)
    pane.updateMatrixWorld()
    // the normal of the glass slab (its local z axis) is the slope's
    const n = new Vector3(0, 0, 1).transformDirection(pane.matrixWorld)
    expect(n.angleTo(faceNormal(roof.faces[faceIndex]!))).toBeLessThan(1e-6)
  })

  it('follows the slope even when the JSON gives it another heading', () => {
    // heading 0 written on the south slope (which descends toward −y): the geometry takes back the descent
    const doc = JSON.parse(JSON.stringify(demo)) as typeof demo
    const o = doc.rooms.find((r) => r.id === 'chambre1')!.openings.find((x) => x.id === 'velux-ch1')!
    Object.assign(o, { yaw: 0 })
    const g2 = computeHouseGeometry(parseHouse(doc))
    const rect = g2.levels.flatMap((l) => l.openings).find((x) => x.host === 'roof')!
    expect(rect.yaw).toBe(180)
    const pane = buildPane(rect, mats)
    pane.updateMatrixWorld()
    const n = new Vector3(0, 0, 1).transformDirection(pane.matrixWorld)
    expect(n.angleTo(faceNormal(g2.roofs[0]!.faces[0]!))).toBeLessThan(1e-6)
  })

  it('fills the roof hole exactly: same size, same place, in the plane of the slope', () => {
    const hole = roof.holes!.find((h) => h.openingId === velux.openingId)!.corners!.map((p) => new Vector3(...p))
    const pane = buildPane(velux, mats)
    pane.updateMatrixWorld()
    const elevation = geo.levels.find((l) => l.levelId === velux.levelId)!.elevation
    // the four corners of the glass slab's mid-plane, in the house reference frame
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy]) =>
      new Vector3((sx! * velux.width) / 2, (sy! * velux.height) / 2, 0).applyMatrix4(pane.matrixWorld).add(new Vector3(0, 0, elevation)))
    // the entered length is measured along the slope: it is the true size of the Velux…
    expect(hole[0]!.distanceTo(hole[3]!)).toBeCloseTo(velux.height, 6)
    expect(hole[0]!.distanceTo(hole[1]!)).toBeCloseTo(velux.width, 6)
    // …and each corner of the glass lands on a corner of the hole
    for (const c of corners) expect(Math.min(...hole.map((h) => h.distanceTo(c)))).toBeLessThan(1e-6)
  })
})
