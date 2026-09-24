import { AdditiveBlending, BoxGeometry, type BufferGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, RingGeometry, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial } from 'three'
import type { DeviceState, PlacedHouseDevice, PanelPlacement } from '@kasbah/shared'
import { mirekToRgb, xyToRgb } from '@kasbah/shared'
import { isMediaActive } from '../../lib/deviceState'
import { coverActivity, isFlatCover } from '../../lib/cover'
import { IDLE_W, isEnergySite } from '../../lib/energy'
import { coverLeaves, coverSize, yawToRad } from '../../lib/orientation'
import { bodyColorOf, bodyFinishOf, FINISH_MATERIAL, SCENE_FINISH } from '../../lib/vehicleTuning'
import { LAMP_LAYER } from '../core/layers'
import { createTween, lerp } from '../core/tween'
import { joineryMaterial } from '../builders/materials'
import { DeviceMarker, type MarkerContext } from './DeviceMarker'
import { ScreenArt } from './screenArt'
import { modelUrl, resolveModel } from '../models/catalog'
import { loadModel } from '../models/loadModel'

// Représentations 3D par type. Toutes mutent leurs objets dans `onState` ; les animations continues
// (déplacement du robot, tween du volet) sont enregistrées dans la boucle et retirées quand elles cessent.

const devMaterial = (ctx: MarkerContext) => ctx.materials.device

/** Nombre d'anneaux de l'onde sonore d'un lecteur, et période d'un anneau (ms). */
const WAVE_RINGS = 3
const WAVE_PERIOD_MS = 5750
/** Rayon (m) de l'anneau à sa naissance et à sa disparition. */
const WAVE_R0 = 0.18
const WAVE_R1 = 1.2

/**
 * Pulsation d'un coffret (batterie, ou borne en charge) : période d'un souffle (ms) et bornes de
 * son émissif. Lente — c'est un état, pas une alerte —, et bien plus longue que l'onde d'un lecteur.
 */
const BATTERY_PULSE_MS = 2600
const BATTERY_GLOW = { min: 0.06, max: 0.6 }
/** Part de la couleur d'état versée dans la teinte du coffret : il reste gris, même au creux du souffle. */
const BATTERY_TINT = 0.3
/** Coffret d'une batterie (m) : largeur, profondeur, hauteur. Ses deux grandes faces portent la jauge. */
const BATTERY_BOX = { w: 0.6, d: 0.15, h: 1 }
/** Jauge de charge du coffret : largeur du trait (m), part de la hauteur de la face, retrait du bord. */
const BATTERY_GAUGE = { w: 0.06, h: 0.86, inset: 0.06 }

/**
 * Caisson d'une station de traitement d'eau (m) : largeur, profondeur, hauteur — les cotes exactes
 * de la notice COMAP Proteo 2. Plat et large : il se pose CONTRE un mur, comme un thermostat, pas
 * au sol comme une borne.
 */
const WATER_BOX = { w: 0.59, d: 0.17, h: 0.59 }
/**
 * Module intérieur d'une pompe à chaleur air-eau (hydrobox Ecodan) : une MACHINE posée au sol dans
 * un local technique, pas un boîtier mural. Cotes du constructeur arrondies, 60 × 36 × 120 cm.
 */
const HEATPUMP_BOX = { w: 0.6, d: 0.36, h: 1.2 }

/** Écrans d'un lecteur : demi-profondeur de la boîte (d'où l'image est posée). Largeur × hauteur
 * d'une TV viennent de `coverSize` (JSON ou défaut) ; l'écran connecté reste une petite dalle fixe. */
const SCREENS = { tv: { depth: 0.03 }, display: { width: 0.25, height: 0.16, depth: 0.04 } } as const
/** Épaisseur du chassis TV (m) — indépendante de la dalle saisie. */
const TV_CHASSIS_DEPTH = 0.06
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
/** Encombrement d'une barre de son (m) : largeur × profondeur × hauteur. */
const SPEAKER_BAR = { w: 0.55, d: 0.08, h: 0.07 } as const
/** Galet : cylindre court (m) — rayon × hauteur avant rotation Z-up. */
const SPEAKER_PEBBLE = { r: 0.14, h: 0.1 } as const
/** Petit bloc rectangulaire (m) : réveil / Nest Hub Mini — largeur × profondeur × hauteur. */
const SPEAKER_BLOCK = { w: 0.14, d: 0.08, h: 0.1 } as const
/** Mangeoire / fontaine (m) : tour un peu plus haute que large — pas une boule. */
const PET_BOX = { w: 0.12, d: 0.12, h: 0.2 } as const

export class GenericMarker extends DeviceMarker {
  private mesh: Mesh
  /** Lecteur en lecture : anneaux concentriques qui s'élargissent et s'estompent, comme une onde sonore. */
  private waves: Mesh<RingGeometry, ShaderMaterial>[] = []
  private waving = false
  private playing = false
  /** Pochette affichée sur l'écran (téléviseur et écran connecté seulement). */
  private art: ScreenArt | null = null
  /**
   * Matériau PROPRE à ce qui pulse (coffret de batterie, borne en charge) : il ne peut pas partager
   * celui des autres objets neutres. `null` pour tout le reste, qui garde le matériau commun.
   */
  private readonly pulseMat: MeshStandardMaterial | null = null
  /** Couleur de ce que la batterie fait en ce moment, `null` si elle n'a rien à dire (au repos). */
  private cue: Color | null = null
  /**
   * Jauge de charge du coffret, une paire piste + trait PAR GRANDE FACE : la vue d'ensemble regarde
   * la maison depuis le sud-est, et un coffret posé `yaw` 0 lui tournerait sa seule face lisible.
   */
  private readonly charge: { track: Mesh<PlaneGeometry, MeshBasicMaterial>; fill: Mesh<PlaneGeometry, MeshBasicMaterial> }[] = []
  constructor(device: PlacedHouseDevice, ctx: MarkerContext) {
    super(device, ctx)
    const kind = ctx.descriptor?.kind ?? device.kind
    let geometry
    // un lecteur prend la forme de sa nature : enceinte (cylindre / galet / barre), téléviseur, écran
    const mediaClass = kind === 'media_player' ? ctx.descriptor?.meta.mediaPlayer?.deviceClass ?? 'speaker' : undefined
    const speakerShape = mediaClass === 'speaker' ? (device.speakerShape ?? 'default') : undefined
    // dalle TV : JSON ou défaut 1 × 0,56 — lue une fois pour le chassis, la pilule et la pochette
    const tvSize = mediaClass === 'tv' ? coverSize(device, ctx.descriptor) : undefined
    // un appareil de chauffage prend la forme de ce qu'il EST : pastille murale pour un thermostat,
    // bloc au sol pour une pompe à chaleur (absent = thermostat, le cas d'avant)
    const climateClass = kind === 'climate' ? ctx.descriptor?.meta.climate?.deviceClass ?? 'thermostat' : undefined
    let battery = false
    let pulse = false
    switch (kind) {
      case 'media_player':
        if (tvSize) {
          geometry = new BoxGeometry(tvSize.width, TV_CHASSIS_DEPTH, tvSize.height)
          // pilule juste au-dessus de l'arête haute (0,24 m d'air, comme l'ancien 0,8 − 0,56)
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
      // Deux objets sous le même kind, comme pour `energy`. Un THERMOSTAT est une pastille contre le
      // mur (12 cm), pas un coffre — celui-ci écrasait le palier où il est posé ; le cylindre garde
      // son axe +y (couché), ses deux disques sont donc verticaux et le cadran regarde la pièce dans
      // la direction du `yaw`. Une POMPE À CHALEUR est l'inverse : une machine debout dans un local
      // technique, et la dessiner en pastille faisait passer toute une installation pour un boîtier
      // de salon.
      case 'climate':
        if (climateClass === 'heat_pump') { geometry = new BoxGeometry(HEATPUMP_BOX.w, HEATPUMP_BOX.d, HEATPUMP_BOX.h); this.setLift(HEATPUMP_BOX.h / 2 + 0.25) }
        else { geometry = new CylinderGeometry(0.06, 0.06, 0.04, 28); this.setLift(0.18) }
        break
      case 'ev_charger': geometry = new BoxGeometry(0.3, 0.15, 0.8); this.setLift(0.6); pulse = true; break
      // Deux objets sous le même kind : le SITE d'une installation est une passerelle, un boîtier de
      // la taille d'une grosse boîte de dérivation ; une batterie, elle, est un coffret qui monte du
      // sol. Le coffret d'un mètre donné aux deux faisait de la passerelle solaire un meuble.
      case 'energy':
        if (ctx.descriptor && isEnergySite(ctx.descriptor)) { geometry = new BoxGeometry(0.28, 0.12, 0.32); this.setLift(0.3) }
        else { geometry = new BoxGeometry(BATTERY_BOX.w, BATTERY_BOX.d, BATTERY_BOX.h); this.setLift(0.7); battery = true; pulse = true }
        break
      // Station de traitement d'eau : une centrale MURALE aux cotes du constructeur (COMAP Proteo 2,
      // 59 × 59 × 17 cm) — un caisson plat et large, bien plus grand qu'un thermostat et bien plus
      // plat qu'un coffret de batterie. Le caisson est centré sur l'ancre, comme la borne et le
      // coffret ; la pilule se pose juste au-dessus de son arête haute.
      case 'water': geometry = new BoxGeometry(WATER_BOX.w, WATER_BOX.d, WATER_BOX.h); this.setLift(WATER_BOX.h / 2 + 0.2); break
      case 'vacuum': geometry = new CylinderGeometry(0.18, 0.18, 0.09, 24); this.setLift(0.25); break
      // Mangeoire et fontaine : tours au sol, un peu plus hautes que larges — la sphère du repli
      // (`default`) les faisait passer pour des capteurs.
      case 'pet_feeder':
      case 'pet_fountain':
        geometry = new BoxGeometry(PET_BOX.w, PET_BOX.d, PET_BOX.h)
        this.setLift(PET_BOX.h / 2 + 0.2)
        break
      default: geometry = new SphereGeometry(0.1, 16, 12); this.setLift(0.3)
    }
    if (pulse) this.pulseMat = devMaterial(ctx).clone()
    this.mesh = new Mesh(geometry, this.pulseMat ?? devMaterial(ctx))
    // Enceinte, robot : cylindre DEBOUT, donc l'axe Y du cylindre passe en Z-up local. Le thermostat,
    // lui, est une pastille couchée contre son mur : il garde l'axe du cylindre à l'horizontale.
    if (geometry instanceof CylinderGeometry && kind !== 'climate') this.mesh.rotation.x = Math.PI / 2
    if (kind === 'media_player') {
      this.mesh.position.z = tvSize ? tvSize.height / 2
        : mediaClass === 'display' ? 0.08
        : speakerShape === 'bar' ? SPEAKER_BAR.h / 2
        : speakerShape === 'block' ? SPEAKER_BLOCK.h / 2
        : speakerShape === 'pebble' ? SPEAKER_PEBBLE.h / 2
        : 0.16
    }
    // ce qui regarde quelque part, et ce qui se pose contre un mur, suivent leur `yaw` (0 = face à
    // +y) : un écran, une barre de son, un bloc-réveil, mais aussi une borne de recharge, une batterie…
    // Un cylindre / galet d'enceinte, lui, n'en a pas besoin.
    if (mediaClass === 'tv' || mediaClass === 'display' || speakerShape === 'bar' || speakerShape === 'block' || kind === 'ev_charger' || kind === 'energy' || kind === 'climate' || kind === 'water') {
      this.mesh.rotation.z = yawToRad(device.yaw)
    }
    // ce que l'écran diffuse se voit SUR l'écran : la pochette du morceau (ou le logo de l'appli), posée
    // devant la face avant et enfant du maillage, donc tournée du même `yaw` que lui
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
      // anneaux à plat (le plan XY est le sol en Z-up), un peu au-dessus de la base de l'appareil ;
      // invisibles tant que rien ne joue, animés par `onState`
      const directional = mediaClass === 'tv' || mediaClass === 'display'
      for (let i = 0; i < WAVE_RINGS; i++) {
        const ring = this.asDecor(new Mesh(new RingGeometry(0.86, 1, 64), waveMaterial(ctx.theme.media, directional)))
        ring.position.z = 0.03
        ring.rotation.z = yawToRad(device.yaw)                 // le « devant » de l'onde suit l'écran
        ring.visible = false
        this.waves.push(ring)
        this.object.add(ring)
      }
    }
  }
  /**
   * Trait de charge le long des deux grandes faces du coffret, dans la langue de la jauge d'un
   * module : une piste à peine visible, et un trait plein qui monte depuis le BAS. Enfants du
   * coffret, donc tournés de son `yaw` avec lui.
   */
  private buildCharge(ctx: MarkerContext): void {
    const h = BATTERY_BOX.h * BATTERY_GAUGE.h
    const x = -(BATTERY_BOX.w / 2 - BATTERY_GAUGE.inset - BATTERY_GAUGE.w / 2)
    for (const side of [1, -1]) {
      // Debout CONTRE la face : la normale du plan sort du coffret (±y local) et son haut est le haut
      // du coffret (+z). Le demi-tour de la face avant remet son axe vertical à l'endroit.
      const face = (opacity: number) => {
        // `MeshBasicMaterial` : une charge qu'on lit ne s'éteint pas avec la lumière de la scène ;
        // sans `depthWrite`, le trait ne creuse pas la tôle sur laquelle il est posé.
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
   * Monte le trait à la charge du coffret. La HAUTEUR dit ce qu'il reste dedans, le souffle dit ce
   * qu'il est en train de faire : deux langues qui ne se marchent pas dessus, d'où un trait à
   * l'accent et non à la couleur d'état. `batterySoc` absent = le coffret ne dit pas sa charge, et
   * la jauge disparaît ENTIÈREMENT — une piste vide se lirait comme une batterie à plat.
   *
   * Un coffret qui ne répond plus garde son dernier niveau : une charge ne s'évapore pas avec la
   * liaison, et le souffle rouge dit déjà que le chiffre est gelé.
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
      case 'media_player': return isMediaActive(s)                  // une appli à l'écran diffuse une image : l'onde aussi
      case 'climate': return s.mode !== 'off'
      case 'vacuum': return s.activity === 'cleaning'
      case 'ev_charger': return s.status === 'charging'
      // une batterie est active quand elle DÉPLACE de l'énergie (elle ne produit jamais rien, et sa
      // pilule serait restée éteinte en pleine charge) ; le site, lui, quand il produit
      case 'energy': return this.pulseMat ? Math.abs(s.batteryW ?? 0) >= IDLE_W : s.productionW > 0
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
    if (this.pulseMat) { this.pulse(state); this.setCharge(state) }
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
  /**
   * Ce qu'un coffret doit dire, et rien de plus. Batterie : VERT quand elle se remplit, BLEU quand
   * elle rend ce qu'elle a, ROUGE quand elle ne répond plus (la seule panne que le contrat porte —
   * un `energy` n'a pas de champ de défaut, et une batterie muette garde ses dernières valeurs,
   * gelées). Borne : VERT seulement en charge — branchée au repos, ça ne pulse pas. `null` au
   * repos : sous le seuil des compteurs, une batterie à l'arrêt n'a rien à signaler.
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
   * Souffle du coffret : sa teinte tire vers la couleur de ce qu'il fait, et son émissif monte et
   * redescend en cosinus — aucune cassure, ni au creux ni à la crête. Au repos il s'éteint
   * franchement et rend la main à la boucle : la scène ne rend qu'à la demande, un coffret qui ne
   * fait rien ne doit pas réveiller le rendu.
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
    if (this.stopAnimation) return                        // déjà en train de souffler : seule la couleur a changé
    let t0 = -1
    // le marqueur n'a qu'un créneau d'animation, et un coffret n'a pas d'onde sonore : les deux ne
    // se rencontrent jamais
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

/** Verre d'un module au repos : bleu nuit, presque noir. */
const PANEL_DARK = 0x1c2740
/** Jauge de bord d'un module : largeur (m), part de la hauteur, et retrait depuis le bord du verre. */
const GAUGE_W = 0.045
const GAUGE_H = 0.88
const GAUGE_INSET = 0.05
/** Repère posé en travers de la jauge : il déborde d'un peu, pour se voir contre le verre. */
const MARK_W = GAUGE_W * 2
const MARK_H = 0.025

/**
 * Module photovoltaïque d'un champ : une dalle aux dimensions du module, couchée, inclinée et
 * orientée comme son champ, qui tire vers l'accent à mesure qu'elle produit. Le kind reste `sensor`
 * (une puissance en W), c'est `meta.panel` qui dit que ce capteur est un module posé sur un toit.
 */
export class PanelMarker extends DeviceMarker {
  private readonly mesh: Mesh
  private readonly mat: MeshStandardMaterial
  /**
   * Jauge de bord : un trait de 4,5 cm le long du côté du module, qui monte avec la production. Le
   * verre entier dit déjà le niveau par sa teinte — se lit à toute distance, mais deux modules
   * voisins à 60 % et 75 % se ressemblent ; le trait, lui, se compare au millimètre. Discret : sur
   * un côté, pas au milieu, et invisible quand le module ne produit pas.
   */
  private readonly gauge: Mesh<PlaneGeometry, MeshBasicMaterial>
  private readonly track: Mesh<PlaneGeometry, MeshBasicMaterial>
  /**
   * Les deux repères de la jauge, TOUJOURS visibles qu'elle les atteigne ou non : `output` = la
   * puissance de sortie max de l'onduleur (sa fiche technique, déclarée sur le champ), `record` = sa
   * plus haute valeur jamais rapportée. Mêmes couleurs que dans la vue Énergie, et le plafond passe
   * DEVANT le record quand les deux coïncident.
   */
  private readonly marks: { output: Mesh<PlaneGeometry, MeshBasicMaterial>; record: Mesh<PlaneGeometry, MeshBasicMaterial> }
  /** Hauteur du trait à plein (m) : ce qui l'ancre sur le bord bas quand il redescend. */
  private readonly gaugeH: number
  /** Puissance crête du module de CE champ : c'est elle qui dit ce qu'« à fond » veut dire ici. */
  private readonly peakW: number
  /** Puissance de sortie de l'onduleur (0 = inconnue) : le second repère de la jauge. */
  private readonly maxOutputW: number
  constructor(device: PlacedHouseDevice, ctx: MarkerContext, panel: PanelPlacement) {
    super(device, ctx)
    this.peakW = panel.peakW
    this.maxOutputW = panel.maxOutputW
    this.mat = new MeshStandardMaterial({ color: PANEL_DARK, roughness: 0.35, metalness: 0.4 })
    this.mesh = new Mesh(new BoxGeometry(panel.width, panel.height, 0.04), this.mat)
    // d'abord l'inclinaison autour de l'axe des colonnes (x local), puis l'orientation du champ (z).
    // Le signe : tourner autour de +x penche la normale vers −y, or le verre regarde vers +y (l'azimut
    // du champ, celui qu'on met au sud) — d'où le moins.
    this.mesh.rotation.order = 'ZXY'
    this.mesh.rotation.x = -(panel.tilt * Math.PI) / 180
    this.mesh.rotation.z = yawToRad(device.yaw)
    this.mesh.position.z = 0.03
    this.mesh.castShadow = true
    this.registerPickable(this.mesh)
    this.object.add(this.mesh)
    // ENFANTS de la dalle : le trait épouse d'office son inclinaison et l'azimut du champ, et le
    // repère local a son bord bas en +y (là où le verre penche, vers le soleil).
    this.gaugeH = panel.height * GAUGE_H
    const geo = () => new PlaneGeometry(GAUGE_W, this.gaugeH)
    const x = -(panel.width / 2 - GAUGE_INSET - GAUGE_W / 2)
    // `MeshBasicMaterial` : une mesure qu'on lit ne s'éteint pas avec la lumière de la scène.
    // Sans `depthWrite`, le trait ne creuse pas le verre sur lequel il est posé.
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

  /** Monte le trait à `k` (0 → 1) depuis le bord BAS du module, celui qui penche vers l'azimut. */
  private setGauge(k: number): void {
    this.gauge.visible = k > 0.004
    this.gauge.scale.y = Math.max(0.001, k)
    this.gauge.position.y = (this.gaugeH / 2) * (1 - k)
  }

  /** Pose un repère à `watts` sur la jauge, à l'échelle donnée ; rien à montrer si on ne le sait pas. */
  private setMark(which: 'output' | 'record', watts: number, scaleW: number): void {
    const m = this.marks[which]
    m.visible = watts > 0
    if (m.visible) m.position.y = (this.gaugeH / 2) * (1 - 2 * Math.min(1, watts / scaleW))
  }
  protected isOn(s: DeviceState): boolean { return s.kind === 'sensor' && s.value > 0 }
  protected onState(state: DeviceState | undefined): void {
    const watts = state?.kind === 'sensor' && state.available ? state.value : 0
    // Le VERRE ENTIER porte la mesure — il tire vers l'accent et s'allume à mesure que le module
    // approche de la crête déclarée par son champ —, et le trait de bord la chiffre : remplir le
    // verre d'une jauge avait été essayé, mais un module coupé en deux n'est plus un module.
    // L'échelle contient les trois valeurs en jeu : la crête du verre, ce que l'onduleur sait sortir
    // et son record. Sans ça, un repère plus haut que la crête du module se perdait hors du trait.
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
    // le record survit à l'indisponibilité : il ne décrit pas l'instant, et la nuit ne l'efface pas
    this.setMark('record', record, scaleW)
  }
  override dispose(): void {
    for (const m of [this.track, this.gauge, this.marks.record, this.marks.output]) { m.geometry.dispose(); m.material.dispose() }
    this.mesh.geometry.dispose(); this.mat.dispose(); super.dispose()
  }
}

/** Lampe : sphère émissive + PointLight ; intensité selon la luminosité, couleur selon l'état. */
/**
 * Halo d'une lampe allumée : un dégradé radial en additif, tourné vers la caméra. C'est ce qui donne
 * le « bloom » de la maquette sans post-traitement — une passe de flou sur un canvas transparent
 * coûterait cher sur tablette et se marierait mal avec les pilules DOM. Texture partagée, procédurale
 * (aucun `<canvas>` : elle se construit aussi en Node pour les tests).
 */
const GLOW_SIZE = 48
let glowTexture: DataTexture | null = null
function glowMap(): DataTexture {
  if (glowTexture) return glowTexture
  const data = new Uint8Array(GLOW_SIZE * GLOW_SIZE * 4)
  const c = (GLOW_SIZE - 1) / 2
  for (let y = 0; y < GLOW_SIZE; y++) for (let x = 0; x < GLOW_SIZE; x++) {
    const d = Math.min(1, Math.hypot(x - c, y - c) / c)
    const a = Math.pow(1 - d, 2.2)          // cœur franc, bord qui s'évanouit
    const i = (y * GLOW_SIZE + x) * 4
    data[i] = data[i + 1] = data[i + 2] = 255
    data[i + 3] = Math.round(a * 255)
  }
  glowTexture = new DataTexture(data, GLOW_SIZE, GLOW_SIZE)
  glowTexture.needsUpdate = true
  return glowTexture
}
/** Portée (m) d'une lampe. Sert aussi de `far` au cône d'ombre d'une lampe de jardin. */
const LIGHT_RANGE = 7

/** Ventilateur-plafonnier (m) : hub vertical + 3 pales + globe lumineux — mêmes ordres que la sphère. */
const CEILING_FAN = {
  hubR: 0.045, hubH: 0.11,
  globeR: 0.075,
  bladeL: 0.34, bladeW: 0.075, bladeT: 0.012,
  bladeZ: -0.04,
}
/**
 * Tours par seconde des pales, de la plus petite vitesse à la plus grande. Un vrai plafonnier monte à
 * 3 tr/s, mais la boucle anime à 20 Hz et trois pales se ressemblent tous les 120° : au-delà d'1 tr/s
 * (18° par image), l'œil commence à voir la roue de charrette tourner à l'envers.
 */
const FAN_TURNS_S = [0.3, 1] as const
/** Vitesses supposées quand le descripteur n'en déclare pas — celles du CREATE (télécommande 1 à 6). */
const FAN_DEFAULT_SPEEDS = [1, 2, 3, 4, 5, 6]

/**
 * Flux d'air sous le plafonnier, dans la langue de l'onde sonore d'un lecteur : des anneaux à plat qui
 * naissent et s'estompent. Sens `forward` (été) : ils partent des pales et DESCENDENT en s'élargissant,
 * en bleu — l'air est poussé vers le bas, il rafraîchit. Sens `reverse` (hiver) : ils MONTENT vers les
 * pales en se resserrant, en rouge — l'air est aspiré, il redescend le long des murs la chaleur
 * accumulée au plafond. Discret : c'est un état, pas une alerte.
 */
const AIRFLOW = {
  rings: 3,
  /** Hauteur (m) de la colonne d'air, depuis le plan des pales. */
  length: 1.3,
  top: -0.08,
  /** Rayon (m) de l'anneau au plan des pales et en bas de la colonne. */
  rTop: 0.32, rBottom: 0.85,
  /** Période d'un anneau (s), de la plus petite vitesse à la plus grande. */
  periodS: [4.5, 1.8] as const,
  /** Opacité d'un anneau au plus fort, de la plus petite vitesse à la plus grande. */
  opacity: [0.22, 0.4] as const,
  cool: new Color(0x4da3ff),
  warm: new Color(0xff6a3d),
}

/** Rang de `speed` dans les vitesses du ventilateur, de 0 (la plus lente) à 1 (la plus rapide). */
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
  /** Avancée du premier anneau sur la colonne (0 → 1) ; les autres suivent, décalés. */
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

  /** `k` : rang de la vitesse (0 → 1). */
  set(forward: boolean, k: number): void {
    this.down = forward
    this.rate = 1 / lerp(AIRFLOW.periodS[0], AIRFLOW.periodS[1], k)
    this.peak = lerp(AIRFLOW.opacity[0], AIRFLOW.opacity[1], k)
    for (const r of this.rings) (r.material.uniforms.uColor!.value as Color).copy(forward ? AIRFLOW.cool : AIRFLOW.warm)
    this.step(0)
  }

  step(dtS: number): void {
    // la phase AVANCE au rythme courant : changer de vitesse n'a pas à faire sauter les anneaux
    this.phase = (this.phase + Math.min(0.1, Math.max(0, dtS)) * this.rate) % 1
    this.rings.forEach((ring, i) => {
      const p = (this.phase + i / AIRFLOW.rings) % 1
      const depth = this.down ? p : 1 - p          // 0 au plan des pales, 1 en bas de la colonne
      const r = lerp(AIRFLOW.rTop, AIRFLOW.rBottom, depth)
      ring.scale.set(r, r, 1)
      ring.position.z = AIRFLOW.top - depth * AIRFLOW.length
      // naît et s'éteint en douceur : aucun anneau n'apparaît ni ne disparaît d'un coup
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
  /** Groupe des pales (null hors plafonnier) : c'est lui qui tourne autour de Z. */
  private readonly blades: Group | null
  /** Flux d'air sous les pales (null hors plafonnier), visible tant que le ventilateur tourne. */
  private readonly airflow: FanAirflow | null
  /** Vitesse signée des pales (rad/s) ; 0 = arrêtées. */
  private spinRadS = 0
  private readonly geometries: BufferGeometry[] = []
  private readonly light: PointLight
  private readonly glow: Sprite
  private readonly glowMat: SpriteMaterial
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
      // Une lampe de JARDIN doit éclairer la façade sans traverser le mur. Aucune couche ne sait
      // faire ça : la seule chose qui arrête vraiment la lumière est une OMBRE. Six faces de 512 px,
      // et seulement tant que la lampe est allumée (`onState`) — c'est ce qui rend la dépense tenable.
      this.light.shadow.mapSize.set(512, 512)
      this.light.shadow.bias = -0.004
      this.light.shadow.normalBias = 0.04
      this.light.shadow.camera.near = 0.15
      this.light.shadow.camera.far = LIGHT_RANGE + 1
    } else {
      this.light.layers.set(LAMP_LAYER)   // n'éclaire que son niveau : voir `core/layers.ts`
    }
    this.glowMat = new SpriteMaterial({ map: glowMap(), color: 0xffd9a0, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false })
    this.glow = new Sprite(this.glowMat)
    this.asDecor(this.glow)
    this.glow.visible = false
    this.object.add(this.body, this.light, this.glow)
    this.body.traverse((o) => { if ((o as Mesh).isMesh) this.registerPickable(o) })
    this.setLift(0.3)
  }

  /**
   * Hub cylindrique (axe Z, maison Z-up) + trois pales + globe émissif sous le hub.
   * Le globe reprend le matériau de la lampe : couleur / température s'y appliquent.
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
    // Tout ce qu'une lampe allumée fait — l'éclat du globe, la portée, le halo — vient du STYLE, qui
    // le tient de l'heure : la même lampe brûle la nuit et se devine à peine en plein jour.
    const g = this.ctx.glow
    this.mat.emissive.copy(c)
    this.mat.emissiveIntensity = k * g.emissive
    this.light.color.copy(c)
    // la lumière n'atteint que les surfaces de SON niveau : voir le rendu en passes de `HouseScene`
    this.light.intensity = k * g.lightIntensity
    // Une lampe éteinte n'a pas à coûter six rendus de profondeur.
    this.light.castShadow = !!this.ctx.outdoor && k > 0
    this.glowMat.color.copy(c)
    this.glowMat.opacity = k * g.opacity
    this.glow.scale.setScalar(g.scale)
    this.glow.visible = k > 0
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
    // `forward` = été : vu d'EN DESSOUS les pales tournent dans le sens trigonométrique et poussent
    // l'air vers le bas. La caméra regarde d'en haut, où ce sens se lit horaire : Z négatif.
    this.spinRadS = (forward ? -1 : 1) * Math.PI * 2 * lerp(FAN_TURNS_S[0], FAN_TURNS_S[1], k)
    this.airflow.set(forward, k)
    this.airflow.object.visible = true
    if (wasOn) return
    // Animation décorative (20 Hz via la boucle) : pales et flux d'air tant que le ventilateur tourne.
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
    super.dispose()
  }
}

/** Épaisseur (m) du panneau d'un ouvrant libre : elle ne se règle pas, un portail se voit de face. */
const COVER_THICKNESS = 0.06
/** Part de la largeur de la baie qu'occupe le tablier : il coulisse DANS l'embrasure, pas dessus. */
const SLAT_INSET = 0.98
/** Jeu (m) entre deux vantaux d'un tablier — même trait que celui des vantaux d'une porte. */
const SLAT_GAP = 0.02

/**
 * Le matériau d'un panneau d'ouvrant : celui de la scène tant que rien n'est demandé (il suit le
 * thème), la variante teintée du relevé sinon. Même mécanique que les menuiseries d'une baie, donc
 * même cache : dix volets blancs partagent un matériau, et changer de style les rattrape tous.
 */
function coverPanelMaterial(device: PlacedHouseDevice, ctx: MarkerContext, fallback: MeshStandardMaterial): MeshStandardMaterial {
  if (!device.coverMaterial && !device.coverColor) return fallback
  return joineryMaterial(ctx.materials, 'slat', device.coverMaterial, device.coverColor)
}
/** Avancée (m) qui reste visible d'un store replié : son coffre et la toile enroulée dedans. */
const AWNING_ROLLED = 0.3
/** Quart de tour : l'ouverture d'un battant de portail grand ouvert. */
const LEAF_SWING = Math.PI / 2

/** Ce qui est dessiné pour un ouvrant LIBRE, et que la part fermée anime. */
type FreeCover =
  /** Store : une dalle horizontale dont l'AVANCÉE suit le déploiement, bord côté mur fixe. */
  | { kind: 'flat'; box: Mesh; depth: number }
  /** Portail : un ou deux battants qui pivotent sur leur charnière, du plat au quart de tour. */
  | { kind: 'leaves'; hinges: Group[] }

/**
 * Volet : lame ajustée dans l'embrasure, hauteur = part fermée, tweenée.
 *
 * Sans ouverture liée, l'ouvrant est un objet LIBRE (portail, store banne) : le JSON seul le
 * dimensionne (`size`) et l'oriente (`yaw`), et c'est la même part fermée qui l'anime — un store
 * rentre son avancée, un portail ouvre ses battants.
 */

export class CoverMarker extends DeviceMarker {
  /** Les vantaux du tablier, de gauche à droite : un seul pour un volet roulant, deux pour un battant. */
  private slats: Mesh[] = []
  private free: FreeCover | null = null
  /** Tout ce qui porte la teinte de l'ouvrant — tablier, dalle de store, battants de portail. */
  private panels: Mesh[] = []
  private mat: MeshStandardMaterial
  /** Le matériau n'est à nous QUE si l'aperçu de couleur l'a détaché ; sinon la scène le partage. */
  private ownsMat = false
  /** La teinte d'avant l'aperçu, gardée à la première retouche pour la rendre si le choix est abandonné. */
  private paintBase: Color | null = null
  private geometries: BufferGeometry[] = []
  private closedFraction = 0
  private cancelTween: (() => void) | null = null
  /**
   * Première position reçue ? Elle se POSE, elle ne se joue pas. Un marqueur naît ouvert (la lame est
   * montée à 0) et toute écriture dans la maison reconstruit les marqueurs : sans ce garde-fou, chaque
   * placement enregistré faisait rouvrir puis refermer tous les volets fermés de la maison — on le
   * voyait à chaque dépôt d'un champ de panneaux. Une VRAIE course, elle, s'anime comme avant.
   */
  private posed = false

  constructor(device: PlacedHouseDevice, ctx: MarkerContext) {
    super(device, ctx)
    const o = ctx.opening
    this.mat = coverPanelMaterial(device, ctx, o ? ctx.materials.slat : devMaterial(ctx))
    // un panneau de VERRE ne porte pas d'ombre pleine, pas plus que le vitrage d'une baie
    const shadowing = device.coverMaterial !== 'glass'
    if (o) {
      // Le tablier en UN OU DEUX VANTAUX (`leaves`) : un volet roulant descend d'une pièce, un
      // battant se lit à son refend. C'est la seule chose que les vantaux font ici — la course
      // reste verticale, c'est elle que l'état publie.
      const count = coverLeaves(device, ctx.descriptor)
      const inner = o.width * SLAT_INSET
      const gap = count > 1 ? SLAT_GAP : 0
      const leafWidth = (inner - gap * (count - 1)) / count
      const angle = Math.atan2(o.u[1], o.u[0])
      for (let i = 0; i < count; i += 1) {
        // abscisse du centre du vantail le long du mur, depuis le bord de la baie
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
      // Ouvrant LIBRE : aucune ouverture ne le dimensionne ni ne l'oriente, c'est donc le JSON qui le
      // fait — `size` mètres, tourné du `yaw`, centré sur le point posé dans la scène. Tout est monté
      // dans un pivot qui porte le `yaw` : ce qui bouge ensuite (avancée, battants) se calcule dans
      // un repère où l'ouvrant regarde toujours +y.
      const { width, height } = coverSize(device, ctx.descriptor)
      const pivot = new Group()
      pivot.rotation.z = yawToRad(device.yaw)
      this.object.add(pivot)
      if (isFlatCover(ctx.descriptor)) {
        // Store banne : une dalle HORIZONTALE (son épaisseur est verticale — un panneau dressé à sa
        // place ne ressemblait à rien), qui s'avance depuis le mur. `height` est son avancée.
        const box = new Mesh(new BoxGeometry(width, height, COVER_THICKNESS), this.mat)
        box.castShadow = shadowing
        pivot.add(box)
        this.geometries.push(box.geometry)
        this.panels.push(box)
        this.registerPickable(box)
        this.free = { kind: 'flat', box, depth: height }
        this.setLift(COVER_THICKNESS / 2 + 0.15)
      } else {
        // Portail, porte de garage : un panneau DEBOUT en travers du passage, en un ou deux battants.
        // Chaque battant pend à une charnière posée au bord extérieur et s'ouvre vers l'avant (+y).
        const hinges: Group[] = []
        const count = coverLeaves(device, ctx.descriptor)
        const leafWidth = width / count
        for (let i = 0; i < count; i += 1) {
          const side = i === 0 ? -1 : 1
          const hinge = new Group()
          hinge.position.x = (side * width) / 2
          const leaf = new Mesh(new BoxGeometry(leafWidth, COVER_THICKNESS, height), this.mat)
          leaf.position.x = (-side * leafWidth) / 2      // le battant part de sa charnière vers le milieu
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
      // tant qu'aucun état n'est arrivé : au repos, comme une position inconnue (voir `onState`)
      this.applyFraction(isFlatCover(ctx.descriptor) ? 0 : 1)
    }
  }

  /** `f` = part FERMÉE : 1 = volet baissé, store déployé, portail clos ; 0 = ouvert. */
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
      // Replié, il ne reste que le coffre : l'avancée va de `AWNING_ROLLED` à celle du JSON. Le bord
      // CÔTÉ MUR (local -y) ne bouge pas — c'est lui qui est fixé à la façade, la toile rentre vers lui.
      const { box, depth } = this.free
      const shown = Math.min(depth, AWNING_ROLLED + (depth - AWNING_ROLLED) * f)
      box.scale.y = shown / depth
      box.position.y = (shown - depth) / 2
      return
    }
    // Portail : du panneau plat (fermé) au quart de tour (ouvert). Les deux battants s'écartent vers
    // l'avant, chacun dans son sens — un seul battant ouvre du même geste.
    for (const [i, hinge] of this.free.hinges.entries()) {
      const side = i === 0 ? -1 : 1
      hinge.rotation.z = -side * (1 - f) * LEAF_SWING
    }
  }

  // ce qui se remarque : un volet ouvert, un store DÉPLOYÉ (c'est déployé qu'il craint le vent)
  protected isOn(s: DeviceState): boolean { return s.kind === 'cover' && coverActivity(this.ctx.descriptor, s.position) > 0 }
  protected onState(state: DeviceState | undefined): void {
    if (!state || state.kind !== 'cover') return
    // Position inconnue (radio unidirectionnelle qui n'a rien reçu) : on dessine l'ouvrant AU REPOS,
    // l'état qu'on suppose partout ailleurs faute de mieux (`coverAtRest`). Le repos n'est pas le même
    // pour tous : un volet rentre son tablier (ne RIEN montrer vaut mieux qu'un volet fermé en
    // trompe-l'œil), un store se replie sur son coffre, un portail reste clos.
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
   * La teinte MONTRÉE le temps qu'on la choisit, sans rien écrire : le sélecteur du panneau peint ici
   * à chaque mouvement, et c'est la maison qui fait foi dès que le choix est validé (les marqueurs
   * sont alors refaits). `null` rend la teinte d'avant, pour un choix abandonné.
   *
   * Un ouvrant qui partageait le matériau de la scène s'en détache ici : le peindre tacherait tous
   * les autres volets de la maison.
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
    for (const g of this.geometries) g.dispose()   // le matériau, lui, est partagé par la scène…
    if (this.ownsMat) this.mat.dispose()           // …sauf celui que l'aperçu de teinte a détaché
    super.dispose()
  }
}

/**
 * Véhicule : carrosserie orientée par `yaw`, masquée quand le véhicule est absent.
 *
 * Deux représentations pour une seule empreinte. La silhouette générique (deux boîtes) est dessinée
 * TOUT DE SUITE, aux cotes de la carrosserie attendue ; le .glb, qui arrive plus tard, s'y substitue
 * sans rien déplacer — même origine, même encombrement, et donc même cadrage de caméra avant et
 * après. Un véhicule dont la carrosserie ne se charge pas garde sa silhouette : on voit toujours la
 * place qu'il occupe.
 *
 * La couleur ne vient JAMAIS du fichier (les .glb sont livrés en blanc neutre) : celle que
 * l'utilisateur a réglée, ou celle de la scène, qui suit le thème.
 */
export class VehicleMarker extends DeviceMarker {
  private readonly group = new Group()
  private bodyMat: MeshStandardMaterial
  /** Le matériau n'est à nous QUE si l'utilisateur a réglé une couleur ; sinon la scène le partage. */
  private ownsBodyMat: boolean
  /** La teinte d'avant l'aperçu, gardée à la première retouche pour la rendre si le choix est abandonné. */
  private paintBase: Color | null = null
  private readonly cabMat: MeshStandardMaterial
  /** Silhouette générique, retirée le jour où la vraie carrosserie arrive. */
  private placeholder: Mesh[] = []
  private shell: Mesh | null = null
  constructor(device: PlacedHouseDevice, ctx: MarkerContext, private atHome: (state: DeviceState) => boolean) {
    super(device, ctx)
    const model = resolveModel(device.model3d, ctx.descriptor?.pluginId, ctx.descriptor?.meta.manufacturer)
    const [width, length, height] = model?.size ?? [1.9, 4.5, 1.4]
    // Sans couleur choisie, on prend le matériau de véhicule de la scène : lui suit le thème, et un
    // matériau propre au marqueur resterait figé sur la teinte du thème en cours à sa création.
    // Réglée à la main, sinon déduite par le plugin, sinon celle de la scène : voir `bodyColorOf`.
    const color = bodyColorOf(ctx.descriptor, device)
    const finishName = bodyFinishOf(ctx.descriptor, device)
    const finish = FINISH_MATERIAL[finishName]
    // Un matériau propre dès qu'on s'écarte du matériau de la scène — par la couleur OU par
    // l'aspect. Sans ça, une carrosserie mate sans couleur réglée resterait vernie.
    this.ownsBodyMat = color !== undefined || finishName !== SCENE_FINISH
    this.bodyMat = this.ownsBodyMat
      // Le reflet vient de `scene.environment`, que three applique à tout matériau standard sans
      // carte propre : une carrosserie colorée le reçoit comme celle de la scène, sans rien recopier.
      ? new MeshStandardMaterial({ color, ...finish })
      : ctx.materials.vehicle
    this.cabMat = new MeshStandardMaterial({ color: 0x2a3240, roughness: 0.2, metalness: 0.5 })

    // Boîtes proportionnelles aux cotes visées : la caisse occupe le bas sur toute l'empreinte,
    // l'habitacle monte jusqu'au toit. L'ensemble remplit EXACTEMENT width × length × height, sans
    // quoi la carrosserie qui s'y substitue déborderait de la place réservée.
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
   * La géométrie chargée est PARTAGÉE (une par URL, clonée nulle part) : c'est le maillage qui est
   * propre au marqueur, pas ses sommets. Elle ne se libère donc pas avec lui.
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
      ctx.invalidate()   // la scène ne rend qu'à la demande : sans ça, la carrosserie n'apparaît qu'au prochain geste
    }, () => {})         // échec : la silhouette générique reste en place, elle dit déjà l'encombrement
  }
  /**
   * La teinte MONTRÉE le temps qu'on la choisit, sans rien écrire : le sélecteur du panneau peint
   * ici à chaque mouvement, et c'est la maison qui fait foi dès que le choix est validé (les
   * marqueurs sont alors refaits). `null` rend la teinte d'avant, pour un choix abandonné.
   *
   * Une voiture qui partageait le matériau de la scène s'en détache ici : le peindre tacherait
   * toutes les autres.
   */
  override previewColor(color: string | null): void {
    if (color === null) {
      if (!this.paintBase) return
      this.bodyMat.color.copy(this.paintBase)
    } else {
      if (!this.ownsBodyMat) {
        this.bodyMat = this.bodyMat.clone()
        this.ownsBodyMat = true
        // la carrosserie chargée l'a remplacée, mais tant qu'elle n'est pas là c'est la boîte qui porte la peinture
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
    this.shell = null   // géométrie partagée par le cache du chargeur : elle survit au marqueur
    if (this.ownsBodyMat) this.bodyMat.dispose()
    this.cabMat.dispose()
    super.dispose()
  }
}

/**
 * Tondeuse : petit corps orange qui suit la position publiée (lissée). Publiée en LOCAL par la
 * simulation, en GPS par un vrai robot (Husqvarna) : dans ce cas la scène projette (`ctx.toLocal`),
 * et un relevé hors du terrain laisse le marqueur où il était.
 */
export class MowerMarker extends DeviceMarker {
  private readonly mesh: Mesh
  private readonly mat: MeshStandardMaterial
  private targetXY: [number, number] | null = null
  private moving = false
  /** Rangée à sa base : son cap vient de la base, pas de sa direction de déplacement. */
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
      // Rangée à sa base, c'est la BASE qui dit où elle est et dans quel sens : le relevé, lui, est
      // bon à quelques mètres près, et le robot finissait en travers à côté de sa station.
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
          if (!this.parked && Math.hypot(dx, dy) > 0.05) this.mesh.rotation.z = Math.atan2(dy, dx) - Math.PI / 2
          if (Math.hypot(dx, dy) < 0.01 && !active) { this.moving = false; return false }
          return true
        },
      })
    }
  }
  override dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); super.dispose() }
}
