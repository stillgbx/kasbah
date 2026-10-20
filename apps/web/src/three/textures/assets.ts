import { NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three'
import { FINISHES, type FinishId } from '@kasbah/shared'
import type { SurfaceRole, SurfaceTexture, SurfaceTextures } from './procedural'

// Materials as IMAGES: free photographic PBR sets (ambientCG, CC0) that replace, role
// for role, the procedural materials when the style carries a pack and the user asked
// for it (Settings → 3D rendering → Photo materials). Same output contract (`SurfaceTexture`):
// the materials don't know where a map comes from, and a role missing from the pack stays procedural
// (water, neon, lacquer have no photo).
//
// The files live under `public/assets/textures/<pack>/<role>/{color,normal,roughness}.jpg`,
// produced by `scripts/fetch-textures.mjs` (download, then reduction to 512 px: an image
// of a meter and a half seen from fifteen meters needs no more). No CDN: the app runs on the LAN.
//
// A photo material carries ITS OWN color (`colored`): the material no longer tints it with the
// style's palette, otherwise a white plaster photographed under a beige wall would render a dirty beige.

export interface PackSurface {
  /** Side (m) covered by one image before repeating: the real-world dimension published with the texture. */
  tileM: number
  /** Multiplier of the photographed relief (default 1). */
  normalScale?: number
}

export interface TexturePack {
  id: string
  surfaces: Partial<Record<SurfaceRole, PackSurface>>
}

/** The shipped pack: one photo per "real" material. The dimensions are ambientCG's (see `SOURCES.md`). */
export const PHOTO_PACK: TexturePack = {
  id: 'photo',
  surfaces: {
    plaster: { tileM: 2 },
    concrete: { tileM: 2.4 },
    wood: { tileM: 1.8 },
    // Tiles107: light white tiles (8 × 60 cm → 4.8 m) — Tiles052 was too dark
    tile: { tileM: 4.8 },
    // Tiles133A: fine earthenware of the pool (kept as is)
    poolTile: { tileM: 1.2 },
    carpet: { tileM: 1.7 },
    // Grass006: dimension missing at ambientCG — we keep 1.4 m (Grass004's)
    grass: { tileM: 1.4 },
    pavers: { tileM: 3.5 },
    soil: { tileM: 1.4 },
    roof: { tileM: 2.9 },
    stone: { tileM: 2.5 },
    gravel: { tileM: 1.6 },
  },
}

export const TEXTURE_PACKS: readonly TexturePack[] = [PHOTO_PACK]

export const packById = (id: string | undefined): TexturePack | undefined => TEXTURE_PACKS.find((p) => p.id === id)

/**
 * Loader of ONE image, injectable: same contract as `TextureLoad` (screens) and `ModelLoad`
 * (car bodies), so that the scene stays testable under happy-dom where no file loads.
 */
export type ImageLoad = (url: string, onLoad: () => void, onError: () => void) => Texture

const defaultLoad: ImageLoad = (url, onLoad, onError) => new TextureLoader().load(url, onLoad, undefined, onError)

/** `base: './'` in Vite: relative URL, to be served at the root by Fastify as well as from a subfolder. */
/** `dir` = path under `assets/textures/`: `<pack>/<role>` for a pack, the catalog's for a finish. */
export const textureUrl = (dir: string, file: string) =>
  `${import.meta.env.BASE_URL}assets/textures/${dir}/${file}.jpg`

function fetchSurface(dir: string, spec: PackSurface, load: ImageLoad): Promise<SurfaceTexture> {
  const one = (file: string, srgb: boolean) => new Promise<Texture>((resolve, reject) => {
    const t = load(textureUrl(dir, file), () => resolve(t), () => reject(new Error(`material not found: ${dir}/${file}`)))
    t.wrapS = t.wrapT = RepeatWrapping
    t.repeat.set(1 / spec.tileM, 1 / spec.tileM)
    // the color is in sRGB; the normal and the roughness are DATA, which must above all not be re-curved
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
    t.anisotropy = 4
  })
  return Promise.all([one('color', true), one('normal', false), one('roughness', false)]).then(([map, normalMap, roughnessMap]) => ({
    map, normalMap, normalScale: spec.normalScale ?? 1,
    roughnessMap,
    metalnessMap: null,                     // a photo has no metal map: the style's, uniform
    tileM: spec.tileM,
    colored: true,
  }))
}

/**
 * The loaded catalog, kept like the baked catalog (`BAKED`): bounded (one pack, ten roles), shared
 * between scenes, never freed. A failure does not go in: a network outage does not doom the
 * material until the next reload.
 */
const READY = new Map<string, SurfaceTexture>()
const PENDING = new Map<string, Promise<SurfaceTexture>>()

/**
 * The photo materials ALREADY THERE for these roles; the missing ones load, and `onReady` is
 * called back for each role that arrives (the caller then comes back here and gets one more map).
 * Meanwhile, the procedural holds the place: the house never waits for an image.
 */
/**
 * Waits for the materials of a pack still on their way for these roles (started by `loadPackTextures`),
 * arrived or failed: it is what the scene's loading veil waits for, which shows the
 * count. A failed material blocks nothing. `onProgress` receives (arrived, total) at each step.
 */
export function packTexturesSettled(pack: TexturePack, roles: Iterable<SurfaceRole>, onProgress?: (done: number, total: number) => void): Promise<void> {
  const keys = [...new Set(roles)].filter((role) => pack.surfaces[role]).map((role) => `${pack.id}/${role}`)
  const pending = keys.map((key) => PENDING.get(key)).filter((p) => !!p)
  let done = keys.length - pending.length
  onProgress?.(done, keys.length)
  return Promise.allSettled(pending.map((p) => p.finally(() => onProgress?.(++done, keys.length)))).then(() => {})
}

export function loadPackTextures(pack: TexturePack, roles: Iterable<SurfaceRole>, onReady: () => void, load: ImageLoad = defaultLoad): SurfaceTextures {
  const out: SurfaceTextures = {}
  for (const role of new Set(roles)) {
    const spec = pack.surfaces[role]
    if (!spec) continue                       // no photo for this role: the procedural stays
    const key = `${pack.id}/${role}`
    const ready = READY.get(key)
    if (ready) { out[role] = ready; continue }
    let pending = PENDING.get(key)
    if (!pending) {
      pending = fetchSurface(key, spec, load)
      PENDING.set(key, pending)
      pending.then((t) => READY.set(key, t)).catch(() => {}).finally(() => PENDING.delete(key))
    }
    pending.then(() => onReady(), () => {})
  }
  return out
}

/**
 * The photos of the FINISHES (`@kasbah/shared › FINISHES`) already there; the others load and
 * `onReady` is called back at each arrival, as for a pack. Same cache, the key is the folder:
 * a finish that reuses a pack material (`photo/wood`) does not load it twice — hence
 * the rule that its dimension be the same as the pack's (checked by the tests).
 */
export function loadFinishTextures(ids: Iterable<FinishId>, onReady: () => void, load: ImageLoad = defaultLoad): Partial<Record<FinishId, SurfaceTexture>> {
  const out: Partial<Record<FinishId, SurfaceTexture>> = {}
  for (const id of new Set(ids)) {
    const spec = FINISHES[id]
    const key = spec.dir
    const ready = READY.get(key)
    if (ready) { out[id] = ready; continue }
    let pending = PENDING.get(key)
    if (!pending) {
      pending = fetchSurface(key, { tileM: spec.tileM }, load)
      PENDING.set(key, pending)
      pending.then((t) => READY.set(key, t)).catch(() => {}).finally(() => PENDING.delete(key))
    }
    pending.then(() => onReady(), () => {})
  }
  return out
}
