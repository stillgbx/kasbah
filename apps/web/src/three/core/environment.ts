import { DataTexture, EquirectangularReflectionMapping, FloatType, LinearFilter, PMREMGenerator, RGBAFormat, Vector3, type Texture, type WebGLRenderer } from 'three'
import type { SceneTheme } from './theme'

// Ce qu'une carrosserie REFLÈTE. Une voiture est faite de grandes surfaces lisses : tout ce qui la
// distingue d'un bloc d'argile vient des reflets, et la part métallique d'un matériau PBR ne rend
// QUE des reflets — sans carte d'environnement elle ne rend rien du tout.
//
// Trois choses comptent, et aucune n'est un détail :
//  - le SOL sombre, qui donne son assise au bas de caisse ;
//  - l'HORIZON clair, dont la ligne balaie le flanc quand on tourne autour — c'est ce trait qui
//    fait lire un galbe, et un dégradé linéaire ne le produit pas ;
//  - un SOLEIL, en valeurs HDR (bien au-delà de 1) : une tache lumineuse à 255 ne fait pas un
//    reflet, elle fait une tache grise. C'est le dépassement qui donne le point brillant.
//
// Réservé aux véhicules (`materials.vehicle`) : `scene.environment` toucherait murs, toit et
// panneaux solaires, ce qui est une autre décision que celle prise ici.

/** Ciel, horizon et sol, dans l'esprit de la `HemisphereLight` de la scène. */
const PALETTE = {
  light: { sky: [0.42, 0.52, 0.68], horizon: [0.95, 0.97, 1.0], ground: [0.12, 0.13, 0.15] },
  dark: { sky: [0.05, 0.06, 0.08], horizon: [0.3, 0.33, 0.38], ground: [0.02, 0.02, 0.03] },
} as const
/** Éclat du soleil, en multiples du blanc. Le thème sombre garde un point brillant, mais discret. */
const SUN = { light: 14, dark: 4 }
/** Rayon angulaire du disque, en cosinus : 0,985 ≈ 10°. Large — le PMREM va l'étaler, pas le concentrer. */
const SUN_COS = 0.985

/** Équirectangulaire : largeur = le tour, hauteur = du bas vers le haut. Minuscule, tout y est flou. */
const W = 64
const H = 32

/**
 * Direction du soleil de la scène (`DirectionalLight` en 14, 24, 10), normalisée. Le reflet et
 * l'ombre portée viennent ainsi du même endroit — sans quoi l'œil sent le décalage sans le nommer.
 */
const SUN_DIR = new Vector3(14, 24, 10).normalize()

/**
 * Le dégradé brut, en flottants. Rang 0 = `v` 0 = vers le BAS dans la projection équirectangulaire
 * de three (`uv.y = asin(dir.y) / π + 0.5`) : les rangs vont du sol vers le ciel.
 */
function sky(theme: SceneTheme): DataTexture {
  const p = theme.isDark ? PALETTE.dark : PALETTE.light
  const sun = theme.isDark ? SUN.dark : SUN.light
  const data = new Float32Array(W * H * 4)
  const dir = new Vector3()
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H
    const phi = (v - 0.5) * Math.PI                       // -π/2 (bas) → +π/2 (haut)
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const theta = (u - 0.5) * 2 * Math.PI
      dir.set(Math.cos(theta) * Math.cos(phi), Math.sin(phi), Math.sin(theta) * Math.cos(phi))

      // `h` = 0 à l'horizon, 1 aux deux pôles : la bande claire se serre donc autour de l'horizon
      // au lieu de se diluer sur toute la moitié haute.
      const h = Math.abs(Math.sin(phi)) ** 0.45
      const far = dir.y >= 0 ? p.sky : p.ground
      const rgb = [0, 1, 2].map((c) => p.horizon[c]! + (far[c]! - p.horizon[c]!) * h)

      const glare = Math.max(0, (dir.dot(SUN_DIR) - SUN_COS) / (1 - SUN_COS))
      const i = (y * W + x) * 4
      for (let c = 0; c < 3; c++) data[i + c] = rgb[c]! + sun * glare * glare
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
 * La carte prête à poser sur un matériau. Le PMREM pré-filtre le ciel pour toutes les rugosités,
 * une fois : sans lui, une surface mate irait piocher un pixel net et scintillerait.
 *
 * `null` sans renderer (mode sans tête, tests) : la carrosserie garde alors son rendu diffus, ce
 * qui n'empêche rien de fonctionner.
 */
export function createVehicleEnvironment(renderer: WebGLRenderer | null, theme: SceneTheme): Texture | null {
  if (!renderer) return null
  const source = sky(theme)
  const pmrem = new PMREMGenerator(renderer)
  const target = pmrem.fromEquirectangular(source)
  pmrem.dispose()
  source.dispose()
  return target.texture
}
