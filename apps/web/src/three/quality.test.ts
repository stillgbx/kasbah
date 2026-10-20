import { describe, expect, it, vi } from 'vitest'
import './textures/prebake' // bakes the materials at import, outside the first test's timeout
import type * as Post from './core/post'
import type { PostPipelineDeps } from './core/post'
import { HouseScene } from './HouseScene'

// The effect chain is replaced by a fake that keeps its dependencies: it is through them that the
// safeguard talks to the scene (`onDowngrade`).
const built: PostPipelineDeps[] = []
vi.mock('./core/post', async (importOriginal) => ({
  ...(await importOriginal<typeof Post>()),
  gpuName: () => '',
  createPostPipeline: (deps: PostPipelineDeps) => {
    built.push(deps)
    return { quality: deps.quality, sceneTarget: null, setLook() {}, setSize() {}, render() {}, dispose() {} }
  },
}))

function sceneWithRenderer(): HouseScene {
  const scene = new HouseScene(document.createElement('canvas'), { headless: true, requestFrame: () => 0, cancelFrame: () => {} })
  ;(scene as unknown as { renderer: object }).renderer = { shadowMap: {}, setPixelRatio() {}, setSize() {}, getPixelRatio: () => 1 }
  built.length = 0
  return scene
}
const quality = (scene: HouseScene) => scene.debugStats().quality

describe('the quality safeguard', () => {
  /** A CHOSEN quality is a choice: the machine may be struggling, but the user wanted it. */
  it('does not touch a forced quality', () => {
    const scene = sceneWithRenderer()
    scene.setOptions({ quality: 'high' })
    expect(built.at(-1)!.onDowngrade).toBeUndefined()
    expect(quality(scene)).toBe('high')
    ;(scene as unknown as { renderer: null }).renderer = null
    scene.dispose()
  })

  /** In "auto", it steps down — one notch at a time — without the setting ceasing to be "auto". */
  it('in auto, steps down one notch and stays in auto', () => {
    const scene = sceneWithRenderer()
    scene.setOptions({ quality: 'medium' })
    scene.setOptions({ quality: 'auto' })
    built.at(-1)!.onDowngrade!('low')
    expect(quality(scene)).toBe('low')
    expect((scene as unknown as { options: { quality: string } }).options.quality).toBe('auto')
    scene.setOptions({ quality: 'high' })                  // an explicit choice starts from scratch…
    scene.setOptions({ quality: 'auto' })                  // …and "auto" redoes its detection
    expect(quality(scene)).not.toBe('low')
    ;(scene as unknown as { renderer: null }).renderer = null
    scene.dispose()
  })
})
