import { CubeCamera, HalfFloatType, LinearMipmapLinearFilter, WebGLCubeRenderTarget, type Object3D, type Scene, type Texture, type Vector3, type WebGLRenderer } from 'three'

// Reflet FIGÉ de la piscine : une sonde cubique posée au-dessus de l'eau, qui photographie la scène
// (façade, arbres, ciel) dans les six directions et sert de carte d'environnement à la seule surface
// de l'eau. Sans elle, l'eau ne reflète que le ciel (`scene.environment`).
//
// Figé parce qu'un miroir recalculé à chaque image coûte un rendu complet de plus par image — ruineux
// sur l'iGPU visé (voir la mémoire « perf GPU hybride »). La sonde ne se refait que quand ce qu'elle
// voit change (maison, jardin, relief, style, heure), et c'est `HouseScene` qui en décide.
//
// Seule la couche 0 est photographiée (les six caméras d'un `CubeCamera` n'en voient pas d'autre) :
// halos, anneaux d'édition et ombres de contact, tous en couche de décor, n'apparaissent pas dans le
// reflet — c'est voulu, ce ne sont pas des objets.

/** Côté d'une face (px) : le reflet est flouté par la rugosité et ridé par la houle, 256 suffit. */
const PROBE_SIZE = 256

export class ReflectionProbe {
  private readonly target = new WebGLCubeRenderTarget(PROBE_SIZE, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter })
  private readonly camera = new CubeCamera(0.05, 400, this.target)

  get texture(): Texture { return this.target.texture }

  /**
   * Photographie la scène depuis `at` (monde). `hide` : ce qui ne doit pas se refléter lui-même (la
   * surface de l'eau). `background` : le ciel, posé le temps des six rendus — la scène n'a pas de
   * fond (le canvas est vidé à la couleur d'horizon), le reflet aurait sinon un ciel uni.
   */
  update(renderer: WebGLRenderer, scene: Scene, at: Vector3, hide: readonly Object3D[], background: Texture | null): void {
    const shown = hide.map((o) => o.visible)
    for (const o of hide) o.visible = false
    const previous = scene.background
    const previousIntensity = scene.backgroundIntensity
    scene.background = background
    // le ciel du reflet brille comme celui qui éclaire les matières, pas plus : la nuit reste la nuit
    scene.backgroundIntensity = scene.environmentIntensity
    this.camera.position.copy(at)
    this.camera.update(renderer, scene)
    scene.background = previous
    scene.backgroundIntensity = previousIntensity
    hide.forEach((o, i) => { o.visible = shown[i]! })
    // le flou selon la rugosité passe par un PMREM que three refait à la demande
    this.target.texture.needsPMREMUpdate = true
  }

  dispose(): void { this.target.dispose() }
}
