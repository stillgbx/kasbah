import type { Material, Object3D } from 'three'
import { BoxGeometry, BufferAttribute, BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three'
import type { Finish, HouseGeometry, LevelGeometry, OpeningRect, WallPrism } from '@kasbah/shared'
import { buildDetails, buildRoofDetails, isGlazed } from './details'
import { finishMaterial, type MaterialSet } from './materials'
import { WATER_DEPTH_ATTRIBUTE } from '../effects/water'
import { applyTerrainHeights, drapeGeometry, skirtGeometry, TERRAIN_MESH_RES } from './terrain'
import { alignedToLongestEdge, discWithHoles, extrudePolygon, extrudePolygonWithHoles, flatPolygon, flatRing, flatWithHoles, insetPolygon, planarFaces, planarFacesWithHoles } from './shapes'
import { offsetPolygon, openingCentre, signedArea } from '@kasbah/shared'

// Builders : descripteurs purs → maillages. Tous les objets vivent dans le repère maison (Z-up) ;
// la racine porte la rotation vers le monde Three. Un maillage de murs par niveau et par matériau.

export const ROOT_ROTATION_X = -Math.PI / 2
/** Rayon (m) du sol infini sous la parcelle : couleur du fond de l'app, donc sans bord visible. */
export const GROUND_RADIUS = 400
/** Largeur (m) de la margelle d'une piscine, profondeur du bassin, et retrait de l'eau sous la margelle. */
const POOL_COPING_W = 0.4
const POOL_DEPTH = 1.5
const POOL_WATER_DROP = 0.12

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
  /** Bord vertical d'un terrain EN RELIEF, jusqu'au sol infini ; `null` sur un terrain plat. */
  skirt: Mesh | null
  roof: Mesh | null
  /** Marqueurs extérieurs (jardin). */
  outdoorMarkers: Group
}

/** Triangles d'un lot de faces de murs, et leurs UV en mètres. */
interface FaceBucket { pos: number[]; uv: number[] }
const bucket = (): FaceBucket => ({ pos: [], uv: [] })

/**
 * Les six faces d'un prisme de mur, chacune dans son lot : la face INTÉRIEURE (côté pièce, celle que
 * la finition murale habille) dans `inner`, tout le reste (face extérieure, bouts, dessus, dessous)
 * dans `rest`. L'empreinte est `[P(u0), Q(u0), Q(u1), P(u1)]` (`pieceFootprint`) : P sur la face
 * intérieure, donc l'arête 3 → 0 EST la face intérieure. Normales sortantes quel que soit le sens
 * du quad ; UV en mètres (le long du mur × hauteur, et x × y sur les dessus), comme les autres.
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

/** Vitrage translucide dans l'embrasure d'une ouverture vitrée (au milieu de l'épaisseur du mur). */
export function buildPane(o: OpeningRect, mats: MaterialSet): Mesh {
  if (o.host === 'floor' || o.host === 'roof') {
    // rectangle horizontal (sol) ou penché (toit) : width × height dans le plan, épaisseur fine
    const thick = Math.max(0.02, o.depth * 0.4)
    const g = new BoxGeometry(o.width, o.height, thick)
    const m = new Mesh(g, mats.glass)
    const yaw = ((o.yaw ?? 0) * Math.PI) / 180
    const slope = ((o.slope ?? 0) * Math.PI) / 180
    // cap : 0 = +y → rotation Z ; pente : inclinaison autour de l'axe local X (largeur). L'ordre
    // ZXY penche APRÈS le cap ; l'ordre XYZ par défaut penchait autour du X monde (à l'envers à 180°)
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
 * `dressed` : les ouvertures HABILLÉES par un ouvrant (`HouseDevice.openingId`). Leur vantail est
 * dessiné par le marqueur de l'appareil, qui l'ouvre — le bâti n'en pose pas un second.
 */
/**
 * Murs pleine hauteur d'un niveau : un maillage par MATÉRIAU. Sans aucune finition, ce sont les deux
 * d'avant — `walls:exterior` (façade, intérieur des façades compris) et `walls:interior` (cloisons).
 * Une pièce qui a une finition murale reçoit les faces intérieures de ses murs dans le maillage de
 * cette finition ; une façade habillée prend tout l'extérieur, et l'intérieur des façades qui n'ont
 * pas de finition passe alors au matériau des cloisons (la brique de la façade n'entre pas dans la pièce).
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
  // l'ordre de création fixe l'ordre des maillages : `walls[0]` reste le mur extérieur
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
  // le détail architectural vit avec les murs : même fantôme, même retour de matériau ; APRÈS eux,
  // pour que `walls[0]` reste le mur extérieur
  for (const mesh of buildDetails(level, mats, dressed)) { walls.push(mesh); group.add(mesh) }
  const floors = new Map<string, Mesh>()
  for (const f of level.floors) {
    const base = f.finish ? finishMaterial(mats, 'floor', f.finish, f.floorStyle) : f.floorStyle ? mats.floors[f.floorStyle] : mats.floor
    const mat = base.clone()            // clone par pièce → surbrillance individuelle
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
  // un verre par PIÈCE : ses fenêtres s'allument avec ses lampes, sans allumer celles des voisines
  const roomGlass = new Map<string, Material>()
  for (const o of level.openings) {
    if (!isGlazed(o)) continue
    const pane = buildPane(o, mats)
    // un puits de lumière est dans une DALLE : allumé, il faisait un carré blanc au milieu de la
    // pièce. Il garde le verre commun, qui ne s'allume jamais.
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
  // Sol infini : la parcelle ne flotte plus sur le fond de l'app, l'horizon n'a plus de bord. Non
  // éclairé et de la couleur du fond, il s'y fond exactement ; il ne porte aucune ombre.
  // Les bassins sont CREUSÉS : terrain et sol infini sont percés à leur emprise, sinon la surface du
  // terrain (ou le disque, deux centimètres plus bas) fermerait le trou et cacherait parois et eau.
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
      // Une piscine est un BASSIN, pas une tache bleue : une margelle qui déborde et affleure, un
      // bassin carrelé vu de l'intérieur (une extrusion rendue sur ses faces ARRIÈRE : parois et
      // fond, le dessus reste ouvert), et l'eau douze centimètres sous la margelle, translucide —
      // c'est le fond qui lui donne sa couleur et sa profondeur.
      const coping = new Mesh(flatRing(offsetPolygon(z.polygon, POOL_COPING_W), z.polygon, z.z + 0.012), mats.trim)
      coping.name = `pool:coping:${z.zoneId}`
      coping.receiveShadow = true
      // bassin et eau sont construits dans le repère de la piscine : les carreaux du fond et des
      // parois suivent ses bords, pas les axes du monde (une piscine tournée les avait en biais)
      const basin = new Mesh(alignedToLongestEdge(z.polygon, (p) => extrudePolygon(p, z.z - POOL_DEPTH, z.z + 0.012)), mats.poolBasin)
      basin.name = `pool:basin:${z.zoneId}`
      // la profondeur de chaque sommet sous la lame : le shader en tire le chemin de la lumière dans l'eau
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
 * Met le terrain, sa jupe, le sol infini et les zones à plat en accord avec `geometry.terrain` :
 * maillés et posés sur la surface quand il y a un relief, polygones plats sinon — le chemin d'avant,
 * inchangé. Les MAILLAGES restent les mêmes objets (le rayon, les ombres, les matières les tiennent),
 * seules leurs géométries changent ; une géométrie déjà maillée n'est pas refaite, seuls ses z
 * bougent : c'est ce que l'éditeur du relief appelle à chaque image d'un glissement.
 * `outlineChanged` : le CONTOUR a changé (éditeur du contour, ou contour enregistré ailleurs) — le
 * terrain et sa jupe se remaillent, même déjà maillés.
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
    // le sol infini s'arrête au bord de la parcelle : c'est la jupe qui fait la marche
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

/** Maillage du toit (plat ou à pentes), trous de Velux compris. */
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
