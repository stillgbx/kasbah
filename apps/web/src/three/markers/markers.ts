import { BoxGeometry, type BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, RingGeometry, ShaderMaterial, SphereGeometry } from 'three'
import type { DeviceState, PlacedHouseDevice, PanelPlacement } from '@kasbah/shared'
import { mirekToRgb, xyToRgb } from '@kasbah/shared'
import { isMediaActive } from '../../lib/deviceState'
import { coverActivity, isFlatCover } from '../../lib/cover'
import { isEnergySite } from '../../lib/energy'
import { coverLeaves, coverSize, yawToRad } from '../../lib/orientation'
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
  constructor(device: PlacedHouseDevice, ctx: MarkerContext) {
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
      // Thermostat : une PASTILLE contre le mur (12 cm), pas un coffre — celui-ci écrasait le palier
      // où il est posé. Le cylindre garde son axe +y (couché) : ses deux disques sont donc verticaux,
      // et le cadran regarde la pièce dans la direction du `yaw`.
      case 'climate': geometry = new CylinderGeometry(0.06, 0.06, 0.04, 28); this.setLift(0.18); break
      case 'ev_charger': geometry = new BoxGeometry(0.3, 0.15, 0.8); this.setLift(0.6); break
      // Deux objets sous le même kind : le SITE d'une installation est une passerelle, un boîtier de
      // la taille d'une grosse boîte de dérivation ; une batterie, elle, est un coffret qui monte du
      // sol. Le coffret d'un mètre donné aux deux faisait de la passerelle solaire un meuble.
      case 'energy':
        if (ctx.descriptor && isEnergySite(ctx.descriptor)) { geometry = new BoxGeometry(0.28, 0.12, 0.32); this.setLift(0.3) }
        else { geometry = new BoxGeometry(0.6, 0.15, 1); this.setLift(0.7) }
        break
      case 'vacuum': geometry = new CylinderGeometry(0.18, 0.18, 0.09, 24); this.setLift(0.25); break
      default: geometry = new SphereGeometry(0.1, 16, 12); this.setLift(0.3)
    }
    this.mesh = new Mesh(geometry, devMaterial(ctx))
    // Enceinte, robot : cylindre DEBOUT, donc l'axe Y du cylindre passe en Z-up local. Le thermostat,
    // lui, est une pastille couchée contre son mur : il garde l'axe du cylindre à l'horizontale.
    if (geometry instanceof CylinderGeometry && kind !== 'climate') this.mesh.rotation.x = Math.PI / 2
    if (kind === 'media_player') this.mesh.position.z = mediaClass === 'tv' ? 0.28 : mediaClass === 'display' ? 0.08 : 0.16
    // ce qui regarde quelque part, et ce qui se pose contre un mur, suivent leur `yaw` (0 = face à
    // +y) : un écran, mais aussi une borne de recharge, une batterie ou le boîtier d'une passerelle.
    // Un cylindre d'enceinte, lui, n'en a pas besoin.
    if (mediaClass === 'tv' || mediaClass === 'display' || kind === 'ev_charger' || kind === 'energy' || kind === 'climate') {
      this.mesh.rotation.z = yawToRad(device.yaw)
    }
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
    for (const m of [this.track, this.gauge]) { m.position.set(x, 0, 0.021); m.renderOrder = 1; this.mesh.add(m) }
    const mark = (color: Color, order: number) => {
      const m = new Mesh(new PlaneGeometry(MARK_W, MARK_H), new MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }))
      m.position.set(x, 0, 0.022)
      m.renderOrder = order
      m.visible = false
      this.mesh.add(m)
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
export class LightMarker extends DeviceMarker {
  private readonly mat: MeshStandardMaterial
  private readonly sphere: Mesh
  private readonly light: PointLight
  constructor(device: PlacedHouseDevice, ctx: MarkerContext) {
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

/** Épaisseur (m) du panneau d'un ouvrant libre : elle ne se règle pas, un portail se voit de face. */
const COVER_THICKNESS = 0.06
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
  private slat: Mesh | null = null
  private slatMat: MeshStandardMaterial | null = null
  private free: FreeCover | null = null
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
        const box = new Mesh(new BoxGeometry(width, height, COVER_THICKNESS), devMaterial(ctx))
        box.castShadow = true
        pivot.add(box)
        this.geometries.push(box.geometry)
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
          const leaf = new Mesh(new BoxGeometry(leafWidth, COVER_THICKNESS, height), devMaterial(ctx))
          leaf.position.x = (-side * leafWidth) / 2      // le battant part de sa charnière vers le milieu
          leaf.castShadow = true
          hinge.add(leaf)
          pivot.add(hinge)
          hinges.push(hinge)
          this.geometries.push(leaf.geometry)
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
    if (o && this.slat) {
      const h = Math.max(0.001, o.height * f)
      this.slat.scale.z = h
      this.slat.position.z = o.origin[2] + o.height - h / 2 - this.device.position[2]
      this.slat.visible = f > 0.005
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
    if (!this.slat && !this.free) return
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
  override dispose(): void {
    this.cancelTween?.()
    this.slat?.geometry.dispose()
    this.slatMat?.dispose()
    for (const g of this.geometries) g.dispose()   // le matériau, lui, est partagé par la scène
    super.dispose()
  }
}

/** Véhicule : carrosserie + habitacle orientés par `yaw`, masqués quand le véhicule est absent. */
export class VehicleMarker extends DeviceMarker {
  private readonly group = new Group()
  private readonly bodyMat: MeshStandardMaterial
  private readonly cabMat: MeshStandardMaterial
  constructor(device: PlacedHouseDevice, ctx: MarkerContext, private atHome: (state: DeviceState) => boolean) {
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
