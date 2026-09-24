import { BufferGeometry, DoubleSide, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, RingGeometry, Shape, ShapeGeometry, Vector3, type Object3D } from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { DeviceDescriptor, DeviceState, OpeningRect, PlacedHouseDevice } from '@kasbah/shared'
import { panelOf } from '@kasbah/shared'
import type { SceneTheme } from '../core/theme'
import { DECOR_LAYER, SITE_DECOR_LAYER } from '../core/layers'
import type { GlowLook } from '../styles/types'
import type { MaterialSet } from '../builders/materials'
import type { Animation } from '../core/renderLoop'
import type { TextureLoad } from './screenArt'
import type { ModelLoad } from '../models/loadModel'
import { isOrientable, yawToRad } from '../../lib/orientation'
import { iconSvg, kindIcon } from '../../lib/strokeIcons'
import { deviceCategory } from '../../lib/deviceIcons'

// Marqueur d'appareil : une pilule DOM (icône + nom) projetée au-dessus de l'ancre par le
// CSS2DRenderer, cliquable, et une représentation 3D minimale propre au type (sphère lumineuse,
// lame de volet, carrosserie…). `update(state)` MUTE les objets ; rien n'est recréé.
// Repère : local au niveau (Z-up), le groupe est à la position de l'appareil.

export interface MarkerContext {
  materials: MaterialSet
  theme: SceneTheme
  /** Ce que le style dit d'une lampe allumée : taille du halo, opacité, portée. */
  glow: GlowLook
  /**
   * L'appareil est au JARDIN (hors niveau). Il n'est pas dessiné au même moment qu'un appareil de
   * niveau, et sa lampe n'éclaire pas la même chose — voir `core/layers.ts`.
   */
  outdoor?: boolean
  descriptor: DeviceDescriptor | undefined
  /** Lumière liée à un ventilateur : icône `lightFan` dans la pilule + corps 3D ventilateur. */
  linkedFan?: boolean
  /** Id du descripteur `fan` lié (pour faire tourner les pales selon son état). */
  linkedFanId?: string
  /** `meta.fan.speeds` du ventilateur lié : la vitesse des pales se lit comme un rang dans cette liste. */
  linkedFanSpeeds?: readonly number[]
  /** Rectangle de l'ouverture liée (volets). */
  opening?: OpeningRect
  addAnimation(a: Animation): () => void
  /** Redemande un rendu : la scène ne rend qu'à la demande, et une image chargée plus tard n'anime rien. */
  invalidate(): void
  /** Chargement des images posées sur un écran ; injecté par les tests, `TextureLoader` sinon. */
  loadTexture?: TextureLoad
  /** Chargement des carrosseries 3D d'un véhicule ; injecté par les tests, `GLTFLoader` sinon. */
  loadModel?: ModelLoad
  /**
   * Projette un point GPS dans le repère de la maison (x, y en mètres), `null` hors du terrain. C'est
   * la scène qui sait le faire (origine, cap, décalage de l'appareil) ; un marqueur qui suit une
   * position publiée en GPS — la tondeuse — s'en sert à chaque relevé, sans reconstruction.
   */
  toLocal?: (p: { lat: number; lon: number }) => [number, number] | null
  /**
   * La place où cet engin se RANGE quand il est au repos (centre en repère maison, et cap), `null`
   * s'il n'y en a pas ou s'il est en mouvement. C'est la scène qui tranche (elle connaît les places
   * de la maison et tous les engins) ; le marqueur d'une tondeuse s'en sert à chaque relevé, sans
   * reconstruction — sinon le robot dériverait de sa base au fil des points GPS reçus à l'arrêt.
   */
  parkedAt?: (state: DeviceState) => { xy: [number, number]; yaw: number } | null
  onTap(key: string): void
  label: string
}

/**
 * Ce que l'appareil fait ENTENDRE, décidé par la scène (qui connaît la maison et tous les états) et non
 * par le marqueur (qui ne voit que le sien) : `emits` — du son sort de lui ; `relayFrom` — l'état du
 * lecteur dont il joue le son (barre de son d'une TV). Voir `lib/audioRouting.ts`.
 */
export interface SoundCue { emits: boolean; relayFrom?: DeviceState }

/** Guide du mode « déplacer » : dessiné après la maison, donc par-dessus elle. */
const GUIDE_RENDER_ORDER = 10

export abstract class DeviceMarker {
  readonly object = new Group()
  readonly key: string
  /** Hauteur (m) de la pilule au-dessus de l'ancre. */
  protected lift = 0.35
  protected state: DeviceState | undefined
  protected sound: SoundCue | undefined
  protected selected = false
  protected stopAnimation: (() => void) | null = null
  protected pill: HTMLButtonElement | null = null
  protected css: CSS2DObject | null = null
  /** Visibilité imposée par le niveau focalisé (indépendante de l'état). */
  private pillAllowed = true
  /** Vrai dès que le marqueur est jeté : un chargement encore en vol ne doit pas réveiller un mort. */
  protected disposed = false
  /** Maillages cliquables (userData.key). */
  readonly pickables: Object3D[] = []
  /**
   * Mode « déplacer » : anneau au sol + fil vertical, pour lire x;y d'un appareil en hauteur ; et, pour
   * un appareil qui regarde quelque part (écran, caméra, véhicule), un cône « regarde vers » au sol
   * dans la direction de son `yaw`, qui suit les touches de rotation du panneau.
   */
  private guide: { ring: Mesh<RingGeometry, MeshBasicMaterial>; line: Line<BufferGeometry, LineBasicMaterial>; look: Mesh<ShapeGeometry, MeshBasicMaterial> | null } | null = null

  constructor(readonly device: PlacedHouseDevice, protected ctx: MarkerContext) {
    this.key = device.id
    this.object.name = `marker:${device.id}`
    this.object.userData = { role: 'marker', key: device.id }
    if (typeof document !== 'undefined') {
      const anchor = document.createElement('div')
      anchor.className = 'marker-anchor'
      this.pill = document.createElement('button')
      this.pill.type = 'button'
      this.pill.className = 'marker-pill'
      this.pill.dataset.key = device.id
      const kind = ctx.descriptor?.kind ?? device.kind
      this.pill.dataset.cat = deviceCategory(kind)
      // le disque d'icône est le POINT FIXE de la pilule : teinté par la catégorie, rempli par l'état,
      // et seul survivant quand la distance réduit la pilule à une icône ou à un point (`data-lod`)
      const disc = document.createElement('span')
      disc.className = 'marker-pill__icon'
      // un module de champ de panneaux est un capteur de puissance, mais ce qu'on voit sur le toit est du solaire
      disc.appendChild(iconSvg(
        panelOf(device) ? 'solar' : kindIcon(kind, ctx.descriptor, { linkedFan: ctx.linkedFan }),
        16, 2,
      ))
      this.pill.appendChild(disc)
      this.pill.title = ctx.label                       // la pilule est bornée : le nom entier reste lisible au survol
      const span = document.createElement('span')
      span.className = 'marker-pill__label'
      span.textContent = ctx.label
      this.pill.appendChild(span)
      this.pill.addEventListener('click', (e) => { e.stopPropagation(); ctx.onTap(this.key) })
      anchor.appendChild(this.pill)
      this.css = new CSS2DObject(anchor)
      this.object.add(this.css)
    }
  }

  protected registerPickable(o: Object3D): void {
    o.userData = { ...o.userData, key: this.key }
    this.pickables.push(o)
  }

  /** Un maillage retiré de la scène doit aussi cesser d'être cliquable, sans quoi on tape dans le vide. */
  protected unregisterPickable(o: Object3D): void {
    const i = this.pickables.indexOf(o)
    if (i >= 0) this.pickables.splice(i, 1)
  }

  protected setLift(z: number): void { this.lift = z; this.css?.position.set(0, 0, z) }

  /** Vrai si l'appareil est « actif » (lampe allumée, volet ouvert, lecture…) : teinte la pilule. */
  protected abstract isOn(state: DeviceState): boolean
  /** Réaction 3D spécifique au type. */
  protected abstract onState(state: DeviceState | undefined): void

  get currentState(): DeviceState | undefined { return this.state }
  get currentSound(): SoundCue | undefined { return this.sound }
  /** Ventilateur lié à cette lumière (plafonnier), s'il y en a un. */
  get linkedFanDeviceId(): string | undefined { return this.ctx.linkedFanId }

  update(state: DeviceState | undefined, sound?: SoundCue): void {
    this.state = state
    this.sound = sound
    if (this.pill) {
      // actif par lui-même, ou parce qu'il joue le son d'un autre (barre de son d'une TV en lecture)
      this.pill.dataset.on = (state && state.available && this.isOn(state)) || sound?.relayFrom ? '1' : '0'
      this.pill.dataset.unavailable = state && !state.available ? '1' : '0'
    }
    this.onState(state)
  }

  /**
   * État du ventilateur lié (plafonnier). No-op hors `LightMarker` : les pales tournent quand
   * le fan est allumé.
   */
  setCompanionFan(_state: DeviceState | undefined): void { /* no-op */ }

  setSelected(s: boolean): void {
    this.selected = s
    if (this.pill) this.pill.dataset.sel = s ? '1' : '0'
    // un marqueur allumé se MONTRE, même de loin, là où la distance avait effacé sa pilule
    // (`setPillVisible`) : c'est ce qui fait ressortir le module d'une case survolée dans la grille
    if (this.css) this.css.visible = this.pillAllowed || s
  }

  setPillVisible(v: boolean): void {
    this.pillAllowed = v
    if (this.css) this.css.visible = v || this.selected
  }

  /**
   * Netteté de la pilule, de 1 (intacte) à 0 (effacée) : elle suit la bande nette du tilt-shift.
   * Une pilule vit dans le DOM, hors du canvas — le flou de la chaîne d'image ne l'atteint pas, et
   * laissée intacte au-dessus d'une maison floutée elle casse l'illusion de maquette.
   */
  setPillFocus(k: number): void {
    const el = this.css?.element
    if (!el) return
    // `''` et non `'1'` : à pleine netteté la pilule redevient un élément SANS style d'opacité
    const v = k >= 0.995 ? '' : k.toFixed(2)
    if (el.style.opacity !== v) el.style.opacity = v
  }

  setTheme(theme: SceneTheme, glow: GlowLook): void {
    this.ctx = { ...this.ctx, theme, glow }
    if (this.guide) { this.guide.ring.material.color.copy(theme.primary); this.guide.line.material.color.copy(theme.primary); this.guide.look?.material.color.copy(theme.primary) }
    this.onState(this.state)
  }

  /**
   * Marque un objet comme DÉCOR : il est posé sur la scène, il n'en est pas la matière. Il sort donc
   * du relevé d'occlusion et de la passe globale (voir `core/layers.ts`) — ce qui vaut pour tout ce
   * qui est translucide ou additif, et pour rien d'autre.
   */
  protected asDecor<T extends Object3D>(o: T): T {
    o.layers.set(this.ctx.outdoor ? SITE_DECOR_LAYER : DECOR_LAYER)
    return o
  }

  /** Position monde de l'ancre. */
  worldAnchor(out = new Vector3()): Vector3 { return this.object.getWorldPosition(out) }
  /** Position monde de la pilule (ancre + lift). */
  worldPill(out = new Vector3()): Vector3 { return this.css ? this.css.getWorldPosition(out) : this.worldAnchor(out) }

  /**
   * Mode « déplacer » : la pilule laisse passer le pointeur (CSS) et un guide relie l'appareil au sol.
   *
   * `guide` sépare les deux : les dix modules d'un champ de panneaux se glissent tous (leur pilule
   * doit laisser passer le doigt, sinon le tap sélectionne le module au lieu de déplacer le champ),
   * mais un seul porte le guide — dix anneaux pour un seul objet qui bouge.
   */
  setMoving(on: boolean, height: number, guide = on): void {
    if (this.pill) this.pill.dataset.moving = on ? '1' : '0'
    if (on && guide) {
      if (!this.guide) {
        const color = this.ctx.theme.primary
        // Le guide se dessine PAR-DESSUS la maison (`depthTest: false` + `renderOrder`) : le sol d'un
        // niveau-toit passe sous la dalle de toiture, qui enterrait l'anneau et le cône ; ailleurs, un
        // mur au premier plan les mangeait de la même façon. Un seul appareil porte un guide à la fois.
        const ring = this.asDecor(new Mesh(new RingGeometry(0.22, 0.3, 40), new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false })))
        const line = this.asDecor(new Line(new BufferGeometry(), new LineBasicMaterial({ color, transparent: true, opacity: 0.7, depthTest: false })))
        ring.renderOrder = line.renderOrder = GUIDE_RENDER_ORDER
        this.object.add(ring, line)
        let look: Mesh<ShapeGeometry, MeshBasicMaterial> | null = null
        // Un module regarde dans l'azimut de son champ (+y local) comme n'importe quel appareil
        // orienté. Posé à plat (aucune inclinaison), il ne regarde nulle part : pas de cône du tout,
        // plutôt qu'une flèche qui invente une direction.
        const panel = panelOf(this.device)
        if (panel ? panel.tilt !== 0 : isOrientable(this.device, this.ctx.descriptor)) {
          // cône plat depuis l'appareil vers +y (le plan XY est le sol en Z-up), tourné du yaw ; les
          // marqueurs sont reconstruits à chaque écriture du placement, donc il suit la rotation
          const shape = new Shape()
          shape.moveTo(0, 0.18)
          shape.lineTo(-0.42, 1.35)
          shape.quadraticCurveTo(0, 1.6, 0.42, 1.35)
          shape.lineTo(0, 0.18)
          look = this.asDecor(new Mesh(new ShapeGeometry(shape, 12), new MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, side: DoubleSide })))
          look.renderOrder = GUIDE_RENDER_ORDER
          // un châssis NÉGATIF bascule le verre en arrière : le cône fait alors demi-tour
          look.rotation.z = yawToRad(this.device.yaw) + (panel && panel.tilt < 0 ? Math.PI : 0)
          this.object.add(look)
        }
        this.guide = { ring, line, look }
      }
      this.setGuideHeight(height)
    } else if (this.guide) {
      this.disposeGuide()
    }
  }

  /** Hauteur (m) de l'appareil au-dessus du sol : l'anneau reste au sol quand la hauteur change. */
  setGuideHeight(height: number): void {
    if (!this.guide) return
    const floor = -height + 0.01
    this.guide.ring.position.z = floor
    if (this.guide.look) this.guide.look.position.z = floor + 0.005
    this.guide.line.geometry.setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, floor)])
  }

  /**
   * Teinte de carrosserie montrée le temps qu'on la CHOISIT, sans rien écrire — `null` rend celle
   * d'avant. Seul un véhicule a une caisse à peindre : c'est `VehicleMarker` qui fait le travail,
   * et ce point d'entrée vit sur la classe de base pour que la scène n'ait pas à importer la
   * sous-classe (un import de valeur de plus dans son graphe, pour une méthode à un appel).
   */
  previewColor(_color: string | null): void {}

  private disposeGuide(): void {
    if (!this.guide) return
    this.guide.ring.geometry.dispose(); this.guide.ring.material.dispose()
    this.guide.line.geometry.dispose(); this.guide.line.material.dispose()
    if (this.guide.look) { this.guide.look.geometry.dispose(); this.guide.look.material.dispose(); this.object.remove(this.guide.look) }
    this.object.remove(this.guide.ring, this.guide.line)
    this.guide = null
  }

  get visibleInScene(): boolean {
    let o: Object3D | null = this.object
    while (o) { if (!o.visible) return false; o = o.parent }
    return this.pillAllowed || this.selected
  }

  dispose(): void {
    this.disposed = true
    this.disposeGuide()
    this.stopAnimation?.()
    this.stopAnimation = null
    this.css?.element.remove()
    this.object.removeFromParent()
  }
}
