import { Box3, Color, DataTexture, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, RingGeometry, Vector3, type Intersection, type Object3D } from 'three'
import { DEFAULT_HEDGE_LENGTH, DEFAULT_HEDGE_WIDTH, type GardenItem, type GardenKind } from '@kasbah/shared'
import { SITE_DECOR_LAYER } from '../core/layers'
import type { GardenLook } from '../styles/types'
import { hedgeShape } from './hedgeShape'
import type { Season } from './season'
import { GARDEN_VARIANTS, gardenSeed, gardenShape, rng, type GardenPart, type GardenShape } from './shapes'
import { speciesOf } from './species'
import { speciesShape } from './speciesShape'

// The drawn garden: one `InstancedMesh` per (family, shape, material). Thirty trees of four
// shapes therefore cost eight draw calls, not sixty. The elements are placed in the
// SITE group (house reference frame, Z up), the foot on the terrain, relief included.

/** Base tint per family and material; each instance deviates from it a little (`jitter`). */
const COLORS: Record<GardenKind, Partial<Record<GardenPart, number>>> = {
  broadleaf: { bark: 0x7a5236, leaf: 0x6fa84a },
  fruit: { bark: 0x5e4a38, leaf: 0x5f9a40, accent: 0xc0392b },
  conifer: { bark: 0x6b4a30, leaf: 0x3f7d4f },
  palm: { bark: 0x9a7b55, leaf: 0x7bb04a },
  bamboo: { bark: 0x8f9a4c, leaf: 0x6a9f45 },
  shrub: { leaf: 0x5c9a45 },
  rock: { stone: 0x9aa0a6 },
  hedge: { bark: 0x5a4a3a, leaf: 0x4f8a3c },
}
/**
 * Foliage of the DECIDUOUS families outside summer (broadleaves, fruit trees, bushes): tender green in spring,
 * russet in autumn, dull in winter. Conifers and palms keep theirs.
 */
const SEASON_LEAF: Partial<Record<Season, Partial<Record<GardenKind, number>>>> = {
  spring: { broadleaf: 0x8cc152, fruit: 0x8cc152, shrub: 0x7cb342 },
  autumn: { broadleaf: 0xd08a2e, fruit: 0xc49a34, shrub: 0xb5652b },
  winter: { broadleaf: 0x8d8272, fruit: 0x8d8272, shrub: 0x7d7a5a },
}
/** Sinking of the foot (m): on a slope, a trunk placed at the center would float on the downhill side. */
const FOOT_SINK_M = 0.05
const RING_MARGIN_M = 0.25
/** Contact shadow: its radius relative to the element's, its opacity at the center. */
const CONTACT_SCALE = 1.25
const CONTACT_OPACITY = 0.38

/** Length and width of a hedge (m); the other elements have none. */
const lengthOf = (it: GardenItem) => it.length ?? DEFAULT_HEDGE_LENGTH
const widthOf = (it: GardenItem) => it.width ?? DEFAULT_HEDGE_WIDTH

/**
 * The contact shadow disc: black, opaque at the center, fading toward the edge. Computed in
 * memory (no canvas) so that it also exists in the tests.
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

/** `owned`: material specific to the batch (a style's neon), to be freed with it. */
interface Slot { mesh: InstancedMesh; ids: string[]; owned?: MeshStandardMaterial }

export class GardenLayer {
  readonly group = new Group()
  private slots = new Map<string, Slot>()
  private items = new Map<string, GardenItem>()
  private signature = ''
  private readonly materials: Record<GardenPart, MeshStandardMaterial> = {
    // `vertexColors`: the per-face lightness of the faceted shapes (`shapes.ts`, `facet`)
    bark: new MeshStandardMaterial({ color: 0xffffff, roughness: 1, vertexColors: true }),
    leaf: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true }),
    stone: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, vertexColors: true }),
    accent: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, vertexColors: true }),
  }
  /** Contact shadows: a disc at the foot of each element, a single instance for the whole garden. */
  private readonly contactMap = contactTexture()
  private readonly contactMaterial = new MeshBasicMaterial({ color: 0x000000, map: this.contactMap, transparent: true, opacity: CONTACT_OPACITY, depthWrite: false })
  private contact: InstancedMesh | null = null
  private season: Season = 'summer'
  /** Garden palette of the current style; absent = natural colors. */
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
    // Like the lawn: no INDOOR lamp on the garden (`core/levelLight.ts`). A tree right
    // against the facade is at the height of the ground floor, the living room ceiling light lit it through
    // the wall. The garden lamps, for their part, still light it.
    for (const m of Object.values(this.materials)) m.userData.noLamps = true
  }

  setAccent(color: Color): void { this.ringMaterial.color.copy(color) }

  /**
   * Places the elements. Same list of elements, same families and same shapes (one is dragged, its
   * height is changed) → only the matrices are rewritten, without recreating a buffer on every frame.
   */
  build(items: readonly GardenItem[], groundZ: (x: number, y: number) => number, season: Season, look?: GardenLook): void {
    this.groundZ = groundZ
    this.season = season
    this.look = look
    this.items = new Map(items.map((it) => [it.id, it]))
    // Under a style palette, the foliage tint is drawn per element: it goes into the
    // key, so that a batch has only one tint — that is what lets the neon emit one.
    const tintOf = (it: GardenItem) => (look ? gardenSeed(it) % look.leaf.length : 0)
    // a hedge is built at its dimensions: two hedges of different sizes do not have the same shape
    const keyOf = (it: GardenItem) => `${it.kind}:${speciesOf(it)?.id ?? ''}:${gardenSeed(it) % GARDEN_VARIANTS}:${tintOf(it)}${it.kind === 'hedge' ? `:${lengthOf(it).toFixed(2)}:${widthOf(it).toFixed(2)}:${it.height.toFixed(2)}:${it.spacing?.toFixed(2) ?? 'auto'}:${gardenSeed(it)}` : ''}`
    const lookKey = look ? JSON.stringify([look.leaf, look.bark, look.stone, look.accent, look.emissive, look.foliage]) : ''
    const signature = `${season}|${lookKey}|${items.map((it) => `${it.id}:${keyOf(it)}`).join('|')}`
    if (signature !== this.signature) {
      this.clearSlots()
      this.signature = signature
      const groups = new Map<string, GardenItem[]>()
      for (const it of items) groups.set(keyOf(it), [...(groups.get(keyOf(it)) ?? []), it])
      // one contact shadow per element, on a decor layer: the ambient occlusion does not take it for an object
      this.contact = new InstancedMesh(new PlaneGeometry(2, 2), this.contactMaterial, Math.max(1, items.length))
      this.contact.count = items.length
      this.contact.layers.set(SITE_DECOR_LAYER)
      this.contact.renderOrder = 1
      this.group.add(this.contact)
      for (const [key, list] of groups) {
        const first = list[0]!
        this.shapeOf(first).parts.forEach(({ geometry, part }, pi) => {
          const base = look ? this.styledColor(look, part, first) : this.naturalColor(part, first)
          // the neon: one material per batch, which emits its own tint (emission ignores the instance color)
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
        const squash = 0.9 + next() * 0.2           // two trees of the same shape do not have the same build
        p.set(it.center[0], it.center[1], this.groundZ(it.center[0], it.center[1]) - FOOT_SINK_M)
        q.setFromAxisAngle(up, ((it.yaw ?? 0) * Math.PI) / 180)   // counterclockwise, like a device's yaw
        // a hedge is already at its meters in plan: only its height stretches
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
      // barely above the ground; on a slope the flat disc sinks on one side: it is the
      // `depthWrite: false` + the render order that keep it readable
      p.set(it.center[0], it.center[1], this.groundZ(it.center[0], it.center[1]) + 0.03)
      // a hedge: a disc stretched along its axis, rotated with it
      if (it.kind === 'hedge') {
        q.setFromAxisAngle(up, ((it.yaw ?? 0) * Math.PI) / 180)
        contact.setMatrixAt(i++, m.compose(p, q, s.set(lengthOf(it) / 2 + 0.3, widthOf(it) / 2 + 0.35, 1)))
      } else contact.setMatrixAt(i++, m.compose(p, q.identity(), s.set(r, r, 1)))
    }
    contact.instanceMatrix.needsUpdate = true
    contact.computeBoundingSphere()
  }

  /** WORLD box of the whole garden (for the sun shadow frame), `null` if it is empty. */
  worldBounds(): Box3 | null {
    let box: Box3 | null = null
    for (const id of this.items.keys()) {
      const b = this.boxOf(id)
      if (b) box = box ? box.union(b) : b
    }
    return box
  }

  /**
   * What the parading characters steer clear of (`effects/roam.ts`), as discs on the ground. A tree
   * blocks only half of its crown (one passes under the edge, not into the trunk); a bush,
   * a rock or a hedge block their whole volume — a hedge as a string of discs. `tall` = a
   * tree: the sleigh and the X-wings, which fly above the rest, only skirt those.
   */
  footprints(): { x: number; y: number; r: number; tall: boolean }[] {
    const out: { x: number; y: number; r: number; tall: boolean }[] = []
    for (const it of this.items.values()) {
      const [x, y] = it.center
      if (it.kind === 'hedge') {
        const len = lengthOf(it), r = widthOf(it) / 2, a = ((it.yaw ?? 0) * Math.PI) / 180
        const n = Math.max(1, Math.ceil(len / (2 * r)))
        for (let k = 0; k < n; k++) {
          const s = (k + 0.5) / n * len - len / 2
          out.push({ x: x + Math.cos(a) * s, y: y + Math.sin(a) * s, r, tall: false })
        }
      } else {
        const r = this.radiusOf(it)
        const low = it.kind === 'shrub' || it.kind === 'rock'
        out.push({ x, y, r: low ? r : Math.min(r * 0.5, 2.5), tall: !low })
      }
    }
    return out
  }

  /** The element being adjusted in edit mode: an accent ring at its foot. `null` = none. */
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
   * The shape of an element: that of its species (at the current season), otherwise that of its family.
   * Under a style palette, the species is drawn as shading only and the style's foliage applies.
   */
  private shapeOf(it: GardenItem): GardenShape {
    const variant = gardenSeed(it) % GARDEN_VARIANTS
    const species = speciesOf(it)
    const foliage = this.look?.foliage ?? 1
    if (it.kind === 'hedge') return hedgeShape(lengthOf(it), this.season, species, !!this.look, widthOf(it), it.height, it.spacing, gardenSeed(it))
    if (species) return speciesShape(species, variant, this.season, this.look ? { foliage } : undefined)
    return gardenShape(it.kind, variant, foliage)
  }

  /** Natural colors: a species carries its own in its vertices, the instance only modulates their lightness. */
  private naturalColor(part: GardenPart, it: GardenItem): Color {
    if (speciesOf(it)) return new Color(0xffffff)
    return new Color((part === 'leaf' ? SEASON_LEAF[this.season]?.[it.kind] : undefined) ?? COLORS[it.kind][part] ?? 0x808080)
  }

  /** Style colors; a species' fruit keeps its own if the style does not impose any. */
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

  /** What the raycaster can hit: the instances, all families together. */
  pickables(): Object3D[] { return [...this.slots.values()].map((s) => s.mesh) }

  /** The element under an intersection returned by `pickables()`, otherwise `null`. */
  idOf(hit: Intersection): string | null {
    for (const slot of this.slots.values()) {
      if (slot.mesh === hit.object && hit.instanceId !== undefined) return slot.ids[hit.instanceId] ?? null
    }
    return null
  }

  /** Foot of the element in the site's reference frame (house, Z up). */
  footOf(id: string): Vector3 | null {
    const it = this.items.get(id)
    return it ? new Vector3(it.center[0], it.center[1], this.groundZ(it.center[0], it.center[1])) : null
  }

  /** WORLD box of the element, to frame it. */
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
    // the geometries are in the shape cache, shared: only the instance goes
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

/** A tint close to `base`, drawn from the seed: a grove is not a uniform green. */
function jitter(base: Color, seed: number): Color {
  const next = rng(seed ^ 0x5bd1e995)
  const hsl = { h: 0, s: 0, l: 0 }
  base.getHSL(hsl)
  return new Color().setHSL(hsl.h + (next() - 0.5) * 0.04, hsl.s * (0.85 + next() * 0.3), hsl.l * (0.85 + next() * 0.3))
}
