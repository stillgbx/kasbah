import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, ConeGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Points, PointsMaterial, SpotLight, Vector3,
} from 'three'

// La BOULE À FACETTES et les PROJECTEURS du style disco, dans le repère LOCAL de la maison (Z-up,
// enfant de la racine), comme les chauves-souris. Trois pièces, toutes animées par `step` :
//  - la boule, un icosaèdre subdivisé à facettes plates, en métal miroir : c'est la carte
//    d'environnement (le ciel du style) qui la fait briller, elle tourne sur elle-même ;
//  - ses éclats, un nuage de points additifs sur une grande sphère qui tourne AVEC elle : les
//    taches de lumière que la boule renvoie, lues dans l'air plutôt que sur les murs ;
//  - les projecteurs, posés aux coins du terrain : un cône de lumière additif (le faisceau
//    visible) et une `SpotLight` sans ombre (la tache de couleur sur la maison), qui balaient et
//    changent de couleur.
//
// Rien de tout cela n'est cliquable : un faisceau couvre la maison, il intercepterait les appareils.

/** L'emprise de la maison (repère local, mètres) et la hauteur du toit, au-dessus duquel pend la boule. */
export interface DiscoArea { min: readonly [number, number]; max: readonly [number, number]; roofZ: number }

/** Rayon (m) de la boule : plus grande que nature, comme les chauves-souris, pour se voir à l'échelle de la maison. */
const BALL_R = 1.1
/** Hauteur (m) de la boule au-dessus du faîtage. */
const BALL_LIFT = 2.5
/** Tour de la boule, en rad/s. */
const BALL_SPIN = 0.5
const SPARKLES = 240
/** Longueur (m) d'un faisceau visible. */
const BEAM_LEN = 14
/** Secondes que met un projecteur à passer d'une couleur à la suivante. */
const COLOR_PERIOD_S = 2.5

interface Spot { light: SpotLight; beam: Mesh; beamMat: MeshBasicMaterial; base: Vector3; phase: number; speed: number }

export class Disco {
  readonly object: Group
  readonly spotCount: number
  private readonly ball: Mesh
  private readonly sparkles: Points
  private readonly spots: Spot[]
  private readonly colors: Color[]
  private readonly target: Vector3
  private readonly disposables: { dispose(): void }[] = []
  private time = 0

  constructor(area: DiscoArea, spotCount: number, colors: readonly Color[]) {
    this.spotCount = Math.max(0, Math.round(spotCount))
    this.colors = colors.length ? colors.map((c) => c.clone()) : [new Color(0xffffff)]
    const cx = (area.min[0] + area.max[0]) / 2
    const cy = (area.min[1] + area.max[1]) / 2
    const reach = Math.hypot(area.max[0] - area.min[0], area.max[1] - area.min[1]) / 2
    this.target = new Vector3(cx, cy, area.roofZ * 0.5)
    this.object = new Group()
    this.object.name = 'disco'

    // la boule : facettes plates, sinon le miroir est une bille lisse
    const ballGeo = new IcosahedronGeometry(BALL_R, 3)
    const ballMat = new MeshStandardMaterial({ color: 0xe8e8f0, metalness: 1, roughness: 0.08, flatShading: true, envMapIntensity: 2.5 })
    this.ball = new Mesh(ballGeo, ballMat)
    this.ball.position.set(cx, cy, area.roofZ + BALL_LIFT)
    this.ball.rotation.x = Math.PI / 2                   // l'axe de rotation de l'icosaèdre vertical en Z-up
    this.object.add(this.ball)
    // le fil qui la tient : un cylindre fin jusqu'à hors champ
    const wireGeo = new ConeGeometry(0.02, 6, 4, 1, true)
    const wireMat = new MeshBasicMaterial({ color: 0x777788 })
    const wire = new Mesh(wireGeo, wireMat)
    wire.rotation.x = Math.PI / 2
    wire.position.set(cx, cy, area.roofZ + BALL_LIFT + BALL_R + 3)
    this.object.add(wire)

    // les éclats : des points répartis au hasard sur une sphère autour de la boule
    const sparkPos = new Float32Array(SPARKLES * 3)
    const sparkCol = new Float32Array(SPARKLES * 3)
    for (let i = 0; i < SPARKLES; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u)
      const r = reach * (0.6 + 0.5 * Math.random())
      // hémisphère du bas surtout : la boule éclaire ce qui est sous elle
      sparkPos.set([Math.cos(th) * s * r, Math.sin(th) * s * r, -Math.abs(u) * r * 0.8 + 0.2 * r], i * 3)
      const c = Math.random() < 0.6 ? new Color(0xffffff) : this.colors[i % this.colors.length]!
      sparkCol.set([c.r, c.g, c.b], i * 3)
    }
    const sparkGeo = new BufferGeometry()
    sparkGeo.setAttribute('position', new BufferAttribute(sparkPos, 3))
    sparkGeo.setAttribute('color', new BufferAttribute(sparkCol, 3))
    const sparkMat = new PointsMaterial({ size: 0.18, vertexColors: true, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false })
    this.sparkles = new Points(sparkGeo, sparkMat)
    this.sparkles.position.copy(this.ball.position)
    this.object.add(this.sparkles)

    // les projecteurs, répartis autour de la maison, au sol, un peu au-delà des façades
    const beamGeo = new ConeGeometry(0.9, BEAM_LEN, 20, 1, true)
    beamGeo.translate(0, -BEAM_LEN / 2, 0)               // la pointe à l'origine : le cône s'ouvre vers −Y
    // le faisceau s'éteint sur sa longueur : en mélange additif, un sommet noir ne rend rien, et le
    // bout du cône ne s'arrête plus net sur un disque
    const beamY = beamGeo.getAttribute('position')
    const fade = new Float32Array(beamY.count * 3)
    for (let v = 0; v < beamY.count; v++) fade.fill((1 + beamY.getY(v) / BEAM_LEN) ** 2, v * 3, v * 3 + 3)
    beamGeo.setAttribute('color', new BufferAttribute(fade, 3))
    this.spots = Array.from({ length: this.spotCount }, (_, i) => {
      const a = (i / this.spotCount) * Math.PI * 2 + Math.PI / 4
      const base = new Vector3(cx + Math.cos(a) * reach * 0.9, cy + Math.sin(a) * reach * 0.9, 0.3)
      const light = new SpotLight(this.colors[i % this.colors.length], 60, 30, 0.22, 0.5, 1.2)
      light.position.copy(base)
      this.object.add(light, light.target)
      const beamMat = new MeshBasicMaterial({
        color: this.colors[i % this.colors.length], vertexColors: true, transparent: true, opacity: 0.3,
        blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
      })
      this.disposables.push(beamMat)
      const beam = new Mesh(beamGeo, beamMat)
      beam.position.copy(base)
      this.object.add(beam)
      return { light, beam, beamMat, base, phase: i * 1.7, speed: 0.6 + 0.25 * (i % 3) }
    })
    this.disposables.push(ballGeo, ballMat, wireGeo, wireMat, sparkGeo, sparkMat, beamGeo)
    // ni les faisceaux ni les éclats ne se prennent au clic, et leur volume englobant bouge
    this.object.traverse((o) => { o.raycast = () => {}; o.frustumCulled = false })
    this.write()
  }

  /** Change les couleurs sans refaire les projecteurs (l'heure tourne). */
  setColors(colors: readonly Color[]): void {
    if (!colors.length) return
    this.colors.length = 0
    for (const c of colors) this.colors.push(c.clone())
    this.write()
  }

  /** Avance l'animation de `dtS` secondes. */
  step(dtS: number): void {
    this.time += Math.min(0.1, Math.max(0, dtS))
    this.write()
  }

  private readonly aim = new Vector3()
  private readonly dir = new Vector3()
  private readonly color = new Color()

  private write(): void {
    const t = this.time
    this.ball.rotation.y = t * BALL_SPIN
    this.sparkles.rotation.z = t * BALL_SPIN
    const n = this.colors.length
    for (const s of this.spots) {
      // un balayage en huit autour de la maison : la cible dessine une lissajous
      const k = t * s.speed + s.phase
      this.aim.set(
        this.target.x + Math.sin(k) * 6,
        this.target.y + Math.sin(k * 1.37 + 1) * 6,
        this.target.z + 3 + Math.sin(k * 0.8) * 3,
      )
      s.light.target.position.copy(this.aim)
      s.light.target.updateMatrixWorld()
      // le cône s'ouvre vers −Y : on tourne son axe vers la cible
      s.beam.quaternion.setFromUnitVectors(DOWN, this.dir.subVectors(this.aim, s.base).normalize())
      // la couleur glisse d'une teinte de la palette à la suivante
      const p = (t / COLOR_PERIOD_S + s.phase) % n
      const i = Math.floor(p)
      this.color.copy(this.colors[i]!).lerp(this.colors[(i + 1) % n]!, p - i)
      s.light.color.copy(this.color)
      s.beamMat.color.copy(this.color)
    }
  }

  dispose(): void {
    this.object.removeFromParent()
    for (const s of this.spots) s.light.dispose()
    for (const d of this.disposables) d.dispose()
  }
}

const DOWN = new Vector3(0, -1, 0)
