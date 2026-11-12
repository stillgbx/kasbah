import { Vector3, WebGLRenderTarget } from 'three'
import { RenderPipeline, type Node, type WebGPURenderer } from 'three/webgpu'
import { dot, length, max, mix, mrt, normalView, output, packNormalToRGB, pass, pow, renderOutput, sample, smoothstep, uniform, unpackRGBToNormal, uv, vec3, vec4 } from 'three/tsl'
import { ao as gtao } from 'three/addons/tsl/display/GTAONode.js'
import { bloom as bloomOf } from 'three/addons/tsl/display/BloomNode.js'
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js'
import { NEUTRAL_GRADE, type PostLook } from '../styles/types'
import { createCostGuard, toneMappingOf, type PostPipeline } from '../core/post'
import type { GpuPostDeps } from '../core/renderBackend'
import { tiltShift } from './tiltShift'
import { lensWater } from './lensWater'

// `core/post.ts` as a TSL `RenderPipeline`. Same order: scene (MSAA 4×) → occlusion (high) → bloom →
// output (tone mapping, sRGB) → grade + vignette → tilt-shift → water on the lens.
//
// What differs:
//  - the occlusion reads the normals the scene pass writes NEXT to its colour (MRT), where `GTAOPass`
//    draws the whole scene a second time (382 k triangles instead of 253 k, demo house). It does not
//    make up for the heavier shaders: high costs 41-45 ms of GPU here against 24-30 in WebGL;
//  - WebGPU only knows 1 or 4 samples: medium (2× in WebGL) gets 4×;
//  - the decor layers (`DECOR_LAYER`: a lamp's additive halo) are in the normal buffer: the WebGL
//    occlusion turns them off for its capture, the MRT has no second capture to turn them off in.
//    Halos write no depth, the effect is limited to their own pixels.
//  - the safeguard times the INTERVAL between two frames of a gesture (the WebGL chain's fallback
//    without a timer query): a GPU-bound machine shows its cost there.

export function createGpuPostPipeline(deps: GpuPostDeps): PostPipeline {
  const renderer = deps.renderer as unknown as WebGPURenderer
  const { scene, camera, quality } = deps

  const scenePass = pass(scene, camera, { samples: 4 })
  if (quality === 'high') scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }))
  const color = scenePass.getTextureNode('output')

  const occlusion = quality === 'high' ? (() => {
    const depth = scenePass.getTextureNode('depth')
    const normalTex = scenePass.getTextureNode('normal')
    const normal = sample((at) => unpackRGBToNormal(normalTex.sample(at)))
    const node = gtao(depth, normal, camera)
    return { node, denoised: denoise(node.getTextureNode(), depth, normal, camera) as unknown as Node<'vec4'> }
  })() : null
  const aoIntensity = uniform(1)

  const bloom = bloomOf(color, 0.5, 0.5, 0.8)

  const vignette = uniform(0)
  const lift = uniform(new Vector3(0, 0, 0))
  const invGamma = uniform(new Vector3(1, 1, 1))
  const gain = uniform(new Vector3(1, 1, 1))
  const saturation = uniform(1)
  const tilt = tiltShift()
  const lens = lensWater()
  let wet = false

  const build = (withAo: boolean, withBloom: boolean, withTilt: boolean, withLens: boolean): Node => {
    let lit = color as unknown as Node<'vec4'>
    if (withAo && occlusion) lit = vec4(color.rgb.mul(mix(1, occlusion.denoised.r, aoIntensity)), color.a)
    if (withBloom) lit = lit.add(bloom)
    // the grade and the vignette in DISPLAY space, after tone mapping, as in `VignetteOutputPass`
    const shown = renderOutput(lit)
    const c0 = shown.rgb
    const graded = pow(max(gain.mul(c0.add(lift.mul(c0.oneMinus()))), 0), invGamma)
    const saturated = mix(vec3(dot(graded, vec3(0.2126, 0.7152, 0.0722))), graded, saturation)
    const d = length(uv().sub(0.5)).mul(1.41421356)
    const finished = vec4(saturated.mul(vignette.mul(smoothstep(0.35, 1, d)).oneMinus()), shown.a)
    const sharp = withTilt ? tilt.apply(finished) : finished
    return withLens ? lens.apply(sharp) : sharp
  }

  const pipeline = new RenderPipeline(renderer, build(!!occlusion, true, false, false))
  pipeline.outputColorTransform = false   // done by `renderOutput`, BEFORE the grade
  let built = `${!!occlusion}|true|false|false`
  let look: PostLook | null = null
  // a pass that is off leaves the graph, as `enabled = false` does in the composer
  const rebuild = () => {
    const ao = !!occlusion && look?.ao !== null
    const bl = look ? look.bloom !== null : true
    const ts = !!look?.tiltShift && look.tiltShift.strength > 0
    const key = `${ao}|${bl}|${ts}|${wet}`
    if (key === built) return
    built = key
    pipeline.outputNode = build(ao, bl, ts, wet)
    pipeline.needsUpdate = true
  }

  const guard = createCostGuard(() => deps.onDowngrade?.(quality === 'high' ? 'medium' : 'low'))
  let lastStart = 0

  return {
    quality,
    sceneTarget: new WebGLRenderTarget(1, 1),   // only read to precompile in WebGL
    setSize() { /* the passes follow the renderer's size and pixel ratio */ },
    setLook(next: PostLook) {
      look = next
      renderer.toneMapping = toneMappingOf(look)
      renderer.toneMappingExposure = look.exposure
      if (look.bloom) { bloom.strength.value = look.bloom.strength; bloom.radius.value = look.bloom.radius; bloom.threshold.value = look.bloom.threshold }
      if (look.ao && occlusion) {
        aoIntensity.value = look.ao.intensity
        occlusion.node.radius.value = look.ao.radius
      }
      vignette.value = look.vignette
      const g = look.grade ?? NEUTRAL_GRADE
      lift.value.set(...g.lift)
      invGamma.value.set(1 / g.gamma[0], 1 / g.gamma[1], 1 / g.gamma[2])
      gain.value.set(...g.gain)
      saturation.value = g.saturation
      tilt.set(look.tiltShift)
      rebuild()
    },
    setLensWater(map) {
      lens.set(map)
      wet = map !== null
      rebuild()
    },
    render(measurable) {
      const t0 = performance.now()
      deps.beforeRender()
      pipeline.render()
      if (measurable && lastStart) guard.sample(t0 - lastStart)
      lastStart = measurable ? t0 : 0
    },
    dispose() { pipeline.dispose() },
  }
}
