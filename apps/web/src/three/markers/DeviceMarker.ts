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

// Device marker: a DOM pill (icon + name) projected above the anchor by the
// CSS2DRenderer, clickable, and a minimal 3D representation specific to the type (glowing sphere,
// shutter slat, car body…). `update(state)` MUTATES the objects; nothing is recreated.
// Reference frame: local to the level (Z-up), the group is at the device's position.

export interface MarkerContext {
  materials: MaterialSet
  theme: SceneTheme
  /** What the style says about a lit lamp: halo size, opacity, range. */
  glow: GlowLook
  /**
   * The device is in the GARDEN (outside any level). It is not drawn at the same moment as a level
   * device, and its lamp does not light the same thing — see `core/layers.ts`.
   */
  outdoor?: boolean
  descriptor: DeviceDescriptor | undefined
  /** Light tied to a fan: `lightFan` icon in the pill + 3D fan body. */
  linkedFan?: boolean
  /** Id of the linked `fan` descriptor (to spin the blades according to its state). */
  linkedFanId?: string
  /** `meta.fan.speeds` of the linked fan: the blade speed reads as a rank in this list. */
  linkedFanSpeeds?: readonly number[]
  /** Rectangle of the linked opening (shutters). */
  opening?: OpeningRect
  addAnimation(a: Animation): () => void
  /** Requests a render again: the scene only renders on demand, and an image loaded later animates nothing. */
  invalidate(): void
  /** Loading of the images laid on a screen; injected by the tests, `TextureLoader` otherwise. */
  loadTexture?: TextureLoad
  /** Loading of a vehicle's 3D car bodies; injected by the tests, `GLTFLoader` otherwise. */
  loadModel?: ModelLoad
  /**
   * Projects a GPS point into the house reference frame (x, y in meters), `null` outside the terrain. It is
   * the scene that knows how (origin, heading, device offset); a marker that follows a
   * position published as GPS — the mower — uses it at every reading, without rebuilding.
   */
  toLocal?: (p: { lat: number; lon: number }) => [number, number] | null
  /** Local z of the marker placed at (x, y): a vehicle driving in the garden follows the relief. */
  groundZ?: (x: number, y: number) => number
  /**
   * The space where this vehicle PARKS when at rest (center in the house reference frame, and heading), `null`
   * if there is none or if it is moving. It is the scene that decides (it knows the house's
   * spaces and all the vehicles); a mower's marker uses it at every reading, without
   * rebuilding — otherwise the robot would drift from its base with the GPS points received while stopped.
   */
  parkedAt?: (state: DeviceState) => { xy: [number, number]; yaw: number } | null
  onTap(key: string): void
  label: string
}

/**
 * What the device makes HEARD, decided by the scene (which knows the house and all the states) and not
 * by the marker (which only sees its own): `emits` — sound comes out of it; `relayFrom` — the state of the
 * player whose sound it plays (a TV's soundbar). See `lib/audioRouting.ts`.
 */
export interface SoundCue { emits: boolean; relayFrom?: DeviceState }

/** Guide of the "move" mode: drawn after the house, hence on top of it. */
const GUIDE_RENDER_ORDER = 10

export abstract class DeviceMarker {
  readonly object = new Group()
  readonly key: string
  /** Height (m) of the pill above the anchor. */
  protected lift = 0.35
  protected state: DeviceState | undefined
  protected sound: SoundCue | undefined
  protected selected = false
  protected stopAnimation: (() => void) | null = null
  protected pill: HTMLButtonElement | null = null
  protected css: CSS2DObject | null = null
  /** Visibility imposed by the focused level (independent of the state). */
  private pillAllowed = true
  /** True as soon as the marker is discarded: a load still in flight must not wake the dead. */
  protected disposed = false
  /** Clickable meshes (userData.key). */
  readonly pickables: Object3D[] = []
  /**
   * "Move" mode: ring on the ground + vertical wire, to read the x;y of a device mounted high; and, for
   * a device that looks somewhere (screen, camera, vehicle), a "looks toward" cone on the ground
   * in the direction of its `yaw`, which follows the panel's rotation keys.
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
      // the icon disc is the FIXED POINT of the pill: tinted by the category, filled by the state,
      // and the sole survivor when distance reduces the pill to an icon or a dot (`data-lod`)
      const disc = document.createElement('span')
      disc.className = 'marker-pill__icon'
      // a module of a panel array is a power sensor, but what one sees on the roof is solar
      disc.appendChild(iconSvg(
        panelOf(device) ? 'solar' : kindIcon(kind, ctx.descriptor, { linkedFan: ctx.linkedFan }),
        16, 2,
      ))
      this.pill.appendChild(disc)
      this.pill.title = ctx.label                       // the pill is bounded: the full name stays readable on hover
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

  /** A mesh removed from the scene must also stop being clickable, otherwise taps hit empty space. */
  protected unregisterPickable(o: Object3D): void {
    const i = this.pickables.indexOf(o)
    if (i >= 0) this.pickables.splice(i, 1)
  }

  protected setLift(z: number): void { this.lift = z; this.css?.position.set(0, 0, z) }

  /** True if the device is "active" (lamp on, shutter open, playback…): tints the pill. */
  protected abstract isOn(state: DeviceState): boolean
  /** Type-specific 3D reaction. */
  protected abstract onState(state: DeviceState | undefined): void

  get currentState(): DeviceState | undefined { return this.state }
  get currentSound(): SoundCue | undefined { return this.sound }
  /** Fan linked to this light (ceiling light), if there is one. */
  get linkedFanDeviceId(): string | undefined { return this.ctx.linkedFanId }

  update(state: DeviceState | undefined, sound?: SoundCue): void {
    this.state = state
    this.sound = sound
    if (this.pill) {
      // active by itself, or because it plays the sound of another (a TV's soundbar during playback)
      this.pill.dataset.on = (state && state.available && this.isOn(state)) || sound?.relayFrom ? '1' : '0'
      this.pill.dataset.unavailable = state && !state.available ? '1' : '0'
    }
    this.onState(state)
  }

  /**
   * State of the linked fan (ceiling light). No-op outside `LightMarker`: the blades spin when
   * the fan is on.
   */
  setCompanionFan(_state: DeviceState | undefined): void { /* no-op */ }

  setSelected(s: boolean): void {
    this.selected = s
    if (this.pill) this.pill.dataset.sel = s ? '1' : '0'
    // a lit marker SHOWS ITSELF, even from afar, where distance had erased its pill
    // (`setPillVisible`): that is what makes the module of a hovered cell stand out in the grid
    if (this.css) this.css.visible = this.pillAllowed || s
  }

  setPillVisible(v: boolean): void {
    this.pillAllowed = v
    if (this.css) this.css.visible = v || this.selected
  }

  /**
   * Sharpness of the pill, from 1 (intact) to 0 (erased): it follows the tilt-shift's sharp band.
   * A pill lives in the DOM, outside the canvas — the blur of the image chain does not reach it, and
   * left intact above a blurred house it breaks the miniature illusion.
   */
  setPillFocus(k: number): void {
    this.pillFocus = k
    this.applyPillOpacity()
  }

  /**
   * Fade of the pill, from 1 (full) to 0: it appears and fades out with its level instead of
   * popping up (`HouseScene.fadePills`). Multiplied by the tilt-shift sharpness.
   */
  setPillFade(k: number): void {
    this.pillFade = k
    this.applyPillOpacity()
  }

  private pillFocus = 1
  private pillFade = 1
  private applyPillOpacity(): void {
    const el = this.css?.element
    if (!el) return
    const k = this.pillFocus * this.pillFade
    // `''` and not `'1'`: at full sharpness the pill becomes an element WITHOUT an opacity style again
    const v = k >= 0.995 ? '' : k.toFixed(2)
    if (el.style.opacity !== v) el.style.opacity = v
  }

  setTheme(theme: SceneTheme, glow: GlowLook): void {
    this.ctx = { ...this.ctx, theme, glow }
    if (this.guide) { this.guide.ring.material.color.copy(theme.primary); this.guide.line.material.color.copy(theme.primary); this.guide.look?.material.color.copy(theme.primary) }
    this.onState(this.state)
  }

  /**
   * Marks an object as DECOR: it is laid on the scene, it is not its matter. It therefore leaves
   * the occlusion capture (see `core/layers.ts`) — which holds for everything translucent or
   * additive, and for nothing else.
   */
  protected asDecor<T extends Object3D>(o: T): T {
    o.layers.set(this.ctx.outdoor ? SITE_DECOR_LAYER : DECOR_LAYER)
    return o
  }

  /** World position of the anchor. */
  worldAnchor(out = new Vector3()): Vector3 { return this.object.getWorldPosition(out) }
  /** World position of the pill (anchor + lift). */
  worldPill(out = new Vector3()): Vector3 { return this.css ? this.css.getWorldPosition(out) : this.worldAnchor(out) }

  /**
   * "Move" mode: the pill lets the pointer through (CSS) and a guide links the device to the ground.
   *
   * `guide` separates the two: the ten modules of a panel array are all dragged (their pill
   * must let the finger through, otherwise the tap selects the module instead of moving the array),
   * but only one carries the guide — ten rings for a single object that moves.
   */
  setMoving(on: boolean, height: number, guide = on): void {
    if (this.pill) this.pill.dataset.moving = on ? '1' : '0'
    if (on && guide) {
      if (!this.guide) {
        const color = this.ctx.theme.primary
        // The guide is drawn ON TOP OF the house (`depthTest: false` + `renderOrder`): the floor of a
        // roof level passes under the roofing slab, which buried the ring and the cone; elsewhere, a
        // wall in the foreground ate them the same way. Only one device carries a guide at a time.
        const ring = this.asDecor(new Mesh(new RingGeometry(0.22, 0.3, 40), new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false })))
        const line = this.asDecor(new Line(new BufferGeometry(), new LineBasicMaterial({ color, transparent: true, opacity: 0.7, depthTest: false })))
        ring.renderOrder = line.renderOrder = GUIDE_RENDER_ORDER
        this.object.add(ring, line)
        let look: Mesh<ShapeGeometry, MeshBasicMaterial> | null = null
        // A module looks in its array's azimuth (local +y) like any oriented
        // device. Laid flat (no tilt), it looks nowhere: no cone at all,
        // rather than an arrow that invents a direction.
        const panel = panelOf(this.device)
        if (panel ? panel.tilt !== 0 : isOrientable(this.device, this.ctx.descriptor)) {
          // flat cone from the device toward +y (the XY plane is the ground in Z-up), rotated by the yaw; the
          // markers are rebuilt at every write of the placement, so it follows the rotation
          const shape = new Shape()
          shape.moveTo(0, 0.18)
          shape.lineTo(-0.42, 1.35)
          shape.quadraticCurveTo(0, 1.6, 0.42, 1.35)
          shape.lineTo(0, 0.18)
          look = this.asDecor(new Mesh(new ShapeGeometry(shape, 12), new MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, side: DoubleSide })))
          look.renderOrder = GUIDE_RENDER_ORDER
          // a NEGATIVE rack tilts the glass backward: the cone then turns around
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

  /** Height (m) of the device above the ground: the ring stays on the ground when the height changes. */
  setGuideHeight(height: number): void {
    if (!this.guide) return
    const floor = -height + 0.01
    this.guide.ring.position.z = floor
    if (this.guide.look) this.guide.look.position.z = floor + 0.005
    this.guide.line.geometry.setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, floor)])
  }

  /**
   * Body color shown while it is being CHOSEN, without writing anything — `null` restores the
   * previous one. Only a vehicle has a body to paint: `VehicleMarker` does the work,
   * and this entry point lives on the base class so that the scene does not have to import the
   * subclass (one more value import in its graph, for a one-call method).
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
