import { BoxGeometry, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, PointLight, RingGeometry, ShaderMaterial, SphereGeometry } from 'three'
import type { DeviceState, HouseDevice, PanelPlacement } from '@kasbah/shared'
import { mirekToRgb, xyToRgb } from '@kasbah/shared'
import { isMediaActive } from '../../lib/deviceState'
import { yawToRad } from '../../lib/orientation'
import { createTween, lerp } from '../core/tween'
import { DeviceMarker, type MarkerContext } from './DeviceMarker'
import { ScreenArt } from './screenArt'

// Représentations 3D par type. Toutes mutent leurs objets dans `onState` ; les animations continues
// (déplacement du robot, tween du volet) sont enregistrées dans la boucle et retirées quand elles cessent.

const devMaterial = (ctx: MarkerContext) => ctx.materials.device

/** Nombre d'anneaux de l'onde sonore d'un lecteur, et période d'un anneau (ms). */
const WAVE_RINGS = 3
const WAVE_PERIOD_MS = 5750
/** Rayon (m) de l'anneau à sa naissance et à sa disparition. */
const WAVE_R0 = 0.18
const WAVE_R1 = 1.2

/** Écrans d'un lecteur : dalle (m) et demi-profondeur de la boîte, d'où l'image est posée. */
const SCREENS = { tv: { width: 1, height: 0.56, depth: 0.03 }, display: { width: 0.25, height: 0.16, depth: 0.04 } } as const
/** L'image occupe TOUTE la dalle : elle est posée 2 mm devant, il n'y a pas de cadre à respecter. */
const ART_INSET = 1

/**
 * Matériau des anneaux : couleur unie, opacité pilotée par l'animation, et — pour un appareil qui
 * regarde quelque part — un fondu angulaire : pleine intensité devant (+y local, tourné du yaw),
 * presque rien dans le dos. Toujours des cercles entiers, seule l'intensité varie le long du tour.
 */
function waveMaterial(color: Color, directional: boolean): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, side: DoubleSide,
    uniforms: { uColor: { value: color.clone() }, uOpacity: { value: 0 }, uDirectional: { value: directional ? 1 : 0 } },
    vertexShader: `
      varying vec2 vPos;
      void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity; uniform float uDirectional;
      varying vec2 vPos;
      void main() {
        float front = 0.5 + 0.5 * cos(atan(vPos.x, vPos.y));          // 1 devant (+y), 0 dans le dos
        float fade = mix(1.0, 0.1 + 0.9 * front * front, uDirectional);
        gl_FragColor = vec4(uColor, uOpacity * fade);
      }`,
  })
}

/** Petit objet neutre (capteur, PAC, borne, énergie…). */
export class GenericMarker extends DeviceMarker {
  private mesh: Mesh
  /** Lecteur en lecture : anneaux concentriques qui s'élargissent et s'estompent, comme une onde sonore. */
  private waves: Mesh<RingGeometry, ShaderMaterial>[] = []
  private waving = false
  private playing = false
  /** Pochette affichée sur l'écran (téléviseur et écran connecté seulement). */
  private art: ScreenArt | null = null
  constructor(device: HouseDevice, ctx: MarkerContext) {
    super(device, ctx)
    const kind = ctx.descriptor?.kind ?? device.kind
    let geometry
    // un lecteur prend la forme de sa nature : enceinte (cylindre), téléviseur (écran plat), écran connecté (petite dalle)
    const mediaClass = kind === 'media_player' ? ctx.descriptor?.meta.mediaPlayer?.deviceClass ?? 'speaker' : undefined
    switch (kind) {
      case 'media_player':
        if (mediaClass === 'tv') { geometry = new BoxGeometry(1, 0.06, 0.56); this.setLift(0.8) }
        else if (mediaClass === 'display') { geometry = new BoxGeometry(0.25, 0.08, 0.16); this.setLift(0.35) }
        else { geometry = new CylinderGeometry(0.13, 0.13, 0.32, 20); this.setLift(0.5) }
        break
      case 'climate': geometry = new BoxGeometry(0.9, 0.3, 0.7); this.setLift(0.55); break
      case 'ev_charger': geometry = new BoxGeometry(0.3, 0.15, 0.8); this.setLift(0.6); break
      case 'energy': geometry = new BoxGeometry(0.6, 0.15, 1); this.setLift(0.7); break
      case 'vacuum': geometry = new CylinderGeometry(0.18, 0.18, 0.09, 24); this.setLift(0.25); break
      default: geometry = new SphereGeometry(0.1, 16, 12); this.setLift(0.3)
    }
    this.mesh = new Mesh(geometry, devMaterial(ctx))
    if (geometry instanceof CylinderGeometry) this.mesh.rotation.x = Math.PI / 2   // axe Y du cylindre → Z-up local
    if (kind === 'media_player') this.mesh.position.z = mediaClass === 'tv' ? 0.28 : mediaClass === 'display' ? 0.08 : 0.16
    // un écran regarde quelque part : `yaw` (0 = face à +y, comme le véhicule) — un cylindre d'enceinte n'en a pas besoin
    if (mediaClass === 'tv' || mediaClass === 'display') this.mesh.rotation.z = yawToRad(device.yaw)
    // ce que l'écran diffuse se voit SUR l'écran : la pochette du morceau (ou le logo de l'appli), posée
    // devant la face avant et enfant du maillage, donc tournée du même `yaw` que lui
    if (mediaClass === 'tv' || mediaClass === 'display') {
      const screen = SCREENS[mediaClass]
      this.art = new ScreenArt({
        width: screen.width * ART_INSET,
        height: screen.height * ART_INSET,
        offsetY: screen.depth + 0.002,
        onReady: () => ctx.invalidate(),
        ...(ctx.loadTexture ? { load: ctx.loadTexture } : {}),
      })
      this.mesh.add(this.art.mesh)
    }
    if (kind === 'vacuum') this.mesh.position.z = 0.05
    this.mesh.castShadow = true
    this.registerPickable(this.mesh)
    this.object.add(this.mesh)
    if (kind === 'media_player') {
      // anneaux à plat (le plan XY est le sol en Z-up), un peu au-dessus de la base de l'appareil ;
      // invisibles tant que rien ne joue, animés par `onState`
      const directional = mediaClass === 'tv' || mediaClass === 'display'
      for (let i = 0; i < WAVE_RINGS; i++) {
        const ring = new Mesh(new RingGeometry(0.86, 1, 64), waveMaterial(ctx.theme.media, directional))
        ring.position.z = 0.03
        ring.rotation.z = yawToRad(device.yaw)                 // le « devant » de l'onde suit l'écran
        ring.visible = false
        this.waves.push(ring)
        this.object.add(ring)
      }
    }
  }
  protected isOn(s: DeviceState): boolean {
    switch (s.kind) {
      case 'media_player': return isMediaActive(s)                  // une appli à l'écran diffuse une image : l'onde aussi
      case 'climate': return s.mode !== 'off'
      case 'vacuum': return s.activity === 'cleaning'
      case 'ev_charger': return s.status === 'charging'
      case 'energy': return s.productionW > 0
      default: return false
    }
  }
  protected onState(state: DeviceState | undefined): void {
    // l'écran montre ce qui joue tant que l'appareil répond ; il redevient nu s'il ne répond plus,
    // si rien ne joue, ou si le morceau n'a aucune image (l'état ne porte alors pas d'`artUrl`)
    if (this.art) {
      const media = state?.kind === 'media_player' && state.available ? state : undefined
      this.art.set(media?.nowPlaying?.artUrl)
    }
    if (this.waves.length === 0) return
    // l'onde est du SON : elle suit ce que la scène dit entendre ici (`SoundCue`) — une TV dont le son
    // part en HDMI vers une barre garde l'image, la barre prend l'onde ; sans indication, l'état seul
    this.playing = this.sound ? this.sound.emits : !!state && state.available && this.isOn(state)
    for (const w of this.waves) (w.material.uniforms.uColor!.value as Color).copy(this.ctx.theme.media)
    if (this.playing && !this.waving) {
      this.waving = true
      let t0 = -1
      this.stopAnimation = this.ctx.addAnimation({
        step: (now) => {
          if (!this.playing) {                                  // lecture finie : on range les anneaux et on rend la main
            for (const w of this.waves) { w.visible = false; w.material.uniforms.uOpacity!.value = 0 }
            this.waving = false
            return false
          }
          if (t0 < 0) t0 = now
          this.waves.forEach((w, i) => {
            const p = (((now - t0) / WAVE_PERIOD_MS) + i / WAVE_RINGS) % 1   // phase 0 → 1, anneaux décalés d'un tiers
            const r = WAVE_R0 + (WAVE_R1 - WAVE_R0) * p
            w.scale.set(r, r, 1)
            w.material.uniforms.uOpacity!.value = 0.85 * (1 - p)            // fondu linéaire : encore visible quand l'anneau est large
            w.visible = true
          })
          return true
        },
      })
    }
  }
  override dispose(): void {
    this.mesh.geometry.dispose()
    this.art?.dispose()
    for (const w of this.waves) { w.geometry.dispose(); w.material.dispose() }
    super.dispose()
  }
}

/** Puissance (W) à partir de laquelle un module est dessiné à pleine intensité (crête d'un IQ8 courant). */
const PANEL_PEAK_W = 450
/** Verre d'un module au repos : bleu nuit, presque noir. */
const PANEL_DARK = 0x1c2740

/**
 * Module photovoltaïque d'un champ : une dalle aux dimensions du module, couchée, inclinée et
 * orientée comme son champ, qui tire vers l'accent à mesure qu'elle produit. Le kind reste `sensor`
 * (une puissance en W), c'est `meta.panel` qui dit que ce capteur est un module posé sur un toit.
 */
export class PanelMarker extends DeviceMarker {
  private readonly mesh: Mesh
  private readonly mat: MeshStandardMaterial
  constructor(device: HouseDevice, ctx: MarkerContext, panel: PanelPlacement) {
    super(device, ctx)
    this.mat = new MeshStandardMaterial({ color: PANEL_DARK, roughness: 0.35, metalness: 0.4 })
    this.mesh = new Mesh(new BoxGeometry(panel.width, panel.height, 0.04), this.mat)
    // d'abord l'inclinaison autour de l'axe des colonnes (x local), puis l'orientation du champ (z)
    this.mesh.rotation.order = 'ZXY'
    this.mesh.rotation.x = (panel.tilt * Math.PI) / 180
    this.mesh.rotation.z = yawToRad(device.yaw)
    this.mesh.position.z = 0.03
    this.mesh.castShadow = true
    this.registerPickable(this.mesh)
    this.object.add(this.mesh)
    this.setLift(0.35)
  }
  protected isOn(s: DeviceState): boolean { return s.kind === 'sensor' && s.value > 0 }
  protected onState(state: DeviceState | undefined): void {
    const watts = state?.kind === 'sensor' && state.available ? state.value : 0
    const k = Math.min(1, Math.max(0, watts / PANEL_PEAK_W))
    this.mat.color.setHex(PANEL_DARK).lerp(this.ctx.theme.primary, k * 0.7)
    this.mat.emissive.copy(this.ctx.theme.primary).multiplyScalar(k * 0.3)
  }
  override dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); super.dispose() }
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

  protected isOn(s: DeviceState): boolean { return s.kind === 'cover' && (s.position ?? 0) > 0 }
  protected onState(state: DeviceState | undefined): void {
    if (!state || state.kind !== 'cover') return
    // position inconnue : tablier rentré (rien de dessiné) plutôt qu'un volet fermé en trompe-l'œil
    const target = 1 - (state.position ?? 100) / 100
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
