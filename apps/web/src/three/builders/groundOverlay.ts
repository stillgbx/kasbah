import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three'
import { terrainHeight, type TerrainDescriptor, type Vec2 } from '@kasbah/shared'
import { applyTerrainHeights, drapeGeometry } from './terrain'

// Des formes PEINTES sur le terrain : aplats et traits qui épousent le relief, posés juste au-dessus
// de l'herbe. Première utilisation : la carte du terrain d'une tondeuse (zones, obstacles, câbles),
// dans le repère de la maison. Le style (teinte, opacité, largeur) est décidé par l'appelant.

export interface GroundShape {
  points: readonly Vec2[]
  /** Polygone (aplat + contour) ou ligne (trait seul). */
  closed: boolean
  fill?: { color: string; opacity: number }
  line?: { color: string; opacity: number; widthM: number }
}

/** Maille de l'aplat : plus lâche que le terrain (0,5 m), une zone de 100 m reste légère. */
const FILL_RES = 1
/** Pas d'échantillonnage d'un trait le long du relief. */
const LINE_STEP_M = 0.5
/** Au-dessus du terrain : l'aplat, puis le trait par-dessus (assez pour ne pas scintiller de loin). */
const FILL_LIFT = 0.03
const LINE_LIFT = 0.05

function material(color: string, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
}

/** Le trait recoupé tous les `LINE_STEP_M` : chaque point prendra la hauteur du terrain. */
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

/** Un ruban de `width` le long du trait, chaque sommet posé sur le relief. */
export function ribbonGeometry(points: readonly Vec2[], closed: boolean, width: number, terrain: TerrainDescriptor): BufferGeometry {
  const pts = densify(points, closed)
  const half = width / 2
  const pos = new Float32Array(pts.length * 6)
  pts.forEach((p, i) => {
    const prev = pts[Math.max(0, i - 1)]!, next = pts[Math.min(pts.length - 1, i + 1)]!
    let dx = next[0] - prev[0], dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    dx /= len; dy /= len
    // la normale au trait, dans le plan : (-dy, dx)
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
 * Les formes, peintes sur le terrain : un aplat drapé (la maille du terrain, posée par
 * `applyTerrainHeights` — sous un plancher, il passe sous le plancher comme l'herbe) et un ruban de
 * contour. Rien ne se touche : la carte peinte ne prend aucun tap (le terrain dessous reste à lui).
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
    if (o instanceof Mesh) { o.raycast = () => {}; o.renderOrder = 1 }
  })
  return group
}
