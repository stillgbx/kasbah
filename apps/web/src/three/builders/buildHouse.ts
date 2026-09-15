import type { BufferGeometry, Object3D } from 'three';
import { BoxGeometry, CircleGeometry, Group, Mesh } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { HouseGeometry, LevelGeometry, OpeningRect, WallPrism } from '@kasbah/shared'
import type { MaterialSet } from './materials'
import { extrudePolygon, flatPolygon, planarFaces } from './shapes'

// Builders : descripteurs purs → maillages. Tous les objets vivent dans le repère maison (Z-up) ;
// la racine porte la rotation vers le monde Three. Un maillage de murs par niveau et par matériau.

export const ROOT_ROTATION_X = -Math.PI / 2
/** Rayon (m) du sol infini sous la parcelle : couleur du fond de l'app, donc sans bord visible. */
export const GROUND_RADIUS = 400

export interface LevelNodes {
  group: Group
  /** Murs pleine hauteur, cloisons comprises : un niveau focalisé se regarde par le dessus, sans plafond. */
  walls: Mesh[]
  floors: Map<string, Mesh>
  panes: Mesh[]
  /** Conteneur des marqueurs d'appareils du niveau (masqué avec le niveau). */
  markers: Group
  labels: Group
  elevation: number
  height: number
}

export interface HouseNodes {
  root: Group
  levels: Map<string, LevelNodes>
  site: Group
  zones: Map<string, Mesh>
  terrain: Mesh
  /** Sol infini sous la parcelle (non éclairé, couleur du fond). */
  ground: Mesh
  roof: Mesh | null
  /** Marqueurs extérieurs (jardin). */
  outdoorMarkers: Group
}

export function buildWallsGeometry(prisms: readonly WallPrism[]): BufferGeometry | null {
  if (prisms.length === 0) return null
  const parts = prisms.map((p) => extrudePolygon(p.footprint, p.z0, p.z1))
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  return merged
}

/** Vitrage translucide dans l'embrasure d'une fenêtre (au milieu de l'épaisseur du mur). */
export function buildPane(o: OpeningRect, mats: MaterialSet): Mesh {
  const g = new BoxGeometry(o.width, Math.max(0.02, o.depth * 0.15), o.height)
  const m = new Mesh(g, mats.glass)
  const angle = Math.atan2(o.u[1], o.u[0])
  m.rotation.z = angle
  m.position.set(
    o.origin[0] + (o.u[0] * o.width) / 2 + (o.normal[0] * o.depth) / 2,
    o.origin[1] + (o.u[1] * o.width) / 2 + (o.normal[1] * o.depth) / 2,
    o.origin[2] + o.height / 2,
  )
  m.userData = { openingId: o.openingId }
  return m
}

export function buildLevel(level: LevelGeometry, mats: MaterialSet): LevelNodes {
  const group = new Group()
  group.name = `level:${level.levelId}`
  group.position.z = level.elevation
  const walls: Mesh[] = []
  for (const kind of ['exterior', 'interior'] as const) {
    const g = buildWallsGeometry(level.walls.filter((w) => w.kind === kind))
    if (!g) continue
    const mesh = new Mesh(g, kind === 'exterior' ? mats.wall : mats.wallInterior)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.name = `walls:${kind}`
    mesh.userData = { role: 'wall', kind, material: mesh.material }
    walls.push(mesh)
    group.add(mesh)
  }
  const floors = new Map<string, Mesh>()
  for (const f of level.floors) {
    const base = f.floorStyle ? mats.floors[f.floorStyle] : mats.floor
    const mat = base.clone()            // clone par pièce → surbrillance individuelle
    const mesh = new Mesh(extrudePolygon(f.polygon, f.z0, f.z1), mat)
    mesh.name = `floor:${f.roomId}`
    mesh.receiveShadow = true
    mesh.userData = { role: 'floor', roomId: f.roomId, baseMaterial: base, material: mat }
    floors.set(f.roomId, mesh)
    group.add(mesh)
  }
  const panes: Mesh[] = []
  for (const o of level.openings) {
    if (o.type !== 'window') continue
    const pane = buildPane(o, mats)
    pane.userData.material = pane.material
    panes.push(pane)
    group.add(pane)
  }
  const markers = new Group()
  markers.name = 'markers'
  const labels = new Group()
  labels.name = 'labels'
  group.add(markers, labels)
  return { group, walls, floors, panes, markers, labels, elevation: level.elevation, height: level.height }
}

export function buildHouse(geometry: HouseGeometry, mats: MaterialSet): HouseNodes {
  const root = new Group()
  root.name = 'house'
  root.rotation.x = ROOT_ROTATION_X

  const site = new Group()
  site.name = 'site'
  // Sol infini : la parcelle ne flotte plus sur le fond de l'app, l'horizon n'a plus de bord. Non
  // éclairé et de la couleur du fond, il s'y fond exactement ; il ne porte aucune ombre.
  const ground = new Mesh(new CircleGeometry(GROUND_RADIUS, 72), mats.ground)
  ground.name = 'ground'
  ground.position.z = geometry.terrain.z - 0.02
  ground.userData = { role: 'ground' }
  site.add(ground)
  const terrain = new Mesh(flatPolygon(geometry.terrain.polygon, geometry.terrain.z), mats.terrain)
  terrain.name = 'terrain'
  terrain.userData = { role: 'terrain' }
  terrain.receiveShadow = true
  site.add(terrain)
  const zones = new Map<string, Mesh>()
  for (const z of geometry.zones) {
    const mat = mats.zones[z.kind]
    const mesh = new Mesh(flatPolygon(z.polygon, z.z + 0.01), mat)
    mesh.name = `zone:${z.zoneId}`
    mesh.userData = { role: 'zone', zoneId: z.zoneId, material: mat }
    zones.set(z.zoneId, mesh)
    site.add(mesh)
  }
  const outdoorMarkers = new Group()
  outdoorMarkers.name = 'outdoor-markers'
  site.add(outdoorMarkers)
  root.add(site)

  const levels = new Map<string, LevelNodes>()
  for (const lg of geometry.levels) {
    const nodes = buildLevel(lg, mats)
    levels.set(lg.levelId, nodes)
    root.add(nodes.group)
  }

  let roof: Mesh | null = null
  if (geometry.roof) {
    const g = geometry.roof.type === 'flat'
      ? extrudePolygon(geometry.roof.outline, geometry.roof.zBase, geometry.roof.zRidge)
      : planarFaces(geometry.roof.faces)
    roof = new Mesh(g, mats.roof)
    roof.name = 'roof'
    roof.castShadow = true
    roof.userData = { role: 'roof', material: mats.roof }
    root.add(roof)
  }
  return { root, levels, site, zones, terrain, ground, roof, outdoorMarkers }
}

/** Nombre de triangles d'un sous-arbre (diagnostic / tests). */
export function countTriangles(root: Object3D): number {
  let n = 0
  root.traverse((o) => {
    if (o instanceof Mesh) {
      const g = o.geometry as BufferGeometry
      n += g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3
    }
  })
  return n
}
