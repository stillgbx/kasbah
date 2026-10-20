import { DataTexture, EquirectangularReflectionMapping, FloatType, LinearFilter, PMREMGenerator, RGBAFormat, type Texture, type Vector3, type WebGLRenderer } from 'three'
import type { SkyLook } from '../styles/types'

// What the house REFLECTS. A PBR material only renders its reflections — and the whole of its metallic
// part — from an environment map; without it, walls, glass, water and car bodies
// render as clay. The map was until now reserved for vehicles, "`scene.environment`
// would touch walls, roof and solar panels, which is another decision": that decision is
// made, and it is set on the whole scene. It is what makes the difference between a maquette
// and a pile of gray polygons.
//
// Three things matter, and none is a detail:
//  - the dark GROUND, which gives the bottom of the volumes their footing;
//  - the bright and TIGHT HORIZON (`|sin φ|^0.45`, not a linear interpolation): it is this
//    line that sweeps across a curved surface as you turn around it, and it is what makes a curve read;
//  - a SUN in HDR values (`FloatType`, well beyond 1). A spot capped at 1 does not make
//    a reflection, it makes a gray spot — it is the overshoot that gives the bright point.
//
// The sky itself is never DISPLAYED: the scene background stays the app's (the infinite ground of
// `buildHouse`), as on the maquette. It only serves to light and to be reflected.

/** Equirectangular: width = the full turn, height = from bottom to top. Small, everything will be blurred anyway. */
const W = 128
const H = 64
/** Angular radius of the solar disc, as a cosine: 0.993 ≈ 6.8°. Wide — the PMREM spreads it, it does not concentrate it. */
const SUN_COS = 0.993

/**
 * The raw gradient, in floats. three's sampling convention is
 * `u = atan2(z, x) / 2π + 0.5`, `v = asin(y) / π + 0.5`: row 0 looks DOWN.
 * `sun` is a unit vector pointing TOWARD the sun, in the world reference frame.
 */
function skyTexture(look: SkyLook, sun: Vector3): DataTexture {
  const data = new Float32Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    const phi = ((y + 0.5) / H - 0.5) * Math.PI            // -π/2 (bottom) → +π/2 (top)
    const cp = Math.cos(phi), sp = Math.sin(phi)
    // `h` = 0 at the horizon, 1 at both poles: the bright band tightens around the horizon instead
    // of diluting over the whole half of the sky.
    const h = Math.abs(sp) ** 0.45
    const far = sp >= 0 ? look.zenith : look.ground
    for (let x = 0; x < W; x++) {
      const theta = ((x + 0.5) / W - 0.5) * 2 * Math.PI
      const dx = Math.cos(theta) * cp, dy = sp, dz = Math.sin(theta) * cp
      const dot = dx * sun.x + dy * sun.y + dz * sun.z
      const glare = Math.max(0, (dot - SUN_COS) / (1 - SUN_COS))
      const disc = look.sunGlare * glare * glare
      const i = (y * W + x) * 4
      for (let c = 0; c < 3; c++) {
        data[i + c] = look.horizon[c]! + (far[c]! - look.horizon[c]!) * h + look.sunColor[c]! * disc
      }
      data[i + 3] = 1
    }
  }
  const tex = new DataTexture(data, W, H, RGBAFormat, FloatType)
  tex.mapping = EquirectangularReflectionMapping
  tex.magFilter = tex.minFilter = LinearFilter
  tex.needsUpdate = true
  return tex
}

/**
 * The map ready to set on `scene.environment`. The PMREM prefilters the sky for all
 * roughnesses, once: without it, a matte surface would pick a sharp pixel and flicker.
 *
 * `null` without a renderer (headless mode, tests): the materials then keep their diffuse render, which
 * prevents nothing from working.
 */
export function createSkyEnvironment(renderer: WebGLRenderer | null, look: SkyLook, sun: Vector3): Texture | null {
  if (!renderer) return null
  const source = skyTexture(look, sun)
  const pmrem = new PMREMGenerator(renderer)
  const target = pmrem.fromEquirectangular(source)
  pmrem.dispose()
  source.dispose()
  return target.texture
}

/**
 * The same sky under the clouds: the colors lose their saturation and the zenith darkens as
 * the cover rises, the solar disc goes out. Central — each style keeps its
 * clear sky, the weather grays it the same for all; it is what the camera sees in the reflections and
 * in the canvas background.
 */
export function overcastSky(look: SkyLook, cloudiness: number): SkyLook {
  const c = Math.min(1, Math.max(0, cloudiness))
  if (c <= 0) return look
  const grey = (rgb: readonly [number, number, number], darken: number, amount: number): [number, number, number] => {
    const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) * darken
    return [rgb[0] + (lum - rgb[0]) * amount, rgb[1] + (lum - rgb[1]) * amount, rgb[2] + (lum - rgb[2]) * amount]
  }
  return {
    ...look,
    zenith: grey(look.zenith, 1 - 0.35 * c, 0.85 * c),
    horizon: grey(look.horizon, 1 - 0.15 * c, 0.7 * c),
    sunGlare: look.sunGlare * (1 - c),
  }
}
