import type { Material, Object3D } from 'three'
import { BoxGeometry, BufferAttribute, BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three'
import type { Finish, HouseGeometry, LevelGeometry, OpeningRect, WallPrism } from '@kasbah/shared'
import { buildDetails, buildRoofDetails, isGlazed } from './details'
import { finishMaterial, type MaterialSet } from './materials'
import { WATER_DEPTH_ATTRIBUTE } from '../effects/water'
import { applyTerrainHeights, drapeGeometry, skirtGeometry, TERRAIN_MESH_RES } from './terrain'
import { alignedToLongestEdge, discWithHoles, extrudePolygon, extrudePolygonWithHoles, flatPolygon, flatRing, flatWithHoles, insetPolygon, planarFaces, planarFacesWithHoles } from './shapes'
import { offsetPolygon, openingCentre, signedArea } from '@kasbah/shared'

// Builders: pure descriptors → meshes. All objects live in the house reference frame (Z-up);
// the root carries the rotation to the Three world. One wall mesh per level and per material.

export const ROOT_ROTATION_X = -Math.PI / 2
/** Radius (m) of the infinite ground under the plot: the app's background color, hence no visible edge. */
export const GROUND_RADIUS = 400
/** Width (m) of a pool's coping, depth of the basin, and inset of the water under the coping. */
const POOL_COPING_W = 0.4
const POOL_DEPTH = 1.5
const POOL_WATER_DROP = 0.12

export interface LevelNodes {
  group: Group
  /** Full-height walls, partitions included: a focused level is looked at from above, without a ceiling. */
  walls: Mesh[]
  floors: Map<string, Mesh>
  panes: Mesh[]
  /** Container of the level's device markers (hidden with the level). */
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
  /** Infinite ground under the plot (unlit, background color). */
  ground: Mesh
  /** Vertical edge of a terrain WITH RELIEF, down to the infinite ground; `null` on a flat terrain. */
  skirt: Mesh | null
  roof: Mesh | null
  /** Outdoor markers (garden). */
  outdoorMarkers: Group
}

/** Triangles of a batch of wall faces, and their UVs in meters. */
interface FaceBucket { pos: number[]; uv: number[] }
const bucket = (): FaceBucket => ({ pos: [], uv: [] })

/**
 * The six faces of a wall prism, each in its batch: the INNER face (room side, the one the
 * wall finish dresses) in `inner`, all the rest (outer face, ends, top, bottom)
 * in `rest`. The footprint is `[P(u0), Q(u0), Q(u1), P(u1)]` (`pieceFootprint`): P on the inner
 * face, so edge 3 → 0 IS the inner face. Outward normals whatever the winding
 * of the quad; UVs in meters (along the wall × height, and x × y on the tops), like the others.
 */
export function addWallPrism(p: WallPrism, inner: FaceBucket, rest: FaceBucket): void {
  const fp = p.footprint
  const ccw = signedArea(fp) >= 0
  const tri = (b: FaceBucket, pts: [number, number, number][], uvs: [number, number][], order: number[]) => {
    for (const i of order) { b.pos.push(...pts[i]!); b.uv.push(...uvs[i]!) }
  }
  for (let i = 0; i < 4; i++) {
    const a = fp[i]!, b = fp[(i + 1) % 4]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-6) continue
    const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len
    const ua = a[0] * dx + a[1] * dy, ub = b[0] * dx + b[1] * dy
    const pts: [number, number, number][] = [[a[0], a[1], p.z0], [b[0], b[1], p.z0], [b[0], b[1], p.z1], [a[0], a[1], p.z1]]
    const uvs: [number, number][] = [[ua, p.z0], [ub, p.z0], [ub, p.z1], [ua, p.z1]]
    tri(i === 3 ? inner : rest, pts, uvs, ccw ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2])
  }
  const cap = (z: number, up: boolean) => {
    const pts = fp.map(([x, y]) => [x, y, z] as [number, number, number])
    const uvs = fp.map(([x, y]) => [x, y] as [number, number])
    tri(rest, pts, uvs, up === ccw ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2])
  }
  cap(p.z1, true)
  cap(p.z0, false)
}

function bucketGeometry(b: FaceBucket): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(b.pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(b.uv, 2))
  g.computeVertexNormals()
  return g
}

/** Translucent glazing in the reveal of a glazed opening (in the middle of the wall thickness). */
export function buildPane(o: OpeningRect, mats: MaterialSet): Mesh {
  if (o.host === 'floor' || o.host === 'roof') {
    // horizontal (floor) or tilted (roof) rectangle: width × height in the plane, thin thickness
    const thick = Math.max(0.02, o.depth * 0.4)
    const g = new BoxGeometry(o.width, o.height, thick)
    const m = new Mesh(g, mats.glass)
    const yaw = ((o.yaw ?? 0) * Math.PI) / 180
    const slope = ((o.slope ?? 0) * Math.PI) / 180
    // heading: 0 = +y → Z rotation; slope: tilt around the local X axis (width). The
    // ZXY order tilts AFTER the heading; the default XYZ order tilted around world X (upside down at 180°)
    m.rotation.order = 'ZXY'
    m.rotation.z = yaw
    m.rotation.x = -slope
    m.position.set(...openingCentre(o))
    m.userData = { openingId: o.openingId }
    return m
  }
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

/**
 * `dressed`: the openings DRESSED by a cover (`HouseDevice.openingId`). Their leaf is
 * drawn by the device's marker, which opens it — the structure does not lay a second one.
 */
/**
 * Full-height walls of a level: one mesh per MATERIAL. Without any finish, these are the two
 * from before — `walls:exterior` (facade, inside of the facades included) and `walls:interior` (partitions).
 * A room with a wall finish receives the inner faces of its walls in that finish's
 * mesh; a dressed facade takes the whole outside, and the inside of the facades that have
 * no finish then goes to the partitions' material (the facade's brick does not enter the room).
 */
function buildWalls(level: LevelGeometry, mats: MaterialSet, facade: Finish | undefined): Mesh[] {
  const ext = facade ? finishMaterial(mats, 'facade', facade) : mats.wall
  const bareInside = facade ? mats.wallInterior : mats.wall
  const lots = new Map<Material, { b: FaceBucket; name: string; kind: 'exterior' | 'interior' }>()
  const lot = (m: Material, name: string, kind: 'exterior' | 'interior') => {
    let l = lots.get(m)
    if (!l) { l = { b: bucket(), name, kind }; lots.set(m, l) }
    return l.b
  }
  // the creation order fixes the order of the meshes: `walls[0]` stays the exterior wall
  if (level.walls.some((w) => w.kind === 'exterior')) lot(ext, 'walls:exterior', 'exterior')
  if (level.walls.some((w) => w.kind === 'interior') || facade) lot(mats.wallInterior, 'walls:interior', 'interior')
  for (const w of level.walls) {
    const finish = level.wallFinishes?.[w.roomId]
    const own = finish ? finishMaterial(mats, 'wall', finish) : undefined
    const inner = own ? lot(own, `walls:finish:${finish!.id}`, 'interior') : lot(w.kind === 'exterior' ? bareInside : mats.wallInterior, '', 'interior')
    const rest = lot(w.kind === 'exterior' ? ext : mats.wallInterior, '', w.kind)
    addWallPrism(w, inner, rest)
  }
  const meshes: Mesh[] = []
  for (const [material, { b, name, kind }] of lots) {
    if (b.pos.length === 0) continue
    const mesh = new Mesh(bucketGeometry(b), material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.name = name
    mesh.userData = { role: 'wall', kind, material }
    meshes.push(mesh)
  }
  return meshes
}
export function buildLevel(level: LevelGeometry, mats: MaterialSet, dressed?: ReadonlySet<string>, facade?: Finish): LevelNodes {
  const group = new Group()
  group.name = `level:${level.levelId}`
  group.position.z = level.elevation
  const walls: Mesh[] = []
  for (const mesh of buildWalls(level, mats, facade)) { walls.push(mesh); group.add(mesh) }
  // the architectural detail lives with the walls: same ghost, same material reset; AFTER them,
  // so that `walls[0]` stays the exterior wall
  for (const mesh of buildDetails(level, mats, dressed)) { walls.push(mesh); group.add(mesh) }
  const floors = new Map<string, Mesh>()
  for (const f of level.floors) {
    const base = f.finish ? finishMaterial(mats, 'floor', f.finish, f.floorStyle) : f.floorStyle ? mats.floors[f.floorStyle] : mats.floor
    const mat = base.clone()            // clone per room → individual highlighting
    const holePolys = f.holes?.map((h) => h.polygon) ?? []
    const geom = holePolys.length > 0
      ? extrudePolygonWithHoles(f.polygon, holePolys, f.z0, f.z1)
      : extrudePolygon(f.polygon, f.z0, f.z1)
    const mesh = new Mesh(geom, mat)
    mesh.name = `floor:${f.roomId}`
    mesh.receiveShadow = true
    mesh.userData = { role: 'floor', roomId: f.roomId, baseMaterial: base, material: mat }
    floors.set(f.roomId, mesh)
    group.add(mesh)
  }
  const panes: Mesh[] = []
  // one glass per ROOM: its windows light up with its lamps, without lighting those of the neighbors
  const roomGlass = new Map<string, Material>()
  for (const o of level.openings) {
    if (!isGlazed(o)) continue
    const pane = buildPane(o, mats)
    // a skylight is in a SLAB: lit, it made a white square in the middle of the
    // room. It keeps the shared glass, which never lights up.
    if (o.host !== 'floor') {
      let glass = roomGlass.get(o.roomId)
      if (!glass) { glass = mats.glass.clone(); roomGlass.set(o.roomId, glass) }
      pane.material = glass
      pane.userData.roomId = o.roomId
    }
    pane.userData.baseMaterial = mats.glass
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

export function buildHouse(geometry: HouseGeometry, mats: MaterialSet, dressed?: ReadonlySet<string>): HouseNodes {
  const root = new Group()
  root.name = 'house'
  root.rotation.x = ROOT_ROTATION_X

  const site = new Group()
  site.name = 'site'
  // Infinite ground: the plot no longer floats on the app background, the horizon no longer has an edge.
  // Unlit and of the background color, it blends into it exactly; it carries no shadow.
  // The pools are DUG: terrain and infinite ground are pierced at their footprint, otherwise the surface of the
  // terrain (or the disc, two centimeters lower) would close the hole and hide walls and water.
  const basins = geometry.zones.filter((z) => z.kind === 'pool').map((z) => z.polygon)
  const ground = new Mesh(discWithHoles(GROUND_RADIUS, basins, 0), mats.ground)
  ground.name = 'ground'
  ground.position.z = geometry.terrain.z - 0.02
  ground.userData = { role: 'ground' }
  site.add(ground)
  const terrain = new Mesh(flatWithHoles(geometry.terrain.polygon, basins, geometry.terrain.z), mats.terrain)
  terrain.name = 'terrain'
  terrain.userData = { role: 'terrain' }
  terrain.receiveShadow = true
  site.add(terrain)
  const zones = new Map<string, Mesh>()
  for (const z of geometry.zones) {
    const mat = mats.zones[z.kind]
    if (z.kind === 'pool') {
      // A pool is a BASIN, not a blue spot: a coping that overhangs and sits flush, a
      // tiled basin seen from inside (an extrusion rendered on its BACK faces: walls and
      // bottom, the top stays open), and the water twelve centimeters below the coping, translucent —
      // it is the bottom that gives it its color and depth.
      const coping = new Mesh(flatRing(offsetPolygon(z.polygon, POOL_COPING_W), z.polygon, z.z + 0.012), mats.trim)
      coping.name = `pool:coping:${z.zoneId}`
      coping.receiveShadow = true
      // basin and water are built in the pool's frame: the tiles of the bottom and
      // walls follow its edges, not the world axes (a rotated pool had them askew)
      const basin = new Mesh(alignedToLongestEdge(z.polygon, (p) => extrudePolygon(p, z.z - POOL_DEPTH, z.z + 0.012)), mats.poolBasin)
      basin.name = `pool:basin:${z.zoneId}`
      // the depth of each vertex under the water sheet: the shader derives the light's path through the water from it
      const pos = basin.geometry.getAttribute('position')
      const depth = new Float32Array(pos.count)
      for (let i = 0; i < pos.count; i++) depth[i] = z.z - POOL_WATER_DROP - pos.getZ(i)
      basin.geometry.setAttribute(WATER_DEPTH_ATTRIBUTE, new BufferAttribute(depth, 1))
      const water = new Mesh(alignedToLongestEdge(insetPolygon(z.polygon, 0.005), (p) => flatPolygon(p, z.z - POOL_WATER_DROP)), mat)
      water.name = `zone:${z.zoneId}`
      water.userData = { role: 'zone', zoneId: z.zoneId, material: mat }
      zones.set(z.zoneId, water)
      site.add(coping, basin, water)
      continue
    }
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
    const nodes = buildLevel(lg, mats, dressed, geometry.facade)
    levels.set(lg.levelId, nodes)
    root.add(nodes.group)
  }

  let roof: Mesh | null = null
  if (geometry.roof) {
    roof = buildRoofMesh(geometry.roof, mats)
    root.add(roof)
  }
  const nodes: HouseNodes = { root, levels, site, zones, terrain, ground, skirt: null, roof, outdoorMarkers }
  if (geometry.terrain.relief) shapeTerrain(nodes, geometry, mats)
  return nodes
}

/**
 * Brings the terrain, its skirt, the infinite ground and the flat zones in line with `geometry.terrain`:
 * meshed and laid on the surface when there is relief, flat polygons otherwise — the former path,
 * unchanged. The MESHES stay the same objects (the raycaster, the shadows, the materials hold them),
 * only their geometries change; an already meshed geometry is not redone, only its z values
 * move: that is what the relief editor calls on every frame of a drag.
 * `outlineChanged`: the OUTLINE changed (outline editor, or outline saved elsewhere) — the
 * terrain and its skirt are remeshed, even if already meshed.
 */
export function shapeTerrain(nodes: HouseNodes, geometry: Pick<HouseGeometry, 'terrain' | 'zones'>, mats: MaterialSet, outlineChanged = false): void {
  const t = geometry.terrain
  const basins = geometry.zones.filter((z) => z.kind === 'pool').map((z) => z.polygon)
  const swap = (mesh: Mesh, g: BufferGeometry) => { mesh.geometry.dispose(); mesh.geometry = g }
  if (!t.relief) {
    if (!nodes.terrain.geometry.userData.drape && !outlineChanged) return
    swap(nodes.terrain, flatWithHoles(t.polygon, basins, t.z))
    swap(nodes.ground, discWithHoles(GROUND_RADIUS, basins, 0))
    for (const z of geometry.zones) {
      const mesh = nodes.zones.get(z.zoneId)
      if (mesh && z.kind !== 'pool') swap(mesh, flatPolygon(z.polygon, z.z + 0.01))
    }
    if (nodes.skirt) { nodes.skirt.removeFromParent(); nodes.skirt.geometry.dispose(); nodes.skirt = null }
    return
  }
  if (!nodes.terrain.geometry.userData.drape || outlineChanged) {
    if (nodes.skirt) { nodes.skirt.removeFromParent(); nodes.skirt.geometry.dispose(); nodes.skirt = null }
    const g = drapeGeometry(t.polygon, basins, TERRAIN_MESH_RES, t.footprints)
    g.userData.drape = true
    swap(nodes.terrain, g)
    // the infinite ground stops at the edge of the plot: the skirt makes the step
    swap(nodes.ground, discWithHoles(GROUND_RADIUS, [t.polygon], 0))
    for (const z of geometry.zones) {
      const mesh = nodes.zones.get(z.zoneId)
      if (mesh && z.kind !== 'pool') { const zg = drapeGeometry(z.polygon, [], TERRAIN_MESH_RES, t.footprints); zg.userData.drape = true; swap(mesh, zg) }
    }
    const skirt = new Mesh(skirtGeometry(t.polygon), mats.ground)
    skirt.name = 'terrain:skirt'
    skirt.userData = { role: 'ground' }
    nodes.site.add(skirt)
    nodes.skirt = skirt
  }
  applyTerrainHeights(nodes.terrain.geometry, t)
  if (nodes.skirt) applyTerrainHeights(nodes.skirt.geometry, t)
  for (const z of geometry.zones) {
    const mesh = nodes.zones.get(z.zoneId)
    if (mesh && z.kind !== 'pool') applyTerrainHeights(mesh.geometry, t, 0.01)
  }
}

/** Roof mesh (flat or pitched), Velux holes included. */
export function buildRoofMesh(
  roof: NonNullable<HouseGeometry['roof']>, mats: MaterialSet,
): Mesh {
  const holes = roof.holes ?? []
  const g = roof.type === 'flat'
    ? (holes.length > 0
      ? extrudePolygonWithHoles(roof.outline, holes.map((h) => h.polygon), roof.zBase, roof.zRidge)
      : extrudePolygon(roof.outline, roof.zBase, roof.zRidge))
    : (holes.some((h) => h.faceIndex !== undefined)
      ? planarFacesWithHoles(roof.faces, holes)
      : planarFaces(roof.faces))
  const roofMat = roof.type === 'flat' ? mats.roofFlat : mats.roof
  const mesh = new Mesh(g, roofMat)
  mesh.name = 'roof'
  mesh.castShadow = true
  mesh.userData = { role: 'roof', material: roofMat }
  for (const d of buildRoofDetails(roof, mats)) mesh.add(d)
  return mesh
}

/** Number of triangles of a subtree (diagnostics / tests). */
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
