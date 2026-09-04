import { Group, Vector3, type Object3D } from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { DeviceDescriptor, DeviceState, HouseDevice, OpeningRect } from '@kasbah/shared'
import type { SceneTheme } from '../core/theme'
import type { MaterialSet } from '../builders/materials'
import type { Animation } from '../core/renderLoop'
import { iconSvg, kindIcon } from '../../lib/strokeIcons'

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
  onTap(key: string): void
  label: string
}

export abstract class DeviceMarker {
  readonly object = new Group()
  readonly key: string
  /** Hauteur (m) de la pilule au-dessus de l'ancre. */
  protected lift = 0.35
  protected state: DeviceState | undefined
  protected selected = false
  protected stopAnimation: (() => void) | null = null
  protected pill: HTMLButtonElement | null = null
  protected css: CSS2DObject | null = null
  /** Visibilité imposée par le niveau focalisé (indépendante de l'état). */
  private pillAllowed = true
  /** Maillages cliquables (userData.key). */
  readonly pickables: Object3D[] = []

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
      this.pill.appendChild(iconSvg(kindIcon(ctx.descriptor?.kind ?? device.kind, ctx.descriptor), 16, 2))
      const span = document.createElement('span')
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

  update(state: DeviceState | undefined): void {
    this.state = state
    if (this.pill) {
      this.pill.dataset.on = state && state.available && this.isOn(state) ? '1' : '0'
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

  setTheme(theme: SceneTheme): void { this.ctx = { ...this.ctx, theme }; this.onState(this.state) }

  /** Position monde de l'ancre. */
  worldAnchor(out = new Vector3()): Vector3 { return this.object.getWorldPosition(out) }

  get visibleInScene(): boolean {
    let o: Object3D | null = this.object
    while (o) { if (!o.visible) return false; o = o.parent }
    return this.pillAllowed || this.selected
  }

  dispose(): void {
    this.stopAnimation?.()
    this.stopAnimation = null
    this.css?.element.remove()
    this.object.removeFromParent()
  }
}
