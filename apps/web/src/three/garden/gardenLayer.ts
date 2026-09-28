import { Box3, Color, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, RingGeometry, Vector3, type Intersection, type Object3D } from 'three'
import type { GardenItem, GardenKind } from '@kasbah/shared'
import { SITE_DECOR_LAYER } from '../core/layers'
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

interface Slot { mesh: InstancedMesh; ids: string[] }

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
  private season: Season = 'summer'
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
  }

  setAccent(color: Color): void { this.ringMaterial.color.copy(color) }

  /**
   * Pose les éléments. Même liste d'éléments, mêmes familles et mêmes formes (on en glisse un, on
   * change sa hauteur) → seules les matrices sont réécrites, sans recréer de tampon à chaque image.
   */
  build(items: readonly GardenItem[], groundZ: (x: number, y: number) => number, season: Season): void {
    this.groundZ = groundZ
    this.season = season
    this.items = new Map(items.map((it) => [it.id, it]))
    const keyOf = (it: GardenItem) => `${it.kind}:${speciesOf(it)?.id ?? ''}:${gardenSeed(it) % GARDEN_VARIANTS}`
    const signature = `${season}|${items.map((it) => `${it.id}:${keyOf(it)}`).join('|')}`
    if (signature !== this.signature) {
      this.clearSlots()
      this.signature = signature
      const groups = new Map<string, GardenItem[]>()
      for (const it of items) groups.set(keyOf(it), [...(groups.get(keyOf(it)) ?? []), it])
      for (const [key, list] of groups) {
        const first = list[0]!
        const kind = first.kind
        const species = speciesOf(first)
        this.shapeOf(first).parts.forEach(({ geometry, part }, pi) => {
          const mesh = new InstancedMesh(geometry, this.materials[part], list.length)
          mesh.castShadow = true
          mesh.receiveShadow = true
          // une espèce porte ses couleurs dans ses sommets : l'instance n'y module que la clarté
          const base = new Color(species ? 0xffffff : (part === 'leaf' ? SEASON_LEAF[season]?.[kind] : undefined) ?? COLORS[kind][part] ?? 0x808080)
          list.forEach((it, i) => mesh.setColorAt(i, jitter(base, gardenSeed(it))))
          this.group.add(mesh)
          this.slots.set(`${key}:${pi}`, { mesh, ids: list.map((it) => it.id) })
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
        s.set(it.height * squash, it.height * squash, it.height)
        slot.mesh.setMatrixAt(i, m.compose(p, q, s))
      })
      slot.mesh.instanceMatrix.needsUpdate = true
      slot.mesh.computeBoundingSphere()
      slot.mesh.computeBoundingBox()
    }
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
    return (this.shapeOf(it).width * it.height) / 2
  }

  /** La forme d'un élément : celle de son espèce (à la saison courante), sinon celle de sa famille. */
  private shapeOf(it: GardenItem): GardenShape {
    const variant = gardenSeed(it) % GARDEN_VARIANTS
    const species = speciesOf(it)
    return species ? speciesShape(species, variant, this.season) : gardenShape(it.kind, variant)
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
    for (const slot of this.slots.values()) { slot.mesh.removeFromParent(); slot.mesh.dispose() }
    this.slots.clear()
    this.signature = ''
  }

  dispose(): void {
    this.clearSlots()
    this.group.removeFromParent()
    for (const m of Object.values(this.materials)) m.dispose()
    this.ringMaterial.dispose()
    this.ring.geometry.dispose()
  }
}

/** Une teinte voisine de `base`, tirée de la graine : un bosquet n'est pas d'un vert uniforme. */
function jitter(base: Color, seed: number): Color {
  const next = rng(seed ^ 0x5bd1e995)
  const hsl = { h: 0, s: 0, l: 0 }
  base.getHSL(hsl)
  return new Color().setHSL(hsl.h + (next() - 0.5) * 0.04, hsl.s * (0.85 + next() * 0.3), hsl.l * (0.85 + next() * 0.3))
}
