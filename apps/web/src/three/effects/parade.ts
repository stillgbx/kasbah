import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry,
  type BufferGeometry as Geometry, Group, LineBasicMaterial, LineSegments, type Material, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, type Object3D, Points, PointsMaterial, SphereGeometry, TorusGeometry, Vector3,
} from 'three'
import type { ParadeKind } from '../styles/types'

// Des PERSONNAGES qui défilent autour de la maison, selon le style (`StyleLook.parade`) :
//  - `noel` : le traîneau du père Noël et ses rennes, qui errent au-dessus du toit en semant des
//    paillettes dorées ;
//  - `halloween` : des fantômes qui flottent (et traversent les murs, ce sont des fantômes) et des
//    squelettes qui marchent en procession AU SOL, autour de la maison, sur le relief ;
//  - `tatooine` : trois X-wings, ailes en X, chacun son vol ; ils se croisent et s'inclinent dans les virages.
//
// Traîneau et X-wings ne tournent pas en rond : leur vol ERRE (`wander`), tiré au hasard à la création
// comme celui des chauves-souris, et le nez suit la trajectoire (`fly`).
//
// Tout est dans le repère LOCAL de la maison (Z-up, enfant de la racine), comme les chauves-souris.
// Les modèles sont faits de primitives (boîtes, cylindres, sphères) : aucun fichier, aucun
// chargement. Chaque modèle regarde vers +X, le haut est +Z. Rien ne porte d'ombre (la carte n'est
// refaite qu'à la demande) et rien ne se prend au clic.

type XY = readonly [number, number]

/** Où défiler : l'emprise bâtie (tous en font le tour), le haut du toit, le sol (les squelettes y marchent). */
export interface ParadeArea {
  building: { min: XY; max: XY }
  roofZ: number
  groundZ?: (x: number, y: number) => number
}

interface Actor { update(t: number): void }

export class Parade {
  readonly object = new Group()
  readonly kind: ParadeKind
  private readonly actors: Actor[] = []
  private time = 0

  constructor(kind: ParadeKind, area: ParadeArea) {
    this.kind = kind
    this.object.name = `parade-${kind}`
    const building = frame(area.building)
    const groundZ = area.groundZ ?? (() => 0)
    if (kind === 'noel') this.sleigh(building, area.roofZ)
    else if (kind === 'halloween') { this.ghosts(building, area.roofZ); this.skeletons(building, groundZ) }
    else this.xwings(building, area.roofZ)
    this.object.traverse((o) => { o.raycast = () => {}; o.castShadow = false })
    this.write()
  }

  /** Avance l'animation de `dtS` secondes. */
  step(dtS: number): void {
    this.time += Math.min(0.1, Math.max(0, dtS))
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

  // ---- Noël -------------------------------------------------------------------------------------

  private sleigh(house: Frame, roofZ: number): void {
    const S = 1.4                                        // plus grand que nature, pour se voir d'en haut
    const red = std(0xc0161e, 0.5), gold = std(0xd9a53a, 0.3, 0.8), brown = std(0x8a5a34, 0.8)
    const white = std(0xf4f4f0, 0.9), skin = std(0xf1c9a5, 0.7), black = std(0x141414, 0.6)
    const antler = std(0xd9c3a0, 0.8), sack = std(0x7a5230, 0.95)
    const rudolph = new MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 })

    const g = new Group()
    // le traîneau : caisse, dossier relevé, patins dorés recourbés à l'avant
    g.add(at(mesh(new BoxGeometry(1.4, 0.8, 0.4), red), 0, 0, 0.4))
    g.add(at(mesh(new BoxGeometry(0.2, 0.8, 0.5), red), -0.65, 0, 0.75))
    for (const y of [-0.38, 0.38]) {
      g.add(at(mesh(new BoxGeometry(1.8, 0.06, 0.06), gold), 0.1, y, 0.06))
      g.add(tilt(at(mesh(new BoxGeometry(0.4, 0.06, 0.06), gold), 1.05, y, 0.2), 0, -0.9))
      g.add(at(mesh(new BoxGeometry(0.06, 0.06, 0.3), gold), -0.3, y, 0.2))
      g.add(at(mesh(new BoxGeometry(0.06, 0.06, 0.3), gold), 0.5, y, 0.2))
    }
    // le père Noël : manteau, ceinture, tête, barbe, bonnet à pompon
    g.add(at(upright(mesh(new CylinderGeometry(0.24, 0.3, 0.6, 12), red)), -0.1, 0, 0.9))
    g.add(at(upright(mesh(new CylinderGeometry(0.29, 0.29, 0.07, 12), black)), -0.1, 0, 0.82))
    g.add(at(mesh(new SphereGeometry(0.16, 12, 8), skin), -0.08, 0, 1.33))
    g.add(sized(at(mesh(new SphereGeometry(0.14, 10, 8), white), 0.02, 0, 1.22), 0.8, 1.1, 1.1))
    g.add(at(upright(mesh(new ConeGeometry(0.16, 0.36, 12), red)), -0.1, 0, 1.6))
    g.add(at(mesh(new SphereGeometry(0.06, 8, 6), white), -0.1, 0, 1.8))
    // la hotte
    g.add(at(mesh(new SphereGeometry(0.34, 12, 8), sack), -0.5, 0.05, 0.85))

    // les rennes : deux paires, Rudolph en tête, le nez qui brille
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

    // la traînée de paillettes : un anneau de points posés là où le traîneau est passé
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

    // une trajectoire qui erre (`wander`), tirée au hasard comme le vol des chauves-souris
    const path = wander(house, house.reach * 1.25, roofZ + 1.8, 0.22, 0.6)
    const rear = new Vector3()
    this.actors.push({
      update: (t) => {
        fly(g, path, t, 0.5)
        for (const d of deer) {
          d.g.position.z = 0.12 * Math.sin(t * 6 + d.phase)
          d.legs.forEach((l, k) => { l.rotation.y = 0.6 * Math.sin(t * 6 + d.phase + (k < 2 ? 0 : Math.PI)) })
        }
        // une paillette toutes les ~0,08 s, derrière la caisse, qui s'éteint en vieillissant
        if (t - lastDrop > 0.08) {
          lastDrop = t
          path(t - 0.35, rear)                           // là où la caisse était il y a un instant
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

  private ghosts(house: Frame, roofZ: number): void {
    const eye = new MeshBasicMaterial({ color: 0x0a0a12 })
    for (let i = 0; i < 5; i++) {
      const mat = new MeshStandardMaterial({ color: 0xeef4ff, emissive: 0xbfe8ff, emissiveIntensity: 0.6, roughness: 0.6, transparent: true, opacity: 0.8, depthWrite: false })
      const g = new Group()
      g.add(upright(mesh(new SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat)))
      // la robe : un tube ouvert au bas ondulé
      const skirt = new CylinderGeometry(0.42, 0.55, 0.9, 20, 3, true)
      const p = skirt.getAttribute('position')
      for (let v = 0; v < p.count; v++) if (p.getY(v) < -0.44) p.setY(v, p.getY(v) + 0.1 * Math.sin(Math.atan2(p.getZ(v), p.getX(v)) * 6))
      g.add(at(upright(mesh(skirt, mat)), 0, 0, -0.45))
      for (const y of [-0.14, 0.14]) g.add(sized(at(mesh(new SphereGeometry(0.07, 8, 6), eye), 0.37, y, 0.12), 0.5, 1, 1.4))
      g.add(sized(at(mesh(new SphereGeometry(0.08, 8, 6), eye), 0.4, 0, -0.1), 0.5, 1, 1.3))
      g.scale.setScalar(1.2)
      this.object.add(g)
      const r = house.reach * (0.5 + 0.25 * i)
      const speed = (0.15 + 0.04 * i) * (i % 2 ? -1 : 1)
      const z0 = roofZ * (0.35 + 0.13 * i)
      const phase = i * 1.3
      this.actors.push({
        update: (t) => {
          orbit(g, house, r * (1 + 0.15 * Math.sin(t * 0.4 + phase)), t * speed + phase, z0 + 0.4 * Math.sin(t * 1.1 + phase), Math.sign(speed))
          g.rotation.x = 0.15 * Math.sin(t * 1.7 + phase)
          // ils s'effacent et reviennent
          mat.opacity = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.8 + phase))
        },
      })
    }
  }

  private skeletons(building: Frame, groundZ: (x: number, y: number) => number): void {
    const bone = std(0xefe6d2, 0.7)
    bone.emissive.set(0xefe6d2)
    bone.emissiveIntensity = 0.15                        // qu'on les voie encore la nuit
    const hole = new MeshBasicMaterial({ color: 0x0a0806 })
    const n = 4
    const r = building.reach + 1.6                       // hors de l'emprise bâtie
    const speed = 0.9 / r                                // ~0,9 m/s, une marche
    for (let i = 0; i < n; i++) {
      const g = new Group()
      g.add(at(mesh(new BoxGeometry(0.14, 0.3, 0.12), bone), 0, 0, 0.95))                        // bassin
      g.add(at(upright(mesh(new CylinderGeometry(0.03, 0.03, 0.55, 6), bone)), 0, 0, 1.25))        // colonne
      for (let k = 0; k < 3; k++) g.add(sized(at(mesh(new TorusGeometry(0.15 - k * 0.015, 0.022, 6, 14), bone), 0, 0, 1.28 + k * 0.1), 0.8, 1, 1))
      g.add(at(mesh(new SphereGeometry(0.13, 12, 10), bone), 0.02, 0, 1.68))                      // crâne
      for (const y of [-0.05, 0.05]) g.add(at(mesh(new SphereGeometry(0.035, 6, 5), hole), 0.13, y, 1.7))
      g.add(at(mesh(new BoxGeometry(0.1, 0.12, 0.05), bone), 0.07, 0, 1.56))                      // mâchoire
      const limb = (y: number, z: number, len: number) => {
        const pivot = at(new Group(), 0, y, z)
        pivot.add(at(upright(mesh(new CylinderGeometry(0.025, 0.025, len, 6), bone)), 0, 0, -len / 2))
        g.add(pivot)
        return pivot
      }
      const arms = [limb(-0.2, 1.52, 0.6), limb(0.2, 1.52, 0.6)]
      const legs = [limb(-0.09, 0.92, 0.9), limb(0.09, 0.92, 0.9)]
      g.scale.setScalar(1.5)                             // plus grand que nature, comme le reste
      this.object.add(g)
      const phase = (i / n) * Math.PI * 2
      this.actors.push({
        update: (t) => {
          const a = t * speed + phase
          const x = building.cx + Math.cos(a) * r, y = building.cy + Math.sin(a) * r
          orbit(g, building, r, a, groundZ(x, y), 1)
          const s = Math.sin(t * 5 + phase)
          legs[0]!.rotation.y = 0.45 * s; legs[1]!.rotation.y = -0.45 * s
          arms[0]!.rotation.y = -0.4 * s; arms[1]!.rotation.y = 0.4 * s
          g.position.z += 0.03 * Math.abs(s)             // le pas qui soulève le corps
        },
      })
    }
  }

  // ---- Tatooine ---------------------------------------------------------------------------------

  private xwings(house: Frame, roofZ: number): void {
    const hull = std(0xd8d8d4, 0.5, 0.3), grey = std(0x8a8a88, 0.6, 0.4), stripe = std(0xb8322a, 0.6)
    const canopy = std(0x1a2230, 0.15, 0.6), droid = std(0x2a5ab8, 0.4, 0.3)
    const flame = new MeshBasicMaterial({ color: new Color(0xff6a3a).multiplyScalar(4) })   // > 1 : le bloom le prend
    const ships: Group[] = []
    for (let s = 0; s < 3; s++) {
      const g = new Group()
      g.add(mesh(new BoxGeometry(2.2, 0.34, 0.34), hull))
      g.add(at(tilt(mesh(new ConeGeometry(0.19, 1.1, 8), hull), 0, 0, -Math.PI / 2), 1.65, 0, 0))
      g.add(at(mesh(new BoxGeometry(0.6, 0.26, 0.14), canopy), 0.45, 0, 0.22))
      g.add(at(mesh(new SphereGeometry(0.1, 10, 8), droid), -0.25, 0, 0.2))
      for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        // une aile en X : un pivot sur l'axe du fuselage, incliné haut ou bas
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
    // chacun son vol, tiré au hasard : ils se croisent, se rapprochent, s'écartent
    const paths = ships.map(() => wander(house, house.reach * 1.4, roofZ + 3, 0.35, 1))
    this.actors.push({ update: (t) => ships.forEach((g, i) => fly(g, paths[i]!, t, 0.9)) })
  }
}

// ---- outils ---------------------------------------------------------------------------------------

interface Frame { cx: number; cy: number; reach: number }

function frame(b: { min: XY; max: XY }): Frame {
  return { cx: (b.min[0] + b.max[0]) / 2, cy: (b.min[1] + b.max[1]) / 2, reach: Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2 }
}

/** Pose `o` sur le cercle, face à la tangente (`dir` = sens de parcours, +1 anti-horaire). */
function orbit(o: Object3D, f: Frame, r: number, a: number, z: number, dir: number): void {
  o.position.set(f.cx + Math.cos(a) * r, f.cy + Math.sin(a) * r, z)
  o.rotation.order = 'ZYX'                               // cap d'abord, puis tangage et roulis
  o.rotation.z = a + dir * Math.PI / 2
}

/** Une trajectoire : la position au temps `t`, écrite dans `out`. */
type Path = (t: number, out: Vector3) => Vector3

/**
 * Un vol qui ERRE autour de la maison, comme les chauves-souris mais sans jamais repasser au même
 * endroit : l'angle avance à une vitesse qui varie, le rayon respire, le centre dérive, l'altitude
 * monte et descend. Toutes les fréquences et phases sont tirées à la création ; la somme de sinus
 * reste lisse (pas de saut) et bornée (on ne part pas au bout du terrain).
 * `speed` en rad/s (le sens est tiré aussi), `swing` règle l'amplitude des écarts, 0 = un cercle.
 */
function wander(f: Frame, radius: number, z0: number, speed: number, swing: number): Path {
  const rnd = (a: number, b: number) => a + (b - a) * Math.random()
  const w = speed * rnd(0.8, 1.2) * (Math.random() < 0.5 ? -1 : 1)
  const [fa, fr, fr2, fz, fz2, fx, fy] = [rnd(0.2, 0.4), rnd(0.15, 0.3), rnd(0.5, 0.8), rnd(0.3, 0.6), rnd(0.9, 1.4), rnd(0.07, 0.15), rnd(0.07, 0.15)]
  const ph = Array.from({ length: 8 }, () => rnd(0, Math.PI * 2))
  return (t, out) => {
    const a = ph[0]! + w * t + swing * 0.6 * Math.sin(fa * t + ph[1]!)
    const r = radius * (1 + swing * (0.3 * Math.sin(fr * t + ph[2]!) + 0.1 * Math.sin(fr2 * t + ph[3]!)))
    const cx = f.cx + swing * f.reach * 0.35 * Math.sin(fx * t + ph[4]!)
    const cy = f.cy + swing * f.reach * 0.35 * Math.sin(fy * t + ph[5]!)
    const z = z0 + swing * (1.2 * Math.sin(fz * t + ph[6]!) + 0.4 * Math.sin(fz2 * t + ph[7]!))
    return out.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.max(z0 - 1, z))
  }
}

const ahead = new Vector3(), behind = new Vector3()

/**
 * Pose `o` sur `path` au temps `t`, le nez dans le sens du vol : cap et tangage lus sur la
 * trajectoire elle-même (un point un peu avant, un point un peu après), roulis dans le virage à
 * proportion de la vitesse à laquelle le cap tourne. `bank` dose ce roulis.
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
  o.rotation.y = -Math.atan2(dz, Math.hypot(dx, dy))    // nez en l'air quand il monte
  o.rotation.x = Math.max(-0.7, Math.min(0.7, -bank * turn / dt))   // penché vers l'intérieur du virage
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

/** Les primitives de three sont en Y-up : couche leur axe sur Z. */
function upright<T extends Object3D>(o: T): T {
  o.rotation.x = Math.PI / 2
  return o
}
