import { describe, expect, it } from 'vitest'
import './textures/prebake' // bakes the materials at import, outside the first test's timeout
import { computeHouseGeometry, parseHouse, pointInPolygon, type Vec2 } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { houseToWorld } from './core/coords'
import { HouseScene } from './HouseScene'

// Edit mode, upper floor tab: a tap on the upper floor's floor grabbed the handle of a window on the
// ground floor right below — handles took precedence over the structure without checking whether it hid them.

const house = parseHouse(demo)
const g = computeHouseGeometry(house)
const etage = house.levels.find((l) => l.id === 'etage')!
const rdc = g.levels.find((l) => l.levelId === 'rdc')!
const etageRooms = house.rooms.filter((r) => r.levelId === 'etage')

/**
 * A wall opening on the ground floor, and an eye placed above the upper floor, on the inside: the ray
 * toward the center of the opening crosses the floor of an upper-floor room before reaching it.
 */
function throughEtageFloor(): { eye: [number, number, number]; target: [number, number, number]; roomId: string } {
  for (const o of rdc.openings) {
    if (o.host !== 'wall') continue
    const c: [number, number, number] = [
      o.origin[0] + (o.u[0] * o.width) / 2, o.origin[1] + (o.u[1] * o.width) / 2, rdc.elevation + o.origin[2] + o.height / 2,
    ]
    for (const back of [2, 3, 4]) {
      const eye: [number, number, number] = [c[0] - o.normal[0] * back, c[1] - o.normal[1] * back, etage.elevation + 3]
      const t = (eye[2] - etage.elevation) / (eye[2] - c[2])     // where the ray passes at floor height
      const at: Vec2 = [eye[0] + (c[0] - eye[0]) * t, eye[1] + (c[1] - eye[1]) * t]
      const room = etageRooms.find((r) => pointInPolygon(at, r.polygon))
      if (room) return { eye, target: c, roomId: room.id }
    }
  }
  throw new Error('no ground-floor opening under an upper-floor floor in the demo house')
}

describe('a tap does not go through the floor', () => {
  it('the upper floor wins against the handle of a ground-floor opening it hides', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.resize(600, 600)
    scene.focusLevel('etage')
    scene.setEditingOpenings(true)
    const { eye, target, roomId } = throughEtageFloor()
    scene.camera.position.copy(houseToWorld(eye))
    scene.camera.lookAt(houseToWorld(target))
    scene.camera.updateMatrixWorld(true)
    scene.scene.updateMatrixWorld(true)
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'room', roomId })
    scene.dispose()
  })
})
