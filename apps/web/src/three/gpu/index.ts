import type { LightShadow, Object3D, WebGLRenderer } from 'three'
import { WebGPURenderer } from 'three/webgpu'
import type { GpuBackend } from '../core/renderBackend'
import { createGpuPostPipeline } from './post'
import { setPointView, syncPointTwins } from './points'
import { KasbahShaderNodeMaterial } from './shaderMaterials'
import './levelLight'
import './materialHooks'

// The WebGPU side (`core/renderBackend.ts`), loaded only when Settings chooses it. Importing it
// registers, once, what replaces the GLSL patches: the point light that only lights its level, the
// hooks on every node material, the node versions of our `ShaderMaterial`s.

/** The page's renderer: one scene, one canvas. */
let current: WebGPURenderer | null = null

export const gpuBackend: GpuBackend = {
  createRenderer(canvas) {
    // the timestamps only serve the benches (`renderer.info.render.timestamp`), in development
    const r = new WebGPURenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', trackTimestamp: import.meta.env.DEV })
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    r.setClearColor(0x000000, 0)
    r.library.addMaterial(KasbahShaderNodeMaterial, 'ShaderMaterial')
    current = r
    return r as unknown as WebGLRenderer
  },
  createPostPipeline: createGpuPostPipeline,
  prepareFrame(scene, camera, rebuildShadows) {
    scene.traverse((o) => {
      const shadow = (o as Object3D & { shadow?: LightShadow }).shadow
      if (shadow) shadow.autoUpdate = rebuildShadows
    })
    setPointView(camera, current?.domElement.clientHeight ?? 1000)
    syncPointTwins(scene)
  },
}
