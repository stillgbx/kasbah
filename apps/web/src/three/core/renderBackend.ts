import type { Camera, Scene, WebGLRenderer } from 'three'
import type { EffectiveQuality, PostPipeline } from './post'

// TWO RENDERERS. `WebGLRenderer` is the default; `WebGPURenderer` (three's node materials, TSL) is
// an option of Settings → 3D rendering. Measured on 2026-11-04 (integrated Radeon, demo house):
// WebGPU costs 1.3 to 1.9 times the GPU time of WebGL at every quality, for about half its CPU
// time — the scene being GPU-bound on the target machines, WebGL stays the default. The bench is
// in the wiki (`doc/1_architecture/1_11_scene-3d-rendu.md`): rerun it at each three upgrade.
//
// Everything WebGPU lives in `three/gpu/`, loaded ON DEMAND: the default renderer does not download
// it. This file is the contract between the two, and imports nothing from `three/webgpu`.
//
// EVERY shader effect therefore exists twice: GLSL patches (`onBeforeCompile`, `ShaderMaterial`) for
// WebGL, TSL nodes in `three/gpu/` for WebGPU, reading the SAME uniform objects. A change to one is
// a change to the other, and `scripts/bench-3d/parity.mjs` checks that both still draw the same house.

export type RendererChoice = 'webgl' | 'webgpu'
export const RENDERER_CHOICES: readonly RendererChoice[] = ['webgl', 'webgpu']

/** What `HouseScene` asks of the WebGPU side. */
export interface GpuBackend {
  /**
   * A `WebGPURenderer`, typed as the WebGL one: the scene only calls their common API, and tests
   * `isWebGPU` where they differ. `init()` must resolve before the first frame (`HouseScene` waits for it).
   */
  createRenderer(canvas: HTMLCanvasElement): WebGLRenderer
  createPostPipeline(deps: GpuPostDeps): PostPipeline
  /**
   * Before each frame: what WebGPU does not do by itself — the shadows redrawn on demand (it has no
   * `shadowMap.autoUpdate`, each light carries its own), the sized points (`gpu/points.ts`).
   */
  prepareFrame(scene: Scene, camera: Camera, rebuildShadows: boolean): void
}

export interface GpuPostDeps {
  renderer: WebGLRenderer
  scene: Scene
  camera: Camera
  quality: EffectiveQuality
  /** What `renderScene` does before drawing (level bounds, shadows on demand): the pipeline draws the scene itself. */
  beforeRender: () => void
  onDowngrade?: (to: EffectiveQuality) => void
}

export const isWebGPU = (renderer: unknown): boolean => (renderer as { isWebGPURenderer?: boolean } | null)?.isWebGPURenderer === true

/** WebGPU exists in this browser (the adapter may still be refused: three then falls back to WebGL 2). */
export const webgpuAvailable = (): boolean => typeof navigator !== 'undefined' && 'gpu' in navigator

export async function loadGpuBackend(): Promise<GpuBackend> {
  const m = await import('../gpu')
  return m.gpuBackend
}
