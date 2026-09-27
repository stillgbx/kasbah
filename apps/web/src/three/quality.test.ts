import { describe, expect, it, vi } from 'vitest'
import type * as Post from './core/post'
import type { PostPipelineDeps } from './core/post'
import { HouseScene } from './HouseScene'

// La chaîne d'effets est remplacée par un faux qui garde ses dépendances : c'est par elles que le
// garde-fou parle à la scène (`onDowngrade`).
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

describe('le garde-fou de qualité', () => {
  /** Une qualité CHOISIE est un choix : la machine rame peut-être, mais c'est l'utilisateur qui l'a voulu. */
  it('ne touche pas à une qualité forcée', () => {
    const scene = sceneWithRenderer()
    scene.setOptions({ quality: 'high' })
    expect(built.at(-1)!.onDowngrade).toBeUndefined()
    expect(quality(scene)).toBe('high')
    ;(scene as unknown as { renderer: null }).renderer = null
    scene.dispose()
  })

  /** En « auto », il descend — d'un cran à la fois — sans que le réglage cesse d'être « auto ». */
  it('en auto, descend d’un cran et reste en auto', () => {
    const scene = sceneWithRenderer()
    scene.setOptions({ quality: 'medium' })
    scene.setOptions({ quality: 'auto' })
    built.at(-1)!.onDowngrade!('low')
    expect(quality(scene)).toBe('low')
    expect((scene as unknown as { options: { quality: string } }).options.quality).toBe('auto')
    scene.setOptions({ quality: 'high' })                  // un choix explicite repart de zéro…
    scene.setOptions({ quality: 'auto' })                  // …et « auto » refait sa détection
    expect(quality(scene)).not.toBe('low')
    ;(scene as unknown as { renderer: null }).renderer = null
    scene.dispose()
  })
})
