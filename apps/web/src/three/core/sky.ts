import { DataTexture, EquirectangularReflectionMapping, FloatType, LinearFilter, PMREMGenerator, RGBAFormat, type Texture, type Vector3, type WebGLRenderer } from 'three'
import type { SkyLook } from '../styles/types'

// Ce que la maison REFLÈTE. Un matériau PBR ne rend ses reflets — et la totalité de sa part
// métallique — qu'à partir d'une carte d'environnement ; sans elle, murs, verre, eau et carrosseries
// rendent de l'argile. La carte était jusqu'ici réservée aux véhicules, « `scene.environment`
// toucherait murs, toit et panneaux solaires, ce qui est une autre décision » : cette décision est
// prise, et elle est posée sur toute la scène. C'est elle qui fait la différence entre une maquette
// et un tas de polygones gris.
//
// Trois choses comptent, et aucune n'est un détail :
//  - le SOL sombre, qui donne son assise au bas des volumes ;
//  - l'HORIZON clair et RESSERRÉ (`|sin φ|^0.45`, pas une interpolation linéaire) : c'est cette
//    ligne qui balaie une surface courbe quand on tourne autour, et c'est elle qui fait lire un galbe ;
//  - un SOLEIL en valeurs HDR (`FloatType`, bien au-delà de 1). Une tache plafonnée à 1 ne fait pas
//    un reflet, elle fait une tache grise — c'est le dépassement qui donne le point brillant.
//
// Le ciel lui-même n'est jamais AFFICHÉ : le fond de la scène reste celui de l'app (le sol infini de
// `buildHouse`), comme sur la maquette. Il ne sert qu'à éclairer et à se refléter.

/** Équirectangulaire : largeur = le tour, hauteur = du bas vers le haut. Petite, tout y sera flouté. */
const W = 128
const H = 64
/** Rayon angulaire du disque solaire, en cosinus : 0,993 ≈ 6,8°. Large — le PMREM l'étale, il ne le concentre pas. */
const SUN_COS = 0.993

/**
 * Le dégradé brut, en flottants. La convention d'échantillonnage de three est
 * `u = atan2(z, x) / 2π + 0.5`, `v = asin(y) / π + 0.5` : le rang 0 regarde vers le BAS.
 * `sun` est un vecteur unitaire pointant VERS le soleil, dans le repère monde.
 */
function skyTexture(look: SkyLook, sun: Vector3): DataTexture {
  const data = new Float32Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    const phi = ((y + 0.5) / H - 0.5) * Math.PI            // -π/2 (bas) → +π/2 (haut)
    const cp = Math.cos(phi), sp = Math.sin(phi)
    // `h` = 0 à l'horizon, 1 aux deux pôles : la bande claire se serre autour de l'horizon au lieu
    // de se diluer sur toute la moitié du ciel.
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
 * La carte prête à poser sur `scene.environment`. Le PMREM pré-filtre le ciel pour toutes les
 * rugosités, une fois : sans lui, une surface mate irait piocher un pixel net et scintillerait.
 *
 * `null` sans renderer (mode sans tête, tests) : les matériaux gardent alors leur rendu diffus, ce
 * qui n'empêche rien de fonctionner.
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
