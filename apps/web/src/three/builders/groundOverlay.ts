import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three'
import { terrainHeight, type TerrainDescriptor, type Vec2 } from '@kasbah/shared'
import { SITE_DECOR_LAYER } from '../core/layers'
import { applyTerrainHeights, drapeGeometry } from './terrain'

// Shapes PAINTED on the terrain: fills and strokes that hug the relief, laid just above
// the grass. First use: a mower's terrain map (zones, obstacles, wires),
// in the house reference frame. The style (tint, opacity, width) is decided by the caller.

export interface GroundShape {
  points: readonly Vec2[]
  /** Polygon (fill + outline) or line (stroke only). */
  closed: boolean
  fill?: { color: string; opacity: number }
  line?: { color: string; opacity: number; widthM: number }
}

/** Mesh of the fill: looser than the terrain (0.5 m), a 100 m zone stays light. */
const FILL_RES = 1
/** Sampling step of a stroke along the relief. */
const LINE_STEP_M = 0.5
/** Above the terrain: the fill, then the stroke on top (enough not to flicker from afar). */
const FILL_LIFT = 0.03
const LINE_LIFT = 0.05

function material(color: string, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
}

/** The stroke cut every `LINE_STEP_M`: each point will take the terrain height. */
function densify(points: readonly Vec2[], closed: boolean): Vec2[] {
  const pts = closed ? [...points, points[0]!] : [...points]
  const out: Vec2[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / LINE_STEP_M))
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  out.push(pts[pts.length - 1]!)
  return out
}

/** A ribbon of `width` along the stroke, each vertex laid on the relief. */
export function ribbonGeometry(points: readonly Vec2[], closed: boolean, width: number, terrain: TerrainDescriptor): BufferGeometry {
  const pts = densify(points, closed)
  const half = width / 2
  const pos = new Float32Array(pts.length * 6)
  pts.forEach((p, i) => {
    const prev = pts[Math.max(0, i - 1)]!, next = pts[Math.min(pts.length - 1, i + 1)]!
    let dx = next[0] - prev[0], dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    dx /= len; dy /= len
    // the normal to the stroke, in the plane: (-dy, dx)
    const lx = p[0] - dy * half, ly = p[1] + dx * half, rx = p[0] + dy * half, ry = p[1] - dx * half
    pos.set([lx, ly, terrainHeight(terrain, lx, ly) + LINE_LIFT, rx, ry, terrainHeight(terrain, rx, ry) + LINE_LIFT], i * 6)
  })
  const index: number[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3
    index.push(a, b, c, b, d, c)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setIndex(index)
  return g
}

/**
 * The shapes, painted on the terrain: a draped fill (the terrain mesh, laid by
 * `applyTerrainHeights` — under a floor, it passes under the floor like the grass) and an outline
 * ribbon. Nothing is touchable: the painted map takes no tap (taps stay with the terrain below).
 * It lives on `SITE_DECOR_LAYER`: ambient occlusion (high quality) took the ribbons, 5 cm
 * above the grass, for obstacles and ringed every stroke with a dark edge.
 */
export function buildGroundOverlay(shapes: readonly GroundShape[], terrain: TerrainDescriptor): Group {
  const group = new Group()
  group.name = 'ground-overlay'
  for (const s of shapes) {
    if (s.points.length < (s.closed ? 3 : 2)) continue
    if (s.closed && s.fill && s.fill.opacity > 0) {
      const g = drapeGeometry(s.points, [], FILL_RES)
      applyTerrainHeights(g, terrain, FILL_LIFT)
      group.add(new Mesh(g, material(s.fill.color, s.fill.opacity)))
    }
    if (s.line && s.line.opacity > 0) group.add(new Mesh(ribbonGeometry(s.points, s.closed, s.line.widthM, terrain), material(s.line.color, s.line.opacity)))
  }
  group.traverse((o) => {
    o.layers.set(SITE_DECOR_LAYER)
    if (o instanceof Mesh) { o.raycast = () => {}; o.renderOrder = 1 }
  })
  return group
}
