import { ACESFilmicToneMapping, AgXToneMapping, HalfFloatType, NeutralToneMapping, NoToneMapping, Vector2, WebGLRenderTarget, type Camera, type Scene, type ToneMapping, type WebGLRenderer } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Pass } from 'three/addons/postprocessing/Pass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { DECOR_LAYER } from './layers'
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

/**
 * Ce que la machine a l'air de pouvoir tenir. Grossier par nature — aucune API du navigateur ne dit
 * ce que vaut un GPU —, mais il ne sert qu'à choisir un point de départ : le garde-fou de
 * `PostPipeline` corrige ensuite à la mesure.
 */
export function detectQuality(): EffectiveQuality {
  const nav = globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined
  const cores = nav?.hardwareConcurrency ?? 8
  const memory = nav?.deviceMemory ?? 8
  const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false
  if (cores <= 4 || memory <= 3) return 'low'
  if (coarse || cores <= 6) return 'medium'
  return 'high'
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
    super.render(renderer, write, read, deltaTime, maskActive)
    this.camera.layers.mask = mask
  }
}

export interface PostPipeline {
  readonly quality: EffectiveQuality
  setSize(width: number, height: number, pixelRatio: number): void
  setLook(look: PostLook): void
  /** Rend une image complète. Mesure son coût et peut demander une baisse de qualité. */
  render(): void
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

/** Au-delà de ce coût moyen par image, la qualité descend d'un cran (≈ 25 images/s sur les vols de caméra). */
const FRAME_BUDGET_MS = 40
const FRAMES_WATCHED = 24

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

  let frames = 0
  let cost = 0
  let downgraded = false
  const vignetteAmount = vignette.uniforms.amount as { value: number }

  return {
    quality,
    setSize(width, height, pixelRatio) {
      // `setPixelRatio` redimensionne déjà tampons ET passes : inutile de les toucher un à un.
      composer.setPixelRatio(pixelRatio)
      composer.setSize(width, height)
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
    },
    render() {
      const t0 = now()
      composer.render()
      if (downgraded || frames >= FRAMES_WATCHED) return
      // Les toutes premières images compilent des shaders : elles ne disent rien de la machine.
      if (++frames > 4) cost += now() - t0
      if (frames === FRAMES_WATCHED && cost / (FRAMES_WATCHED - 4) > FRAME_BUDGET_MS) {
        downgraded = true
        deps.onDowngrade?.(quality === 'high' ? 'medium' : 'low')
      }
    },
    dispose() {
      composer.dispose()
      target.dispose()
    },
  }
}
