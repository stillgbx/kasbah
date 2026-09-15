import { DataTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

// Textures PAR DÉFAUT des surfaces de la maison, calculées ici plutôt que chargées : l'app tourne en
// LAN sans CDN, et aucune image n'est à héberger ni à verser au dépôt. Chaque texture est une carte
// de LUMINANCE (gris autour de 1) que le matériau multiplie par sa couleur de thème : la teinte
// reste celle des thèmes (`plugins/vuetify.ts`), la texture n'apporte que la matière. Les UV des
// builders sont en MÈTRES (les caps d'`ExtrudeGeometry` et `ShapeGeometry` reprennent les
// positions), donc `repeat = 1 / taille du motif` pose un motif à l'échelle du monde.
//
// Le catalogue est la couture prévue pour laisser l'utilisateur, plus tard, remplacer une entrée par
// une image à lui : un rôle de surface → une texture, et rien d'autre ne connaît la façon dont elle
// est faite.

/** Une surface de la maison qui a une matière. */
export type SurfaceRole =
  | 'plaster' | 'wood' | 'tile' | 'carpet' | 'concrete'
  | 'grass' | 'water' | 'pavers' | 'soil' | 'roof'

export interface SurfaceTexture {
  map: Texture
  /** Relief tiré de la même carte (la matière se lit aussi en lumière rasante). */
  bumpMap: Texture
  bumpScale: number
}

interface Spec {
  /** Côté (px) de la carte. */
  size: number
  /** Taille (m) du motif avant répétition. */
  tileM: number
  bumpScale: number
  /** Luminance en [0, 1] du point (u, v) ∈ [0, 1[². */
  shade(u: number, v: number): number
}

// ---- bruit --------------------------------------------------------------------------------------

/** Hachage déterministe → [0, 1[ : la texture est la même à chaque lancement et dans les tests. */
function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smooth = (t: number) => t * t * (3 - 2 * t)

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

// ---- motifs --------------------------------------------------------------------------------------

const SPECS: Record<SurfaceRole, Spec> = {
  // enduit fin : à peine grenu, c'est le relief qui le fait exister
  plaster: { size: 256, tileM: 2, bumpScale: 0.004, shade: (u, v) => 0.94 + 0.08 * fbm(u, v, 16, 3, 1) },
  // lames de 12 cm sur 1,2 m, décalées d'une demi-lame par rangée, veinées dans la longueur
  wood: {
    size: 512, tileM: 2.4, bumpScale: 0.01,
    shade: (u, v) => {
      const row = Math.floor(v * 20)                       // 20 lames de 12 cm sur 2,4 m
      const uu = (u + (row % 2) * 0.25) % 1
      const plank = Math.floor(uu * 2)                     // 2 lames de 1,2 m dans la longueur
      const tone = 0.82 + 0.28 * hash(plank, row, 7)       // chaque lame a sa teinte
      const grain = 0.9 + 0.2 * fbm(u * 6, v * 0.5 + hash(plank, row, 9), 24, 3, 2)
      const gapV = Math.abs(v * 20 - row - 0.5) > 0.47 ? 0.6 : 1   // joint entre lames
      const gapU = Math.abs(uu * 2 - plank - 0.5) > 0.49 ? 0.6 : 1
      return Math.min(1, tone * grain) * gapV * gapU
    },
  },
  // carreaux de 60 cm, joint de 6 mm, léger nuage par carreau
  tile: {
    size: 512, tileM: 2.4, bumpScale: 0.008,
    shade: (u, v) => {
      const n = 4, cx = u * n, cy = v * n
      const ix = Math.floor(cx), iy = Math.floor(cy)
      const grout = Math.abs(cx - ix - 0.5) > 0.495 || Math.abs(cy - iy - 0.5) > 0.495
      if (grout) return 0.55
      return 0.9 + 0.1 * hash(ix, iy, 3) + 0.08 * (fbm(u, v, 8, 2, 4) - 0.5)
    },
  },
  // moquette : grain serré et uniforme
  carpet: { size: 256, tileM: 1, bumpScale: 0.006, shade: (u, v) => 0.85 + 0.25 * fbm(u, v, 64, 2, 5) },
  // béton : nuages larges et piqûres fines
  concrete: { size: 256, tileM: 2, bumpScale: 0.006, shade: (u, v) => 0.86 + 0.2 * fbm(u, v, 6, 4, 6) - (hash(Math.floor(u * 256), Math.floor(v * 256), 8) > 0.985 ? 0.15 : 0) },
  // pelouse : deux échelles, la touffe et la plaque
  grass: { size: 256, tileM: 3, bumpScale: 0.01, shade: (u, v) => 0.8 + 0.3 * fbm(u, v, 48, 3, 10) * (0.8 + 0.4 * fbm(u, v, 4, 2, 11)) },
  // eau : réseau clair de « caustiques » — les crêtes d'un bruit replié
  water: {
    size: 256, tileM: 4, bumpScale: 0.02,
    shade: (u, v) => { const n = fbm(u, v, 6, 3, 12); return 0.85 + 0.35 * Math.pow(1 - Math.abs(n * 2 - 1), 4) },
  },
  // dalles de 40 cm posées droites, joint marqué
  pavers: {
    size: 512, tileM: 2, bumpScale: 0.012,
    shade: (u, v) => {
      const n = 5, cx = u * n, cy = v * n
      const ix = Math.floor(cx), iy = Math.floor(cy)
      const grout = Math.abs(cx - ix - 0.5) > 0.485 || Math.abs(cy - iy - 0.5) > 0.485
      if (grout) return 0.5
      return 0.82 + 0.18 * hash(ix, iy, 13) + 0.12 * (fbm(u, v, 20, 2, 14) - 0.5)
    },
  },
  // terre de massif : sombre, grumeleuse
  soil: { size: 256, tileM: 2, bumpScale: 0.01, shade: (u, v) => 0.7 + 0.4 * fbm(u, v, 32, 3, 15) },
  // toiture : gravillon / membrane, plus uniforme que le béton
  roof: { size: 256, tileM: 3, bumpScale: 0.004, shade: (u, v) => 0.9 + 0.14 * fbm(u, v, 40, 2, 16) },
}

function bake(spec: Spec): SurfaceTexture {
  const { size } = spec
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = Math.round(Math.max(0, Math.min(1, spec.shade((x + 0.5) / size, (y + 0.5) / size))) * 255)
    const i = (y * size + x) * 4
    data[i] = data[i + 1] = data[i + 2] = l
    data[i + 3] = 255
  }
  const make = (srgb: boolean) => {
    const t = new DataTexture(data, size, size)
    t.wrapS = t.wrapT = RepeatWrapping
    t.repeat.set(1 / spec.tileM, 1 / spec.tileM)
    if (srgb) t.colorSpace = SRGBColorSpace
    t.anisotropy = 4
    t.generateMipmaps = true
    t.needsUpdate = true
    return t
  }
  // deux objets Texture pour un même tampon : la couleur se lit en sRGB, le relief en linéaire
  return { map: make(true), bumpMap: make(false), bumpScale: spec.bumpScale }
}

export type SurfaceTextures = Record<SurfaceRole, SurfaceTexture>

/** Le jeu complet, calculé une fois par scène (quelques millisecondes ; ~3 Mo de textures). */
export function createSurfaceTextures(): SurfaceTextures {
  return Object.fromEntries((Object.keys(SPECS) as SurfaceRole[]).map((r) => [r, bake(SPECS[r])])) as SurfaceTextures
}

export function disposeSurfaceTextures(t: SurfaceTextures): void {
  for (const s of Object.values(t)) { s.map.dispose(); s.bumpMap.dispose() }
}
