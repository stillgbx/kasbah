import { ACESFilmicToneMapping, AgXToneMapping, HalfFloatType, NeutralToneMapping, NoToneMapping, Vector2, WebGLRenderTarget, type Camera, type Scene, type ToneMapping, type WebGLRenderer } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Pass } from 'three/addons/postprocessing/Pass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { DECOR_LAYER, SITE_DECOR_LAYER } from './layers'
import type { PostLook } from '../styles/types'

// Le POST-TRAITEMENT : ce qui sépare un rendu direct d'une image. Trois choses, dans cet ordre.
//
//  1. Le TONE MAPPING. La scène est calculée en valeurs linéaires non bornées (une lampe vaut 20,
//     pas 1) ; sans courbe pour ramener ça à l'écran, tout ce qui dépasse devient un aplat blanc et
//     la nuit devient un aplat noir. C'est le réglage qui décide si la maison est lisible.
//  2. L'OCCLUSION AMBIANTE (GTAO). Elle assombrit les angles rentrants, le pied des murs, le dessous
//     des objets. C'est elle qui POSE les volumes les uns sur les autres — sans elle, une maison
//     reste un empilement de faces qui flottent, quelle que soit la finesse des matières.
//  3. Le BLOOM. Ce qui dépasse le seuil bave sur ses voisins : le halo des lampes de la maquette.
//     La scène en faisait déjà une imitation par sprite additif (`GLOW`), qui reste — les deux se
//     complètent, l'un donne le volume de la source, l'autre la diffusion dans l'image.
//
// Puis une vignette, en espace d'affichage, parce que c'est là qu'elle se règle à l'œil.
//
// COÛT : ces passes sont payées à chaque image rendue. Le rendu étant à la demande
// (`core/renderLoop.ts`), le coût au repos reste nul — mais pendant un vol de caméra sur tablette,
// il compte. D'où les trois niveaux de `RenderQuality`, et le garde-fou qui descend d'un cran tout
// seul si les images coûtent trop cher.

/** Ce que l'utilisateur choisit. `auto` mesure la machine, puis se corrige si les images traînent. */
export type RenderQuality = 'auto' | 'high' | 'medium' | 'low'
export const RENDER_QUALITIES: readonly RenderQuality[] = ['auto', 'high', 'medium', 'low']

/** Ce qui est réellement appliqué. */
export type EffectiveQuality = 'high' | 'medium' | 'low'

/** Plafond du rapport de pixels selon la qualité : c'est le levier le moins visible et le plus rentable. */
export const PIXEL_RATIO: Record<EffectiveQuality, number> = { high: 2, medium: 1.5, low: 1.25 }
/** Anticrénelage matériel du tampon intermédiaire (MSAA). 0 en bas de gamme. */
const SAMPLES: Record<EffectiveQuality, number> = { high: 4, medium: 2, low: 0 }

const TONE_MAPPING: Record<PostLook['toneMapping'], ToneMapping> = {
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
  linear: NoToneMapping,
}

/** La courbe de tone mapping d'un style : le renderer l'applique lui-même quand il n'y a pas de chaîne. */
export const toneMappingOf = (look: PostLook): ToneMapping => TONE_MAPPING[look.toneMapping]

/** Le nom du GPU tel que le navigateur le donne (`ANGLE (AMD, AMD Radeon(TM) Graphics ...)`) ; vide s'il le cache. */
export function gpuName(renderer: WebGLRenderer): string {
  const gl = renderer.getContext()
  const dbg = gl.getExtension('WEBGL_debug_renderer_info')
  return String((dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? '')
}

// Un GPU INTÉGRÉ se reconnaît à son nom, et c'est lui qui décide. Mesuré sur un portable hybride
// (Ryzen 9 5900HX + RTX 3060) dont Chrome dessinait sur la Radeon intégrée : une image « high » y
// coûte 93 ms de GPU (8 img/s), « medium » 17 ms, « low » 3 ms — contre 14 ms en « high » sur la
// RTX. Or les seize cœurs et les trente-et-un gigaoctets de la même machine disent « high ».
const INTEGRATED_GPU = /\bIntel\b|Radeon\(TM\) Graphics|\bRadeon Graphics\b|\bRadeon \d{3}M\b|\bVega \d/i
/** Rendu logiciel : rien n'y est tenable au-delà de « low ». */
const SOFTWARE_GPU = /SwiftShader|llvmpipe|Basic Render Driver/i

/**
 * Ce que la machine a l'air de pouvoir tenir. Grossier par nature, mais il ne sert qu'à choisir un
 * point de départ : le garde-fou de `PostPipeline` corrige ensuite à la mesure. Le nom du GPU
 * (`gpuName`) pèse plus que le reste : c'est lui qui exécute la chaîne, pas les cœurs du processeur.
 */
export function detectQuality(gpu = ''): EffectiveQuality {
  const nav = globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined
  const cores = nav?.hardwareConcurrency ?? 8
  const memory = nav?.deviceMemory ?? 8
  const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false
  if (SOFTWARE_GPU.test(gpu) || cores <= 4 || memory <= 3) return 'low'
  if (INTEGRATED_GPU.test(gpu) || coarse || cores <= 6) return 'medium'
  return 'high'
}

/**
 * Le garde-fou : `sample` reçoit le coût d'une image, `onOver` est appelé UNE fois si la MÉDIANE des
 * images observées dépasse le budget. Les premières compilent des shaders et sont ignorées ; la
 * médiane, elle, ignore les pointes isolées — l'envoi d'une texture, une carte d'environnement —
 * qu'une moyenne aurait prises pour la machine.
 */
export function createCostGuard(onOver: () => void, budgetMs = FRAME_BUDGET_MS, watched = FRAMES_WATCHED, warmup = 4): { sample(ms: number): void } {
  let frames = 0, done = false
  const costs: number[] = []
  return {
    sample(ms) {
      if (done || ++frames <= warmup) return
      costs.push(ms)
      if (frames < watched) return
      done = true
      if (costs.sort((a, b) => a - b)[costs.length >> 1]! > budgetMs) onOver()
    },
  }
}

/** Vignette appliquée APRÈS le tone mapping : c'est une atténuation d'objectif, pas une lumière. */
const VIGNETTE_SHADER = {
  uniforms: { tDiffuse: { value: null as unknown }, amount: { value: 0.3 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // distance au centre, ramenée à 1 dans les coins ; courbe douce pour qu'aucun cercle ne se voie
      float d = length(vUv - 0.5) * 1.41421356;
      c.rgb *= 1.0 - amount * smoothstep(0.35, 1.0, d);
      gl_FragColor = c;
    }
  `,
}

/** Largeur de la transition net → flou, en fraction de l'image. */
const TILT_FALLOFF = 0.35
/** Rayon (px) du flou à pleine force. */
const TILT_MAX_PX = 14

/**
 * TILT-SHIFT : une bande nette au milieu de l'image, le flou qui monte vers le haut et vers le bas.
 *
 * Ce n'est PAS une profondeur de champ : rien ici ne lit la profondeur. Et c'est fidèle — une photo
 * tilt-shift est faite avec un plan de netteté INCLINÉ, qui vu d'une caméra plongeante se lit
 * précisément comme une bande horizontale. Un vrai flou de profondeur (`BokehPass`) demanderait un
 * rendu de la scène en profondeur, alors qu'elle est déjà rendue en plusieurs passes par niveau.
 *
 * Deux passes séparables (horizontale puis verticale) plutôt qu'un noyau 2D : neuf échantillons
 * chacune au lieu de quatre-vingt-un, pour le même flou. Le rayon varie par pixel, ce qui n'est pas
 * exactement séparable — l'écart ne se voit pas, et c'est l'approximation de tous les flous d'écran.
 *
 * Appliqué APRÈS le tone mapping (comme la vignette) : c'est un défaut d'objectif, pas une lumière.
 */
const TILT_SHIFT_SHADER = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    /** Un pixel, en UV, dans la direction de la passe : (1/l, 0) puis (0, 1/h). */
    direction: { value: new Vector2(0, 0) },
    strength: { value: 0 },
    center: { value: 0.5 },
    width: { value: 0.18 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  // Les deux constantes sont INTERPOLÉES depuis le JS : `tiltBlurFactor` doit rendre exactement la
  // même courbe pour les pilules, et deux nombres recopiés à la main finissent toujours par diverger.
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 direction;
    uniform float strength;
    uniform float center;
    uniform float width;
    varying vec2 vUv;
    void main() {
      float k = smoothstep(width, width + ${TILT_FALLOFF.toFixed(2)}, abs(vUv.y - center));
      float r = k * strength * ${TILT_MAX_PX.toFixed(1)};
      if (r < 0.15) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec4 sum = vec4(0.0);
      float wsum = 0.0;
      for (int i = -4; i <= 4; i++) {
        float fi = float(i);
        float w = exp(-fi * fi / 8.0);
        sum += texture2D(tDiffuse, vUv + direction * (fi * r)) * w;
        wsum += w;
      }
      gl_FragColor = sum / wsum;
    }
  `,
}

/**
 * Combien un point de l'image est flouté, de 0 (net) à 1. `uvY` a son origine en BAS, comme le
 * shader. Sert AUSSI aux pilules des appareils, qui vivent dans le DOM et non dans le canvas : sans
 * ça, elles resteraient parfaitement nettes au-dessus d'une maison floutée (voir `HouseScene`).
 */
export function tiltBlurFactor(uvY: number, look: { center: number; width: number }): number {
  const d = Math.abs(uvY - look.center)
  const t = Math.min(1, Math.max(0, (d - look.width) / TILT_FALLOFF))
  return t * t * (3 - 2 * t)              // smoothstep, celui du shader
}

/** Dessine la scène (toutes passes de niveaux comprises) dans la cible donnée, `null` = l'écran. */
export type DrawScene = (target: WebGLRenderTarget | null) => void

/** La première passe : notre propre rendu multi-passes, là où un `RenderPass` ferait un seul `render`. */
class ScenePass extends Pass {
  constructor(private readonly draw: DrawScene) {
    super()
    this.needsSwap = false          // comme `RenderPass` : la suite lit le tampon qu'on vient d'écrire
  }

  override render(_renderer: WebGLRenderer, _write: WebGLRenderTarget, read: WebGLRenderTarget): void {
    this.draw(this.renderToScreen ? null : read)
  }
}

/**
 * L'occlusion relève la scène en profondeur et en normales : les décors ADDITIFS (le halo d'une
 * lampe) doivent en être absents, sinon elle les prend pour des obstacles et creuse un carré noir
 * sous chaque lampe allumée. Le temps du relevé, leur couche est éteinte sur la caméra.
 */
class ArchitectureGTAOPass extends GTAOPass {
  override render(renderer: WebGLRenderer, write: WebGLRenderTarget, read: WebGLRenderTarget, deltaTime = 0, maskActive = false): void {
    const mask = this.camera.layers.mask
    this.camera.layers.disable(DECOR_LAYER)
    this.camera.layers.disable(SITE_DECOR_LAYER)
    super.render(renderer, write, read, deltaTime, maskActive)
    this.camera.layers.mask = mask
  }
}

export interface PostPipeline {
  readonly quality: EffectiveQuality
  setSize(width: number, height: number, pixelRatio: number): void
  setLook(look: PostLook): void
  /**
   * Rend une image complète. Mesure son coût et peut demander une baisse de qualité. `measurable` :
   * l'image dit quelque chose de la machine — elle suit un geste (voir `renderLoop.ts`) et ne refait
   * pas la carte d'ombre. Les autres sont rendues sans être comptées.
   */
  render(measurable: boolean): void
  dispose(): void
}

export interface PostPipelineDeps {
  renderer: WebGLRenderer
  scene: Scene
  camera: Camera
  draw: DrawScene
  quality: EffectiveQuality
  /** Appelé au plus une fois, quand le garde-fou décide que la machine ne suit pas. */
  onDowngrade?: (to: EffectiveQuality) => void
  now?: () => number
}

/** Ce qu'on lit de `EXT_disjoint_timer_query_webgl2` (absent des types du DOM). */
interface TimerQueryExt { readonly TIME_ELAPSED_EXT: number; readonly GPU_DISJOINT_EXT: number }

/** Au-delà de ce coût MÉDIAN par image, la qualité descend d'un cran (≈ 25 images/s sur les vols de caméra). */
const FRAME_BUDGET_MS = 40
/** Images observées avant de trancher : à 5 images/s, c'est déjà trois secondes de saccade. */
const FRAMES_WATCHED = 16

export function createPostPipeline(deps: PostPipelineDeps): PostPipeline {
  const { renderer, scene, camera, draw, quality } = deps
  const now = deps.now ?? (() => performance.now())
  const samples = SAMPLES[quality]

  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples })
  const composer = new EffectComposer(renderer, target)
  composer.addPass(new ScenePass(draw))

  // L'occlusion n'est calculée qu'en qualité haute : c'est la passe la plus chère du lot (elle rend
  // la scène une fois de plus, en profondeur et en normales).
  const ao = quality === 'high' ? new ArchitectureGTAOPass(scene, camera, 1, 1) : null
  if (ao) {
    ao.output = GTAOPass.OUTPUT.Default
    composer.addPass(ao)
  }

  const bloom = quality === 'low' ? null : new UnrealBloomPass(new Vector2(1, 1), 0.5, 0.5, 0.8)
  if (bloom) composer.addPass(bloom)

  composer.addPass(new OutputPass())

  const vignette = new ShaderPass(VIGNETTE_SHADER)
  composer.addPass(vignette)

  // Le tilt-shift ferme la marche : il floute l'image FINIE, vignette comprise. Éteint en qualité
  // basse, comme le bloom — deux passes plein écran de plus sur une machine qui peine déjà, non.
  const tilt = quality === 'low' ? null : [new ShaderPass(TILT_SHIFT_SHADER), new ShaderPass(TILT_SHIFT_SHADER)] as const
  if (tilt) for (const pass of tilt) { pass.enabled = false; composer.addPass(pass) }

  // LE GARDE-FOU MESURE LE GPU, PAS LE FIL PRINCIPAL. `composer.render()` ne fait que SOUMETTRE des
  // commandes : 7 ms sur une machine dont le GPU met 93 ms à les exécuter — et c'est l'exécution qui
  // bride la cadence. Chronométré côté CPU, le garde-fou restait aveugle et « auto » restait « high »
  // à 8 images par seconde. Deux mesures, dans l'ordre :
  //  - une requête de temps GPU autour de chaque image (`EXT_disjoint_timer_query_webgl2`), lue
  //    quelques images plus tard quand le résultat est disponible ;
  //  - sinon (Safari, Firefox), l'intervalle entre deux images ENCHAÎNÉES par un geste : c'est le
  //    coût réel d'une image quand le GPU est le goulot, et l'écran ne le borne que par en bas.
  // Dans les deux cas, seules les images `measurable` comptent : celles d'un geste, sans relevé
  // d'ombres. Les premières images après un chargement refont la carte d'ombre pendant 700 ms et
  // envoient textures et cartes d'environnement — elles disaient « lent » de toute machine.
  const gl = renderer.getContext()
  const timer = 'createQuery' in gl ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null) : null
  const pending: WebGLQuery[] = []
  const guard = createCostGuard(() => deps.onDowngrade?.(quality === 'high' ? 'medium' : 'low'))
  let lastStart = 0
  const readQueries = (gl2: WebGL2RenderingContext, ext: TimerQueryExt) => {
    // Un « disjoint » (changement de fréquence, autre contexte) invalide tout ce qui était en vol.
    if (gl2.getParameter(ext.GPU_DISJOINT_EXT)) { for (const q of pending) gl2.deleteQuery(q); pending.length = 0; return }
    while (pending.length && gl2.getQueryParameter(pending[0]!, gl2.QUERY_RESULT_AVAILABLE)) {
      const q = pending.shift()!
      guard.sample(Number(gl2.getQueryParameter(q, gl2.QUERY_RESULT)) / 1e6)
      gl2.deleteQuery(q)
    }
  }
  const vignetteAmount = vignette.uniforms.amount as { value: number }

  return {
    quality,
    setSize(width, height, pixelRatio) {
      // `setPixelRatio` redimensionne déjà tampons ET passes : inutile de les toucher un à un.
      composer.setPixelRatio(pixelRatio)
      composer.setSize(width, height)
      if (tilt) {
        // Le pas d'échantillonnage est UN PIXEL RENDU : il suit donc la taille ET le rapport de
        // pixels, sans quoi le flou serait deux fois plus étroit sur un écran dense.
        const w = Math.max(1, width * pixelRatio), h = Math.max(1, height * pixelRatio)
        ;(tilt[0].uniforms.direction as { value: Vector2 }).value.set(1 / w, 0)
        ;(tilt[1].uniforms.direction as { value: Vector2 }).value.set(0, 1 / h)
      }
    },
    setLook(look) {
      renderer.toneMapping = TONE_MAPPING[look.toneMapping]
      renderer.toneMappingExposure = look.exposure
      if (bloom) {
        // `null` = le style ne veut pas de bloom : on l'éteint plutôt que de démonter la chaîne,
        // pour qu'un changement de style ne reconstruise pas des cibles de rendu.
        bloom.enabled = look.bloom !== null
        if (look.bloom) {
          bloom.strength = look.bloom.strength
          bloom.radius = look.bloom.radius
          bloom.threshold = look.bloom.threshold
        }
      }
      if (ao) {
        ao.enabled = look.ao !== null
        if (look.ao) {
          ao.blendIntensity = look.ao.intensity
          ao.updateGtaoMaterial({ radius: look.ao.radius, distanceExponent: 1, thickness: 1, scale: 1 })
        }
      }
      vignette.enabled = look.vignette > 0
      vignetteAmount.value = look.vignette
      if (tilt) {
        const ts = look.tiltShift
        for (const pass of tilt) {
          pass.enabled = !!ts && ts.strength > 0
          if (!ts) continue
          ;(pass.uniforms.strength as { value: number }).value = ts.strength
          ;(pass.uniforms.center as { value: number }).value = ts.center
          ;(pass.uniforms.width as { value: number }).value = ts.width
        }
      }
    },
    render(measurable) {
      if (timer) {
        const gl2 = gl as WebGL2RenderingContext
        readQueries(gl2, timer)
        const q = measurable ? gl2.createQuery() : null
        if (q) gl2.beginQuery(timer.TIME_ELAPSED_EXT, q)
        composer.render()
        if (q) { gl2.endQuery(timer.TIME_ELAPSED_EXT); pending.push(q) }
        return
      }
      const t0 = now()
      composer.render()
      if (measurable && lastStart) guard.sample(t0 - lastStart)
      lastStart = measurable ? t0 : 0
    },
    dispose() {
      if (timer) for (const q of pending) (gl as WebGL2RenderingContext).deleteQuery(q)
      pending.length = 0
      composer.dispose()
      target.dispose()
    },
  }
}
