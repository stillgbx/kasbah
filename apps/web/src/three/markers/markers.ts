import { BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PointLight, SphereGeometry } from 'three'
import type { DeviceState, HouseDevice } from '@kasbah/shared'
import { mirekToRgb, xyToRgb } from '@kasbah/shared'
import { createTween, lerp } from '../core/tween'
import { DeviceMarker, type MarkerContext } from './DeviceMarker'

// Représentations 3D par type. Toutes mutent leurs objets dans `onState` ; les animations continues
// (déplacement du robot, tween du volet) sont enregistrées dans la boucle et retirées quand elles cessent.

const devMaterial = (ctx: MarkerContext) => ctx.materials.device

/** Petit objet neutre (capteur, PAC, borne, énergie…). */
export class GenericMarker extends DeviceMarker {
  private mesh: Mesh
  constructor(device: HouseDevice, ctx: MarkerContext) {
    super(device, ctx)
    const kind = ctx.descriptor?.kind ?? device.kind
    let geometry
    switch (kind) {
      case 'media_player': geometry = new CylinderGeometry(0.13, 0.13, 0.32, 20); this.setLift(0.5); break
      case 'climate': geometry = new BoxGeometry(0.9, 0.3, 0.7); this.setLift(0.55); break
      case 'ev_charger': geometry = new BoxGeometry(0.3, 0.15, 0.8); this.setLift(0.6); break
      case 'energy': geometry = new BoxGeometry(0.6, 0.15, 1); this.setLift(0.7); break
      case 'vacuum': geometry = new CylinderGeometry(0.18, 0.18, 0.09, 24); this.setLift(0.25); break
      default: geometry = new SphereGeometry(0.1, 16, 12); this.setLift(0.3)
    }
    this.mesh = new Mesh(geometry, devMaterial(ctx))
    if (geometry instanceof CylinderGeometry) this.mesh.rotation.x = Math.PI / 2   // axe Y du cylindre → Z-up local
    if (kind === 'media_player') this.mesh.position.z = 0.16
    if (kind === 'vacuum') this.mesh.position.z = 0.05
    this.mesh.castShadow = true
    this.registerPickable(this.mesh)
    this.object.add(this.mesh)
  }
  protected isOn(s: DeviceState): boolean {
    switch (s.kind) {
      case 'media_player': return s.playback === 'playing'
      case 'climate': return s.mode !== 'off'
      case 'vacuum': return s.activity === 'cleaning'
      case 'ev_charger': return s.status === 'charging'
      case 'energy': return s.productionW > 0
      default: return false
    }
  }
  protected onState(): void {}
  override dispose(): void { this.mesh.geometry.dispose(); super.dispose() }
}

/** Lampe : sphère émissive + PointLight ; intensité selon la luminosité, couleur selon l'état. */
export class LightMarker extends DeviceMarker {
  private readonly mat: MeshStandardMaterial
  private readonly sphere: Mesh
  private readonly light: PointLight
  constructor(device: HouseDevice, ctx: MarkerContext) {
    super(device, ctx)
    this.mat = new MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffc46b, emissiveIntensity: 0, roughness: 0.4 })
    this.sphere = new Mesh(new SphereGeometry(0.13, 20, 14), this.mat)
    this.light = new PointLight(0xffd9a0, 0, 7, 1.6)
    this.object.add(this.sphere, this.light)
    this.registerPickable(this.sphere)
    this.setLift(0.3)
  }
  private color(): Color {
    const s = this.state
    if (!s || s.kind !== 'light') return new Color('#ffd9a0')
    if (s.color) { const { r, g, b } = xyToRgb(s.color.x, s.color.y); return new Color(r, g, b) }
    const { r, g, b } = mirekToRgb(s.colorTempMirek ?? 366)
    return new Color(r, g, b)
  }
  protected isOn(s: DeviceState): boolean { return s.kind === 'light' && s.on }
  protected onState(state: DeviceState | undefined): void {
    const on = !!state && state.kind === 'light' && state.available && state.on
    const k = on && state.kind === 'light' ? (state.brightness ?? 100) / 100 : 0
    const c = this.color()
    this.mat.emissive.copy(c)
    this.mat.emissiveIntensity = k * 1.6
    this.light.color.copy(c)
    this.light.intensity = k * (this.ctx.theme.isDark ? 14 : 6)
  }
  override dispose(): void { this.sphere.geometry.dispose(); this.mat.dispose(); super.dispose() }
}

/** Volet : lame ajustée dans l'embrasure, hauteur = part fermée, tweenée ; icône seule sans ouverture. */
export class CoverMarker extends DeviceMarker {
  private slat: Mesh | null = null
  private slatMat: MeshStandardMaterial | null = null
  private closedFraction = 0
  private cancelTween: (() => void) | null = null

  constructor(device: HouseDevice, ctx: MarkerContext) {
    super(device, ctx)
    const o = ctx.opening
    if (o) {
      this.slatMat = ctx.materials.slat.clone()
      this.slat = new Mesh(new BoxGeometry(o.width * 0.98, Math.max(0.03, o.depth * 0.25), 1), this.slatMat)
      this.slat.rotation.z = Math.atan2(o.u[1], o.u[0])
      this.slat.castShadow = true
      this.object.add(this.slat)
      this.slat.position.set(
        o.origin[0] + (o.u[0] * o.width) / 2 + o.normal[0] * o.depth * 0.8 - device.position[0],
        o.origin[1] + (o.u[1] * o.width) / 2 + o.normal[1] * o.depth * 0.8 - device.position[1],
        0,
      )
      this.registerPickable(this.slat)
      this.applyFraction(0)
      this.setLift(o.origin[2] + o.height - device.position[2] + 0.2)
    } else {
      const box = new Mesh(new BoxGeometry(0.6, 0.06, 0.5), devMaterial(ctx))
      this.object.add(box)
      this.registerPickable(box)
      this.setLift(0.4)
    }
  }

  private applyFraction(f: number): void {
    const o = this.ctx.opening
    if (!o || !this.slat) return
    this.closedFraction = f
    const h = Math.max(0.001, o.height * f)
    this.slat.scale.z = h
    this.slat.position.z = o.origin[2] + o.height - h / 2 - this.device.position[2]
    this.slat.visible = f > 0.005
  }

  protected isOn(s: DeviceState): boolean { return s.kind === 'cover' && s.position > 0 }
  protected onState(state: DeviceState | undefined): void {
    if (!state || state.kind !== 'cover') return
    const target = 1 - state.position / 100
    if (!this.slat) return
    this.cancelTween?.()
    const from = this.closedFraction
    if (Math.abs(target - from) < 0.002) this.applyFraction(target)
    else {
      const tw = createTween({ durationMs: 400, now: performance.now(), onUpdate: (k) => this.applyFraction(lerp(from, target, k)) })
      this.cancelTween = () => tw.cancel()
      this.ctx.addAnimation({ step: (now) => tw.step(now) })
    }
  }
  override dispose(): void { this.cancelTween?.(); this.slat?.geometry.dispose(); this.slatMat?.dispose(); super.dispose() }
}

/** Véhicule : carrosserie + habitacle orientés par `yaw`, masqués quand le véhicule est absent. */
export class VehicleMarker extends DeviceMarker {
  private readonly group = new Group()
  private readonly bodyMat: MeshStandardMaterial
  private readonly cabMat: MeshStandardMaterial
  constructor(device: HouseDevice, ctx: MarkerContext, private atHome: (state: DeviceState) => boolean) {
    super(device, ctx)
    const brand = (ctx.descriptor?.meta.manufacturer ?? '').toLowerCase()
    this.bodyMat = new MeshStandardMaterial({ color: brand.includes('tesla') ? 0xe4e8ec : 0x8a2b2b, roughness: 0.35, metalness: 0.3 })
    this.cabMat = new MeshStandardMaterial({ color: 0x2a3240, roughness: 0.2, metalness: 0.5 })
    const body = new Mesh(new BoxGeometry(1.9, 4.5, 0.6), this.bodyMat)
    body.position.z = 0.3
    const cab = new Mesh(new BoxGeometry(1.7, 2.4, 0.55), this.cabMat)
    cab.position.set(0, -0.2, 0.85)
    body.castShadow = cab.castShadow = true
    this.group.add(body, cab)
    this.group.rotation.z = ((device.yaw ?? 0) * Math.PI) / 180
    this.object.add(this.group)
    this.registerPickable(body)
    this.registerPickable(cab)
    this.setLift(1.4)
  }
  protected isOn(s: DeviceState): boolean { return s.kind === 'vehicle' && s.charging }
  protected onState(state: DeviceState | undefined): void {
    const present = !state || state.kind !== 'vehicle' || !state.location || this.atHome(state)
    this.group.visible = present
  }
  override dispose(): void { this.group.children.forEach((c) => (c as Mesh).geometry.dispose()); this.bodyMat.dispose(); this.cabMat.dispose(); super.dispose() }
}

/** Tondeuse : petit corps orange qui suit la position publiée (lissée). */
export class MowerMarker extends DeviceMarker {
  private readonly mesh: Mesh
  private readonly mat: MeshStandardMaterial
  private targetXY: [number, number] | null = null
  private moving = false
  constructor(device: HouseDevice, ctx: MarkerContext) {
    super(device, ctx)
    this.mat = new MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 })
    this.mesh = new Mesh(new BoxGeometry(0.5, 0.7, 0.28), this.mat)
    this.mesh.position.z = 0.14
    this.mesh.castShadow = true
    this.object.add(this.mesh)
    this.registerPickable(this.mesh)
    this.setLift(0.55)
  }
  protected isOn(s: DeviceState): boolean { return s.kind === 'mower' && s.activity === 'mowing' }
  protected onState(state: DeviceState | undefined): void {
    if (state?.kind === 'mower' && state.position) this.targetXY = state.position
    const active = !!state && state.kind === 'mower' && state.activity === 'mowing'
    if (this.targetXY && !this.moving) {
      this.moving = true
      this.stopAnimation = this.ctx.addAnimation({
        step: (_now, dtS) => {
          if (!this.targetXY) { this.moving = false; return false }
          const k = 1 - Math.exp(-dtS * 3)
          const dx = this.targetXY[0] - this.object.position.x, dy = this.targetXY[1] - this.object.position.y
          this.object.position.x = lerp(this.object.position.x, this.targetXY[0], k)
          this.object.position.y = lerp(this.object.position.y, this.targetXY[1], k)
          if (Math.hypot(dx, dy) > 0.05) this.mesh.rotation.z = Math.atan2(dy, dx) - Math.PI / 2
          if (Math.hypot(dx, dy) < 0.01 && !active) { this.moving = false; return false }
          return true
        },
      })
    }
  }
  override dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); super.dispose() }
}
