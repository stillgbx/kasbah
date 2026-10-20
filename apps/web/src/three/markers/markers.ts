import { AdditiveBlending, BoxGeometry, type BufferGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, RingGeometry, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial } from 'three'
import type { DeviceState, PlacedHouseDevice, PanelPlacement } from '@kasbah/shared'
import { mirekToRgb, xyToRgb } from '@kasbah/shared'
import { isMediaActive } from '../../lib/deviceState'
import { coverActivity, isFlatCover } from '../../lib/cover'
import { IDLE_W, isEnergySite } from '../../lib/energy'
import { coverLeaves, coverSize, yawToRad } from '../../lib/orientation'
import { bodyColorOf, bodyFinishOf, FINISH_MATERIAL, SCENE_FINISH } from '../../lib/vehicleTuning'
import { createTween, lerp } from '../core/tween'
import { joineryMaterial } from '../builders/materials'
import { DeviceMarker, type MarkerContext } from './DeviceMarker'
import { ScreenArt } from './screenArt'
import { modelUrl, resolveModel } from '../models/catalog'
import { loadModel } from '../models/loadModel'

// 3D representations per type. All mutate their objects in `onState`; continuous animations
// (robot movement, shutter tween) are registered in the loop and removed when they stop.

const devMaterial = (ctx: MarkerContext) => ctx.materials.device

/** Number of rings of a player's sound wave, and period of a ring (ms). */
const WAVE_RINGS = 3
const WAVE_PERIOD_MS = 5750
/** Radius (m) of the ring at its birth and at its disappearance. */
const WAVE_R0 = 0.18
const WAVE_R1 = 1.2

/**
 * Pulse of a cabinet (battery, or charger while charging): period of one breath (ms) and bounds of
 * its emissive. Slow — it is a state, not an alert —, and much longer than a player's wave.
 */
const BATTERY_PULSE_MS = 2600
const BATTERY_GLOW = { min: 0.06, max: 0.6 }
/** Share of the state color poured into the cabinet's tint: it stays gray, even at the trough of the breath. */
const BATTERY_TINT = 0.3
/** Cabinet of a battery (m): width, depth, height. Its two large faces carry the gauge. */
const BATTERY_BOX = { w: 0.6, d: 0.15, h: 1 }
/** Charge gauge of the cabinet: width of the bar (m), share of the face height, inset from the edge. */
const BATTERY_GAUGE = { w: 0.06, h: 0.86, inset: 0.06 }

/**
 * Housing of a water treatment station (m): width, depth, height — the exact dimensions
 * from the COMAP Proteo 2 manual. Flat and wide: it sits AGAINST a wall, like a thermostat, not
 * on the floor like a charger.
 */
const WATER_BOX = { w: 0.59, d: 0.17, h: 0.59 }
/**
 * Indoor module of an air-to-water heat pump (Ecodan hydrobox): a MACHINE standing on the floor in
 * a utility room, not a wall box. Vendor dimensions rounded, 60 × 36 × 120 cm.
 */
const HEATPUMP_BOX = { w: 0.6, d: 0.36, h: 1.2 }

/** A player's screens: half depth of the box (where the image is laid). Width × height
 * of a TV come from `coverSize` (JSON or default); the smart display stays a small fixed panel. */
const SCREENS = { tv: { depth: 0.03 }, display: { width: 0.25, height: 0.16, depth: 0.04 } } as const
/** Thickness of the TV chassis (m) — independent of the entered panel size. */
const TV_CHASSIS_DEPTH = 0.06
/** The image takes up the WHOLE panel: it is laid 2 mm in front, there is no frame to respect. */
const ART_INSET = 1

/**
 * Material of the rings: flat color, opacity driven by the animation, and — for a device that
 * looks somewhere — an angular fade: full intensity in front (+y local, rotated by the yaw),
 * almost nothing behind. Always full circles, only the intensity varies around the ring.
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
        float front = 0.5 + 0.5 * cos(atan(vPos.x, vPos.y));          // 1 in front (+y), 0 behind
        float fade = mix(1.0, 0.1 + 0.9 * front * front, uDirectional);
        gl_FragColor = vec4(uColor, uOpacity * fade);
      }`,
  })
}

/** Small neutral object (sensor, heat pump, charger, energy…). */
/** Footprint of a soundbar (m): width × depth × height. */
const SPEAKER_BAR = { w: 0.55, d: 0.08, h: 0.07 } as const
/** Puck: short cylinder (m) — radius × height before the Z-up rotation. */
const SPEAKER_PEBBLE = { r: 0.14, h: 0.1 } as const
/** Small rectangular block (m): alarm clock / Nest Hub Mini — width × depth × height. */
const SPEAKER_BLOCK = { w: 0.14, d: 0.08, h: 0.1 } as const
/** Feeder / fountain (m): a tower a little taller than wide — not a ball. */
const PET_BOX = { w: 0.12, d: 0.12, h: 0.2 } as const

export class GenericMarker extends DeviceMarker {
  private mesh: Mesh
  /** Player that is playing: concentric rings that widen and fade, like a sound wave. */
  private waves: Mesh<RingGeometry, ShaderMaterial>[] = []
  private waving = false
  private playing = false
  /** Cover art shown on the screen (TV and smart display only). */
  private art: ScreenArt | null = null
  /**
   * Material SPECIFIC to what pulses (battery cabinet, charger while charging): it cannot share
   * that of the other neutral objects. `null` for everything else, which keeps the shared material.
   */
  private readonly pulseMat: MeshStandardMaterial | null = null
  /** Color of what the battery is doing right now, `null` if it has nothing to say (at rest). */
  private cue: Color | null = null
  /**
   * Charge gauge of the cabinet, a track + bar pair PER LARGE FACE: the overview looks at
   * the house from the south-east, and a cabinet set at `yaw` 0 would turn its only readable face away from it.
   */
  private readonly charge: { track: Mesh<PlaneGeometry, MeshBasicMaterial>; fill: Mesh<PlaneGeometry, MeshBasicMaterial> }[] = []
  constructor(device: PlacedHouseDevice, ctx: MarkerContext) {
    super(device, ctx)
    const kind = ctx.descriptor?.kind ?? device.kind
    let geometry
    // a player takes the shape of its kind: speaker (cylinder / puck / bar), TV, smart display
    const mediaClass = kind === 'media_player' ? ctx.descriptor?.meta.mediaPlayer?.deviceClass ?? 'speaker' : undefined
    const speakerShape = mediaClass === 'speaker' ? (device.speakerShape ?? 'default') : undefined
    // TV panel: JSON or default 1 × 0.56 — read once for the chassis, the pill and the cover art
    const tvSize = mediaClass === 'tv' ? coverSize(device, ctx.descriptor) : undefined
    // a heating device takes the shape of what it IS: a wall disc for a thermostat,
    // a floor block for a heat pump (absent = thermostat, the former case)
    const climateClass = kind === 'climate' ? ctx.descriptor?.meta.climate?.deviceClass ?? 'thermostat' : undefined
    let battery = false
    let pulse = false
    switch (kind) {
      case 'media_player':
        if (tvSize) {
          geometry = new BoxGeometry(tvSize.width, TV_CHASSIS_DEPTH, tvSize.height)
          // pill just above the top edge (0.24 m of air, like the former 0.8 − 0.56)
          this.setLift(tvSize.height + 0.24)
        }
        else if (mediaClass === 'display') { geometry = new BoxGeometry(0.25, 0.08, 0.16); this.setLift(0.35) }
        else if (speakerShape === 'pebble') {
          geometry = new CylinderGeometry(SPEAKER_PEBBLE.r, SPEAKER_PEBBLE.r, SPEAKER_PEBBLE.h, 24)
          this.setLift(0.28)
        }
        else if (speakerShape === 'bar') {
          geometry = new BoxGeometry(SPEAKER_BAR.w, SPEAKER_BAR.d, SPEAKER_BAR.h)
          this.setLift(0.28)
        }
        else if (speakerShape === 'block') {
          geometry = new BoxGeometry(SPEAKER_BLOCK.w, SPEAKER_BLOCK.d, SPEAKER_BLOCK.h)
          this.setLift(0.28)
        }
        else { geometry = new CylinderGeometry(0.13, 0.13, 0.32, 20); this.setLift(0.5) }
        break
      // Two objects under the same kind, as for `energy`. A THERMOSTAT is a disc against the
      // wall (12 cm), not a chest — that one squashed the landing it sits on; the cylinder keeps
      // its +y axis (lying down), its two discs are therefore vertical and the dial faces the room in
      // the direction of the `yaw`. A HEAT PUMP is the reverse: a machine standing in a utility
      // room, and drawing it as a disc made a whole installation look like a living room
      // box.
      case 'climate':
        if (climateClass === 'heat_pump') { geometry = new BoxGeometry(HEATPUMP_BOX.w, HEATPUMP_BOX.d, HEATPUMP_BOX.h); this.setLift(HEATPUMP_BOX.h / 2 + 0.25) }
        else { geometry = new CylinderGeometry(0.06, 0.06, 0.04, 28); this.setLift(0.18) }
        break
      case 'ev_charger': geometry = new BoxGeometry(0.3, 0.15, 0.8); this.setLift(0.6); pulse = true; break
      // Two objects under the same kind: the SITE of an installation is a gateway, a box the
      // size of a large junction box; a battery, for its part, is a cabinet that rises from the
      // floor. The one-meter cabinet given to both turned the solar gateway into a piece of furniture.
      case 'energy':
        if (ctx.descriptor && isEnergySite(ctx.descriptor)) { geometry = new BoxGeometry(0.28, 0.12, 0.32); this.setLift(0.3) }
        else { geometry = new BoxGeometry(BATTERY_BOX.w, BATTERY_BOX.d, BATTERY_BOX.h); this.setLift(0.7); battery = true; pulse = true }
        break
      // Water treatment station: a WALL-MOUNTED unit at the vendor's dimensions (COMAP Proteo 2,
      // 59 × 59 × 17 cm) — a flat, wide housing, much larger than a thermostat and much
      // flatter than a battery cabinet. The housing is centered on the anchor, like the charger and the
      // cabinet; the pill sits just above its top edge.
      case 'water': geometry = new BoxGeometry(WATER_BOX.w, WATER_BOX.d, WATER_BOX.h); this.setLift(WATER_BOX.h / 2 + 0.2); break
      case 'vacuum': geometry = new CylinderGeometry(0.18, 0.18, 0.09, 24); this.setLift(0.25); break
      // Feeder and fountain: towers on the floor, a little taller than wide — the fallback sphere
      // (`default`) made them look like sensors.
      case 'pet_feeder':
      case 'pet_fountain':
        geometry = new BoxGeometry(PET_BOX.w, PET_BOX.d, PET_BOX.h)
        this.setLift(PET_BOX.h / 2 + 0.2)
        break
      default: geometry = new SphereGeometry(0.1, 16, 12); this.setLift(0.3)
    }
    if (pulse) this.pulseMat = devMaterial(ctx).clone()
    this.mesh = new Mesh(geometry, this.pulseMat ?? devMaterial(ctx))
    // Speaker, robot: an UPRIGHT cylinder, so the cylinder's Y axis becomes local Z-up. The thermostat,
    // for its part, is a disc lying against its wall: it keeps the cylinder axis horizontal.
    if (geometry instanceof CylinderGeometry && kind !== 'climate') this.mesh.rotation.x = Math.PI / 2
    if (kind === 'media_player') {
      this.mesh.position.z = tvSize ? tvSize.height / 2
        : mediaClass === 'display' ? 0.08
        : speakerShape === 'bar' ? SPEAKER_BAR.h / 2
        : speakerShape === 'block' ? SPEAKER_BLOCK.h / 2
        : speakerShape === 'pebble' ? SPEAKER_PEBBLE.h / 2
        : 0.16
    }
    // what looks somewhere, and what sits against a wall, follow their `yaw` (0 = facing
    // +y): a screen, a soundbar, a clock block, but also a charger, a battery…
    // A speaker cylinder / puck does not need it.
    if (mediaClass === 'tv' || mediaClass === 'display' || speakerShape === 'bar' || speakerShape === 'block' || kind === 'ev_charger' || kind === 'energy' || kind === 'climate' || kind === 'water') {
      this.mesh.rotation.z = yawToRad(device.yaw)
    }
    // what the screen is showing can be seen ON the screen: the track's cover art (or the app logo), laid
    // in front of the front face and a child of the mesh, hence rotated by the same `yaw` as it
    if (mediaClass === 'tv' || mediaClass === 'display') {
      const screen = tvSize
        ? { width: tvSize.width, height: tvSize.height, depth: SCREENS.tv.depth }
        : SCREENS.display
      this.art = new ScreenArt({
        width: screen.width * ART_INSET,
        height: screen.height * ART_INSET,
        offsetY: screen.depth + 0.002,
        onReady: () => ctx.invalidate(),
        ...(ctx.loadTexture ? { load: ctx.loadTexture } : {}),
      })
      this.mesh.add(this.asDecor(this.art.mesh))
    }
    if (battery) this.buildCharge(ctx)
    if (kind === 'vacuum') this.mesh.position.z = 0.05
    if (kind === 'pet_feeder' || kind === 'pet_fountain') this.mesh.position.z = PET_BOX.h / 2
    this.mesh.castShadow = true
    this.registerPickable(this.mesh)
    this.object.add(this.mesh)
    if (kind === 'media_player') {
      // flat rings (the XY plane is the ground in Z-up), a little above the base of the device;
      // invisible as long as nothing plays, animated by `onState`
      const directional = mediaClass === 'tv' || mediaClass === 'display'
      for (let i = 0; i < WAVE_RINGS; i++) {
        const ring = this.asDecor(new Mesh(new RingGeometry(0.86, 1, 64), waveMaterial(ctx.theme.media, directional)))
        ring.position.z = 0.03
        ring.rotation.z = yawToRad(device.yaw)                 // the "front" of the wave follows the screen
        ring.visible = false
        this.waves.push(ring)
        this.object.add(ring)
      }
    }
  }
  /**
   * Charge bar along the two large faces of the cabinet, in the language of a module's
   * gauge: a barely visible track, and a solid bar rising from the BOTTOM. Children of the
   * cabinet, hence rotated by its `yaw` with it.
   */
  private buildCharge(ctx: MarkerContext): void {
    const h = BATTERY_BOX.h * BATTERY_GAUGE.h
    const x = -(BATTERY_BOX.w / 2 - BATTERY_GAUGE.inset - BATTERY_GAUGE.w / 2)
    for (const side of [1, -1]) {
      // Upright AGAINST the face: the plane's normal points out of the cabinet (±y local) and its top is the top
      // of the cabinet (+z). The half turn of the front face sets its vertical axis back the right way.
      const face = (opacity: number) => {
        // `MeshBasicMaterial`: a charge being read does not go out with the scene's light;
        // without `depthWrite`, the bar does not dig into the sheet metal it sits on.
        const m = new Mesh(
          new PlaneGeometry(BATTERY_GAUGE.w, h),
          new MeshBasicMaterial({ color: ctx.theme.primary, transparent: true, opacity, depthWrite: false }),
        )
        m.rotation.set((side * -Math.PI) / 2, 0, side > 0 ? Math.PI : 0)
        m.position.set(x, side * (BATTERY_BOX.d / 2 + 0.003), 0)
        m.renderOrder = 1
        this.mesh.add(this.asDecor(m))
        return m
      }
      this.charge.push({ track: face(0.16), fill: face(0.95) })
    }
  }
  /**
   * Raises the bar to the cabinet's charge. The HEIGHT says what is left inside, the breath says what
   * it is doing: two languages that do not step on each other, hence a bar in the
   * accent and not in the state color. `batterySoc` absent = the cabinet does not tell its charge, and
   * the gauge disappears ENTIRELY — an empty track would read as a flat battery.
   *
   * A cabinet that no longer responds keeps its last level: a charge does not evaporate with the
   * link, and the red breath already says the figure is frozen.
   */
  private setCharge(state: DeviceState | undefined): void {
    const soc = state?.kind === 'energy' ? state.batterySoc : undefined
    const k = Math.min(1, Math.max(0, (soc ?? 0) / 100))
    const h = BATTERY_BOX.h * BATTERY_GAUGE.h
    for (const { track, fill } of this.charge) {
      track.visible = soc !== undefined
      fill.visible = soc !== undefined && k > 0.004
      track.material.color.copy(this.ctx.theme.primary)
      fill.material.color.copy(this.ctx.theme.primary)
      fill.scale.y = Math.max(0.001, k)
      fill.position.z = -(h / 2) * (1 - k)
    }
  }
  protected isOn(s: DeviceState): boolean {
    switch (s.kind) {
      case 'media_player': return isMediaActive(s)                  // an app on screen shows an image: the wave too
      case 'climate': return s.mode !== 'off'
      case 'vacuum': return s.activity === 'cleaning'
      case 'ev_charger': return s.status === 'charging'
      // a battery is active when it MOVES energy (it never produces anything, and its
      // pill would have stayed off in the middle of charging); the site, for its part, when it produces
      case 'energy': return this.pulseMat ? Math.abs(s.batteryW ?? 0) >= IDLE_W : s.productionW > 0
      default: return false
    }
  }
  protected onState(state: DeviceState | undefined): void {
    // the screen shows what is playing as long as the device responds; it goes bare again if it no longer responds,
    // if nothing is playing, or if the track has no image (the state then carries no `artUrl`)
    if (this.art) {
      const media = state?.kind === 'media_player' && state.available ? state : undefined
      this.art.set(media?.nowPlaying?.artUrl)
    }
    if (this.pulseMat) { this.pulse(state); this.setCharge(state) }
    if (this.waves.length === 0) return
    // the wave is SOUND: it follows what the scene says is heard here (`SoundCue`) — a TV whose sound
    // goes over HDMI to a soundbar keeps the image, the bar takes the wave; without a cue, the state alone
    this.playing = this.sound ? this.sound.emits : !!state && state.available && this.isOn(state)
    for (const w of this.waves) (w.material.uniforms.uColor!.value as Color).copy(this.ctx.theme.media)
    if (this.playing && !this.waving) {
      this.waving = true
      let t0 = -1
      this.stopAnimation = this.ctx.addAnimation({
        step: (now) => {
          if (!this.playing) {                                  // playback ended: put the rings away and hand back control
            for (const w of this.waves) { w.visible = false; w.material.uniforms.uOpacity!.value = 0 }
            this.waving = false
            return false
          }
          if (t0 < 0) t0 = now
          this.waves.forEach((w, i) => {
            const p = (((now - t0) / WAVE_PERIOD_MS) + i / WAVE_RINGS) % 1   // phase 0 → 1, rings offset by a third
            const r = WAVE_R0 + (WAVE_R1 - WAVE_R0) * p
            w.scale.set(r, r, 1)
            w.material.uniforms.uOpacity!.value = 0.85 * (1 - p)            // linear fade: still visible when the ring is wide
            w.visible = true
          })
          return true
        },
      })
    }
  }
  /**
   * What a cabinet must say, and nothing more. Battery: GREEN when it is filling, BLUE when
   * it gives back what it holds, RED when it no longer responds (the only failure the contract carries —
   * an `energy` has no fault field, and a silent battery keeps its last values,
   * frozen). Charger: GREEN only while charging — plugged in at rest, it does not pulse. `null` at
   * rest: below the meters' threshold, an idle battery has nothing to report.
   */
  private pulseCue(state: DeviceState | undefined): Color | null {
    if (!state) return null
    if (state.kind === 'ev_charger') return state.status === 'charging' ? this.ctx.theme.success : null
    if (state.kind !== 'energy') return null
    if (!state.available) return this.ctx.theme.error
    const w = state.batteryW ?? 0
    if (w >= IDLE_W) return this.ctx.theme.success
    if (w <= -IDLE_W) return this.ctx.theme.info
    return null
  }
  /**
   * Breath of the cabinet: its tint leans toward the color of what it is doing, and its emissive rises and
   * falls in a cosine — no break, neither at the trough nor at the crest. At rest it goes out
   * cleanly and hands control back to the loop: the scene only renders on demand, a cabinet that
   * does nothing must not wake up the render.
   */
  private pulse(state: DeviceState | undefined): void {
    const mat = this.pulseMat
    if (!mat) return
    this.cue = this.pulseCue(state)
    const base = this.ctx.materials.device.color
    if (!this.cue) {
      this.stopAnimation?.()
      this.stopAnimation = null
      mat.color.copy(base)
      mat.emissive.setRGB(0, 0, 0)
      mat.emissiveIntensity = 0
      this.ctx.invalidate()
      return
    }
    mat.color.copy(base).lerp(this.cue, BATTERY_TINT)
    mat.emissive.copy(this.cue)
    if (this.stopAnimation) return                        // already breathing: only the color changed
    let t0 = -1
    // the marker has only one animation slot, and a cabinet has no sound wave: the two never
    // meet
    this.stopAnimation = this.ctx.addAnimation({
      step: (now) => {
        if (!this.cue) return false
        if (t0 < 0) t0 = now
        const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * (now - t0)) / BATTERY_PULSE_MS)
        mat.emissiveIntensity = BATTERY_GLOW.min + (BATTERY_GLOW.max - BATTERY_GLOW.min) * k
        return true
      },
    })
  }
  override dispose(): void {
    this.mesh.geometry.dispose()
    this.pulseMat?.dispose()
    for (const { track, fill } of this.charge) { track.geometry.dispose(); track.material.dispose(); fill.geometry.dispose(); fill.material.dispose() }
    this.art?.dispose()
    for (const w of this.waves) { w.geometry.dispose(); w.material.dispose() }
    super.dispose()
  }
}

/** Glass of a module at rest: midnight blue, almost black. */
const PANEL_DARK = 0x1c2740
/** Edge gauge of a module: width (m), share of the height, and inset from the edge of the glass. */
const GAUGE_W = 0.045
const GAUGE_H = 0.88
const GAUGE_INSET = 0.05
/** Marker set across the gauge: it overhangs a little, to show against the glass. */
const MARK_W = GAUGE_W * 2
const MARK_H = 0.025

/**
 * Photovoltaic module of a panel array: a slab with the module's dimensions, lying down, tilted and
 * oriented like its array, which leans toward the accent as it produces. The kind stays `sensor`
 * (a power in W), it is `meta.panel` that says this sensor is a module laid on a roof.
 */
export class PanelMarker extends DeviceMarker {
  private readonly mesh: Mesh
  private readonly mat: MeshStandardMaterial
  /**
   * Edge gauge: a 4.5 cm bar along the side of the module, which rises with production. The
   * whole glass already tells the level by its tint — readable at any distance, but two neighboring
   * modules at 60 % and 75 % look alike; the bar, for its part, compares to the millimeter. Discreet: on
   * one side, not in the middle, and invisible when the module is not producing.
   */
  private readonly gauge: Mesh<PlaneGeometry, MeshBasicMaterial>
  private readonly track: Mesh<PlaneGeometry, MeshBasicMaterial>
  /**
   * The gauge's two markers, ALWAYS visible whether it reaches them or not: `output` = the
   * inverter's max output power (its datasheet, declared on the array), `record` = its
   * highest value ever reported. Same colors as in the Energy view, and the ceiling passes
   * IN FRONT OF the record when the two coincide.
   */
  private readonly marks: { output: Mesh<PlaneGeometry, MeshBasicMaterial>; record: Mesh<PlaneGeometry, MeshBasicMaterial> }
  /** Height of the full bar (m): what anchors it to the bottom edge when it goes back down. */
  private readonly gaugeH: number
  /** Peak power of the module of THIS array: it is what says what "full" means here. */
  private readonly peakW: number
  /** Inverter output power (0 = unknown): the gauge's second marker. */
  private readonly maxOutputW: number
  constructor(device: PlacedHouseDevice, ctx: MarkerContext, panel: PanelPlacement) {
    super(device, ctx)
    this.peakW = panel.peakW
    this.maxOutputW = panel.maxOutputW
    this.mat = new MeshStandardMaterial({ color: PANEL_DARK, roughness: 0.35, metalness: 0.4 })
    this.mesh = new Mesh(new BoxGeometry(panel.width, panel.height, 0.04), this.mat)
    // first the tilt around the column axis (local x), then the array's orientation (z).
    // The sign: rotating around +x tilts the normal toward −y, yet the glass faces +y (the array's
    // azimuth, the one set to the south) — hence the minus.
    this.mesh.rotation.order = 'ZXY'
    this.mesh.rotation.x = -(panel.tilt * Math.PI) / 180
    this.mesh.rotation.z = yawToRad(device.yaw)
    this.mesh.position.z = 0.03
    this.mesh.castShadow = true
    this.registerPickable(this.mesh)
    this.object.add(this.mesh)
    // CHILDREN of the slab: the bar automatically follows its tilt and the array's azimuth, and the
    // local frame has its bottom edge at +y (where the glass leans, toward the sun).
    this.gaugeH = panel.height * GAUGE_H
    const geo = () => new PlaneGeometry(GAUGE_W, this.gaugeH)
    const x = -(panel.width / 2 - GAUGE_INSET - GAUGE_W / 2)
    // `MeshBasicMaterial`: a measurement being read does not go out with the scene's light.
    // Without `depthWrite`, the bar does not dig into the glass it sits on.
    this.track = new Mesh(geo(), new MeshBasicMaterial({ color: ctx.theme.primary, transparent: true, opacity: 0.16, depthWrite: false }))
    this.gauge = new Mesh(geo(), new MeshBasicMaterial({ color: ctx.theme.primary, transparent: true, opacity: 0.95, depthWrite: false }))
    for (const m of [this.track, this.gauge]) { m.position.set(x, 0, 0.021); m.renderOrder = 1; this.mesh.add(this.asDecor(m)) }
    const mark = (color: Color, order: number) => {
      const m = new Mesh(new PlaneGeometry(MARK_W, MARK_H), new MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }))
      m.position.set(x, 0, 0.022)
      m.renderOrder = order
      m.visible = false
      this.mesh.add(this.asDecor(m))
      return m
    }
    this.marks = { record: mark(ctx.theme.success, 2), output: mark(ctx.theme.warning, 3) }
    this.setGauge(0)
    this.setLift(0.35)
  }

  /** Raises the bar to `k` (0 → 1) from the BOTTOM edge of the module, the one that leans toward the azimuth. */
  private setGauge(k: number): void {
    this.gauge.visible = k > 0.004
    this.gauge.scale.y = Math.max(0.001, k)
    this.gauge.position.y = (this.gaugeH / 2) * (1 - k)
  }

  /** Sets a marker at `watts` on the gauge, at the given scale; nothing to show if it is not known. */
  private setMark(which: 'output' | 'record', watts: number, scaleW: number): void {
    const m = this.marks[which]
    m.visible = watts > 0
    if (m.visible) m.position.y = (this.gaugeH / 2) * (1 - 2 * Math.min(1, watts / scaleW))
  }
  protected isOn(s: DeviceState): boolean { return s.kind === 'sensor' && s.value > 0 }
  protected onState(state: DeviceState | undefined): void {
    const watts = state?.kind === 'sensor' && state.available ? state.value : 0
    // The WHOLE GLASS carries the measurement — it leans toward the accent and lights up as the module
    // approaches the peak declared by its array —, and the edge bar puts a figure on it: filling the
    // glass as a gauge had been tried, but a module cut in two is no longer a module.
    // The scale holds the three values at play: the glass's peak, what the inverter can output
    // and its record. Without that, a marker higher than the module's peak got lost outside the bar.
    const record = state?.kind === 'sensor' ? state.maxValue ?? 0 : 0
    const scaleW = Math.max(this.peakW, this.maxOutputW, record)
    const k = Math.min(1, Math.max(0, watts / scaleW))
    this.mat.color.setHex(PANEL_DARK).lerp(this.ctx.theme.primary, k * 0.7)
    this.mat.emissive.copy(this.ctx.theme.primary).multiplyScalar(k * 0.3)
    this.track.material.color.copy(this.ctx.theme.primary)
    this.gauge.material.color.copy(this.ctx.theme.primary)
    this.marks.record.material.color.copy(this.ctx.theme.success)
    this.marks.output.material.color.copy(this.ctx.theme.warning)
    this.setGauge(k)
    this.setMark('output', this.maxOutputW, scaleW)
    // the record survives unavailability: it does not describe the instant, and the night does not erase it
    this.setMark('record', record, scaleW)
  }
  override dispose(): void {
    for (const m of [this.track, this.gauge, this.marks.record, this.marks.output]) { m.geometry.dispose(); m.material.dispose() }
    this.mesh.geometry.dispose(); this.mat.dispose(); super.dispose()
  }
}

/** Lamp: emissive sphere + PointLight; intensity according to brightness, color according to state. */
/**
 * Halo of a lit lamp: an additive radial gradient, turned toward the camera. It is what gives
 * the maquette its "bloom" without post-processing — a blur pass on a transparent canvas
 * would cost a lot on a tablet and would go badly with the DOM pills. Shared, procedural texture
 * (no `<canvas>`: it also builds in Node for the tests).
 */
const GLOW_SIZE = 48
let glowTexture: DataTexture | null = null
function glowMap(): DataTexture {
  if (glowTexture) return glowTexture
  const data = new Uint8Array(GLOW_SIZE * GLOW_SIZE * 4)
  const c = (GLOW_SIZE - 1) / 2
  for (let y = 0; y < GLOW_SIZE; y++) for (let x = 0; x < GLOW_SIZE; x++) {
    const d = Math.min(1, Math.hypot(x - c, y - c) / c)
    const a = Math.pow(1 - d, 2.2)          // sharp core, fading edge
    const i = (y * GLOW_SIZE + x) * 4
    data[i] = data[i + 1] = data[i + 2] = 255
    data[i + 3] = Math.round(a * 255)
  }
  glowTexture = new DataTexture(data, GLOW_SIZE, GLOW_SIZE)
  glowTexture.needsUpdate = true
  return glowTexture
}
/** Range (m) of a lamp. Also serves as the `far` of a garden lamp's shadow cone. */
const LIGHT_RANGE = 7
/**
 * The floor SPOT of a ceiling light: radius (m), opacity relative to the style's halo, and height above
 * the floor (under the selected room's veil, laid at 8 mm).
 */
const POOL = { radius: 1.3, opacity: 0.55, lift: 0.004 }

/** Ceiling fan (m): vertical hub + 3 blades + glowing globe — same orders of magnitude as the sphere. */
const CEILING_FAN = {
  hubR: 0.045, hubH: 0.11,
  globeR: 0.075,
  bladeL: 0.34, bladeW: 0.075, bladeT: 0.012,
  bladeZ: -0.04,
}
/**
 * Blade turns per second, from the lowest speed to the highest. A real ceiling fan goes up to
 * 3 rev/s, but the loop animates at 20 Hz and three blades look alike every 120°: beyond 1 rev/s
 * (18° per frame), the eye starts to see the wagon wheel turning backward.
 */
const FAN_TURNS_S = [0.3, 1] as const
/** Speeds assumed when the descriptor declares none — those of the CREATE (remote 1 to 6). */
const FAN_DEFAULT_SPEEDS = [1, 2, 3, 4, 5, 6]

/**
 * Airflow under the ceiling fan, in the language of a player's sound wave: flat rings that
 * are born and fade. `forward` direction (summer): they leave the blades and GO DOWN while widening,
 * in blue — the air is pushed down, it cools. `reverse` direction (winter): they GO UP toward the
 * blades while narrowing, in red — the air is drawn up, it brings back down along the walls the heat
 * accumulated at the ceiling. Discreet: it is a state, not an alert.
 */
const AIRFLOW = {
  rings: 3,
  /** Height (m) of the air column, from the plane of the blades. */
  length: 1.3,
  top: -0.08,
  /** Radius (m) of the ring at the plane of the blades and at the bottom of the column. */
  rTop: 0.32, rBottom: 0.85,
  /** Period of a ring (s), from the lowest speed to the highest. */
  periodS: [4.5, 1.8] as const,
  /** Opacity of a ring at its strongest, from the lowest speed to the highest. */
  opacity: [0.22, 0.4] as const,
  cool: new Color(0x4da3ff),
  warm: new Color(0xff6a3d),
}

/** Rank of `speed` among the fan's speeds, from 0 (the slowest) to 1 (the fastest). */
export function fanSpeedFraction(speed: number | undefined, speeds: readonly number[] = FAN_DEFAULT_SPEEDS): number {
  const min = Math.min(...speeds), max = Math.max(...speeds)
  if (speed === undefined) return 0.5
  if (max <= min) return 1
  return Math.min(1, Math.max(0, (speed - min) / (max - min)))
}

class FanAirflow {
  readonly object = new Group()
  private readonly rings: Mesh<RingGeometry, ShaderMaterial>[] = []
  private readonly geometry = new RingGeometry(0.93, 1, 64)
  /** Progress of the first ring along the column (0 → 1); the others follow, offset. */
  private phase = 0
  private down = true
  private rate = 1 / AIRFLOW.periodS[0]
  private peak: number = AIRFLOW.opacity[0]

  constructor() {
    this.object.name = 'ceiling-fan-airflow'
    this.object.visible = false
    for (let i = 0; i < AIRFLOW.rings; i++) {
      const ring = new Mesh(this.geometry, waveMaterial(AIRFLOW.cool, false))
      this.rings.push(ring)
      this.object.add(ring)
    }
  }

  /** `k`: rank of the speed (0 → 1). */
  set(forward: boolean, k: number): void {
    this.down = forward
    this.rate = 1 / lerp(AIRFLOW.periodS[0], AIRFLOW.periodS[1], k)
    this.peak = lerp(AIRFLOW.opacity[0], AIRFLOW.opacity[1], k)
    for (const r of this.rings) (r.material.uniforms.uColor!.value as Color).copy(forward ? AIRFLOW.cool : AIRFLOW.warm)
    this.step(0)
  }

  step(dtS: number): void {
    // the phase ADVANCES at the current rate: changing speed does not have to make the rings jump
    this.phase = (this.phase + Math.min(0.1, Math.max(0, dtS)) * this.rate) % 1
    this.rings.forEach((ring, i) => {
      const p = (this.phase + i / AIRFLOW.rings) % 1
      const depth = this.down ? p : 1 - p          // 0 at the plane of the blades, 1 at the bottom of the column
      const r = lerp(AIRFLOW.rTop, AIRFLOW.rBottom, depth)
      ring.scale.set(r, r, 1)
      ring.position.z = AIRFLOW.top - depth * AIRFLOW.length
      // is born and goes out smoothly: no ring appears or disappears all at once
      ring.material.uniforms.uOpacity!.value = this.peak * Math.sin(Math.PI * p)
    })
  }

  dispose(): void {
    this.geometry.dispose()
    for (const r of this.rings) r.material.dispose()
  }
}

export class LightMarker extends DeviceMarker {
  private readonly mat: MeshStandardMaterial
  private readonly bladeMat: MeshStandardMaterial | null
  private readonly body: Mesh | Group
  /** Group of the blades (null outside a ceiling fan): it is what turns around Z. */
  private readonly blades: Group | null
  /** Airflow under the blades (null outside a ceiling fan), visible as long as the fan turns. */
  private readonly airflow: FanAirflow | null
  /** Signed speed of the blades (rad/s); 0 = stopped. */
  private spinRadS = 0
  private readonly geometries: BufferGeometry[] = []
  private readonly light: PointLight
  private readonly glow: Sprite
  private readonly glowMat: SpriteMaterial
  /** Spot of light on the floor under a ceiling light (null otherwise). */
  private readonly pool: Mesh<PlaneGeometry, MeshBasicMaterial> | null
  constructor(device: PlacedHouseDevice, ctx: MarkerContext) {
    super(device, ctx)
    this.mat = new MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffc46b, emissiveIntensity: 0, roughness: 0.4 })
    if (ctx.linkedFan) {
      this.bladeMat = new MeshStandardMaterial({ color: 0x5c6573, metalness: 0.3, roughness: 0.5 })
      const built = this.buildCeilingFan()
      this.body = built.root
      this.blades = built.blades
      this.airflow = new FanAirflow()
      this.airflow.object.traverse((o) => this.asDecor(o))
      this.object.add(this.airflow.object)
    } else {
      this.bladeMat = null
      this.blades = null
      this.airflow = null
      const geo = new SphereGeometry(0.13, 20, 14)
      this.geometries.push(geo)
      this.body = new Mesh(geo, this.mat)
    }
    this.light = new PointLight(0xffd9a0, 0, LIGHT_RANGE, 1.6)
    if (ctx.outdoor) {
      // A GARDEN lamp must light the facade without going through the wall. No layer knows how
      // to do that: the only thing that really stops light is a SHADOW. Six 512 px faces,
      // and only as long as the lamp is on (`onState`) — that is what makes the expense sustainable.
      this.light.shadow.mapSize.set(512, 512)
      this.light.shadow.bias = -0.004
      this.light.shadow.normalBias = 0.04
      this.light.shadow.camera.near = 0.15
      this.light.shadow.camera.far = LIGHT_RANGE + 1
    }
    // an INDOOR lamp only lights its level: the shader confines it there (`core/levelLight.ts`)
    this.glowMat = new SpriteMaterial({ map: glowMap(), color: 0xffd9a0, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false })
    this.glow = new Sprite(this.glowMat)
    this.asDecor(this.glow)
    this.glow.visible = false
    this.object.add(this.body, this.light, this.glow)
    // A ceiling light LAYS its light on the floor: the `PointLight` lights everything around it, walls and
    // ceiling included, and does not draw the pool of light one sees under a pendant. An additive disc
    // draws it without adding light — their number must stay constant (`HouseScene.padLamps`).
    this.pool = null
    if (!ctx.outdoor && device.mount === 'ceiling') {
      const geo = new PlaneGeometry(POOL.radius * 2, POOL.radius * 2)
      this.geometries.push(geo)
      const pool = new Mesh(geo, new MeshBasicMaterial({ map: glowMap(), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }))
      pool.name = 'lamp-pool'
      pool.visible = false
      // the level's floor is at z = 0: the spot follows the lamp's height, even during a move
      pool.onBeforeRender = () => {
        pool.position.z = POOL.lift - this.object.position.z
        pool.updateMatrixWorld()
      }
      this.asDecor(pool)
      this.object.add(pool)
      this.pool = pool
    }
    this.body.traverse((o) => { if ((o as Mesh).isMesh) this.registerPickable(o) })
    this.setLift(0.3)
  }

  /**
   * Cylindrical hub (Z axis, house Z-up) + three blades + emissive globe under the hub.
   * The globe reuses the lamp's material: color / temperature apply to it.
   */
  private buildCeilingFan(): { root: Group; blades: Group } {
    const root = new Group()
    root.name = 'ceiling-fan'
    const { hubR, hubH, globeR, bladeL, bladeW, bladeT, bladeZ } = CEILING_FAN

    const hubGeo = new CylinderGeometry(hubR, hubR * 0.9, hubH, 16)
    this.geometries.push(hubGeo)
    const hub = new Mesh(hubGeo, this.mat)
    hub.rotation.x = Math.PI / 2
    hub.position.z = -hubH / 2

    const globeGeo = new SphereGeometry(globeR, 16, 12)
    this.geometries.push(globeGeo)
    const globe = new Mesh(globeGeo, this.mat)
    globe.position.z = -hubH - globeR * 0.55

    const blades = new Group()
    blades.name = 'ceiling-fan-blades'
    const bladeGeo = new BoxGeometry(bladeL, bladeW, bladeT)
    this.geometries.push(bladeGeo)
    for (let i = 0; i < 3; i++) {
      const arm = new Group()
      arm.rotation.z = (i * Math.PI * 2) / 3
      const blade = new Mesh(bladeGeo, this.bladeMat!)
      blade.position.set(hubR + bladeL / 2 + 0.015, 0, bladeZ)
      blade.rotation.x = 0.1
      arm.add(blade)
      blades.add(arm)
    }
    root.add(hub, globe, blades)
    return { root, blades }
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
    // Everything a lit lamp does — the glow of the globe, the range, the halo — comes from the STYLE, which
    // gets it from the hour: the same lamp blazes at night and can barely be made out in broad daylight.
    const g = this.ctx.glow
    this.mat.emissive.copy(c)
    this.mat.emissiveIntensity = k * g.emissive
    this.light.color.copy(c)
    // the light only reaches the surfaces of ITS level: see `core/levelLight.ts`
    this.light.intensity = k * g.lightIntensity
    // A lamp that is off has no business costing six depth renders.
    this.light.castShadow = !!this.ctx.outdoor && k > 0
    this.glowMat.color.copy(c)
    this.glowMat.opacity = k * g.opacity
    this.glow.scale.setScalar(g.scale)
    this.glow.visible = k > 0
    if (this.pool) {
      this.pool.material.color.copy(c)
      this.pool.material.opacity = k * g.opacity * POOL.opacity
      this.pool.visible = k > 0
    }
  }

  override setCompanionFan(state: DeviceState | undefined): void {
    if (!this.blades || !this.airflow) return
    const on = !!state && state.kind === 'fan' && state.available && state.on
    const wasOn = this.spinRadS !== 0
    if (!on) {
      if (!wasOn) return
      this.spinRadS = 0
      this.airflow.object.visible = false
      this.stopAnimation?.()
      this.stopAnimation = null
      this.ctx.invalidate()
      return
    }
    const k = fanSpeedFraction(state.speed, this.ctx.linkedFanSpeeds)
    const forward = state.direction !== 'reverse'
    // `forward` = summer: seen from BELOW the blades turn counterclockwise and push
    // the air down. The camera looks from above, where this direction reads clockwise: negative Z.
    this.spinRadS = (forward ? -1 : 1) * Math.PI * 2 * lerp(FAN_TURNS_S[0], FAN_TURNS_S[1], k)
    this.airflow.set(forward, k)
    this.airflow.object.visible = true
    if (wasOn) return
    // Decorative animation (20 Hz via the loop): blades and airflow as long as the fan turns.
    this.stopAnimation = this.ctx.addAnimation({
      step: (_now, dtS) => {
        if (this.spinRadS === 0 || !this.blades || !this.airflow) return false
        this.blades.rotation.z += this.spinRadS * dtS
        this.airflow.step(dtS)
        return true
      },
    })
  }

  override dispose(): void {
    for (const geo of this.geometries) geo.dispose()
    this.mat.dispose()
    this.bladeMat?.dispose()
    this.airflow?.dispose()
    this.glowMat.dispose()
    this.pool?.material.dispose()
    super.dispose()
  }
}

/** Thickness (m) of the panel of a free cover: it is not adjustable, a gate is seen face on. */
const COVER_THICKNESS = 0.06
/** Share of the opening's width taken by the curtain: it slides INSIDE the reveal, not over it. */
const SLAT_INSET = 0.98
/** Gap (m) between two leaves of a curtain — the same line as between the leaves of a door. */
const SLAT_GAP = 0.02

/**
 * The material of a cover panel: the scene's as long as nothing is requested (it follows the
 * theme), the survey's tinted variant otherwise. Same mechanism as an opening's joinery, hence
 * the same cache: ten white shutters share one material, and changing style catches them all.
 */
function coverPanelMaterial(device: PlacedHouseDevice, ctx: MarkerContext, fallback: MeshStandardMaterial): MeshStandardMaterial {
  if (!device.coverMaterial && !device.coverColor) return fallback
  return joineryMaterial(ctx.materials, 'slat', device.coverMaterial, device.coverColor)
}
/** Projection (m) that stays visible of a retracted awning: its cassette and the canvas rolled inside. */
const AWNING_ROLLED = 0.3
/** Quarter turn: the opening of a wide-open gate leaf. */
const LEAF_SWING = Math.PI / 2

/** What is drawn for a FREE cover, and what the closed share animates. */
type FreeCover =
  /** Awning: a horizontal slab whose PROJECTION follows the deployment, wall-side edge fixed. */
  | { kind: 'flat'; box: Mesh; depth: number }
  /** Gate: one or two leaves that pivot on their hinge, from flat to a quarter turn. */
  | { kind: 'leaves'; hinges: Group[] }

/**
 * Shutter: slat fitted into the reveal, height = closed share, tweened.
 *
 * Without a linked opening, the cover is a FREE object (gate, awning): the JSON alone
 * sizes it (`size`) and orients it (`yaw`), and it is the same closed share that animates it — an awning
 * retracts its projection, a gate opens its leaves.
 */

export class CoverMarker extends DeviceMarker {
  /** The leaves of the curtain, from left to right: only one for a roller shutter, two for a hinged one. */
  private slats: Mesh[] = []
  private free: FreeCover | null = null
  /** Everything that carries the cover's tint — curtain, awning slab, gate leaves. */
  private panels: Mesh[] = []
  private mat: MeshStandardMaterial
  /** The material is ours ONLY if the color preview detached it; otherwise the scene shares it. */
  private ownsMat = false
  /** The tint from before the preview, kept on the first touch-up to restore it if the choice is abandoned. */
  private paintBase: Color | null = null
  private geometries: BufferGeometry[] = []
  private closedFraction = 0
  private cancelTween: (() => void) | null = null
  /**
   * First position received? It is SET, not played. A marker is born open (the slat is
   * raised to 0) and every write to the house rebuilds the markers: without this safeguard, each
   * saved placement made every closed shutter of the house reopen then close again — it could be
   * seen every time a panel array was dropped. A REAL travel, for its part, is animated as before.
   */
  private posed = false

  constructor(device: PlacedHouseDevice, ctx: MarkerContext) {
    super(device, ctx)
    const o = ctx.opening
    this.mat = coverPanelMaterial(device, ctx, o ? ctx.materials.slat : devMaterial(ctx))
    // a GLASS panel casts no solid shadow, no more than the glazing of an opening
    const shadowing = device.coverMaterial !== 'glass'
    if (o) {
      // The curtain in ONE OR TWO LEAVES (`leaves`): a roller shutter comes down in one piece, a
      // hinged one reads by its mullion. That is the only thing the leaves do here — the travel
      // stays vertical, it is what the state publishes.
      const count = coverLeaves(device, ctx.descriptor)
      const inner = o.width * SLAT_INSET
      const gap = count > 1 ? SLAT_GAP : 0
      const leafWidth = (inner - gap * (count - 1)) / count
      const angle = Math.atan2(o.u[1], o.u[0])
      for (let i = 0; i < count; i += 1) {
        // abscissa of the leaf center along the wall, from the edge of the opening
        const t = (o.width - inner) / 2 + i * (leafWidth + gap) + leafWidth / 2
        const slat = new Mesh(new BoxGeometry(leafWidth, Math.max(0.03, o.depth * 0.25), 1), this.mat)
        slat.rotation.z = angle
        slat.castShadow = shadowing
        this.object.add(slat)
        slat.position.set(
          o.origin[0] + o.u[0] * t + o.normal[0] * o.depth * 0.8 - device.position[0],
          o.origin[1] + o.u[1] * t + o.normal[1] * o.depth * 0.8 - device.position[1],
          0,
        )
        this.registerPickable(slat)
        this.geometries.push(slat.geometry)
        this.slats.push(slat)
      }
      this.panels = [...this.slats]
      this.applyFraction(0)
      this.setLift(o.origin[2] + o.height - device.position[2] + 0.2)
    } else {
      // FREE cover: no opening sizes or orients it, so the JSON does it
      // — `size` meters, rotated by the `yaw`, centered on the point placed in the scene. Everything is mounted
      // in a pivot that carries the `yaw`: what moves next (projection, leaves) is computed in
      // a frame where the cover always faces +y.
      const { width, height } = coverSize(device, ctx.descriptor)
      const pivot = new Group()
      pivot.rotation.z = yawToRad(device.yaw)
      this.object.add(pivot)
      if (isFlatCover(ctx.descriptor)) {
        // Awning: a HORIZONTAL slab (its thickness is vertical — a panel standing in its
        // place looked like nothing), which projects from the wall. `height` is its projection.
        const box = new Mesh(new BoxGeometry(width, height, COVER_THICKNESS), this.mat)
        box.castShadow = shadowing
        pivot.add(box)
        this.geometries.push(box.geometry)
        this.panels.push(box)
        this.registerPickable(box)
        this.free = { kind: 'flat', box, depth: height }
        this.setLift(COVER_THICKNESS / 2 + 0.15)
      } else {
        // Gate, garage door: an UPRIGHT panel across the passage, in one or two leaves.
        // Each leaf hangs from a hinge set at the outer edge and opens forward (+y).
        const hinges: Group[] = []
        const count = coverLeaves(device, ctx.descriptor)
        const leafWidth = width / count
        for (let i = 0; i < count; i += 1) {
          const side = i === 0 ? -1 : 1
          const hinge = new Group()
          hinge.position.x = (side * width) / 2
          const leaf = new Mesh(new BoxGeometry(leafWidth, COVER_THICKNESS, height), this.mat)
          leaf.position.x = (-side * leafWidth) / 2      // the leaf goes from its hinge toward the middle
          leaf.castShadow = shadowing
          hinge.add(leaf)
          pivot.add(hinge)
          hinges.push(hinge)
          this.geometries.push(leaf.geometry)
          this.panels.push(leaf)
          this.registerPickable(leaf)
        }
        this.free = { kind: 'leaves', hinges }
        this.setLift(height / 2 + 0.15)
      }
      // as long as no state has arrived: at rest, like an unknown position (see `onState`)
      this.applyFraction(isFlatCover(ctx.descriptor) ? 0 : 1)
    }
  }

  /** `f` = CLOSED share: 1 = shutter down, awning deployed, gate shut; 0 = open. */
  private applyFraction(f: number): void {
    this.closedFraction = f
    const o = this.ctx.opening
    if (o && this.slats.length) {
      const h = Math.max(0.001, o.height * f)
      for (const slat of this.slats) {
        slat.scale.z = h
        slat.position.z = o.origin[2] + o.height - h / 2 - this.device.position[2]
        slat.visible = f > 0.005
      }
      return
    }
    if (!this.free) return
    if (this.free.kind === 'flat') {
      // Retracted, only the cassette remains: the projection goes from `AWNING_ROLLED` to the JSON's. The
      // WALL-SIDE edge (local -y) does not move — it is the one fixed to the facade, the canvas retracts toward it.
      const { box, depth } = this.free
      const shown = Math.min(depth, AWNING_ROLLED + (depth - AWNING_ROLLED) * f)
      box.scale.y = shown / depth
      box.position.y = (shown - depth) / 2
      return
    }
    // Gate: from the flat panel (closed) to a quarter turn (open). The two leaves swing apart
    // forward, each in its own direction — a single leaf opens with the same gesture.
    for (const [i, hinge] of this.free.hinges.entries()) {
      const side = i === 0 ? -1 : 1
      hinge.rotation.z = -side * (1 - f) * LEAF_SWING
    }
  }

  // what gets noticed: an open shutter, a DEPLOYED awning (it is when deployed that it fears the wind)
  protected isOn(s: DeviceState): boolean { return s.kind === 'cover' && coverActivity(this.ctx.descriptor, s.position) > 0 }
  protected onState(state: DeviceState | undefined): void {
    if (!state || state.kind !== 'cover') return
    // Unknown position (one-way radio that received nothing): we draw the cover AT REST,
    // the state assumed everywhere else for lack of anything better (`coverAtRest`). Rest is not the same
    // for all: a shutter retracts its curtain (showing NOTHING is better than a closed shutter as a
    // trompe-l'œil), an awning retracts onto its cassette, a gate stays shut.
    const rest = this.free && !isFlatCover(this.ctx.descriptor) ? 0 : 100
    const target = 1 - (state.position ?? rest) / 100
    if (!this.slats.length && !this.free) return
    this.cancelTween?.()
    const from = this.closedFraction
    const first = !this.posed
    this.posed = true
    if (first || Math.abs(target - from) < 0.002) this.applyFraction(target)
    else {
      const tw = createTween({ durationMs: 400, now: performance.now(), onUpdate: (k) => this.applyFraction(lerp(from, target, k)) })
      this.cancelTween = () => tw.cancel()
      this.ctx.addAnimation({ step: (now) => tw.step(now) })
    }
  }
  /**
   * The tint SHOWN while it is being chosen, without writing anything: the panel's picker paints here
   * at every movement, and the house is authoritative as soon as the choice is confirmed (the markers
   * are then rebuilt). `null` restores the previous tint, for an abandoned choice.
   *
   * A cover that shared the scene's material detaches from it here: painting it would stain all
   * the other shutters of the house.
   */
  override previewColor(color: string | null): void {
    if (color === null) {
      if (!this.paintBase) return
      this.mat.color.copy(this.paintBase)
    } else {
      if (!this.ownsMat) {
        this.mat = this.mat.clone()
        this.ownsMat = true
        for (const panel of this.panels) panel.material = this.mat
      }
      this.paintBase ??= this.mat.color.clone()
      this.mat.color.set(color)
    }
    this.ctx.invalidate()
  }
  override dispose(): void {
    this.cancelTween?.()
    for (const g of this.geometries) g.dispose()   // the material, for its part, is shared by the scene…
    if (this.ownsMat) this.mat.dispose()           // …except the one the tint preview detached
    super.dispose()
  }
}

/**
 * Vehicle: car body oriented by `yaw`, hidden when the vehicle is away.
 *
 * Two representations for a single footprint. The generic silhouette (two boxes) is drawn
 * RIGHT AWAY, at the dimensions of the expected car body; the .glb, which arrives later, replaces it
 * without moving anything — same origin, same footprint, and therefore the same camera framing before and
 * after. A vehicle whose car body does not load keeps its silhouette: the space
 * it occupies is always visible.
 *
 * The color NEVER comes from the file (the .glb files ship in neutral white): the one the
 * user set, or the scene's, which follows the theme.
 */
export class VehicleMarker extends DeviceMarker {
  private readonly group = new Group()
  private bodyMat: MeshStandardMaterial
  /** The material is ours ONLY if the user set a color; otherwise the scene shares it. */
  private ownsBodyMat: boolean
  /** The tint from before the preview, kept on the first touch-up to restore it if the choice is abandoned. */
  private paintBase: Color | null = null
  private readonly cabMat: MeshStandardMaterial
  /** Generic silhouette, removed the day the real car body arrives. */
  private placeholder: Mesh[] = []
  private shell: Mesh | null = null
  constructor(device: PlacedHouseDevice, ctx: MarkerContext, private atHome: (state: DeviceState) => boolean) {
    super(device, ctx)
    const model = resolveModel(device.model3d, ctx.descriptor?.pluginId, ctx.descriptor?.meta.manufacturer)
    const [width, length, height] = model?.size ?? [1.9, 4.5, 1.4]
    // Without a chosen color, we take the scene's vehicle material: it follows the theme, and a
    // material specific to the marker would stay frozen on the tint of the theme current at its creation.
    // Set by hand, otherwise derived by the plugin, otherwise the scene's: see `bodyColorOf`.
    const color = bodyColorOf(ctx.descriptor, device)
    const finishName = bodyFinishOf(ctx.descriptor, device)
    const finish = FINISH_MATERIAL[finishName]
    // A material of its own as soon as we depart from the scene's material — by color OR by
    // finish. Without that, a matte body without a set color would stay glossy.
    this.ownsBodyMat = color !== undefined || finishName !== SCENE_FINISH
    this.bodyMat = this.ownsBodyMat
      // The reflection comes from `scene.environment`, which three applies to every standard material without
      // its own map: a colored body receives it like the scene's, without copying anything.
      ? new MeshStandardMaterial({ color, ...finish })
      : ctx.materials.vehicle
    this.cabMat = new MeshStandardMaterial({ color: 0x2a3240, roughness: 0.2, metalness: 0.5 })

    // Boxes proportional to the target dimensions: the body takes the bottom over the whole footprint,
    // the cabin rises up to the roof. The whole fills EXACTLY width × length × height, otherwise
    // the car body that replaces it would overflow the reserved space.
    const body = new Mesh(new BoxGeometry(width, length, height * 0.5), this.bodyMat)
    body.position.z = height * 0.25
    const cab = new Mesh(new BoxGeometry(width * 0.89, length * 0.53, height * 0.55), this.cabMat)
    cab.position.set(0, -length * 0.04, height * 0.725)
    body.castShadow = cab.castShadow = true
    this.placeholder = [body, cab]
    this.group.add(body, cab)

    this.group.rotation.z = ((device.yaw ?? 0) * Math.PI) / 180
    this.object.add(this.group)
    this.registerPickable(body)
    this.registerPickable(cab)
    this.setLift(height)
    if (model) this.loadShell(modelUrl(model.id), ctx)
  }
  /**
   * The loaded geometry is SHARED (one per URL, cloned nowhere): it is the mesh that is
   * specific to the marker, not its vertices. It is therefore not freed with it.
   */
  private loadShell(url: string, ctx: MarkerContext): void {
    const load = ctx.loadModel ?? loadModel
    load(url, (geometry) => {
      if (this.disposed) return
      const shell = new Mesh(geometry, this.bodyMat)
      shell.castShadow = true
      this.shell = shell
      this.group.add(shell)
      this.registerPickable(shell)
      for (const mesh of this.placeholder) {
        this.group.remove(mesh)
        this.unregisterPickable(mesh)
        mesh.geometry.dispose()
      }
      this.placeholder = []
      ctx.invalidate()   // the scene only renders on demand: without this, the car body only appears at the next gesture
    }, () => {})         // failure: the generic silhouette stays in place, it already conveys the footprint
  }
  /**
   * The tint SHOWN while it is being chosen, without writing anything: the panel's picker paints
   * here at every movement, and the house is authoritative as soon as the choice is confirmed (the
   * markers are then rebuilt). `null` restores the previous tint, for an abandoned choice.
   *
   * A car that shared the scene's material detaches from it here: painting it would stain
   * all the others.
   */
  override previewColor(color: string | null): void {
    if (color === null) {
      if (!this.paintBase) return
      this.bodyMat.color.copy(this.paintBase)
    } else {
      if (!this.ownsBodyMat) {
        this.bodyMat = this.bodyMat.clone()
        this.ownsBodyMat = true
        // the loaded car body replaced it, but as long as it is not there the box carries the paint
        if (this.shell) this.shell.material = this.bodyMat
        if (this.placeholder[0]) this.placeholder[0].material = this.bodyMat
      }
      this.paintBase ??= this.bodyMat.color.clone()
      this.bodyMat.color.set(color)
    }
    this.ctx.invalidate()
  }
  protected isOn(s: DeviceState): boolean { return s.kind === 'vehicle' && s.charging }
  protected onState(state: DeviceState | undefined): void {
    const present = !state || state.kind !== 'vehicle' || !state.location || this.atHome(state)
    this.group.visible = present
  }
  override dispose(): void {
    for (const mesh of this.placeholder) mesh.geometry.dispose()
    this.shell = null   // geometry shared by the loader's cache: it outlives the marker
    if (this.ownsBodyMat) this.bodyMat.dispose()
    this.cabMat.dispose()
    super.dispose()
  }
}

/**
 * Mower: small orange body following the published position (smoothed). Published in LOCAL coordinates by the
 * simulation, in GPS by a real robot (Husqvarna): in that case the scene projects (`ctx.toLocal`),
 * and a reading outside the terrain leaves the marker where it was.
 */
export class MowerMarker extends DeviceMarker {
  private readonly mesh: Mesh
  private readonly mat: MeshStandardMaterial
  private targetXY: [number, number] | null = null
  private moving = false
  /** Parked at its base: its heading comes from the base, not from its direction of travel. */
  private parked = false
  constructor(device: PlacedHouseDevice, ctx: MarkerContext) {
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
    if (state?.kind === 'mower') {
      // Parked at its base, it is the BASE that says where it is and which way it faces: the reading, for its part, is
      // good to within a few meters, and the robot ended up crosswise next to its station.
      const parked = this.ctx.parkedAt?.(state) ?? null
      const xy = parked?.xy ?? state.position ?? (state.location ? this.ctx.toLocal?.(state.location) ?? null : null)
      if (xy) this.targetXY = xy
      if (parked) this.mesh.rotation.z = (parked.yaw * Math.PI) / 180
      this.parked = !!parked
    }
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
          if (this.ctx.groundZ) this.object.position.z = this.ctx.groundZ(this.object.position.x, this.object.position.y)
          if (!this.parked && Math.hypot(dx, dy) > 0.05) this.mesh.rotation.z = Math.atan2(dy, dx) - Math.PI / 2
          if (Math.hypot(dx, dy) < 0.01 && !active) { this.moving = false; return false }
          return true
        },
      })
    }
  }
  override dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); super.dispose() }
}
