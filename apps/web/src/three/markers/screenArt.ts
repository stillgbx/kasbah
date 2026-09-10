import { Mesh, PlaneGeometry, ShaderMaterial, SRGBColorSpace, TextureLoader, Vector2, type Texture } from 'three'

// Pochette (ou logo de l'appli) posée SUR l'écran d'un lecteur dans la scène 3D : ce que la TV du
// salon diffuse se voit sur la maquette, pas seulement dans le panneau. L'image est celle que l'état
// porte déjà (`nowPlaying.artUrl`), servie par notre propre origine — donc pas de CORS à négocier.
//
// L'image REMPLIT l'écran (comme `object-fit: cover`) : une pochette est carrée, un écran est en
// 16:9, alors on montre la bande centrale de l'image plutôt que de la déformer ou de la laisser en
// timbre au milieu d'un cadre noir (premier essai, écarté par l'utilisateur). Le calcul du cadrage
// est pur (`coverCrop`) : il ne dépend que des deux formats.
//
// PIÈGE : le cadrage est appliqué DANS le shader (`uCrop`, `uCropOffset`). `texture.repeat` et
// `texture.offset` n'agissent que par le transform d'UV des matériaux STANDARD ; un shader écrit à la
// main lit `uv` brut et les ignore en silence — l'image sortait étirée alors que le calcul était bon.
//
// Les BORDS SONT FONDUS (fondu doux sur les quatre côtés, largeur égale en mètres de tous les côtés,
// donc corrigée du format de l'écran) : sans lui, l'image collée au ras de la dalle donne un
// rectangle dur qui appartient mal à l'objet. Fondu et texture sont faits dans un petit shader —
// l'opacité varie DANS la surface, ce qu'un matériau standard ne sait pas faire.
//
// Et l'image porte un VOILE dégradé, transposition de ce que l'utilisateur fait dans ses projets web
// (`.background-shade` : un `linear-gradient(#0000, #00000040)` posé par-dessus) : une pochette pleine
// de couleurs saturées est moins criarde, et se marie mieux avec une maquette gris-bleu. En CSS c'est
// un noir semi-transparent EMPILÉ sur l'image ; ici la même chose en une multiplication, avant le
// mélange alpha — composer du noir d'opacité a sur une couleur c donne `c · (1 − a)`.
//
// Matériau NON éclairé : un écran émet sa lumière. Éclairé, il serait sombre dans une maison dont
// les lampes sont éteintes, alors que c'est précisément ce qu'on veut voir.

export type TextureLoad = (url: string, onLoad: (t: Texture) => void, onError: () => void) => void

const defaultLoad: TextureLoad = (url, onLoad, onError) => { new TextureLoader().load(url, onLoad, undefined, () => onError()) }

/**
 * Largeur du fondu, en part de la HAUTEUR de l'écran (même largeur en mètres sur les quatre bords).
 * Assez pour que l'image ne finisse pas sur une arête franche, assez peu pour qu'elle occupe l'écran.
 */
const FADE = 0.09

/** Voile noir : opacité en HAUT et en BAS de l'image (le `#0000` → `#00000040` du CSS d'origine). */
const SHADE_TOP = 0
const SHADE_BOTTOM = 0.25

/**
 * Plan orienté comme la face avant d'un écran, dans le repère LOCAL de sa boîte (X = largeur,
 * Y = profondeur, Z = hauteur) : normale vers +Y, haut de l'image vers +Z, et côté droit de l'image
 * vers −X. Ce dernier point n'est pas un détail : quelqu'un placé devant l'écran (en +Y, regardant
 * vers −Y) a sa droite en −X. Vouloir « droite = +X » avec le haut en +Z et la normale en +Y
 * demanderait un miroir (déterminant −1), pas une rotation — l'image sortirait retournée.
 */
export function screenArtGeometry(width: number, height: number): PlaneGeometry {
  const geometry = new PlaneGeometry(width, height)
  geometry.rotateX(-Math.PI / 2)
  geometry.rotateY(Math.PI)
  return geometry
}

/**
 * Cadrage « cover » d'une image de format `source` sur un écran de format `screen` (largeur /
 * hauteur) : la part de l'image à montrer et son décalage pour REMPLIR l'écran SANS JAMAIS déformer,
 * exactement comme `object-fit: cover` en CSS. Une image plus étroite que l'écran (pochette carrée
 * sur un 16:9) est rognée en haut et en bas ; une image plus large est rognée sur les côtés.
 *
 * Format de l'image inconnu (texture pas encore décodée) : on la suppose CARRÉE, jamais « on étire
 * pour remplir » — mieux vaut rogner un peu trop qu'afficher une pochette écrasée.
 */
export function coverCrop(sourceAspect: number, screenAspect: number): { repeat: [number, number]; offset: [number, number] } {
  if (!Number.isFinite(screenAspect) || screenAspect <= 0) return { repeat: [1, 1], offset: [0, 0] }
  const source = Number.isFinite(sourceAspect) && sourceAspect > 0 ? sourceAspect : 1
  if (source < screenAspect) {
    const repeatY = source / screenAspect
    return { repeat: [1, repeatY], offset: [0, (1 - repeatY) / 2] }
  }
  const repeatX = screenAspect / source
  return { repeat: [repeatX, 1], offset: [(1 - repeatX) / 2, 0] }
}

/** Format d'une image chargée ; `0` si la texture ne le dit pas (test, image non décodée). */
function aspectOf(texture: Texture): number {
  const image = texture.image as { width?: number; height?: number } | undefined
  const w = image?.width ?? 0, h = image?.height ?? 0
  return w > 0 && h > 0 ? w / h : 0
}

/**
 * Matériau de l'image : la texture, et un fondu doux vers les quatre bords. `uFade` est en unités
 * d'UV, donc plus petit en x qu'en y sur un écran large — c'est ce qui rend le fondu aussi épais
 * en haut qu'à droite.
 */
function artMaterial(fade: Vector2): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uMap: { value: null }, uFade: { value: fade },
      // cadrage « cover » : part de l'image montrée, et coin d'où on part (voir `coverCrop`)
      uCrop: { value: new Vector2(1, 1) }, uCropOffset: { value: new Vector2(0, 0) },
      // voile noir dégradé : opacité en haut, opacité en bas
      uShade: { value: new Vector2(SHADE_TOP, SHADE_BOTTOM) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec2 uFade; uniform vec2 uCrop; uniform vec2 uCropOffset; uniform vec2 uShade;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(uMap, vUv * uCrop + uCropOffset);
        // voile noir : vUv.y vaut 1 en haut de l'image (cf. l'orientation du plan)
        float shade = mix(uShade.y, uShade.x, vUv.y);
        // distance au bord le plus proche, sur chaque axe : 0 au ras du bord, 0.5 au centre
        float ax = smoothstep(0.0, uFade.x, min(vUv.x, 1.0 - vUv.x));
        float ay = smoothstep(0.0, uFade.y, min(vUv.y, 1.0 - vUv.y));
        gl_FragColor = vec4(c.rgb * (1.0 - shade), c.a * ax * ay);
      }`,
  })
}

export interface ScreenArtOptions {
  /** Largeur et hauteur de l'écran (m) : l'image le remplit. */
  width: number
  height: number
  /** Décalage en Y (m) pour poser l'image DEVANT la face, sans la traverser. */
  offsetY: number
  /** Injection pour les tests (sinon `TextureLoader`). */
  load?: TextureLoad
  /** Appelé quand une image vient d'être posée : la scène ne rend qu'à la demande. */
  onReady?: () => void
}

/**
 * L'image de l'écran d'un marqueur. `set(url)` charge et remplace ; `set(undefined)` cache. Une
 * réponse tardive dont l'URL n'est plus celle attendue est jetée (l'utilisateur a pu zapper), et la
 * texture remplacée est libérée — une texture non libérée reste en mémoire vidéo.
 */
export class ScreenArt {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>
  /** URL visée en dernier (chargée ou en cours) ; `null` = rien à afficher. */
  private wanted: string | null = null
  private texture: Texture | null = null
  private readonly load: TextureLoad
  private readonly screenAspect: number

  constructor(private readonly opts: ScreenArtOptions) {
    this.load = opts.load ?? defaultLoad
    this.screenAspect = opts.width / opts.height
    const fade = new Vector2(FADE / this.screenAspect, FADE)
    this.mesh = new Mesh(screenArtGeometry(opts.width, opts.height), artMaterial(fade))
    this.mesh.position.y = opts.offsetY
    this.mesh.visible = false
  }

  set(url: string | undefined): void {
    const next = url ?? null
    if (next === this.wanted) return
    this.wanted = next
    if (!next) { this.clear(); return }
    this.load(next, (texture) => {
      if (this.wanted !== next) { texture.dispose(); return }
      texture.colorSpace = SRGBColorSpace
      const { repeat, offset } = coverCrop(aspectOf(texture), this.screenAspect)
      const uniforms = this.mesh.material.uniforms
      ;(uniforms.uCrop!.value as Vector2).set(repeat[0], repeat[1])
      ;(uniforms.uCropOffset!.value as Vector2).set(offset[0], offset[1])
      this.texture?.dispose()
      this.texture = texture
      this.mesh.material.uniforms.uMap!.value = texture
      this.mesh.visible = true
      this.opts.onReady?.()
    }, () => {
      // image refusée ou illisible : on garde l'écran nu et on n'insiste pas
      if (this.wanted !== next) return
      this.wanted = null
      this.clear()
    })
  }

  /** Cache l'image et libère la texture : rien à afficher, rien à garder en mémoire. */
  private clear(): void {
    this.mesh.visible = false
    this.mesh.material.uniforms.uMap!.value = null
    this.texture?.dispose()
    this.texture = null
  }

  dispose(): void {
    this.wanted = null
    this.clear()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.mesh.removeFromParent()
  }
}
