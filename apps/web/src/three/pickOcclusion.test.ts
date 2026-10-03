import { describe, expect, it } from 'vitest'
import { computeHouseGeometry, parseHouse, pointInPolygon, type Vec2 } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { houseToWorld } from './core/coords'
import { HouseScene } from './HouseScene'

// Mode édition, onglet Étage : un tap sur le plancher du 1er attrapait la poignée d'une fenêtre du
// RDC juste dessous — les poignées passaient avant le bâti sans regarder s'il les cachait.

const house = parseHouse(demo)
const g = computeHouseGeometry(house)
const etage = house.levels.find((l) => l.id === 'etage')!
const rdc = g.levels.find((l) => l.levelId === 'rdc')!
const etageRooms = house.rooms.filter((r) => r.levelId === 'etage')

/**
 * Une ouverture murale du RDC, et un œil placé au-dessus du 1er côté intérieur : le rayon vers le
 * centre de l'ouverture traverse le plancher d'une pièce du 1er avant de l'atteindre.
 */
function throughEtageFloor(): { eye: [number, number, number]; target: [number, number, number]; roomId: string } {
  for (const o of rdc.openings) {
    if (o.host !== 'wall') continue
    const c: [number, number, number] = [
      o.origin[0] + (o.u[0] * o.width) / 2, o.origin[1] + (o.u[1] * o.width) / 2, rdc.elevation + o.origin[2] + o.height / 2,
    ]
    for (const back of [2, 3, 4]) {
      const eye: [number, number, number] = [c[0] - o.normal[0] * back, c[1] - o.normal[1] * back, etage.elevation + 3]
      const t = (eye[2] - etage.elevation) / (eye[2] - c[2])     // où le rayon passe au niveau du plancher
      const at: Vec2 = [eye[0] + (c[0] - eye[0]) * t, eye[1] + (c[1] - eye[1]) * t]
      const room = etageRooms.find((r) => pointInPolygon(at, r.polygon))
      if (room) return { eye, target: c, roomId: room.id }
    }
  }
  throw new Error('aucune ouverture du RDC sous un plancher du 1er dans la maison de démo')
}

describe('un tap ne traverse pas le plancher', () => {
  it('le sol du 1er gagne contre la poignée d’une ouverture du RDC qu’il cache', () => {
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
