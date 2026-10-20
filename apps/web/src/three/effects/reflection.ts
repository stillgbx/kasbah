import { CubeCamera, HalfFloatType, LinearMipmapLinearFilter, WebGLCubeRenderTarget, type Object3D, type Scene, type Texture, type Vector3, type WebGLRenderer } from 'three'

// FROZEN reflection of the pool: a cube probe placed above the water, which photographs the scene
// (facade, trees, sky) in all six directions and serves as the environment map of the water
// surface alone. Without it, the water reflects only the sky (`scene.environment`).
//
// Frozen because a mirror recomputed every frame costs one more full render per frame — ruinous
// on the targeted iGPU (see the "hybrid GPU perf" memory). The probe is only redone when what it
// sees changes (house, garden, relief, style, hour), and `HouseScene` decides that.
//
// Only layer 0 is photographed (the six cameras of a `CubeCamera` see no other):
// halos, edit rings and contact shadows, all on a decor layer, do not appear in the
// reflection — that is intended, they are not objects.

/** Side of a face (px): the reflection is blurred by roughness and rippled by the swell, 256 is enough. */
const PROBE_SIZE = 256

export class ReflectionProbe {
  private readonly target = new WebGLCubeRenderTarget(PROBE_SIZE, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter })
  private readonly camera = new CubeCamera(0.05, 400, this.target)

  get texture(): Texture { return this.target.texture }

  /**
   * Photographs the scene from `at` (world). `hide`: what must not reflect itself (the
   * water surface). `background`: the sky, set for the duration of the six renders — the scene has no
   * background (the canvas is cleared to the horizon color), the reflection would otherwise have a flat sky.
   */
  update(renderer: WebGLRenderer, scene: Scene, at: Vector3, hide: readonly Object3D[], background: Texture | null): void {
    const shown = hide.map((o) => o.visible)
    for (const o of hide) o.visible = false
    const previous = scene.background
    const previousIntensity = scene.backgroundIntensity
    scene.background = background
    // the reflection's sky shines like the one lighting the materials, no more: the night stays night
    scene.backgroundIntensity = scene.environmentIntensity
    this.camera.position.copy(at)
    this.camera.update(renderer, scene)
    scene.background = previous
    scene.backgroundIntensity = previousIntensity
    hide.forEach((o, i) => { o.visible = shown[i]! })
    // the roughness-dependent blur goes through a PMREM that three rebuilds on demand
    this.target.texture.needsPMREMUpdate = true
  }

  dispose(): void { this.target.dispose() }
}
