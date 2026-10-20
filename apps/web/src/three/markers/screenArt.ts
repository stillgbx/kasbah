import { Mesh, PlaneGeometry, ShaderMaterial, SRGBColorSpace, TextureLoader, Vector2, type Texture } from 'three'

// Cover art (or app logo) laid ON the screen of a player in the 3D scene: what the living room
// TV is showing can be seen on the maquette, not only in the panel. The image is the one the state
// already carries (`nowPlaying.artUrl`), served by our own origin — so no CORS to negotiate.
//
// The image FILLS the screen (like `object-fit: cover`): a cover is square, a screen is
// 16:9, so we show the central band of the image rather than distorting it or leaving it as a
// stamp in the middle of a black frame (first attempt, rejected by the user). The framing computation
// is pure (`coverCrop`): it depends only on the two aspect ratios.
//
// PITFALL: the framing is applied IN the shader (`uCrop`, `uCropOffset`). `texture.repeat` and
// `texture.offset` only act through the UV transform of STANDARD materials; a hand-written
// shader reads raw `uv` and silently ignores them — the image came out stretched while the computation was right.
//
// The image carries a gradient VEIL, a transposition of what the user does in their web projects
// (`.background-shade`: a `linear-gradient(#0000, #00000040)` laid on top): a cover full
// of saturated colors is less garish, and goes better with a blue-gray maquette. In CSS it is
// a semi-transparent black STACKED on the image; here the same thing as a multiplication, before
// alpha blending — compositing black of opacity a over a color c gives `c · (1 − a)`.
//
// Tried and REMOVED: a fade of the four edges. The plane matches the slab exactly, so the edge of
// the image falls on the edge of the screen — a real edge, which belongs to the object and does not need
// softening. The fade ate into the image without solving anything.
//
// UNLIT material: a screen emits its own light. Lit, it would be dark in a house whose
// lamps are off, whereas that is precisely what we want to see.

export type TextureLoad = (url: string, onLoad: (t: Texture) => void, onError: () => void) => void

const defaultLoad: TextureLoad = (url, onLoad, onError) => { new TextureLoader().load(url, onLoad, undefined, () => onError()) }

/** Black veil: opacity at the TOP and at the BOTTOM of the image (the `#0000` → `#00000040` of the original CSS). */
const SHADE_TOP = 0
const SHADE_BOTTOM = 0.25

/**
 * Plane oriented like the front face of a screen, in the LOCAL frame of its box (X = width,
 * Y = depth, Z = height): normal toward +Y, top of the image toward +Z, and right side of the image
 * toward −X. That last point is not a detail: someone standing in front of the screen (at +Y, looking
 * toward −Y) has their right at −X. Wanting "right = +X" with the top at +Z and the normal at +Y
 * would require a mirror (determinant −1), not a rotation — the image would come out flipped.
 */
export function screenArtGeometry(width: number, height: number): PlaneGeometry {
  const geometry = new PlaneGeometry(width, height)
  geometry.rotateX(-Math.PI / 2)
  geometry.rotateY(Math.PI)
  return geometry
}

/**
 * "Cover" framing of an image of aspect `source` on a screen of aspect `screen` (width /
 * height): the part of the image to show and its offset to FILL the screen WITHOUT EVER distorting,
 * exactly like `object-fit: cover` in CSS. An image narrower than the screen (square cover
 * on a 16:9) is cropped at the top and bottom; a wider image is cropped on the sides.
 *
 * Unknown image aspect (texture not yet decoded): we assume it is SQUARE, never "stretch
 * to fill" — better to crop a little too much than to show a squashed cover.
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

/** Aspect ratio of a loaded image; `0` if the texture does not tell (test, undecoded image). */
function aspectOf(texture: Texture): number {
  const image = texture.image as { width?: number; height?: number } | undefined
  const w = image?.width ?? 0, h = image?.height ?? 0
  return w > 0 && h > 0 ? w / h : 0
}

/**
 * Material of the image: the framed texture, darkened by the gradient veil. `transparent` stays true
 * for images that carry alpha (app logos are cut-out PNGs).
 */
function artMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uMap: { value: null },
      // "cover" framing: share of the image shown, and the corner it starts from (see `coverCrop`)
      uCrop: { value: new Vector2(1, 1) }, uCropOffset: { value: new Vector2(0, 0) },
      // gradient black veil: opacity at the top, opacity at the bottom
      uShade: { value: new Vector2(SHADE_TOP, SHADE_BOTTOM) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec2 uCrop; uniform vec2 uCropOffset; uniform vec2 uShade;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(uMap, vUv * uCrop + uCropOffset);
        // black veil: vUv.y is 1 at the top of the image (see the plane's orientation)
        float shade = mix(uShade.y, uShade.x, vUv.y);
        gl_FragColor = vec4(c.rgb * (1.0 - shade), c.a);
      }`,
  })
}

export interface ScreenArtOptions {
  /** Width and height of the screen (m): the image fills it. */
  width: number
  height: number
  /** Y offset (m) to lay the image IN FRONT of the face, without going through it. */
  offsetY: number
  /** Injection for the tests (otherwise `TextureLoader`). */
  load?: TextureLoad
  /** Called when an image has just been laid: the scene only renders on demand. */
  onReady?: () => void
}

/**
 * The image on a marker's screen. `set(url)` loads and replaces; `set(undefined)` hides. A
 * late response whose URL is no longer the expected one is discarded (the user may have switched channels), and the
 * replaced texture is freed — a texture that is not freed stays in video memory.
 */
export class ScreenArt {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>
  /** URL targeted last (loaded or in progress); `null` = nothing to display. */
  private wanted: string | null = null
  private texture: Texture | null = null
  private readonly load: TextureLoad
  private readonly screenAspect: number

  constructor(private readonly opts: ScreenArtOptions) {
    this.load = opts.load ?? defaultLoad
    this.screenAspect = opts.width / opts.height
    this.mesh = new Mesh(screenArtGeometry(opts.width, opts.height), artMaterial())
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
      // image refused or unreadable: we keep the screen bare and do not insist
      if (this.wanted !== next) return
      this.wanted = null
      this.clear()
    })
  }

  /** Hides the image and frees the texture: nothing to display, nothing to keep in memory. */
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
