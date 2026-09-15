import { NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three'
import type { SurfaceRole, SurfaceTexture, SurfaceTextures } from './procedural'

// Matières en IMAGES : des jeux PBR photographiques libres (ambientCG, CC0) qui remplacent, rôle
// pour rôle, les matières procédurales quand le style en porte un pack et que l'utilisateur l'a
// demandé (Réglages → Rendu 3D → matières en images). Même contrat de sortie (`SurfaceTexture`) :
// les matériaux ne savent pas d'où vient une carte, et un rôle absent du pack reste procédural
// (l'eau, le néon, la laque n'ont pas de photo).
//
// Les fichiers vivent sous `public/assets/textures/<pack>/<rôle>/{color,normal,roughness}.jpg`,
// produits par `scripts/fetch-textures.mjs` (téléchargement, puis réduction à 512 px : une image
// d'un mètre cinquante vue à quinze mètres n'a pas besoin de plus). Aucun CDN : l'app tourne en LAN.
//
// Une matière photo porte SA couleur (`colored`) : le matériau ne la teinte plus par la palette du
// style, sans quoi un plâtre blanc photographié sous un mur beige rendrait un beige sale.

export interface PackSurface {
  /** Côté (m) couvert par une image avant répétition : la cote réelle publiée avec la texture. */
  tileM: number
  /** Multiplicateur du relief photographié (défaut 1). */
  normalScale?: number
}

export interface TexturePack {
  id: string
  surfaces: Partial<Record<SurfaceRole, PackSurface>>
}

/** Le pack livré : une photo par matière « réelle ». Les cotes sont celles d'ambientCG (voir `SOURCES.md`). */
export const PHOTO_PACK: TexturePack = {
  id: 'photo',
  surfaces: {
    plaster: { tileM: 2 },
    concrete: { tileM: 2.4 },
    wood: { tileM: 1.8 },
    tile: { tileM: 1.2 },
    carpet: { tileM: 1.7 },
    grass: { tileM: 1.4 },
    pavers: { tileM: 3.5 },
    soil: { tileM: 1.4 },
    roof: { tileM: 2.9 },
    stone: { tileM: 2.5 },
  },
}

export const TEXTURE_PACKS: readonly TexturePack[] = [PHOTO_PACK]

export const packById = (id: string | undefined): TexturePack | undefined => TEXTURE_PACKS.find((p) => p.id === id)

/**
 * Chargeur d'UNE image, injectable : même contrat que `TextureLoad` (écrans) et `ModelLoad`
 * (carrosseries), pour que la scène reste testable sous happy-dom où aucun fichier ne se charge.
 */
export type ImageLoad = (url: string, onLoad: () => void, onError: () => void) => Texture

const defaultLoad: ImageLoad = (url, onLoad, onError) => new TextureLoader().load(url, onLoad, undefined, onError)

/** `base: './'` dans Vite : URL relative, pour être servi à la racine par Fastify comme depuis un sous-dossier. */
const fileUrl = (packId: string, role: SurfaceRole, file: string) =>
  `${import.meta.env.BASE_URL}assets/textures/${packId}/${role}/${file}.jpg`

function fetchSurface(packId: string, role: SurfaceRole, spec: PackSurface, load: ImageLoad): Promise<SurfaceTexture> {
  const one = (file: string, srgb: boolean) => new Promise<Texture>((resolve, reject) => {
    const t = load(fileUrl(packId, role, file), () => resolve(t), () => reject(new Error(`matière introuvable : ${packId}/${role}/${file}`)))
    t.wrapS = t.wrapT = RepeatWrapping
    t.repeat.set(1 / spec.tileM, 1 / spec.tileM)
    // la couleur est en sRGB ; la normale et la rugosité sont des DONNÉES, à ne surtout pas recourber
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
    t.anisotropy = 4
  })
  return Promise.all([one('color', true), one('normal', false), one('roughness', false)]).then(([map, normalMap, roughnessMap]) => ({
    map, normalMap, normalScale: spec.normalScale ?? 1,
    roughnessMap,
    metalnessMap: null,                     // une photo n'a pas de carte de métal : celle du style, uniforme
    tileM: spec.tileM,
    colored: true,
  }))
}

/**
 * Le catalogue chargé, gardé comme le catalogue cuit (`BAKED`) : borné (un pack, dix rôles), partagé
 * entre les scènes, jamais libéré. Un échec ne s'y met pas : une coupure réseau ne condamne pas la
 * matière jusqu'au prochain rechargement.
 */
const READY = new Map<string, SurfaceTexture>()
const PENDING = new Map<string, Promise<SurfaceTexture>>()

/**
 * Les matières photo DÉJÀ LÀ pour ces rôles ; celles qui manquent se chargent, et `onReady` est
 * rappelé à chaque rôle qui arrive (l'appelant repasse alors par ici et obtient une carte de plus).
 * Entre-temps, le procédural tient la place : la maison n'attend jamais une image.
 */
export function loadPackTextures(pack: TexturePack, roles: Iterable<SurfaceRole>, onReady: () => void, load: ImageLoad = defaultLoad): SurfaceTextures {
  const out: SurfaceTextures = {}
  for (const role of new Set(roles)) {
    const spec = pack.surfaces[role]
    if (!spec) continue                       // pas de photo pour ce rôle : le procédural reste
    const key = `${pack.id}/${role}`
    const ready = READY.get(key)
    if (ready) { out[role] = ready; continue }
    let pending = PENDING.get(key)
    if (!pending) {
      pending = fetchSurface(pack.id, role, spec, load)
      PENDING.set(key, pending)
      pending.then((t) => READY.set(key, t)).catch(() => {}).finally(() => PENDING.delete(key))
    }
    pending.then(() => onReady(), () => {})
  }
  return out
}
