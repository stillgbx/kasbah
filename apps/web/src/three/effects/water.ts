import type { Color, MeshStandardMaterial, Texture, WebGLRenderer } from 'three'
import {
  AdditiveBlending, InstancedBufferGeometry, LinearFilter, LinearMipmapLinearFilter, Mesh, OrthographicCamera,
  PlaneGeometry, RepeatWrapping, Scene, ShaderMaterial, Color as ThreeColor, Vector3, WebGLRenderTarget,
} from 'three'
import { applyLevelLight } from '../core/levelLight'
import { applyHeightMist } from '../core/heightMist'
import { applyLevelFade } from '../core/levelFade'
import { applyRoomFocus } from '../core/roomFocus'

// L'eau d'une piscine qui ne fait plus semblant. Trois gestes, sur les deux matériaux du bassin
// (`builders/materials.ts`) :
//  - la SURFACE ondule : une houle d'une vingtaine d'ondes incline la normale (point brillant du soleil, reflet
//    du ciel), et elle suit FRESNEL : transparente vue d'en haut, miroir vue en rasant ;
//  - le FOND reçoit des CAUSTIQUES par RÉFRACTION : chaque point d'une grille de la surface dévie
//    la lumière selon sa pente, et là où les rayons se resserrent sur le carrelage, la lumière se
//    concentre. C'est la méthode de *WebGL Water* (Evan Wallace, MIT) reprise par clearwater
//    (Aureliengmz, MIT) ; les lignes sont réécrites ici ;
//  - le fond est vu À TRAVERS l'eau : la lumière y perd ses couleurs selon le chemin parcouru (le
//    rouge d'abord), et l'eau diffuse sa propre teinte à la place. D'où le bleu qui fonce avec la
//    profondeur et avec l'angle.
//
// Ce que ça coûte : une passe de 512 × 512 px par pas d'animation (la grille réfractée, en additif)
// et quelques dizaines d'instructions sur les PIXELS DE LA PISCINE. Le vrai coût reste la boucle de
// rendu qu'une eau animée fait tourner (`core/renderLoop.ts`) ; c'est `HouseScene.syncWater` qui
// décide quand.

/** Le rôle du matériau patché : la lame d'eau, ou les parois et le fond vus de l'intérieur. */
export type WaterRole = 'surface' | 'basin'

/** Le temps de l'animation, en secondes. PARTAGÉ : houle et caustiques doivent battre ensemble. */
export type WaterTime = { value: number }

/** Ce qui reste réglable après coup : 0 = eau figée (le style « maquette », la qualité basse). */
export type WaterStrength = { value: number }

/** Ce que les deux matériaux partagent : le temps, la carte des caustiques, la teinte de l'eau. */
export interface WaterUniforms {
  time: WaterTime
  caustics: { value: Texture | null }
  /** Teinte que l'eau DIFFUSE (celle du style), et ce qu'elle absorbe par mètre, déduit d'elle. */
  tint: { value: Color }
  sigma: { value: Vector3 }
  /** La lumière du soleil qui ENTRE dans l'eau (monde, vers le bas), et ce rayon une fois réfracté par une eau plane. */
  light: { value: Vector3 }
  refracted: { value: Vector3 }
  /** Le vent : (x, y) = vers où il pousse, dans le plan xz du monde (unitaire) ; z = amplitude de la houle (1 = une brise de 10 km/h). */
  wind: { value: Vector3 }
}

/** Nom de l'attribut de sommet du bassin : sa profondeur sous la lame d'eau, en mètres. */
export const WATER_DEPTH_ATTRIBUTE = 'waterDepth'

/**
 * Le motif est PÉRIODIQUE sur une tuile de 5 m : toutes les ondes y font un nombre entier de
 * périodes, la carte des caustiques se répète donc sans couture sur le fond — et à 5 m, plus que la
 * longueur d'un demi-bassin, la répétition ne se lit plus.
 */
const TILE_M = 5
/** Distance de la lame au fond (`POOL_DEPTH − POOL_WATER_DROP` de `buildHouse`) : là où la lumière se concentre. */
const FLOOR_DEPTH_M = 1.38
const CAUSTIC_PX = 512
const CAUSTIC_GRID = 256
/** Les caustiques valent 1 en moyenne et montent à ~4 sur les lignes : stockées au quart en 8 bits. */
const CAUSTIC_RANGE = 4
/** Ce que l'eau absorbe, par mètre, de ce qui n'est PAS sa teinte (-ln de la teinte × ce facteur). */
const ABSORPTION_PER_M = 0.3

/** Une onde : vecteur d'onde (rad/m), amplitude (m), pulsation (rad/s), phase à l'origine. */
export interface Wave { kx: number; ky: number; a: number; w: number; phase: number }

/**
 * La houle : une vingtaine d'ondes TIRÉES (graine fixe, donc la même eau à chaque chargement), pas
 * choisies — huit ondes posées à la main faisaient un réseau trop régulier. Longueurs d'onde de
 * 25 cm à 2,5 m, réparties en logarithme ; directions groupées autour du vent (±70°), un tiers en
 * clapot libre ; phases au hasard, sinon toutes les crêtes se rencontrent à l'origine. Les ondes
 * sont tirées dans le REPÈRE DU VENT (+x = vers où il pousse) : le shader y ramène chaque point
 * (`kasbahToWind`), et la houle tourne avec le vent réel sans être retirée.
 *
 * C'est la COURBURE (A·k²) qui concentre la lumière : au fond d'1,4 m il en faut ~3 pour une ligne
 * nette. Chaque onde en porte ~0,6 ; ce sont leurs rencontres qui dessinent le réseau. L'amplitude
 * est plafonnée à 1,2 cm : les longues ondes font les reflets, pas des vagues de plage. Chaque
 * vecteur est arrondi sur la grille de la tuile (périodicité). La pulsation suit la dispersion des
 * ondes de gravité (√gk), ralentie.
 */
function drawWaves(): Wave[] {
  let seed = 0x6b617362
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const k0 = (2 * Math.PI) / TILE_M
  const wind = 0
  const seen = new Set<string>()
  const waves: Wave[] = []
  while (waves.length < 20) {
    const lambda = 0.25 * Math.pow(10, rand())
    const dir = rand() < 0.66 ? wind + (rand() - 0.5) * 2.4 : rand() * 2 * Math.PI
    const k = (2 * Math.PI) / lambda
    const m = Math.round((k * Math.cos(dir)) / k0), n = Math.round((k * Math.sin(dir)) / k0)
    if ((m === 0 && n === 0) || seen.has(`${m},${n}`)) continue
    seen.add(`${m},${n}`)
    const kl = k0 * Math.hypot(m, n)
    waves.push({
      kx: m * k0, ky: n * k0,
      a: Math.min((0.6 * (0.7 + 0.6 * rand())) / (kl * kl), 0.012),
      w: 0.3 * Math.sqrt(9.81 * kl),
      phase: rand() * 2 * Math.PI,
    })
  }
  return waves
}
/** Exporté pour les tests : qu'elles partent bien sous le vent. */
export const WAVES: readonly Wave[] = drawWaves()

const glsl = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x))

/**
 * Le repère du vent : `uWaterWind.xy` est la direction où il pousse (plan xz du monde). Les ondes y
 * sont tirées ; un point du monde y entre par `kasbahToWind`, une pente en sort par `kasbahFromWind`.
 * La carte des caustiques est une tuile de CE repère : le fond la lit donc par `kasbahToWind` aussi.
 */
const WIND_FRAME = /* glsl */`
uniform vec3 uWaterWind;
vec2 kasbahToWind(vec2 w) { return vec2(dot(w, uWaterWind.xy), dot(w, vec2(-uWaterWind.y, uWaterWind.x))); }
vec2 kasbahFromWind(vec2 v) { return vec2(v.x * uWaterWind.x - v.y * uWaterWind.y, v.x * uWaterWind.y + v.y * uWaterWind.x); }
`

/**
 * La PENTE de la houle (son gradient), pas sa hauteur : c'est elle qui incline la normale. `px` est
 * la taille d'un pixel au sol (m) : une onde plus courte que quelques pixels s'efface au lieu de
 * scintiller. La passe des caustiques la demande à 0 (elle veut toutes les ondes). La phase est
 * `k·p − ωt` : chaque onde AVANCE dans le sens de son vecteur, donc sous le vent. `p` et le
 * résultat sont dans le repère du vent, l'amplitude est celle du vent (`uWaterWind.z`).
 */
const WAVE_GRAD = /* glsl */`
vec2 kasbahWaveGrad(vec2 p, float t, float px) {
  vec2 g = vec2(0.0);
  vec2 k;
${WAVES.map(({ kx, ky, a, w, phase }) => `  k = vec2(${glsl(kx)}, ${glsl(ky)});
  g += k * (${glsl(a)} * cos(dot(k, p) - ${glsl(w)} * t + ${glsl(phase)}) * (1.0 - smoothstep(0.15, 0.5, px * ${glsl(Math.hypot(kx, ky) / (2 * Math.PI))})));`).join('\n')}
  return g * uWaterWind.z;
}
`

const COMMON = /* glsl */`
varying vec3 vWaterPos;
uniform float uWaterTime;
uniform float uWaterStrength;
${WIND_FRAME}`

const BASIN_COMMON = /* glsl */`
varying float vWaterDepth;
uniform sampler2D uWaterCaustics;
uniform vec3 uWaterTint;
uniform vec3 uWaterSigma;
uniform vec3 uWaterRefracted;
`

/**
 * La surface : la houle incline la normale (pente en repère MONDE, le plan d'eau est horizontal ;
 * `normal` en repère CAMÉRA — d'où `viewMatrix`), puis Fresnel décide de l'opacité : vue d'en haut
 * on voit le fond (que `BASIN_*` teinte), vue en rasant on ne voit plus que le reflet. F₀ = 0,02,
 * celui de l'eau.
 */
const SURFACE = /* glsl */`
  float waterPx = length(fwidth(vWaterPos.xz));
  vec2 waveG = kasbahFromWind(kasbahWaveGrad(kasbahToWind(vWaterPos.xz), uWaterTime, waterPx)) * uWaterStrength;
  normal = normalize(normal + (viewMatrix * vec4(-waveG.x, 0.0, -waveG.y, 0.0)).xyz);
  float waterCos = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float waterFresnel = 0.02 + 0.98 * pow(1.0 - waterCos, 5.0);
  diffuseColor.a = mix(diffuseColor.a * 0.55, 1.0, waterFresnel);
`

/**
 * Le bassin, avant l'éclairage : où tombe-t-il dans la carte des caustiques ? La carte est celle du
 * FOND ; un point de paroi y lit l'endroit où le rayon de soleil qui le touche aurait fini sa course
 * (prolongé jusqu'au fond, dans l'axe du soleil réfracté). La paroi qui fait face au soleil reçoit
 * donc le réseau, celle qui lui tourne le dos non (l'éclairage de three la laisse déjà sans soleil
 * direct). Plus un point est près de la surface, moins la houle y a concentré la lumière : le poids
 * suit la profondeur.
 */
const BASIN_PRE = /* glsl */`
  float causticDepth = clamp(vWaterDepth, 0.0, ${glsl(FLOOR_DEPTH_M)});
  vec2 causticAt = vWaterPos.xz + uWaterRefracted.xz * ((${glsl(FLOOR_DEPTH_M)} - causticDepth) / -uWaterRefracted.y);
  float caustic = texture2D(uWaterCaustics, kasbahToWind(causticAt) * ${glsl(1 / TILE_M)}).r * ${glsl(CAUSTIC_RANGE)};
  float causticWeight = sqrt(causticDepth * ${glsl(1 / FLOOR_DEPTH_M)});
`

/**
 * Les caustiques redistribuent la lumière DIRECTE (le soleil) : elles s'éteignent seules à l'ombre
 * et la nuit, et leur moyenne reste 1 — le fond n'est pas plus clair, il est tramé.
 */
const BASIN_LIGHT = /* glsl */`
  reflectedLight.directDiffuse *= mix(1.0, caustic, causticWeight * uWaterStrength);
`

/**
 * Le fond vu à travers l'eau : le chemin de la lumière (descendre jusqu'au fond, remonter vers
 * l'œil, d'autant plus long que le regard rase), l'absorption qui en découle, et la teinte que l'eau
 * diffuse à la place, à la mesure de la lumière reçue ici.
 */
const BASIN_POST = /* glsl */`
  float waterUp = max(normalize(cameraPosition - vWaterPos).y, 0.1);
  float waterPath = min(max(vWaterDepth, 0.0) * (1.0 + 1.0 / waterUp), 12.0);
  vec3 waterT = exp(-uWaterSigma * waterPath);
  float waterLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight = outgoingLight * waterT + uWaterTint * waterLum * (1.0 - waterT);
`

/** Les uniformes partagés, teinte neutre en attendant la première `setWaterTint`. */
export function createWaterUniforms(): WaterUniforms {
  return {
    time: { value: 0 },
    caustics: { value: null },
    tint: { value: new ThreeColor(1, 1, 1) },
    sigma: { value: new Vector3() },
    light: { value: new Vector3(0, -1, 0) },
    refracted: { value: new Vector3(0, -1, 0) },
    wind: { value: new Vector3(1, 0, 1) },
  }
}

/** Indice de l'eau : l'air sur l'eau, pour `refract`. */
const ETA = 1 / 1.333
/** Un soleil plus bas que ça (ou couché : la lune suit le même chemin) est tenu à cette hauteur. */
const MIN_SUN_ELEVATION = Math.sin((5 * Math.PI) / 180)

/**
 * La direction du soleil (monde three, VERS lui) : les caustiques la suivent. Un soleil bas entre en
 * biais — le réseau se décale et s'étire dans son axe, et c'est la paroi qui lui fait face qui le
 * reçoit. La réfraction ramène le rayon vers la verticale (au plus 48,6°, l'angle limite de l'eau).
 */
export function setWaterSun(u: WaterUniforms, sunDir: Vector3): void {
  const l = u.light.value.copy(sunDir).normalize().negate()
  if (-l.y < MIN_SUN_ELEVATION) {
    const h = Math.hypot(l.x, l.z) || 1
    const c = Math.sqrt(1 - MIN_SUN_ELEVATION * MIN_SUN_ELEVATION)
    l.set((l.x / h) * c, -MIN_SUN_ELEVATION, (l.z / h) * c)
  }
  // refract(l, n = (0, 1, 0), ETA), écrit à plat : eau calme
  const cosI = -l.y
  const k = Math.sqrt(1 - ETA * ETA * (1 - cosI * cosI))
  u.refracted.value.set(ETA * l.x, ETA * l.y + (ETA * cosI - k), ETA * l.z).normalize()
}

/** Sans vent, la piscine ne dort pas tout à fait (la filtration) ; par gros vent, la houle plafonne. */
const CALM_WAVES = 0.15
const MAX_WAVES = 1.5

/**
 * Le vent (convention météo : `windDirDeg` est d'où il VIENT, sens horaire, compté depuis le +y du
 * plan — le cap de la maison déjà retranché par l'appelant) : la houle
 * part sous le vent, et son amplitude suit la racine de la vitesse — 1 à 10 km/h, la houle d'avant.
 * Repère three : +x du plan = +x, +y du plan = −z.
 */
export function setWaterWind(u: WaterUniforms, windKmh: number, windDirDeg: number): void {
  const a = (windDirDeg * Math.PI) / 180
  const amp = Math.min(MAX_WAVES, CALM_WAVES + (1 - CALM_WAVES) * Math.sqrt(Math.max(windKmh, 0) / 10))
  u.wind.value.set(-Math.sin(a), Math.cos(a), amp)
}

/** La teinte de l'eau (celle du style, linéaire) : ce qu'elle diffuse, et donc ce qu'elle absorbe. */
export function setWaterTint(u: WaterUniforms, tint: Color): void {
  u.tint.value.copy(tint)
  const s = (c: number) => -Math.log(Math.max(c, 0.03)) * ABSORPTION_PER_M
  u.sigma.value.set(s(tint.r), s(tint.g), s(tint.b))
}

/**
 * Rend un matériau d'eau VIVANT. Le patch survit aux changements de style : `applyLook` mute les
 * mêmes matériaux (il ne les recrée pas), et une recompilation repasse par `onBeforeCompile`.
 * La force revient en retour : c'est le seul réglage qui bouge ensuite, image après image.
 */
export function makeWaterAlive(mat: MeshStandardMaterial, role: WaterRole, water: WaterUniforms): WaterStrength {
  const strength: WaterStrength = { value: 0 }
  const basin = role === 'basin'
  // l'eau est au jardin : aucune lampe d'intérieur ne l'atteint (`core/levelLight.ts`)
  mat.userData.noLamps = true
  mat.onBeforeCompile = (shader) => {
    applyLevelLight(shader, mat)
    applyHeightMist(shader, mat)
    applyLevelFade(shader, mat)
    applyRoomFocus(shader, mat)
    shader.uniforms.uWaterTime = water.time
    shader.uniforms.uWaterStrength = strength
    shader.uniforms.uWaterWind = water.wind
    if (basin) {
      shader.uniforms.uWaterCaustics = water.caustics
      shader.uniforms.uWaterTint = water.tint
      shader.uniforms.uWaterSigma = water.sigma
      shader.uniforms.uWaterRefracted = water.refracted
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWaterPos;${basin ? `\nattribute float ${WATER_DEPTH_ATTRIBUTE};\nvarying float vWaterDepth;` : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n  vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;${basin ? `\n  vWaterDepth = ${WATER_DEPTH_ATTRIBUTE};` : ''}`)
    let frag = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}${basin ? BASIN_COMMON : WAVE_GRAD}`)
      // après l'émissive : la normale y est posée (cartes comprises) et `lights_fragment_begin`,
      // qui la lira, n'est pas encore passé.
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${basin ? BASIN_PRE : SURFACE}`)
    if (basin) {
      frag = frag
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${BASIN_LIGHT}`)
        .replace('#include <opaque_fragment>', `${BASIN_POST}\n#include <opaque_fragment>`)
    }
    shader.fragmentShader = frag
  }
  // Sans clé propre, three réutiliserait le programme d'un matériau standard aux mêmes réglages —
  // et l'eau serait rendue par un shader qui n'a pas reçu le patch.
  mat.customProgramCacheKey = () => `kasbah-water-${role}`
  mat.needsUpdate = true
  return strength
}

const CAUSTIC_VERTEX = /* glsl */`
uniform float uTime;
uniform vec3 uLight;
out vec2 vOld;
out vec2 vNew;
${WIND_FRAME}${WAVE_GRAD}
void main() {
  // neuf copies de la tuile (3 × 3) : un rayon dévié hors de la tuile retombe chez la voisine
  vec2 offset = vec2(float(gl_InstanceID % 3) - 1.0, float(gl_InstanceID / 3) - 1.0);
  vec2 p = position.xy * ${glsl(TILE_M)};
  vec2 g = kasbahWaveGrad(p, uTime, 0.0);
  // la tuile est dans le repère du vent : le soleil y entre aussi
  vec2 l = kasbahToWind(uLight.xz);
  vec3 r = refract(vec3(l.x, uLight.y, l.y), normalize(vec3(-g.x, 1.0, -g.y)), ${glsl(ETA)});
  vec2 q = p + r.xz * (${glsl(FLOOR_DEPTH_M)} / -r.y);
  vOld = p;
  vNew = q;
  gl_Position = vec4((q * ${glsl(1 / TILE_M)} + offset) * 2.0 - 1.0, 0.0, 1.0);
}
`

// L'intensité : l'aire d'une maille à la surface sur l'aire qu'elle couvre au fond. Des mailles
// repliées se recouvrent, et le mélange additif les somme.
const CAUSTIC_FRAGMENT = /* glsl */`
in vec2 vOld;
in vec2 vNew;
void main() {
  vec2 ox = dFdx(vOld), oy = dFdy(vOld), nx = dFdx(vNew), ny = dFdy(vNew);
  float ratio = abs(ox.x * oy.y - ox.y * oy.x) / max(abs(nx.x * ny.y - nx.y * ny.x), 1e-12);
  gl_FragColor = vec4(vec3(ratio * ${glsl(1 / CAUSTIC_RANGE)}), 1.0);
}
`

const clearColor = new ThreeColor()

/**
 * La carte des caustiques : une tuile de fond, redessinée quand l'eau ou le soleil ont bougé. Rendue
 * AVANT l'image, par `HouseScene.render` ; lue par le matériau du bassin, en répétition.
 */
export class WaterCaustics {
  readonly target = new WebGLRenderTarget(CAUSTIC_PX, CAUSTIC_PX, {
    depthBuffer: false, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
    wrapS: RepeatWrapping, wrapT: RepeatWrapping,
  })
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera()
  private readonly material: ShaderMaterial
  private readonly geometry = new InstancedBufferGeometry()
  private drawnAt = Number.NaN
  private readonly drawnLight = new Vector3()
  private readonly drawnWind = new Vector3()

  constructor(private readonly water: WaterUniforms) {
    const plane = new PlaneGeometry(1, 1, CAUSTIC_GRID, CAUSTIC_GRID).translate(0.5, 0.5, 0)
    this.geometry.index = plane.index
    this.geometry.setAttribute('position', plane.getAttribute('position'))
    this.geometry.instanceCount = 9
    this.material = new ShaderMaterial({
      uniforms: { uTime: water.time, uLight: water.light, uWaterWind: water.wind },
      vertexShader: CAUSTIC_VERTEX,
      fragmentShader: CAUSTIC_FRAGMENT,
      blending: AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    })
    const mesh = new Mesh(this.geometry, this.material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
  }

  get texture(): Texture { return this.target.texture }

  /** Redessine la carte si l'eau, le soleil ou le vent ont bougé depuis ; remet le renderer comme il l'a trouvé. */
  update(r: WebGLRenderer): void {
    const w = this.water
    if (w.time.value === this.drawnAt && w.light.value.equals(this.drawnLight) && w.wind.value.equals(this.drawnWind)) return
    this.drawnAt = w.time.value
    this.drawnLight.copy(w.light.value)
    this.drawnWind.copy(w.wind.value)
    const prevTarget = r.getRenderTarget()
    const prevAlpha = r.getClearAlpha()
    r.getClearColor(clearColor)
    r.setRenderTarget(this.target)
    r.setClearColor(0x000000, 1)
    r.clear(true, false, false)
    r.render(this.scene, this.camera)
    r.setClearColor(clearColor, prevAlpha)
    r.setRenderTarget(prevTarget)
  }

  dispose(): void {
    this.target.dispose()
    this.geometry.dispose()
    this.material.dispose()
  }
}
