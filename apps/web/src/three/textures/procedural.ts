import { DataTexture, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

// Matières PROCÉDURALES des surfaces, calculées ici plutôt que chargées : l'app tourne en LAN sans
// CDN, et aucune image n'est à héberger ni à verser au dépôt (arbitrage de l'utilisateur :
// « on va au max de ce qu'on peut faire en procédural, si ça n'est toujours pas satisfaisant alors
// on ajoutera des assets »).
//
// Une matière est un RÔLE (`SurfaceRole`) : du bois, du carrelage, du gravillon. Ce sont les STYLES
// de rendu (`three/styles/`) qui disent quel rôle habille quelle surface et avec quels réglages PBR
// — le même `wood` sert de parquet réaliste et de plancher pastel, seules la couleur et la rugosité
// changent. Ajouter une matière = ajouter une entrée à `SPECS`, rien d'autre.
//
// Chaque rôle produit TROIS cartes, parce qu'une seule ne suffit pas à faire exister une surface :
//  - `map`, la couleur (luminance × teinte), que le matériau multiplie par sa couleur de style ;
//  - `normalMap`, la pente de la matière, dérivée du même relief : c'est elle qui fait accrocher la
//    lumière rasante, là où l'ancien `bumpMap` ne donnait qu'un tremblement approximatif ;
//  - `ormMap`, une carte packée (R occlusion inutilisée = 1, G rugosité, B métallicité) lue par
//    `roughnessMap` et `metalnessMap` du MÊME objet Texture — three lit le canal qu'il lui faut.
//    Le matériau multiplie : `roughness` du style = la rugosité là où la carte vaut 1.
//
// Les UV des builders sont en MÈTRES (les caps d'`ExtrudeGeometry` et `ShapeGeometry` reprennent les
// positions), donc `repeat = 1 / tileM` pose un motif à l'échelle du monde, sans couture (bruit de
// valeur périodique, hachage déterministe : la texture est la même à chaque lancement et en test).

/** Une matière disponible. Les styles y puisent ; ajouter une entrée ici suffit à en offrir une de plus. */
export type SurfaceRole =
  | 'plaster' | 'wood' | 'tile' | 'poolTile' | 'carpet' | 'concrete'
  | 'grass' | 'water' | 'pavers' | 'soil' | 'roof'
  | 'metal' | 'grid' | 'gloss' | 'stone' | 'gravel' | 'siding'

export interface SurfaceTexture {
  /** Couleur (sRGB) : luminance et teinte de la matière, à multiplier par la couleur du style. */
  map: Texture
  /** Pente de la matière (espace tangent, linéaire). */
  normalMap: Texture
  /** Échelle de la normale, en unités three (x, y). */
  normalScale: number
  /** Rugosité dans le canal G, multiplicateur de celle du style. */
  roughnessMap: Texture
  /** Métallicité dans le canal B ; `null` = uniforme, celle du style (une photo n'en a pas). */
  metalnessMap: Texture | null
  /** Côté (m) du motif avant répétition. */
  tileM: number
  /** La carte porte SA couleur (une photo) : le matériau ne la teinte pas par la palette du style. */
  colored?: boolean
}

// Règle tenue par tous les motifs : la luminance reste SOUS 1. Une matière qui sature écrête ses
// variations et rend un aplat de la couleur du style — exactement ce que la texture est censée éviter.
interface Spec {
  /** Côté (px) des cartes. */
  size: number
  /** Côté (m) du motif avant répétition. */
  tileM: number
  /** Amplitude (m) du relief : c'est elle, rapportée à `tileM`, qui donne la pente des normales. */
  relief: number
  /** Luminance en [0, 1] du point (u, v) ∈ [0, 1[². */
  shade(u: number, v: number): number
  /** Relief en [0, 1]. Par défaut la luminance : une matière claire est en saillie. */
  height?(u: number, v: number): number
  /** Rugosité en [0, 1], MULTIPLICATEUR de celle du style. Par défaut 1 (uniforme). */
  rough?(u: number, v: number): number
  /** Métallicité en [0, 1], multiplicateur de celle du style. Par défaut 1. */
  metal?(u: number, v: number): number
  /** Teinte : multiplicateurs RVB autour de 1 (une matière qui n'est pas grise sous sa couleur). */
  tint?(u: number, v: number): readonly [number, number, number]
}

// ---- bruit --------------------------------------------------------------------------------------

/** Hachage déterministe → [0, 1[ : la texture est la même à chaque lancement et dans les tests. */
function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Bruit de valeur lissé, périodique sur `period` cellules (donc la texture se répète sans couture). */
function noise(u: number, v: number, period: number, seed = 0): number {
  const x = u * period, y = v * period
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = smooth(x - x0), fy = smooth(y - y0)
  const c = (i: number, j: number) => hash(((x0 + i) % period + period) % period, ((y0 + j) % period + period) % period, seed)
  const a = c(0, 0) + (c(1, 0) - c(0, 0)) * fx
  const b = c(0, 1) + (c(1, 1) - c(0, 1)) * fx
  return a + (b - a) * fy
}

/** Plusieurs octaves, période doublée à chaque fois ; résultat centré sur 0,5. */
function fbm(u: number, v: number, period: number, octaves: number, seed = 0): number {
  let sum = 0, amp = 0.5, total = 0, p = period
  for (let i = 0; i < octaves; i++) { sum += noise(u, v, p, seed + i) * amp; total += amp; amp *= 0.5; p *= 2 }
  return sum / total
}

/**
 * Distance au joint le plus proche d'une grille de `n × n` cases, en fraction de case, et l'indice de
 * la case. Un joint DOUX (et non un seuil binaire) est ce qui distingue un carrelage d'un damier :
 * le chanfrein du bord accroche la lumière.
 */
function cell(u: number, v: number, n: number): { ix: number; iy: number; edge: number } {
  const cx = u * n, cy = v * n
  const ix = Math.floor(cx), iy = Math.floor(cy)
  const dx = Math.abs(cx - ix - 0.5), dy = Math.abs(cy - iy - 0.5)
  return { ix, iy, edge: Math.max(dx, dy) * 2 }         // 0 au centre, 1 sur le joint
}

/** Appareil à joints décalés (une assise sur deux glisse d'un demi-bloc), comme un mur de pierre. */
function brick(u: number, v: number, rows: number, cols: number, seed: number): { ix: number; iy: number; edge: number } {
  const iy = Math.floor(v * rows)
  const uu = (u + hash(0, iy, seed) * 0.5) % 1
  const ix = Math.floor(uu * cols)
  const dx = Math.abs(uu * cols - ix - 0.5) * 2
  const dy = Math.abs(v * rows - iy - 0.5) * 2
  return { ix, iy, edge: Math.max(dx, dy) }
}

/** Creux de joint : 0 loin du bord, 1 dans le joint, avec un chanfrein de `w` (fraction de case). */
const grout = (edge: number, w: number) => clamp01((edge - (1 - w)) / w)

// ---- catalogue des matières ---------------------------------------------------------------------

const SPECS: Record<SurfaceRole, Spec> = {
  // enduit fin : à peine grenu, c'est le relief qui le fait exister
  plaster: {
    size: 256, tileM: 2, relief: 0.0015,
    shade: (u, v) => 0.92 + 0.08 * fbm(u, v, 16, 3, 1),
    height: (u, v) => 0.4 * fbm(u, v, 48, 3, 1) + 0.6 * fbm(u, v, 12, 2, 21),
    rough: (u, v) => 0.92 + 0.08 * fbm(u, v, 12, 2, 22),
  },
  // lames de 12 cm sur 1,2 m, décalées d'une demi-lame par rangée, veinées dans la longueur
  wood: {
    size: 512, tileM: 2.4, relief: 0.004,
    shade: (u, v) => {
      const row = Math.floor(v * 20)                       // 20 lames de 12 cm sur 2,4 m
      const uu = (u + (row % 2) * 0.25) % 1
      const plank = Math.floor(uu * 2)                     // 2 lames de 1,2 m dans la longueur
      const tone = 0.76 + 0.22 * hash(plank, row, 7)       // chaque lame a sa teinte
      const grain = 0.9 + 0.2 * fbm(u * 6, v * 0.5 + hash(plank, row, 9), 24, 3, 2)
      const gapV = Math.abs(v * 20 - row - 0.5) > 0.47 ? 0.6 : 1   // joint entre lames
      const gapU = Math.abs(uu * 2 - plank - 0.5) > 0.49 ? 0.6 : 1
      return Math.min(1, tone * grain) * gapV * gapU
    },
    // le VEINAGE est en creux, le joint entre lames l'est franchement : deux échelles de relief
    height: (u, v) => {
      const row = Math.floor(v * 20)
      const uu = (u + (row % 2) * 0.25) % 1
      const joint = Math.abs(v * 20 - row - 0.5) > 0.45 || Math.abs(uu * 2 - Math.floor(uu * 2) - 0.5) > 0.47
      return joint ? 0 : 0.6 + 0.4 * fbm(u * 6, v * 0.5, 24, 3, 2)
    },
    // le vernis suit la lame : chaque planche s'use un peu différemment
    rough: (u, v) => 0.78 + 0.22 * hash(Math.floor((u + (Math.floor(v * 20) % 2) * 0.25) % 1 * 2), Math.floor(v * 20), 31),
    tint: (u, v) => { const w = 0.06 * (fbm(u * 6, v * 0.5, 24, 2, 33) - 0.5); return [1 + w, 1, 1 - w] as const },
  },
  // bardage à clin : 12 lames horizontales de 20 cm, chacune sur toute la longueur du motif — le mur
  // d'un chalet. Le parquet (`wood`), à lames courtes décalées, se lisait comme de la brique sur une
  // façade. Une lame est plus épaisse en bas, où elle recouvre celle du dessous : l'ombre du clin.
  siding: {
    size: 512, tileM: 2.4, relief: 0.006,
    shade: (u, v) => {
      const row = Math.floor(v * 12)
      const f = v * 12 - row                               // 0 = bas de la lame, 1 = haut
      const tone = 0.8 + 0.14 * hash(0, row, 41)
      // veinage ÉTIRÉ dans le sens de la lame (4 cellules sur sa longueur, 6 sur sa hauteur) : fin
      // dans le sens de la longueur, il hachait chaque lame en petits pavés — de la brique
      const grain = 0.9 + 0.2 * fbm(u, v * 18 + hash(1, row, 43), 4, 3, 44)
      return Math.min(1, tone * grain) * (f < 0.07 ? 0.55 : 1)
    },
    height: (u, v) => {
      const f = v * 12 - Math.floor(v * 12)
      return f < 0.07 ? 0 : 1 - 0.6 * f
    },
    rough: (_u, v) => 0.8 + 0.2 * hash(0, Math.floor(v * 12), 45),
    tint: (u, v) => { const w = 0.06 * (fbm(u, v * 18, 4, 2, 46) - 0.5); return [1 + w, 1, 1 - w] as const },
  },
  // carreaux de 60 cm, joint de 6 mm, léger nuage par carreau — sol de maison
  tile: {
    size: 512, tileM: 2.4, relief: 0.003,
    shade: (u, v) => {
      const { ix, iy, edge } = cell(u, v, 4)
      const g = grout(edge, 0.02)
      const face = 0.86 + 0.1 * hash(ix, iy, 3) + 0.08 * (fbm(u, v, 8, 2, 4) - 0.5)
      return face * (1 - 0.42 * g)
    },
    height: (u, v) => 1 - grout(cell(u, v, 4).edge, 0.035),
    // la faïence est lisse, le joint est mat : c'est ce contraste qui fait lire un carrelage
    rough: (u, v) => 0.35 + 0.65 * grout(cell(u, v, 4).edge, 0.04),
  },
  // faïence fine du bassin (plus serrée que le sol) — le procédural tient jusqu'à la photo Tiles133A
  poolTile: {
    size: 512, tileM: 1.2, relief: 0.002,
    shade: (u, v) => {
      const { ix, iy, edge } = cell(u, v, 4)
      const g = grout(edge, 0.025)
      const face = 0.9 + 0.06 * hash(ix, iy, 5) + 0.05 * (fbm(u, v, 10, 2, 7) - 0.5)
      return face * (1 - 0.35 * g)
    },
    height: (u, v) => 1 - grout(cell(u, v, 4).edge, 0.04),
    rough: (u, v) => 0.3 + 0.7 * grout(cell(u, v, 4).edge, 0.045),
  },
  // moquette : grain serré et uniforme
  carpet: {
    size: 256, tileM: 1, relief: 0.003,
    shade: (u, v) => 0.8 + 0.2 * fbm(u, v, 64, 2, 5),
    rough: () => 1,
  },
  // béton : nuages larges et piqûres fines
  concrete: {
    size: 256, tileM: 2, relief: 0.002,
    shade: (u, v) => 0.82 + 0.18 * fbm(u, v, 6, 4, 6) - (hash(Math.floor(u * 256), Math.floor(v * 256), 8) > 0.985 ? 0.15 : 0),
    height: (u, v) => 0.5 * fbm(u, v, 40, 3, 6) + 0.5 * fbm(u, v, 6, 3, 61),
    rough: (u, v) => 0.85 + 0.15 * fbm(u, v, 8, 2, 62),
  },
  // pelouse : deux échelles, la touffe et la plaque
  grass: {
    size: 256, tileM: 3, relief: 0.012,
    shade: (u, v) => 0.7 + 0.25 * fbm(u, v, 48, 3, 10) * (0.8 + 0.4 * fbm(u, v, 4, 2, 11)),
    rough: () => 1,
    // l'herbe n'est pas d'un seul vert : les creux tirent au jaune, les touffes au bleu
    tint: (u, v) => { const w = 0.1 * (fbm(u, v, 12, 2, 12) - 0.5); return [1 + w, 1, 1 - 1.4 * w] as const },
  },
  // eau : réseau clair de « caustiques » — les crêtes d'un bruit replié
  water: {
    size: 256, tileM: 4, relief: 0.01,
    shade: (u, v) => { const n = fbm(u, v, 6, 3, 12); return 0.8 + 0.2 * Math.pow(1 - Math.abs(n * 2 - 1), 4) },
    height: (u, v) => 0.5 + 0.5 * (fbm(u, v, 8, 3, 13) - 0.5),
    rough: () => 0.25,
  },
  // dalles de 40 cm posées droites, joint marqué
  pavers: {
    size: 512, tileM: 2, relief: 0.005,
    shade: (u, v) => {
      const { ix, iy, edge } = cell(u, v, 5)
      const face = 0.78 + 0.16 * hash(ix, iy, 13) + 0.12 * (fbm(u, v, 20, 2, 14) - 0.5)
      return face * (1 - 0.4 * grout(edge, 0.05))
    },
    height: (u, v) => (1 - grout(cell(u, v, 5).edge, 0.08)) * (0.85 + 0.15 * fbm(u, v, 24, 2, 15)),
    rough: (u, v) => 0.8 + 0.2 * hash(cell(u, v, 5).ix, cell(u, v, 5).iy, 16),
  },
  // terre de massif : sombre, grumeleuse
  soil: {
    size: 256, tileM: 2, relief: 0.01,
    shade: (u, v) => 0.62 + 0.36 * fbm(u, v, 32, 3, 15),
    rough: () => 1,
  },
  // toiture : gravillon / membrane, plus uniforme que le béton
  roof: {
    size: 256, tileM: 3, relief: 0.004,
    shade: (u, v) => 0.88 + 0.12 * fbm(u, v, 40, 2, 16),
    height: (u, v) => fbm(u, v, 64, 3, 16),
    rough: (u, v) => 0.88 + 0.12 * fbm(u, v, 30, 2, 17),
  },
  // gravillon d'un toit plat : grain gris serré, plus grossier que la membrane `roof`
  gravel: {
    size: 256, tileM: 1.6, relief: 0.006,
    shade: (u, v) => 0.6 + 0.3 * fbm(u, v, 56, 3, 18) + 0.1 * (hash(Math.floor(u * 256), Math.floor(v * 256), 19) - 0.5),
    height: (u, v) => fbm(u, v, 56, 3, 18),
    rough: () => 1,
  },
  // métal brossé : stries fines dans une direction, la lumière y glisse en traînée
  metal: {
    size: 256, tileM: 1, relief: 0.0008,
    shade: (u, v) => 0.88 + 0.12 * noise(u * 40, v, 128, 40),
    height: (u, v) => noise(u * 40, v, 128, 40),
    rough: (u, v) => 0.25 + 0.15 * noise(u * 40, v, 128, 41),
    metal: () => 1,
  },
  // dalle technique : cases de 1 m creusées d'une rainure, le lisse entre deux arêtes
  grid: {
    size: 512, tileM: 2, relief: 0.006,
    shade: (u, v) => {
      const g = grout(cell(u, v, 2).edge, 0.035)
      return (0.86 + 0.1 * fbm(u, v, 16, 2, 50)) * (1 - 0.55 * g)
    },
    height: (u, v) => 1 - grout(cell(u, v, 2).edge, 0.05),
    rough: (u, v) => 0.3 + 0.55 * grout(cell(u, v, 2).edge, 0.06),
    metal: (u, v) => 1 - 0.7 * grout(cell(u, v, 2).edge, 0.06),
  },
  // laque : presque lisse, juste assez de grain pour que le reflet ne soit pas un miroir
  gloss: {
    size: 256, tileM: 2, relief: 0.0004,
    shade: (u, v) => 0.97 + 0.03 * fbm(u, v, 24, 2, 55),
    rough: (u, v) => 0.45 + 0.1 * fbm(u, v, 24, 2, 56),
  },
  // pierre : blocs irréguliers, joints creusés, grain sableux
  stone: {
    size: 512, tileM: 2.5, relief: 0.008,
    shade: (u, v) => {
      const { ix, iy, edge } = brick(u, v, 6, 3, 60)
      const face = 0.76 + 0.16 * hash(ix, iy, 61) + 0.16 * (fbm(u, v, 40, 3, 62) - 0.5)
      return face * (1 - 0.35 * grout(edge, 0.06))
    },
    height: (u, v) => (1 - grout(brick(u, v, 6, 3, 60).edge, 0.09)) * (0.8 + 0.2 * fbm(u, v, 40, 3, 63)),
    rough: () => 1,
  },
}

// ---- cuisson ------------------------------------------------------------------------------------

function texture(data: Uint8Array, size: number, tileM: number, srgb: boolean): Texture {
  const t = new DataTexture(data, size, size)
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(1 / tileM, 1 / tileM)
  t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace
  t.anisotropy = 4
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

function bake(spec: Spec): SurfaceTexture {
  const { size, tileM } = spec
  const height = spec.height ?? spec.shade
  // Le relief est échantillonné une fois pour toutes : la normale se lit sur ses voisins, et
  // recalculer `height` quatre fois par pixel coûterait quatre fois le prix de la matière.
  const h = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    h[y * size + x] = clamp01(height((x + 0.5) / size, (y + 0.5) / size))
  }

  const color = new Uint8Array(size * size * 4)
  const normal = new Uint8Array(size * size * 4)
  const orm = new Uint8Array(size * size * 4)
  // Pente : une hauteur de `relief` mètres sur un texel de `tileM / size` mètres. C'est ce rapport,
  // et non l'amplitude seule, qui décide de l'inclinaison des normales — doubler la résolution d'une
  // matière sans ce facteur la rendrait deux fois plus pentue.
  const slope = spec.relief / (tileM / size)
  const wrap = (i: number) => (i + size) % size
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size
    const i = (y * size + x) * 4
    const l = clamp01(spec.shade(u, v))
    const [tr, tg, tb] = spec.tint?.(u, v) ?? [1, 1, 1]
    color[i] = Math.round(clamp01(l * tr) * 255)
    color[i + 1] = Math.round(clamp01(l * tg) * 255)
    color[i + 2] = Math.round(clamp01(l * tb) * 255)
    color[i + 3] = 255

    // différences centrées : la pente en x et en y, puis la normale unitaire (z vers l'extérieur)
    const dx = (h[y * size + wrap(x + 1)]! - h[y * size + wrap(x - 1)]!) * 0.5 * slope
    const dy = (h[wrap(y + 1) * size + x]! - h[wrap(y - 1) * size + x]!) * 0.5 * slope
    const inv = 1 / Math.hypot(dx, dy, 1)
    normal[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255)
    normal[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255)
    normal[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
    normal[i + 3] = 255

    orm[i] = 255
    orm[i + 1] = Math.round(clamp01(spec.rough?.(u, v) ?? 1) * 255)
    orm[i + 2] = Math.round(clamp01(spec.metal?.(u, v) ?? 1) * 255)
    orm[i + 3] = 255
  }
  // la même carte packée sert de rugosité ET de métallicité : three lit le canal qu'il lui faut
  const ormMap = texture(orm, size, tileM, false)
  return {
    map: texture(color, size, tileM, true),
    normalMap: texture(normal, size, tileM, false),
    normalScale: 1,
    roughnessMap: ormMap,
    metalnessMap: ormMap,
    tileM,
  }
}

export type SurfaceTextures = Partial<Record<SurfaceRole, SurfaceTexture>>

/**
 * Le catalogue cuit, GARDÉ d'une scène à l'autre et d'un style à l'autre. Une matière est
 * déterministe et immuable : la recuire donnerait exactement les mêmes octets. La cuisson n'est pas
 * gratuite (une carte de 512 px, c'est un quart de million de fois trois fonctions de bruit), et
 * elle se payait à chaque construction de scène — visible dès les tests.
 *
 * Même politique que le cache des carrosseries (`models/loadModel.ts`) : rien n'est libéré, parce
 * que le catalogue est BORNÉ (quatorze rôles) et partagé. Une scène qui se détruit n'emporte donc
 * pas les matières de celle qui la remplace.
 */
const BAKED = new Map<SurfaceRole, SurfaceTexture>()

/**
 * Les matières demandées. Un style ne se sert que de quelques rôles : cuire les quatorze coûterait
 * des millisecondes et des méga-octets pour rien.
 */
export function createSurfaceTextures(roles: Iterable<SurfaceRole>): SurfaceTextures {
  const out: SurfaceTextures = {}
  for (const r of new Set(roles)) {
    let t = BAKED.get(r)
    if (!t) { t = bake(SPECS[r]); BAKED.set(r, t) }
    out[r] = t
  }
  return out
}
