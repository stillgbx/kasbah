import { Box3, Color, DataTexture, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, RingGeometry, Vector3, type Intersection, type Object3D } from 'three'
import { DEFAULT_HEDGE_LENGTH, DEFAULT_HEDGE_WIDTH, type GardenItem, type GardenKind } from '@kasbah/shared'
import { SITE_DECOR_LAYER } from '../core/layers'
import type { GardenLook } from '../styles/types'
import { hedgeShape } from './hedgeShape'
import type { Season } from './season'
import { GARDEN_VARIANTS, gardenSeed, gardenShape, rng, type GardenPart, type GardenShape } from './shapes'
import { speciesOf } from './species'
import { speciesShape } from './speciesShape'

// Le jardin dessiné : une `InstancedMesh` par (famille, forme, matière). Trente arbres de quatre
// formes coûtent donc huit appels de dessin, pas soixante. Les éléments sont posés dans le groupe
// du SITE (repère maison, Z vers le haut), le pied sur le terrain relief compris.

/** Teinte de base par famille et matière ; chaque instance s'en écarte un peu (`jitter`). */
const COLORS: Record<GardenKind, Partial<Record<GardenPart, number>>> = {
  broadleaf: { bark: 0x7a5236, leaf: 0x6fa84a },
  conifer: { bark: 0x6b4a30, leaf: 0x3f7d4f },
  palm: { bark: 0x9a7b55, leaf: 0x7bb04a },
  shrub: { leaf: 0x5c9a45 },
  rock: { stone: 0x9aa0a6 },
  hedge: { bark: 0x5a4a3a, leaf: 0x4f8a3c },
}
/**
 * Feuillage des familles CADUQUES hors de l'été (feuillus, buissons) : vert tendre au printemps,
 * roux en automne, terne en hiver. Conifères et palmiers gardent le leur.
 */
const SEASON_LEAF: Partial<Record<Season, Partial<Record<GardenKind, number>>>> = {
  spring: { broadleaf: 0x8cc152, shrub: 0x7cb342 },
  autumn: { broadleaf: 0xd08a2e, shrub: 0xb5652b },
  winter: { broadleaf: 0x8d8272, shrub: 0x7d7a5a },
}
/** Enfoncement du pied (m) : sur une pente, un tronc posé au centre flotterait côté aval. */
const FOOT_SINK_M = 0.05
const RING_MARGIN_M = 0.25
/** Ombre de contact : son rayon rapporté à celui de l'élément, son opacité au centre. */
const CONTACT_SCALE = 1.25
const CONTACT_OPACITY = 0.38

/** Longueur et largeur d'une haie (m) ; les autres éléments n'en ont pas. */
const lengthOf = (it: GardenItem) => it.length ?? DEFAULT_HEDGE_LENGTH
const widthOf = (it: GardenItem) => it.width ?? DEFAULT_HEDGE_WIDTH

/**
 * Le disque de l'ombre de contact : noir, opaque au centre, qui s'efface vers le bord. Calculé en
 * mémoire (pas de canevas) pour qu'il existe aussi dans les tests.
 */
function contactTexture(): DataTexture {
  const n = 64
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5) * 2
      const a = Math.max(0, 1 - d) ** 1.6
      data[(y * n + x) * 4 + 3] = Math.round(a * 255)
    }
  }
  const t = new DataTexture(data, n, n)
  t.needsUpdate = true
  return t
}

/** `owned` : matière propre à la tranche (néon d'un style), à libérer avec elle. */
interface Slot { mesh: InstancedMesh; ids: string[]; owned?: MeshStandardMaterial }

export class GardenLayer {
  readonly group = new Group()
  private slots = new Map<string, Slot>()
  private items = new Map<string, GardenItem>()
  private signature = ''
  private readonly materials: Record<GardenPart, MeshStandardMaterial> = {
    // `vertexColors` : la clarté par face des formes facettées (`shapes.ts`, `facet`)
    bark: new MeshStandardMaterial({ color: 0xffffff, roughness: 1, vertexColors: true }),
    leaf: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true }),
    stone: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, vertexColors: true }),
    accent: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, vertexColors: true }),
  }
  /** Ombres de contact : un disque au pied de chaque élément, une seule instance pour tout le jardin. */
  private readonly contactMap = contactTexture()
  private readonly contactMaterial = new MeshBasicMaterial({ color: 0x000000, map: this.contactMap, transparent: true, opacity: CONTACT_OPACITY, depthWrite: false })
  private contact: InstancedMesh | null = null
  private season: Season = 'summer'
  /** Palette de jardin du style courant ; absente = couleurs naturelles. */
  private look: GardenLook | undefined
  private readonly ringMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, side: DoubleSide })
  private readonly ring = new Mesh(new RingGeometry(0.92, 1, 48), this.ringMaterial)
  private selectedId: string | null = null
  private groundZ: (x: number, y: number) => number = () => 0

  constructor() {
    this.group.name = 'garden'
    this.ring.layers.set(SITE_DECOR_LAYER)
    this.ring.renderOrder = 10
    this.ring.visible = false
    this.group.add(this.ring)
    // Comme la pelouse : aucune lampe d'INTÉRIEUR sur le jardin (`core/levelLight.ts`). Un arbre au
    // ras de la façade est à la hauteur du rez-de-chaussée, le plafonnier du salon l'éclairait à
    // travers le mur. Les lampes de jardin, elles, l'éclairent toujours.
    for (const m of Object.values(this.materials)) m.userData.noLamps = true
  }

  setAccent(color: Color): void { this.ringMaterial.color.copy(color) }

  /**
   * Pose les éléments. Même liste d'éléments, mêmes familles et mêmes formes (on en glisse un, on
   * change sa hauteur) → seules les matrices sont réécrites, sans recréer de tampon à chaque image.
   */
  build(items: readonly GardenItem[], groundZ: (x: number, y: number) => number, season: Season, look?: GardenLook): void {
    this.groundZ = groundZ
    this.season = season
    this.look = look
    this.items = new Map(items.map((it) => [it.id, it]))
    // Sous une palette de style, la teinte du feuillage est tirée par élément : elle entre dans la
    // clé, pour qu'une tranche n'ait qu'une teinte — c'est ce qui permet au néon d'en émettre une.
    const tintOf = (it: GardenItem) => (look ? gardenSeed(it) % look.leaf.length : 0)
    // une haie est construite à ses dimensions : deux haies de tailles différentes n'ont pas la même forme
    const keyOf = (it: GardenItem) => `${it.kind}:${speciesOf(it)?.id ?? ''}:${gardenSeed(it) % GARDEN_VARIANTS}:${tintOf(it)}${it.kind === 'hedge' ? `:${lengthOf(it).toFixed(2)}:${widthOf(it).toFixed(2)}:${it.height.toFixed(2)}:${it.spacing?.toFixed(2) ?? 'auto'}:${gardenSeed(it)}` : ''}`
    const lookKey = look ? JSON.stringify([look.leaf, look.bark, look.stone, look.accent, look.emissive, look.foliage]) : ''
    const signature = `${season}|${lookKey}|${items.map((it) => `${it.id}:${keyOf(it)}`).join('|')}`
    if (signature !== this.signature) {
      this.clearSlots()
      this.signature = signature
      const groups = new Map<string, GardenItem[]>()
      for (const it of items) groups.set(keyOf(it), [...(groups.get(keyOf(it)) ?? []), it])
      // une ombre de contact par élément, en couche de décor : l'occlusion ambiante ne la prend pas pour un objet
      this.contact = new InstancedMesh(new PlaneGeometry(2, 2), this.contactMaterial, Math.max(1, items.length))
      this.contact.count = items.length
      this.contact.layers.set(SITE_DECOR_LAYER)
      this.contact.renderOrder = 1
      this.group.add(this.contact)
      for (const [key, list] of groups) {
        const first = list[0]!
        this.shapeOf(first).parts.forEach(({ geometry, part }, pi) => {
          const base = look ? this.styledColor(look, part, first) : this.naturalColor(part, first)
          // le néon : une matière par tranche, qui émet sa propre teinte (l'émission ignore la couleur d'instance)
          const glows = !!look?.emissive && (part === 'leaf' || part === 'accent')
          const owned = glows ? this.materials[part].clone() : undefined
          if (owned) { owned.emissive.copy(base); owned.emissiveIntensity = look!.emissive! }
          const mesh = new InstancedMesh(geometry, owned ?? this.materials[part], list.length)
          mesh.castShadow = true
          mesh.receiveShadow = true
          list.forEach((it, i) => mesh.setColorAt(i, jitter(base, gardenSeed(it))))
          this.group.add(mesh)
          this.slots.set(`${key}:${pi}`, { mesh, ids: list.map((it) => it.id), ...(owned ? { owned } : {}) })
        })
      }
    }
    this.writeMatrices()
    this.placeRing()
  }

  private writeMatrices(): void {
    const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3()
    const up = new Vector3(0, 0, 1)
    for (const slot of this.slots.values()) {
      slot.ids.forEach((id, i) => {
        const it = this.items.get(id)!
        const next = rng(gardenSeed(it))
        const squash = 0.9 + next() * 0.2           // deux arbres de même forme n'ont pas la même carrure
        p.set(it.center[0], it.center[1], this.groundZ(it.center[0], it.center[1]) - FOOT_SINK_M)
        q.setFromAxisAngle(up, ((it.yaw ?? 0) * Math.PI) / 180)   // sens trigonométrique, comme le yaw d'un appareil
        // une haie est déjà à ses mètres en plan : seule sa hauteur s'étire
        if (it.kind === 'hedge') s.set(1, 1, it.height)
        else s.set(it.height * squash, it.height * squash, it.height)
        slot.mesh.setMatrixAt(i, m.compose(p, q, s))
      })
      slot.mesh.instanceMatrix.needsUpdate = true
      slot.mesh.computeBoundingSphere()
      slot.mesh.computeBoundingBox()
    }
    const contact = this.contact
    if (!contact) return
    let i = 0
    for (const it of this.items.values()) {
      const r = this.radiusOf(it) * CONTACT_SCALE
      // à peine au-dessus du sol ; sur une pente le disque, plat, s'enfonce d'un côté : c'est le
      // `depthWrite: false` + l'ordre de rendu qui le gardent lisible
      p.set(it.center[0], it.center[1], this.groundZ(it.center[0], it.center[1]) + 0.03)
      // une haie : un disque étiré le long de son axe, tourné avec elle
      if (it.kind === 'hedge') {
        q.setFromAxisAngle(up, ((it.yaw ?? 0) * Math.PI) / 180)
        contact.setMatrixAt(i++, m.compose(p, q, s.set(lengthOf(it) / 2 + 0.3, widthOf(it) / 2 + 0.35, 1)))
      } else contact.setMatrixAt(i++, m.compose(p, q.identity(), s.set(r, r, 1)))
    }
    contact.instanceMatrix.needsUpdate = true
    contact.computeBoundingSphere()
  }

  /** Boîte MONDE de tout le jardin (pour le cadre des ombres du soleil), `null` s'il est vide. */
  worldBounds(): Box3 | null {
    let box: Box3 | null = null
    for (const id of this.items.keys()) {
      const b = this.boxOf(id)
      if (b) box = box ? box.union(b) : b
    }
    return box
  }

  /** L'élément réglé en mode édition : un anneau d'accent au pied. `null` = aucun. */
  setSelected(id: string | null): void {
    this.selectedId = id
    this.placeRing()
  }

  private placeRing(): void {
    const it = this.selectedId ? this.items.get(this.selectedId) : undefined
    this.ring.visible = !!it
    if (!it) return
    const r = this.radiusOf(it) + RING_MARGIN_M
    this.ring.scale.set(r, r, 1)
    this.ring.position.set(it.center[0], it.center[1], this.groundZ(it.center[0], it.center[1]) + 0.03)
  }

  private radiusOf(it: GardenItem): number {
    if (it.kind === 'hedge') return lengthOf(it) / 2
    return (this.shapeOf(it).width * it.height) / 2
  }

  /**
   * La forme d'un élément : celle de son espèce (à la saison courante), sinon celle de sa famille.
   * Sous une palette de style, l'espèce est tirée en ombrage seul et le feuillage du style s'applique.
   */
  private shapeOf(it: GardenItem): GardenShape {
    const variant = gardenSeed(it) % GARDEN_VARIANTS
    const species = speciesOf(it)
    const foliage = this.look?.foliage ?? 1
    if (it.kind === 'hedge') return hedgeShape(lengthOf(it), this.season, species, !!this.look, widthOf(it), it.height, it.spacing, gardenSeed(it))
    if (species) return speciesShape(species, variant, this.season, this.look ? { foliage } : undefined)
    return gardenShape(it.kind, variant, foliage)
  }

  /** Couleurs naturelles : une espèce porte les siennes dans ses sommets, l'instance n'y module que la clarté. */
  private naturalColor(part: GardenPart, it: GardenItem): Color {
    if (speciesOf(it)) return new Color(0xffffff)
    return new Color((part === 'leaf' ? SEASON_LEAF[this.season]?.[it.kind] : undefined) ?? COLORS[it.kind][part] ?? 0x808080)
  }

  /** Couleurs du style ; les fruits d'une espèce gardent les leurs si le style n'en impose pas. */
  private styledColor(look: GardenLook, part: GardenPart, it: GardenItem): Color {
    if (part === 'leaf') return look.leaf[gardenSeed(it) % look.leaf.length]!.clone()
    if (part === 'bark') return look.bark.clone()
    if (part === 'stone') return look.stone.clone()
    if (look.accent) return look.accent.clone()
    const species = speciesOf(it)
    const over = species?.seasons?.[this.season]?.accent
    const accent = over === undefined ? species?.accent : over ?? undefined
    return new Color(accent?.color ?? 0xffffff)
  }

  /** Ce que le lancer de rayon peut toucher : les instances, toutes familles confondues. */
  pickables(): Object3D[] { return [...this.slots.values()].map((s) => s.mesh) }

  /** L'élément sous une intersection renvoyée par `pickables()`, sinon `null`. */
  idOf(hit: Intersection): string | null {
    for (const slot of this.slots.values()) {
      if (slot.mesh === hit.object && hit.instanceId !== undefined) return slot.ids[hit.instanceId] ?? null
    }
    return null
  }

  /** Pied de l'élément dans le repère du site (maison, Z vers le haut). */
  footOf(id: string): Vector3 | null {
    const it = this.items.get(id)
    return it ? new Vector3(it.center[0], it.center[1], this.groundZ(it.center[0], it.center[1])) : null
  }

  /** Boîte MONDE de l'élément, pour le cadrer. */
  boxOf(id: string): Box3 | null {
    const it = this.items.get(id)
    const foot = this.footOf(id)
    if (!it || !foot) return null
    const r = this.radiusOf(it)
    const box = new Box3(new Vector3(foot.x - r, foot.y - r, foot.z), new Vector3(foot.x + r, foot.y + r, foot.z + it.height))
    this.group.updateWorldMatrix(true, false)
    return box.applyMatrix4(this.group.matrixWorld)
  }

  private clearSlots(): void {
    // les géométries sont au cache des formes, partagées : seule l'instance part
    for (const slot of this.slots.values()) { slot.mesh.removeFromParent(); slot.mesh.dispose(); slot.owned?.dispose() }
    this.slots.clear()
    if (this.contact) { this.contact.removeFromParent(); this.contact.geometry.dispose(); this.contact.dispose(); this.contact = null }
    this.signature = ''
  }

  dispose(): void {
    this.clearSlots()
    this.group.removeFromParent()
    for (const m of Object.values(this.materials)) m.dispose()
    this.ringMaterial.dispose()
    this.ring.geometry.dispose()
    this.contactMaterial.dispose()
    this.contactMap.dispose()
  }
}

/** Une teinte voisine de `base`, tirée de la graine : un bosquet n'est pas d'un vert uniforme. */
function jitter(base: Color, seed: number): Color {
  const next = rng(seed ^ 0x5bd1e995)
  const hsl = { h: 0, s: 0, l: 0 }
  base.getHSL(hsl)
  return new Color().setHSL(hsl.h + (next() - 0.5) * 0.04, hsl.s * (0.85 + next() * 0.3), hsl.l * (0.85 + next() * 0.3))
}
