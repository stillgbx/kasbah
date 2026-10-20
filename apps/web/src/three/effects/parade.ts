import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, CircleGeometry, Color, ConeGeometry,
  CylinderGeometry, DoubleSide, type BufferGeometry as Geometry, Group, LineBasicMaterial, LineSegments, type Material, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, type Object3D, Points, PointsMaterial, SphereGeometry, TorusGeometry, Vector3,
} from 'three'
import type { ParadeKind } from '../styles/types'
import { type Box, type Circle, type Obstacles, type Path, roam, type RoamArea } from './roam'

// CHARACTERS that roam the terrain, depending on the style (`StyleLook.parade`):
//  - `noel`: Santa's sleigh and its reindeer, flying above the garden and scattering
//    golden glitter;
//  - `halloween`: ghosts that float (and go through walls, they are ghosts) and
//    skeletons that walk ON THE GROUND, each on its own, over the relief;
//  - `tatooine`: three X-wings, wings in an X, each with its own flight; they cross and bank in the turns;
//  - `akira`: Kaneda's red motorbike riding ON THE GROUND, leaning into the turns, and the red trail
//    of its tail light;
//  - `girlyversaire`: balloons of every color, released at the foot of the house, rising
//    while swaying at the end of their string, pushed by the same light wind, then vanishing
//    above the roof while others take off from the ground.
//
// Balloons aside, nobody goes round in circles: each follows a course drawn at random over the WHOLE terrain
// (`roam.ts`), which skirts the house, the pool and the garden, and steers clear of the cars and the
// mower — except the ghosts, which go through everything, and the sleigh and the X-wings, which fly
// above and only skirt the house and the trees. The nose follows the trajectory (`fly`).
//
// Everything is in the house's LOCAL reference frame (Z-up, child of the root), like the bats.
// The models are made of primitives (boxes, cylinders, spheres): no file, no
// loading. Each model faces +X, up is +Z. Nothing casts a shadow (the map is only
// redone on demand) and nothing catches clicks.

type XY = readonly [number, number]

/** Where to parade: the terrain, the building footprint (avoided), the roof top, the ground (skeletons and bike ride on it). */
export interface ParadeArea {
  terrain: readonly XY[]
  building: Box
  /** The other footprints to skirt (the pool). */
  pools?: readonly Box[]
  /** The garden, as discs; `tall` = a tree, which even what flies above the roof skirts. */
  statics?: readonly (Circle & { tall?: boolean })[]
  /** What moves (cars, mower), read again at every step. */
  around?: () => readonly Circle[]
  roofZ: number
  groundZ?: (x: number, y: number) => number
}

interface Actor { update(t: number): void }

export class Parade {
  readonly object = new Group()
  readonly kind: ParadeKind
  private readonly actors: Actor[] = []
  private readonly obstacles: Obstacles = { list: [] }
  private readonly readObstacles: () => readonly Circle[]
  private time = 0

  constructor(kind: ParadeKind, area: ParadeArea) {
    this.kind = kind
    this.object.name = `parade-${kind}`
    const groundZ = area.groundZ ?? (() => 0)
    this.readObstacles = area.around ?? (() => [])
    this.obstacles.list = this.readObstacles()
    const site: RoamArea = { terrain: area.terrain, avoid: [area.building, ...(area.pools ?? [])], statics: area.statics, around: this.obstacles }
    // what flies above the roof only skirts the house and the trees: no car, no
    // mower, no bush, no pool
    const sky: RoamArea = { terrain: area.terrain, avoid: [area.building], statics: area.statics?.filter((c) => c.tall) }
    if (kind === 'noel') this.sleigh(sky, area.roofZ)
    else if (kind === 'halloween') { this.ghosts({ terrain: area.terrain, avoid: [] }, area.roofZ); this.skeletons(site, groundZ) }
    else if (kind === 'tatooine') this.xwings(sky, area.roofZ)
    else if (kind === 'girlyversaire') this.balloons(area.building, area.roofZ, groundZ)
    else this.bike(site, groundZ)
    this.object.traverse((o) => { o.raycast = () => {}; o.castShadow = false })
    this.write()
  }

  /** Advances the animation by `dtS` seconds. */
  step(dtS: number): void {
    this.time += Math.min(0.1, Math.max(0, dtS))
    this.obstacles.list = this.readObstacles()
    this.write()
  }

  private write(): void {
    for (const a of this.actors) a.update(this.time)
  }

  dispose(): void {
    this.object.removeFromParent()
    const geos = new Set<Geometry>(), mats = new Set<Material>()
    this.object.traverse((o) => {
      const m = o as Mesh
      if (m.geometry) geos.add(m.geometry)
      if (m.material) for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x)
    })
    for (const g of geos) g.dispose()
    for (const m of mats) m.dispose()
  }

  // ---- Christmas --------------------------------------------------------------------------------

  private sleigh(site: RoamArea, roofZ: number): void {
    const S = 1.4                                        // larger than life, to be seen from above
    const red = std(0xc0161e, 0.5), gold = std(0xd9a53a, 0.3, 0.8), brown = std(0x8a5a34, 0.8)
    const white = std(0xf4f4f0, 0.9), skin = std(0xf1c9a5, 0.7), black = std(0x141414, 0.6)
    const antler = std(0xd9c3a0, 0.8), sack = std(0x7a5230, 0.95)
    const rudolph = new MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 })

    const g = new Group()
    // the sleigh: body, raised backrest, golden runners curled up at the front
    g.add(at(mesh(new BoxGeometry(1.4, 0.8, 0.4), red), 0, 0, 0.4))
    g.add(at(mesh(new BoxGeometry(0.2, 0.8, 0.5), red), -0.65, 0, 0.75))
    for (const y of [-0.38, 0.38]) {
      g.add(at(mesh(new BoxGeometry(1.8, 0.06, 0.06), gold), 0.1, y, 0.06))
      g.add(tilt(at(mesh(new BoxGeometry(0.4, 0.06, 0.06), gold), 1.05, y, 0.2), 0, -0.9))
      g.add(at(mesh(new BoxGeometry(0.06, 0.06, 0.3), gold), -0.3, y, 0.2))
      g.add(at(mesh(new BoxGeometry(0.06, 0.06, 0.3), gold), 0.5, y, 0.2))
    }
    // Santa: coat, belt, head, beard, pompom hat
    g.add(at(upright(mesh(new CylinderGeometry(0.24, 0.3, 0.6, 12), red)), -0.1, 0, 0.9))
    g.add(at(upright(mesh(new CylinderGeometry(0.29, 0.29, 0.07, 12), black)), -0.1, 0, 0.82))
    g.add(at(mesh(new SphereGeometry(0.16, 12, 8), skin), -0.08, 0, 1.33))
    g.add(sized(at(mesh(new SphereGeometry(0.14, 10, 8), white), 0.02, 0, 1.22), 0.8, 1.1, 1.1))
    g.add(at(upright(mesh(new ConeGeometry(0.16, 0.36, 12), red)), -0.1, 0, 1.6))
    g.add(at(mesh(new SphereGeometry(0.06, 8, 6), white), -0.1, 0, 1.8))
    // the sack
    g.add(at(mesh(new SphereGeometry(0.34, 12, 8), sack), -0.5, 0.05, 0.85))

    // the reindeer: two pairs, Rudolph in the lead, his nose glowing
    const deer: { g: Group; legs: Group[]; phase: number }[] = []
    const slots: [number, number, boolean][] = [[2.1, 0.45, false], [2.1, -0.45, false], [3.4, 0.45, false], [3.4, -0.45, false], [4.7, 0, true]]
    const reins = new Float32Array(slots.length * 6)
    slots.forEach(([x, y, lead], i) => {
      const d = new Group()
      d.add(at(mesh(new BoxGeometry(0.9, 0.34, 0.38), brown), 0, 0, 0.75))
      d.add(tilt(at(mesh(new BoxGeometry(0.18, 0.16, 0.45), brown), 0.45, 0, 1.05), 0, 0.5))
      d.add(at(mesh(new BoxGeometry(0.32, 0.18, 0.18), brown), 0.6, 0, 1.3))
      d.add(at(mesh(new SphereGeometry(0.05, 8, 6), lead ? rudolph : black), 0.78, 0, 1.3))
      for (const s of [-1, 1]) d.add(tilt(at(mesh(new BoxGeometry(0.04, 0.04, 0.35), antler), 0.5, s * 0.08, 1.5), s * 0.5, -0.3))
      const legs: Group[] = []
      for (const lx of [-0.35, 0.35]) for (const ly of [-0.12, 0.12]) {
        const pivot = at(new Group(), lx, ly, 0.6)
        pivot.add(at(mesh(new BoxGeometry(0.08, 0.08, 0.55), brown), 0, 0, -0.27))
        d.add(pivot)
        legs.push(pivot)
      }
      d.position.set(x, y, 0)
      g.add(d)
      deer.push({ g: d, legs, phase: i * 0.9 })
      reins.set([0.75, 0, 0.6, x + 0.3, y, 1.1], i * 6)
    })
    const reinGeo = new BufferGeometry()
    reinGeo.setAttribute('position', new BufferAttribute(reins, 3))
    g.add(new LineSegments(reinGeo, new LineBasicMaterial({ color: 0x3a2414 })))
    g.scale.setScalar(S)
    this.object.add(g)

    // the glitter trail: a ring of points laid where the sleigh has passed
    const N = 90
    const trail = new Float32Array(N * 3), trailCol = new Float32Array(N * 3)
    const trailGeo = new BufferGeometry()
    trailGeo.setAttribute('position', new BufferAttribute(trail, 3))
    trailGeo.setAttribute('color', new BufferAttribute(trailCol, 3))
    const sparkles = new Points(trailGeo, new PointsMaterial({ size: 0.2, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }))
    sparkles.frustumCulled = false
    this.object.add(sparkles)
    let head = 0, lastDrop = -1
    const glitter = new Color(0xffd36b)

    const path = aloft(roam(site, 3), roofZ + 1.8, 0.6)
    const rear = new Vector3()
    this.actors.push({
      update: (t) => {
        fly(g, path, t, 0.5)
        for (const d of deer) {
          d.g.position.z = 0.12 * Math.sin(t * 6 + d.phase)
          d.legs.forEach((l, k) => { l.rotation.y = 0.6 * Math.sin(t * 6 + d.phase + (k < 2 ? 0 : Math.PI)) })
        }
        // one glitter every ~0.08 s, behind the body, fading out as it ages
        if (t - lastDrop > 0.08) {
          lastDrop = t
          path(t - 0.35, rear)                           // where the body was a moment ago
          trail.set([rear.x + (Math.random() - 0.5) * 0.6, rear.y + (Math.random() - 0.5) * 0.6, rear.z + 0.5 + (Math.random() - 0.5) * 0.4], head * 3)
          head = (head + 1) % N
        }
        for (let i = 0; i < N; i++) {
          const age = ((head - 1 - i + N) % N) / N
          const k = (1 - age) ** 2
          trailCol.set([glitter.r * k, glitter.g * k, glitter.b * k], i * 3)
        }
        trailGeo.getAttribute('position').needsUpdate = true
        trailGeo.getAttribute('color').needsUpdate = true
      },
    })
  }

  // ---- Halloween --------------------------------------------------------------------------------

  private ghosts(site: RoamArea, roofZ: number): void {
    const eye = new MeshBasicMaterial({ color: 0x0a0a12 })
    for (let i = 0; i < 5; i++) {
      const mat = new MeshStandardMaterial({ color: 0xeef4ff, emissive: 0xbfe8ff, emissiveIntensity: 0.6, roughness: 0.6, transparent: true, opacity: 0.8, depthWrite: false })
      const g = new Group()
      g.add(upright(mesh(new SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat)))
      // the robe: an open tube with a wavy hem
      const skirt = new CylinderGeometry(0.42, 0.55, 0.9, 20, 3, true)
      const p = skirt.getAttribute('position')
      for (let v = 0; v < p.count; v++) if (p.getY(v) < -0.44) p.setY(v, p.getY(v) + 0.1 * Math.sin(Math.atan2(p.getZ(v), p.getX(v)) * 6))
      g.add(at(upright(mesh(skirt, mat)), 0, 0, -0.45))
      for (const y of [-0.14, 0.14]) g.add(sized(at(mesh(new SphereGeometry(0.07, 8, 6), eye), 0.37, y, 0.12), 0.5, 1, 1.4))
      g.add(sized(at(mesh(new SphereGeometry(0.08, 8, 6), eye), 0.4, 0, -0.1), 0.5, 1, 1.3))
      g.scale.setScalar(1.2)
      this.object.add(g)
      const z0 = roofZ * (0.35 + 0.13 * i)
      const phase = i * 1.3
      const flat = roam(site, 1.5 + 0.3 * i)
      const path: Path = (t, out) => { flat(t, out); out.z = z0 + 0.4 * Math.sin(t * 1.1 + phase); return out }
      this.actors.push({
        update: (t) => {
          fly(g, path, t, 0)
          g.rotation.x = 0.15 * Math.sin(t * 1.7 + phase)
          // they fade out and come back
          mat.opacity = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.8 + phase))
        },
      })
    }
  }

  private skeletons(site: RoamArea, groundZ: (x: number, y: number) => number): void {
    const bone = std(0xefe6d2, 0.7)
    bone.emissive.set(0xefe6d2)
    bone.emissiveIntensity = 0.15                        // so they can still be seen at night
    const hole = new MeshBasicMaterial({ color: 0x0a0806 })
    const n = 4
    // each its own course, at walking speed (~0.9 m/s): they spread out over the terrain
    for (let i = 0; i < n; i++) {
      const g = new Group()
      g.add(at(mesh(new BoxGeometry(0.14, 0.3, 0.12), bone), 0, 0, 0.95))                        // pelvis
      g.add(at(upright(mesh(new CylinderGeometry(0.03, 0.03, 0.55, 6), bone)), 0, 0, 1.25))        // spine
      for (let k = 0; k < 3; k++) g.add(sized(at(mesh(new TorusGeometry(0.15 - k * 0.015, 0.022, 6, 14), bone), 0, 0, 1.28 + k * 0.1), 0.8, 1, 1))
      g.add(at(mesh(new SphereGeometry(0.13, 12, 10), bone), 0.02, 0, 1.68))                      // skull
      for (const y of [-0.05, 0.05]) g.add(at(mesh(new SphereGeometry(0.035, 6, 5), hole), 0.13, y, 1.7))
      g.add(at(mesh(new BoxGeometry(0.1, 0.12, 0.05), bone), 0.07, 0, 1.56))                      // jaw
      const limb = (y: number, z: number, len: number) => {
        const pivot = at(new Group(), 0, y, z)
        pivot.add(at(upright(mesh(new CylinderGeometry(0.025, 0.025, len, 6), bone)), 0, 0, -len / 2))
        g.add(pivot)
        return pivot
      }
      const arms = [limb(-0.2, 1.52, 0.6), limb(0.2, 1.52, 0.6)]
      const legs = [limb(-0.09, 0.92, 0.9), limb(0.09, 0.92, 0.9)]
      g.scale.setScalar(1.5)                             // larger than life, like the rest
      this.object.add(g)
      const phase = (i / n) * Math.PI * 2
      const path = onGround(roam(site, 0.8 + 0.1 * i), groundZ)
      this.actors.push({
        update: (t) => {
          fly(g, path, t, 0)
          const s = Math.sin(t * 5 + phase)
          legs[0]!.rotation.y = 0.45 * s; legs[1]!.rotation.y = -0.45 * s
          arms[0]!.rotation.y = -0.4 * s; arms[1]!.rotation.y = 0.4 * s
          g.position.z += 0.03 * Math.abs(s)             // the step that lifts the body
        },
      })
    }
  }

  // ---- Tatooine ---------------------------------------------------------------------------------

  private xwings(site: RoamArea, roofZ: number): void {
    const hull = std(0xd8d8d4, 0.5, 0.3), grey = std(0x8a8a88, 0.6, 0.4), stripe = std(0xb8322a, 0.6)
    const canopy = std(0x1a2230, 0.15, 0.6), droid = std(0x2a5ab8, 0.4, 0.3)
    const flame = new MeshBasicMaterial({ color: new Color(0xff6a3a).multiplyScalar(4) })   // > 1: the bloom catches it
    const ships: Group[] = []
    for (let s = 0; s < 3; s++) {
      const g = new Group()
      g.add(mesh(new BoxGeometry(2.2, 0.34, 0.34), hull))
      g.add(at(tilt(mesh(new ConeGeometry(0.19, 1.1, 8), hull), 0, 0, -Math.PI / 2), 1.65, 0, 0))
      g.add(at(mesh(new BoxGeometry(0.6, 0.26, 0.14), canopy), 0.45, 0, 0.22))
      g.add(at(mesh(new SphereGeometry(0.1, 10, 8), droid), -0.25, 0, 0.2))
      for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        // an X wing: a pivot on the fuselage axis, tilted up or down
        const w = new Group()
        w.rotation.x = sy * sz * 0.28
        w.add(at(mesh(new BoxGeometry(0.75, 1.5, 0.05), hull), -0.45, sy * 0.95, 0))
        w.add(at(mesh(new BoxGeometry(0.2, 0.9, 0.06), stripe), -0.35, sy * 1.1, 0))
        w.add(at(tilt(mesh(new CylinderGeometry(0.13, 0.13, 0.9, 10), grey), 0, 0, Math.PI / 2), -0.35, sy * 0.3, sz * 0.12))
        w.add(at(tilt(mesh(new CircleGeometry(0.11, 12), flame), 0, -Math.PI / 2, 0), -0.81, sy * 0.3, sz * 0.12))
        w.add(at(tilt(mesh(new CylinderGeometry(0.03, 0.03, 1.4, 6), grey), 0, 0, Math.PI / 2), 0.2, sy * 1.7, 0))
        g.add(w)
      }
      this.object.add(g)
      ships.push(g)
    }
    // each its own flight, drawn at random: they cross, close in, move apart
    const paths = ships.map(() => aloft(roam(site, 6), roofZ + 3, 1))
    this.actors.push({ update: (t) => ships.forEach((g, i) => fly(g, paths[i]!, t, 0.9)) })
  }

  // ---- Akira ------------------------------------------------------------------------------------

  private bike(site: RoamArea, groundZ: (x: number, y: number) => number): void {
    const red = std(0xc8141a, 0.35, 0.3), black = std(0x111114, 0.7), metal = std(0x9a9ca4, 0.3, 0.9)
    const white = std(0xf2f0ea, 0.5), screen = std(0x1a2a34, 0.1, 0.6), denim = std(0x2a3448, 0.8)
    const tail = new MeshBasicMaterial({ color: new Color(0xff2010).multiplyScalar(5) })   // > 1: the bloom catches it
    const head = new MeshBasicMaterial({ color: new Color(0xfff2d0).multiplyScalar(3) })

    const g = new Group()
    // the wheels: thick black tires, solid red hubs (three's cylinder axis is Y, here the side)
    for (const x of [-0.95, 0.95]) {
      g.add(at(mesh(new CylinderGeometry(0.34, 0.34, 0.22, 20), black), x, 0, 0.34))
      g.add(at(mesh(new CylinderGeometry(0.22, 0.22, 0.24, 16), red), x, 0, 0.34))
    }
    // the fairing: an elongated red capsule, low, the rounded nose dropping toward the front wheel
    g.add(sized(at(tilt(mesh(new CapsuleGeometry(0.3, 1.5, 6, 14), red), 0, 0, Math.PI / 2), -0.05, 0, 0.62), 1, 0.85, 1))
    g.add(sized(at(mesh(new SphereGeometry(0.34, 14, 10), red), 0.85, 0, 0.62), 1.2, 0.85, 0.9))
    g.add(at(tilt(mesh(new SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), screen), 0, -0.6), 0.55, 0, 0.82))
    g.add(at(mesh(new BoxGeometry(1.6, 0.27, 0.05), white), -0.1, 0, 0.5))                          // the white trim
    g.add(at(mesh(new BoxGeometry(0.5, 0.5, 0.08), black), -0.75, 0, 0.92))                          // the seat
    g.add(at(mesh(new BoxGeometry(0.6, 0.12, 0.12), metal), -0.95, 0.22, 0.3))                       // the exhaust
    g.add(at(mesh(new BoxGeometry(0.05, 0.3, 0.1), tail), -1.28, 0, 0.72))
    g.add(at(tilt(mesh(new CircleGeometry(0.09, 12), head), 0, Math.PI / 2), 1.26, 0, 0.66))

    // Kaneda: lying on the tank, red jacket with the white capsule on the back, red helmet
    g.add(tilt(at(mesh(new BoxGeometry(0.75, 0.42, 0.3), red), -0.35, 0, 1.12), 0, 0.45))
    g.add(tilt(at(mesh(new CapsuleGeometry(0.06, 0.14, 4, 8), white), -0.42, 0, 1.3), 0, 0, Math.PI / 2))
    g.add(at(mesh(new SphereGeometry(0.16, 14, 10), red), 0.12, 0, 1.36))
    g.add(at(mesh(new BoxGeometry(0.08, 0.24, 0.1), screen), 0.25, 0, 1.36))                          // the visor
    for (const y of [-0.17, 0.17]) {
      g.add(tilt(at(mesh(new BoxGeometry(0.55, 0.09, 0.09), red), 0.1, y, 1.08), 0, 0.5))           // arm toward the handlebar
      g.add(tilt(at(mesh(new BoxGeometry(0.5, 0.12, 0.12), denim), -0.6, y * 1.25, 0.82), 0, -0.5))  // thigh
    }
    g.scale.setScalar(1.3)                               // larger than life, like the rest
    this.object.add(g)

    const path = onGround(roam(site, 8, { margin: 2.5 }), groundZ)   // ~8 m/s

    // the tail light trail: two crossed ribbons (seen from above as from the side) laid on the
    // past trajectory — `path` is a function of time, the trail has nothing to remember
    const N = 48, DT = 0.025, LAG = 0.2, Z = 0.72 * 1.3, W = 0.09
    const pos = new Float32Array(N * 4 * 3), col = new Float32Array(N * 4 * 3)
    const index: number[] = []
    for (let i = 0; i < N - 1; i++) for (const o of [0, 2]) {
      const a = i * 4 + o, b = a + 1, c = a + 4, d = a + 5
      index.push(a, b, c, b, d, c)
    }
    const trailGeo = new BufferGeometry()
    trailGeo.setAttribute('position', new BufferAttribute(pos, 3))
    trailGeo.setAttribute('color', new BufferAttribute(col, 3))
    trailGeo.setIndex(index)
    const trail = new Mesh(trailGeo, new MeshBasicMaterial({ color: new Color(1, 1, 1).multiplyScalar(4), vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }))
    trail.frustumCulled = false
    this.object.add(trail)
    const p = new Vector3(), q = new Vector3(), glow = new Color(0xff2010)

    this.actors.push({
      update: (t) => {
        fly(g, path, t, 0.6)
        for (let i = 0; i < N; i++) {
          path(t - LAG - i * DT, p)
          path(t - LAG - i * DT - DT, q)
          // the horizontal normal to the path, for the flat ribbon
          const dx = p.x - q.x, dy = p.y - q.y, l = Math.hypot(dx, dy) || 1
          const nx = -dy / l * W, ny = dx / l * W, z = p.z + Z
          pos.set([p.x + nx, p.y + ny, z, p.x - nx, p.y - ny, z, p.x, p.y, z + W, p.x, p.y, z - W], i * 12)
          const k = (1 - i / (N - 1)) ** 1.5
          for (let v = 0; v < 4; v++) col.set([glow.r * k, glow.g * k, glow.b * k], i * 12 + v * 3)
        }
        trailGeo.getAttribute('position').needsUpdate = true
        trailGeo.getAttribute('color').needsUpdate = true
      },
    })
  }

  // ---- Girlyversaire -----------------------------------------------------------------------------

  private balloons(building: Box, roofZ: number, groundZ: (x: number, y: number) => number): void {
    const N = 16, SEG = 6
    const S = 1.5                                        // larger than life, to be seen from above
    const BELOW = (0.35 * 1.18 + 0.1) * S, STRING = 1.3 * S
    const top = roofZ + 7
    const wind = [0.18, 0.08] as const                   // drift in meters per meter of climb
    const body = new SphereGeometry(0.35, 20, 14), knot = new ConeGeometry(0.06, 0.1, 8)
    // pink, lilac, gold, mint, sky, coral: slightly emissive, so they can also be seen at night
    const mats = [0xff5fa2, 0xb98aff, 0xffc93c, 0x5fd3c4, 0x6fb6ff, 0xff8a65].map((c) =>
      new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.18, roughness: 0.25 }))
    const rnd = (lo: number, hi: number) => lo + (hi - lo) * Math.random()

    // released around the house, 1 to 3.5 m from its walls
    const release = (): [number, number] => {
      const m = rnd(1, 3.5)
      const x0 = building.min[0] - m, x1 = building.max[0] + m, y0 = building.min[1] - m, y1 = building.max[1] + m
      const w = x1 - x0, h = y1 - y0
      let u = Math.random() * 2 * (w + h)
      if (u < w) return [x0 + u, y0]
      if ((u -= w) < h) return [x1, y0 + u]
      if ((u -= h) < w) return [x1 - u, y1]
      return [x0, y1 - (u - w)]
    }

    const lines = new Float32Array(N * SEG * 2 * 3)
    const lineGeo = new BufferGeometry()
    lineGeo.setAttribute('position', new BufferAttribute(lines, 3))
    const strings = new LineSegments(lineGeo, new LineBasicMaterial({ color: 0xf4f0f6 }))
    strings.frustumCulled = false

    const all = Array.from({ length: N }, (_, i) => {
      const g = new Group()
      const mat = mats[i % mats.length]!
      g.add(sized(mesh(body, mat), 1, 1, 1.18))
      g.add(at(tilt(mesh(knot, mat), -Math.PI / 2, 0), 0, 0, -0.35 * 1.18 - 0.03))
      g.scale.setScalar(S)
      this.object.add(g)
      const b = { g, x: 0, y: 0, z: 0, t0: 0, speed: 0, freq: rnd(0.6, 1.1), phase: rnd(0, Math.PI * 2), drift: [rnd(-0.08, 0.08), rnd(-0.08, 0.08)] as const }
      const launch = (t: number) => {
        const [x, y] = release()
        b.x = x; b.y = y
        b.z = groundZ(b.x, b.y) + 0.6 * S
        b.t0 = t
        b.speed = rnd(0.7, 1.1)
      }
      launch(0)
      b.t0 = -Math.random() * (top - b.z) / b.speed   // already on their way, at every height
      return { b, launch }
    })
    this.object.add(strings)

    this.actors.push({
      update: (t) => {
        all.forEach(({ b, launch }, i) => {
          let rise = (t - b.t0) * b.speed
          if (b.z + rise > top) { launch(t); rise = 0 }
          const age = t - b.t0
          const sway = Math.sin(b.freq * t + b.phase)
          const x = b.x + (wind[0] + b.drift[0]) * rise + 0.25 * sway
          const y = b.y + (wind[1] + b.drift[1]) * rise + 0.15 * Math.cos(b.freq * 0.8 * t + b.phase)
          const z = b.z + rise
          // it inflates at the start, and fades out over the last two meters
          const s = Math.min(1, age / 0.6) * Math.min(1, (top - z) / 2)
          b.g.position.set(x, y, z)
          b.g.scale.setScalar(S * Math.max(0.001, s))
          b.g.rotation.set(0.12 * Math.cos(b.freq * t + b.phase), -0.12 * sway, 0)
          // the string: under the knot, swaying a little more toward the bottom
          for (let k = 0; k < SEG; k++) for (const e of [0, 1]) {
            const f = (k + e) / SEG
            const wave = 0.12 * f * Math.sin(t * 2.5 + b.phase + f * 3) * s
            lines.set([x + wave - 0.15 * sway * f * s, y + wave * 0.5, z - (BELOW + f * STRING) * s], ((i * SEG + k) * 2 + e) * 3)
          }
        })
        lineGeo.getAttribute('position').needsUpdate = true
      },
    })
  }
}

// ---- tools ----------------------------------------------------------------------------------------

/** A flat course lifted into the air: the altitude rises and falls (two sines with drawn phases). */
function aloft(flat: Path, z0: number, swing: number): Path {
  const rnd = (lo: number, hi: number) => lo + (hi - lo) * Math.random()
  const [f1, f2, p1, p2] = [rnd(0.3, 0.6), rnd(0.9, 1.4), rnd(0, Math.PI * 2), rnd(0, Math.PI * 2)]
  return (t, out) => {
    flat(t, out)
    out.z = z0 + swing * (1.2 * Math.sin(f1 * t + p1) + 0.4 * Math.sin(f2 * t + p2))
    return out
  }
}

/** A flat course laid on the relief. */
function onGround(flat: Path, groundZ: (x: number, y: number) => number): Path {
  return (t, out) => { flat(t, out); out.z = groundZ(out.x, out.y); return out }
}

const ahead = new Vector3(), behind = new Vector3()

/**
 * Places `o` on `path` at time `t`, nose in the direction of flight: heading and pitch read on the
 * trajectory itself (a point slightly before, a point slightly after), roll in the turn in
 * proportion to the rate at which the heading turns. `bank` doses that roll.
 */
function fly(o: Object3D, path: Path, t: number, bank: number): void {
  const dt = 0.15
  path(t, o.position)
  path(t + dt, ahead)
  path(t - dt, behind)
  const dx = ahead.x - behind.x, dy = ahead.y - behind.y, dz = ahead.z - behind.z
  const yaw = Math.atan2(dy, dx)
  const yawBefore = Math.atan2(o.position.y - behind.y, o.position.x - behind.x)
  const yawAfter = Math.atan2(ahead.y - o.position.y, ahead.x - o.position.x)
  let turn = yawAfter - yawBefore
  if (turn > Math.PI) turn -= 2 * Math.PI
  if (turn < -Math.PI) turn += 2 * Math.PI
  o.rotation.order = 'ZYX'
  o.rotation.z = yaw
  o.rotation.y = -Math.atan2(dz, Math.hypot(dx, dy))    // nose up when it climbs
  o.rotation.x = Math.max(-0.7, Math.min(0.7, -bank * turn / dt))   // leaning into the turn
}

function std(color: number, roughness: number, metalness = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness })
}

function mesh(g: BufferGeometry, m: Material): Mesh {
  return new Mesh(g, m)
}

function at<T extends Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z)
  return o
}

function tilt<T extends Object3D>(o: T, x: number, y: number, z = 0): T {
  o.rotation.set(x, y, z)
  return o
}

function sized<T extends Object3D>(o: T, x: number, y: number, z: number): T {
  o.scale.set(x, y, z)
  return o
}

/** three's primitives are Y-up: lays their axis down onto Z. */
function upright<T extends Object3D>(o: T): T {
  o.rotation.x = Math.PI / 2
  return o
}
