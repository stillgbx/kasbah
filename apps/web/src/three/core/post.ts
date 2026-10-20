import { ACESFilmicToneMapping, AgXToneMapping, HalfFloatType, NeutralToneMapping, NoBlending, NoToneMapping, ShaderMaterial, UniformsUtils, Vector2, Vector3, WebGLRenderTarget, type Camera, type Scene, type ToneMapping, type WebGLRenderer } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { CopyShader } from 'three/addons/shaders/CopyShader.js'
import { DECOR_LAYER, SITE_DECOR_LAYER } from './layers'
import { NEUTRAL_GRADE, type PostLook } from '../styles/types'

// POST-PROCESSING: what separates a direct render from an image. Three things, in this order.
//
//  1. TONE MAPPING. The scene is computed in unbounded linear values (a lamp is worth 20,
//     not 1); without a curve to bring that back to the screen, everything that overshoots becomes a flat white and
//     the night becomes a flat black. It is the setting that decides whether the house is readable.
//  2. AMBIENT OCCLUSION (GTAO). It darkens inside corners, the foot of the walls, the underside
//     of objects. It is what SETS the volumes on one another — without it, a house
//     stays a stack of floating faces, however fine the materials.
//  3. BLOOM. What exceeds the threshold bleeds onto its neighbors: the halo of the maquette's lamps.
//     The scene already imitated it with an additive sprite (`GLOW`), which stays — the two
//     complement each other, one gives the volume of the source, the other the diffusion in the image.
//
// Then a vignette, in display space, because that is where it is tuned by eye — in the
// output pass itself, not in a pass of its own (`VignetteOutputPass`).
//
// COST: these passes are paid on every rendered frame. Rendering being on demand
// (`core/renderLoop.ts`), the cost at rest stays zero — but during a camera flight on a tablet,
// it counts. Hence the three levels of `RenderQuality`, and the safeguard that steps down a notch on
// its own if the frames cost too much.
//
// ANTI-ALIASING (MSAA) only serves the render of the SCENE: that is where edges are born. It therefore lives
// in the target of `ScenePass`, copied once into the composer's buffer; the composer's two buffers,
// for their part, have none. Until 2026-09-25 the MSAA target was the composer's, which
// CLONES it for its second buffer: every full-screen pass (bloom, output, vignette, tilt-shift)
// wrote into a multisampled target then resolved it. Measured on an iGPU (integrated
// Radeon, 1904×905, medium quality): 22 ms of GPU per frame, 7.7 ms without — bloom went from
// 4.9 to 1.7 ms, each shader pass from 2.8 to 0.8 ms.

/** What the user chooses. `auto` measures the machine, then corrects itself if the frames lag. */
export type RenderQuality = 'auto' | 'high' | 'medium' | 'low'
export const RENDER_QUALITIES: readonly RenderQuality[] = ['auto', 'high', 'medium', 'low']

/** What is actually applied. */
export type EffectiveQuality = 'high' | 'medium' | 'low'

/** Pixel ratio ceiling by quality: it is the least visible and most profitable lever. */
export const PIXEL_RATIO: Record<EffectiveQuality, number> = { high: 2, medium: 1.5, low: 1.25 }
/** Hardware anti-aliasing of the intermediate buffer (MSAA). 0 at the low end. */
const SAMPLES: Record<EffectiveQuality, number> = { high: 4, medium: 2, low: 0 }

const TONE_MAPPING: Record<PostLook['toneMapping'], ToneMapping> = {
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
  linear: NoToneMapping,
}

/** A style's tone mapping curve: the renderer applies it itself when there is no chain. */
export const toneMappingOf = (look: PostLook): ToneMapping => TONE_MAPPING[look.toneMapping]

/** The GPU name as the browser gives it (`ANGLE (AMD, AMD Radeon(TM) Graphics ...)`); empty if it hides it. */
export function gpuName(renderer: WebGLRenderer): string {
  const gl = renderer.getContext()
  const dbg = gl.getExtension('WEBGL_debug_renderer_info')
  return String((dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? '')
}

// An INTEGRATED GPU started out as "medium" by default, based on its name: the Radeon of a hybrid laptop
// (Ryzen 9 5900HX + RTX 3060) cost 93 ms of GPU per "high" frame on 2026-09-15. Since the single
// pass and the lightened chain, it costs 26 to 46 with the real house (measured on 2026-09-27):
// it is up to the safeguard to judge, on the measurement, no longer on the name.
/** Software rendering: nothing is sustainable there beyond "low". */
const SOFTWARE_GPU = /SwiftShader|llvmpipe|Basic Render Driver/i

/**
 * What the machine seems able to sustain. Crude by nature, but it only serves to pick a
 * starting point: the `PostPipeline` safeguard then corrects by measurement. The GPU name
 * (`gpuName`) weighs more than the rest: it is what runs the chain, not the processor's cores.
 */
export function detectQuality(gpu = ''): EffectiveQuality {
  const nav = globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined
  const cores = nav?.hardwareConcurrency ?? 8
  const memory = nav?.deviceMemory ?? 8
  const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false
  if (SOFTWARE_GPU.test(gpu) || cores <= 4 || memory <= 3) return 'low'
  if (coarse || cores <= 6) return 'medium'
  return 'high'
}

/**
 * The safeguard: `sample` receives the cost of a frame, `onOver` is called ONCE if the MEDIAN of the
 * observed frames exceeds the budget. The first ones compile shaders and are ignored; the
 * median, for its part, ignores isolated spikes — a texture upload, an environment map —
 * that an average would have taken for the machine.
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

/**
 * The OUTPUT (tone mapping, color space) and the VIGNETTE in one pass: one full-screen read and
 * write fewer. The vignette is applied AFTER the sRGB conversion, as when it
 * had its own pass: it is a lens falloff, not a light. `vignette = 0` cancels it.
 */
class VignetteOutputPass extends OutputPass {
  readonly vignette = { value: 0 }
  /**
   * The grading (`GradeLook`), applied BEFORE the vignette, in display space: that is where a
   * colorist sets their curves. Neutral, it renders the image identically. `gamma` is passed INVERTED.
   */
  readonly grade = {
    lift: { value: new Vector3(0, 0, 0) },
    invGamma: { value: new Vector3(1, 1, 1) },
    gain: { value: new Vector3(1, 1, 1) },
    saturation: { value: 1 },
  }
  constructor() {
    super()
    this.uniforms.vignette = this.vignette
    this.uniforms.gradeLift = this.grade.lift
    this.uniforms.gradeInvGamma = this.grade.invGamma
    this.uniforms.gradeGain = this.grade.gain
    this.uniforms.gradeSaturation = this.grade.saturation
    const frag = this.material.fragmentShader
    const at = frag.lastIndexOf('}')
    if (!frag.includes('varying vec2 vUv;') || at < 0) throw new Error('post: OutputShader changed')
    this.material.fragmentShader = frag.slice(0, at).replace('varying vec2 vUv;', 'varying vec2 vUv;\nuniform float vignette;\nuniform vec3 gradeLift;\nuniform vec3 gradeInvGamma;\nuniform vec3 gradeGain;\nuniform float gradeSaturation;') + `
      vec3 kasbahC = gradeGain * ( gl_FragColor.rgb + gradeLift * ( 1.0 - gl_FragColor.rgb ) );
      kasbahC = pow( max( kasbahC, 0.0 ), gradeInvGamma );
      gl_FragColor.rgb = mix( vec3( dot( kasbahC, vec3( 0.2126, 0.7152, 0.0722 ) ) ), kasbahC, gradeSaturation );
      // distance to the center, brought to 1 in the corners; soft curve so that no circle shows
      float kasbahD = length( vUv - 0.5 ) * 1.41421356;
      gl_FragColor.rgb *= 1.0 - vignette * smoothstep( 0.35, 1.0, kasbahD );
    ` + frag.slice(at)
  }
}

/** Width of the sharp → blurred transition, as a fraction of the image. */
const TILT_FALLOFF = 0.35
/** Radius (px) of the blur at full strength. */
const TILT_MAX_PX = 14

/**
 * TILT-SHIFT: a sharp band in the middle of the image, the blur rising toward the top and the bottom.
 *
 * It is NOT a depth of field: nothing here reads depth. And that is faithful — a tilt-shift
 * photo is taken with a TILTED plane of focus, which seen from a downward-looking camera reads
 * precisely as a horizontal band. A true depth blur (`BokehPass`) would require one more
 * render of the scene, in depth.
 *
 * Two separable passes (horizontal then vertical) rather than a 2D kernel: nine samples
 * each instead of eighty-one, for the same blur. The radius varies per pixel, which is not
 * exactly separable — the difference does not show, and it is the approximation of all screen blurs.
 *
 * Applied AFTER tone mapping (like the vignette): it is a lens defect, not a light.
 */
const TILT_SHIFT_SHADER = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    /** One pixel, in UV, in the direction of the pass: (1/w, 0) then (0, 1/h). */
    direction: { value: new Vector2(0, 0) },
    strength: { value: 0 },
    center: { value: 0.5 },
    width: { value: 0.18 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  // The two constants are INTERPOLATED from the JS: `tiltBlurFactor` must return exactly the
  // same curve for the pills, and two numbers copied by hand always end up diverging.
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
 * How much a point of the image is blurred, from 0 (sharp) to 1. `uvY` has its origin at the BOTTOM, like the
 * shader. ALSO used for the device pills, which live in the DOM and not in the canvas: without
 * it, they would stay perfectly sharp above a blurred house (see `HouseScene`).
 */
export function tiltBlurFactor(uvY: number, look: { center: number; width: number }): number {
  const d = Math.abs(uvY - look.center)
  const t = Math.min(1, Math.max(0, (d - look.width) / TILT_FALLOFF))
  return t * t * (3 - 2 * t)              // smoothstep, the shader's
}

/** Draws the scene into the given target, `null` = the screen. */
export type DrawScene = (target: WebGLRenderTarget | null) => void

/**
 * The first pass: our own render (shadows on demand, caustics), where a `RenderPass`
 * would do a bare `render`. It carries the ANTI-ALIASING: the scene is drawn into its MSAA target, then
 * copied — resolved — into the composer's buffer, which has none (see the header).
 */
class ScenePass extends Pass {
  private readonly msaa: WebGLRenderTarget | null
  private readonly copy: FullScreenQuad | null
  private readonly copyMaterial: ShaderMaterial | null

  constructor(private readonly draw: DrawScene, samples: number) {
    super()
    this.needsSwap = false          // like `RenderPass`: what follows reads the buffer just written
    this.msaa = samples > 0 ? new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples }) : null
    // no blending: the copy replaces the buffer, alpha included (the canvas is transparent)
    this.copyMaterial = this.msaa
      ? new ShaderMaterial({ ...CopyShader, uniforms: UniformsUtils.clone(CopyShader.uniforms), blending: NoBlending, depthTest: false, depthWrite: false })
      : null
    this.copy = this.copyMaterial ? new FullScreenQuad(this.copyMaterial) : null
  }

  override setSize(width: number, height: number): void {
    this.msaa?.setSize(width, height)
  }

  override render(renderer: WebGLRenderer, _write: WebGLRenderTarget, read: WebGLRenderTarget): void {
    if (!this.msaa || this.renderToScreen) { this.draw(this.renderToScreen ? null : read); return }
    this.draw(this.msaa)
    this.copyMaterial!.uniforms.tDiffuse!.value = this.msaa.texture
    renderer.setRenderTarget(read)
    this.copy!.render(renderer)
  }

  override dispose(): void {
    this.msaa?.dispose()
    this.copyMaterial?.dispose()
    this.copy?.dispose()
  }
}

/**
 * The occlusion captures the scene in depth and normals: the ADDITIVE decorations (a lamp's
 * halo) must be absent from it, otherwise it takes them for obstacles and digs a black square
 * under every lit lamp. For the duration of the capture, their layer is turned off on the camera.
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
  /**
   * A target in the format of the one the scene is drawn into (half float, linear). Precompiling
   * the shaders while targeting the SCREEN would produce the "tone mapping + sRGB" variant, which the scene
   * never uses here: it is the output of the chain that takes care of it.
   */
  readonly sceneTarget: WebGLRenderTarget
  setSize(width: number, height: number, pixelRatio: number): void
  setLook(look: PostLook): void
  /**
   * Renders a full frame. Measures its cost and may request a quality drop. `measurable`:
   * the frame says something about the machine — it follows a gesture (see `renderLoop.ts`) and does not redo
   * the shadow map. The others are rendered without being counted.
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
  /** Called at most once, when the safeguard decides the machine cannot keep up. */
  onDowngrade?: (to: EffectiveQuality) => void
  now?: () => number
}

/** What is read from `EXT_disjoint_timer_query_webgl2` (missing from the DOM types). */
interface TimerQueryExt { readonly TIME_ELAPSED_EXT: number; readonly GPU_DISJOINT_EXT: number }

/**
 * Beyond this MEDIAN cost per frame, the quality steps down a notch (≈ 30 frames/s on camera
 * flights). 40 ms until 2026-09-25 (25 frames/s, a view that lags), then 25 ms — which made
 * the integrated Radeon step down a notch as soon as the view was touched: "high" costs 26-46 ms there with
 * the real house, "medium" 9-18 (measured on 2026-09-27). 30 frames/s sustained are worth more than an
 * impoverished image: the user's choice, the same day.
 */
const FRAME_BUDGET_MS = 33
/** Frames observed before deciding: at 5 frames/s, that is already three seconds of stutter. */
const FRAMES_WATCHED = 16

export function createPostPipeline(deps: PostPipelineDeps): PostPipeline {
  const { renderer, scene, camera, draw, quality } = deps
  const now = deps.now ?? (() => performance.now())
  const samples = SAMPLES[quality]

  // Without MSAA: it is in the scene's target (`ScenePass`), and the composer CLONES this target.
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType })
  const composer = new EffectComposer(renderer, target)
  composer.addPass(new ScenePass(draw, samples))

  // The occlusion is only computed in high quality: it is the most expensive pass of the lot (it renders
  // the scene one more time, in depth and normals).
  const ao = quality === 'high' ? new ArchitectureGTAOPass(scene, camera, 1, 1) : null
  if (ao) {
    ao.output = GTAOPass.OUTPUT.Default
    composer.addPass(ao)
  }

  const bloom = quality === 'low' ? null : new UnrealBloomPass(new Vector2(1, 1), 0.5, 0.5, 0.8)
  if (bloom) composer.addPass(bloom)

  const output = new VignetteOutputPass()
  composer.addPass(output)

  // The tilt-shift brings up the rear: it blurs the FINISHED image, vignette included. Off in low
  // quality, like the bloom — two more full-screen passes on a machine already struggling, no.
  const tilt = quality === 'low' ? null : [new ShaderPass(TILT_SHIFT_SHADER), new ShaderPass(TILT_SHIFT_SHADER)] as const
  if (tilt) for (const pass of tilt) { pass.enabled = false; composer.addPass(pass) }

  // THE SAFEGUARD MEASURES THE GPU, NOT THE MAIN THREAD. `composer.render()` only SUBMITS
  // commands: 7 ms on a machine whose GPU takes 93 ms to execute them — and it is the execution that
  // caps the frame rate. Timed on the CPU side, the safeguard stayed blind and "auto" stayed "high"
  // at 8 frames per second. Two measurements, in order:
  //  - a GPU timer query around each frame (`EXT_disjoint_timer_query_webgl2`), read
  //    a few frames later when the result is available;
  //  - otherwise (Safari, Firefox), the interval between two frames CHAINED by a gesture: it is the
  //    real cost of a frame when the GPU is the bottleneck, and the screen only bounds it from below.
  // In both cases, only `measurable` frames count: those of a gesture, without a shadow
  // capture. The first frames after a load redo the shadow map for 700 ms and
  // upload textures and environment maps — they said "slow" of any machine.
  const gl = renderer.getContext()
  const timer = 'createQuery' in gl ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null) : null
  const pending: WebGLQuery[] = []
  const guard = createCostGuard(() => deps.onDowngrade?.(quality === 'high' ? 'medium' : 'low'))
  let lastStart = 0
  const readQueries = (gl2: WebGL2RenderingContext, ext: TimerQueryExt) => {
    // A "disjoint" (frequency change, other context) invalidates everything that was in flight.
    if (gl2.getParameter(ext.GPU_DISJOINT_EXT)) { for (const q of pending) gl2.deleteQuery(q); pending.length = 0; return }
    while (pending.length && gl2.getQueryParameter(pending[0]!, gl2.QUERY_RESULT_AVAILABLE)) {
      const q = pending.shift()!
      guard.sample(Number(gl2.getQueryParameter(q, gl2.QUERY_RESULT)) / 1e6)
      gl2.deleteQuery(q)
    }
  }

  return {
    quality,
    sceneTarget: target,
    setSize(width, height, pixelRatio) {
      // `setPixelRatio` already resizes buffers AND passes: no need to touch them one by one.
      composer.setPixelRatio(pixelRatio)
      composer.setSize(width, height)
      if (tilt) {
        // The sampling step is ONE RENDERED PIXEL: it therefore follows the size AND the pixel
        // ratio, otherwise the blur would be twice as narrow on a dense screen.
        const w = Math.max(1, width * pixelRatio), h = Math.max(1, height * pixelRatio)
        ;(tilt[0].uniforms.direction as { value: Vector2 }).value.set(1 / w, 0)
        ;(tilt[1].uniforms.direction as { value: Vector2 }).value.set(0, 1 / h)
      }
    },
    setLook(look) {
      renderer.toneMapping = TONE_MAPPING[look.toneMapping]
      renderer.toneMappingExposure = look.exposure
      if (bloom) {
        // `null` = the style wants no bloom: we turn it off rather than tearing down the chain,
        // so that a style change does not rebuild render targets.
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
      output.vignette.value = look.vignette
      const g = look.grade ?? NEUTRAL_GRADE
      output.grade.lift.value.set(...g.lift)
      output.grade.invGamma.value.set(1 / g.gamma[0], 1 / g.gamma[1], 1 / g.gamma[2])
      output.grade.gain.value.set(...g.gain)
      output.grade.saturation.value = g.saturation
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
