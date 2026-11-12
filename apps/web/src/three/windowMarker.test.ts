import { describe, expect, it } from 'vitest'
import './textures/prebake'
import { type BufferGeometry, Mesh, Vector3, type Object3D } from 'three'
import { parseHouse, type DeviceDescriptor, type DeviceState } from '@kasbah/shared'
import tilleuls from '../../../../house/demos/tilleuls.json'
import { HouseScene } from './HouseScene'

// The demo's roof window (`velux-palier`, slope 35°, heading 180°) carries a motorized WINDOW and its
// BLIND on the same opening. Both must lie in the plane of the roof, not stand across it.

const window_ = {
  id: 'mock:tl-cover-velux', pluginId: 'mock', externalId: 'tl-cover-velux', kind: 'window', name: 'Fenêtre de toit',
  capabilities: ['open_close', 'position'], meta: {},
} as DeviceDescriptor
const blind = {
  id: 'mock:tl-cover-velux-blind', pluginId: 'mock', externalId: 'tl-cover-velux-blind', kind: 'cover', name: 'Store',
  capabilities: ['open_close', 'position'], meta: { cover: { deviceClass: 'blind' } },
} as DeviceDescriptor
const state = (kind: 'window' | 'cover', position: number) =>
  ({ kind, updatedAt: 1, available: true, position, motion: 'stopped' }) as DeviceState

/**
 * Outward normal of the roof window, in WORLD coordinates. In the house's frame (z up) the slope faces
 * −y tilted 35° (heading 180°): (0, −sin, cos). The scene turns the house −90° around X to put y up,
 * which gives (0, cos, sin) — the normal the structure's own glass has (measured: 0, .819, .574).
 */
const slope = (35 * Math.PI) / 180
const normal = new Vector3(0, Math.cos(slope), Math.sin(slope))
/** Down the slope, in the same world frame: (0, −cos, −sin) in the house's → (0, −sin, cos). */
const down = new Vector3(0, -Math.sin(slope), Math.cos(slope))

function worldVertices(root: Object3D): Vector3[] {
  root.updateWorldMatrix(true, true)
  const out: Vector3[] = []
  root.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return
    const pos = (o.geometry as BufferGeometry).getAttribute('position')
    for (let i = 0; i < pos.count; i += 1) out.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld))
  })
  return out
}
/** Spread of the vertices along the roof's normal: a thin sheet lying in the roof has a small one. */
function spreadAlongNormal(root: Object3D): number {
  const d = worldVertices(root).map((v) => v.dot(normal))
  return Math.max(...d) - Math.min(...d)
}

function scene() {
  const s = new HouseScene(document.createElement('canvas'), { headless: true })
  s.load(parseHouse(tilleuls))
  s.setDescriptors({ [window_.id]: window_, [blind.id]: blind })
  return s
}

describe('a roof window and its blind on the same opening', () => {
  it('the window draws the glass: the structure lays no pane there', () => {
    const s = scene()
    const panes: Mesh[] = []
    s.scene.traverse((o) => { if (o instanceof Mesh && o.userData.openingId === 'velux-palier' && o.userData.baseMaterial) panes.push(o) })
    expect(panes).toEqual([])
  })

  it('the sash lies in the roof closed, and its bottom swings out when it opens', () => {
    const s = scene()
    s.updateStates({ [window_.id]: state('window', 0), [blind.id]: state('cover', 100) }, true)
    const marker = s.markers.get('cover.velux')!
    const closed = spreadAlongNormal(marker.object)
    // a sash a few centimeters thick, flat in the roof — not a 1.18 m panel standing across it
    expect(closed).toBeLessThan(0.1)
    // the FIRST state is set without a tween (a later one animates, and a headless scene draws no frame)
    const open = scene()
    open.updateStates({ [window_.id]: state('window', 100), [blind.id]: state('cover', 100) }, true)
    expect(spreadAlongNormal(open.markers.get('cover.velux')!.object)).toBeGreaterThan(0.3)
    // and OUTWARD: the open sash rises above the closed one, it does not dip into the room
    const highest = (o: Object3D) => Math.max(...worldVertices(o).map((v) => v.dot(normal)))
    expect(highest(open.markers.get('cover.velux')!.object) - highest(marker.object)).toBeGreaterThan(0.3)
  })

  it('the blind unrolls along the slope, outside the glass, by its closed share', () => {
    const s = scene()
    s.updateStates({ [window_.id]: state('window', 0), [blind.id]: state('cover', 0) }, true)
    const marker = s.markers.get('cover.velux-store')!
    expect(spreadAlongNormal(marker.object)).toBeLessThan(0.1)
    // fully deployed: it covers the height of the opening along the slope
    const along = worldVertices(marker.object).map((v) => v.dot(down))
    expect(Math.max(...along) - Math.min(...along)).toBeGreaterThan(1.1)
    // raised: nothing shows (a fresh scene: the first state is set, not animated)
    const raised = scene()
    raised.updateStates({ [window_.id]: state('window', 0), [blind.id]: state('cover', 100) }, true)
    expect(worldVertices(raised.markers.get('cover.velux-store')!.object)).toEqual([])
  })
})
