import { BufferGeometry, DoubleSide, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, RingGeometry, Shape, ShapeGeometry, Vector3, type Object3D } from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { DeviceDescriptor, DeviceState, HouseDevice, OpeningRect } from '@kasbah/shared'
import { panelOf } from '@kasbah/shared'
import type { SceneTheme } from '../core/theme'
import type { MaterialSet } from '../builders/materials'
import type { Animation } from '../core/renderLoop'
import type { TextureLoad } from './screenArt'
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
  descriptor: DeviceDescriptor | undefined
  /** Rectangle de l'ouverture liée (volets). */
  opening?: OpeningRect
  addAnimation(a: Animation): () => void
  /** Redemande un rendu : la scène ne rend qu'à la demande, et une image chargée plus tard n'anime rien. */
  invalidate(): void
  /** Chargement des images posées sur un écran ; injecté par les tests, `TextureLoader` sinon. */
  loadTexture?: TextureLoad
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
  /** Maillages cliquables (userData.key). */
  readonly pickables: Object3D[] = []
  /**
   * Mode « déplacer » : anneau au sol + fil vertical, pour lire x;y d'un appareil en hauteur ; et, pour
   * un appareil qui regarde quelque part (écran, caméra, véhicule), un cône « regarde vers » au sol
   * dans la direction de son `yaw`, qui suit les touches de rotation du panneau.
   */
  private guide: { ring: Mesh<RingGeometry, MeshBasicMaterial>; line: Line<BufferGeometry, LineBasicMaterial>; look: Mesh<ShapeGeometry, MeshBasicMaterial> | null } | null = null

  constructor(readonly device: HouseDevice, protected ctx: MarkerContext) {
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
      disc.appendChild(iconSvg(panelOf(device) ? 'solar' : kindIcon(kind, ctx.descriptor), 16, 2))
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

  protected setLift(z: number): void { this.lift = z; this.css?.position.set(0, 0, z) }

  /** Vrai si l'appareil est « actif » (lampe allumée, volet ouvert, lecture…) : teinte la pilule. */
  protected abstract isOn(state: DeviceState): boolean
  /** Réaction 3D spécifique au type. */
  protected abstract onState(state: DeviceState | undefined): void

  get currentState(): DeviceState | undefined { return this.state }
  get currentSound(): SoundCue | undefined { return this.sound }

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

  setSelected(s: boolean): void {
    this.selected = s
    if (this.pill) this.pill.dataset.sel = s ? '1' : '0'
  }

  setPillVisible(v: boolean): void {
    this.pillAllowed = v
    if (this.css) this.css.visible = v || this.selected
  }

  setTheme(theme: SceneTheme): void {
    this.ctx = { ...this.ctx, theme }
    if (this.guide) { this.guide.ring.material.color.copy(theme.primary); this.guide.line.material.color.copy(theme.primary); this.guide.look?.material.color.copy(theme.primary) }
    this.onState(this.state)
  }

  /** Position monde de l'ancre. */
  worldAnchor(out = new Vector3()): Vector3 { return this.object.getWorldPosition(out) }
  /** Position monde de la pilule (ancre + lift). */
  worldPill(out = new Vector3()): Vector3 { return this.css ? this.css.getWorldPosition(out) : this.worldAnchor(out) }

  /** Mode « déplacer » : la pilule laisse passer le pointeur (CSS) et un guide relie l'appareil au sol. */
  setMoving(on: boolean, height: number): void {
    if (this.pill) this.pill.dataset.moving = on ? '1' : '0'
    if (on) {
      if (!this.guide) {
        const color = this.ctx.theme.primary
        // Le guide se dessine PAR-DESSUS la maison (`depthTest: false` + `renderOrder`) : le sol d'un
        // niveau-toit passe sous la dalle de toiture, qui enterrait l'anneau et le cône ; ailleurs, un
        // mur au premier plan les mangeait de la même façon. Un seul appareil porte un guide à la fois.
        const ring = new Mesh(new RingGeometry(0.22, 0.3, 40), new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }))
        const line = new Line(new BufferGeometry(), new LineBasicMaterial({ color, transparent: true, opacity: 0.7, depthTest: false }))
        ring.renderOrder = line.renderOrder = GUIDE_RENDER_ORDER
        this.object.add(ring, line)
        let look: Mesh<ShapeGeometry, MeshBasicMaterial> | null = null
        if (isOrientable(this.device, this.ctx.descriptor)) {
          // cône plat depuis l'appareil vers +y (le plan XY est le sol en Z-up), tourné du yaw ; les
          // marqueurs sont reconstruits à chaque écriture du placement, donc il suit la rotation
          const shape = new Shape()
          shape.moveTo(0, 0.18)
          shape.lineTo(-0.42, 1.35)
          shape.quadraticCurveTo(0, 1.6, 0.42, 1.35)
          shape.lineTo(0, 0.18)
          look = new Mesh(new ShapeGeometry(shape, 12), new MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, side: DoubleSide }))
          look.renderOrder = GUIDE_RENDER_ORDER
          look.rotation.z = yawToRad(this.device.yaw)
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
    this.disposeGuide()
    this.stopAnimation?.()
    this.stopAnimation = null
    this.css?.element.remove()
    this.object.removeFromParent()
  }
}
