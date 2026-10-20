import {
  BoxGeometry, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  Shape, ShapeGeometry, type BufferGeometry, type Texture,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { isParkingBay, type Parking, type ParkingSide } from '@kasbah/shared'

// What one SEES of a parking space. Two drawings, because these are two objects:
//
// - a car space is PAINT on the ground — thin dashes, a "P" in the middle, and a solid
//   line on the BACK side, which is what tells the front from the back without writing an arrow: it is
//   the stop, the one you back up against. It must read when you look for it and disappear
//   when you look at the house: that is the request, "discreet".
// - a robot's base is an OBJECT — a plate on the ground and a block, like the bases of robot
//   vacuums. A ground marking would not say there is something there where the robot charges.
//   The block is BEHIND the robot (back side of the space): that is where it comes to touch when
//   backing into its station, and that is what one sees on a real base.
//
// Everything is built in the space's frame (origin at the center, +y toward the front): the group
// carries the position and the rotation, and the rest only knows meters.

/** Dimensions of a car space marking (m): the "P" fills the middle, generously. */
const BAY = { dash: 0.3, gap: 0.22, stroke: 0.06, glyph: 0.68 } as const
/** Dimensions of a robot base (m): the plate, then the head block where the robot comes to touch. */
const DOCK = { plate: 0.03, head: 0.16, headDepth: 0.1 } as const
/** Thickness (m) of a dimension line, that of the opening dimensions. */
const COTE_BAR = 0.02

export interface ParkingMaterials {
  /** The ground marking: light paint, no reflection, never opaque. */
  paint: MeshBasicMaterial
  /** The dimension line, while a space is being adjusted. */
  cote: MeshBasicMaterial
  /** The plate and the block of a robot base. */
  dock: MeshStandardMaterial
  /** Touchable veil of the SELECTED space in edit mode. */
  fillOn: MeshBasicMaterial
  /** Edit mode frame, at rest then selected. */
  ring: MeshBasicMaterial
  ringOn: MeshBasicMaterial
  /**
   * What TURNS OFF a veil or a frame: an invisible material, never `Object3D.visible` — that
   * property says "my level is hidden", and turning it off would make the space unreachable by finger
   * (same pitfall as the opening handles).
   */
  off: MeshBasicMaterial
}

/**
 * The color of the ground paint, and it does NOT FOLLOW the app theme: a parking marking
 * is white in the world, just as the roof and the lawn keep their material color whatever
 * the theme (see `styles/`). Tried first with `theme.onSurface` — in dark theme it gave
 * white (right), in light theme a CHARCOAL line on the concrete, which no parking lot carries.
 */
const PAINT = 0xe8eef4

export function parkingMaterials(accent: Color): ParkingMaterials {
  const trait = accent.clone().lerp(new Color(0xffffff), 0.2).multiplyScalar(1.15)
  return {
    // `depthWrite: false`: the paint is laid two centimeters above the ground, it must not
    // fight over depth with what parks on it.
    paint: new MeshBasicMaterial({ color: PAINT, transparent: true, opacity: 0.26, depthWrite: false, side: DoubleSide }),
    cote: new MeshBasicMaterial({ color: trait, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, side: DoubleSide }),
    dock: new MeshStandardMaterial({ color: 0x2d3138, roughness: 0.7, metalness: 0.1 }),
    fillOn: new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide }),
    ring: new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide }),
    ringOn: new MeshBasicMaterial({ color: trait, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, side: DoubleSide }),
    off: new MeshBasicMaterial({ visible: false }),
  }
}

/**
 * The "P" of the marking, drawn in a canvas rather than in a 3D font: a letter is an
 * IMAGE here, it carries neither volume nor shadow, and loading a font for one character would cost
 * more than the whole space. `null` where there is no canvas (tests outside a browser) —
 * the rest of the marking does very well without its letter.
 */
export function parkingGlyphTexture(color: Color): Texture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = `#${color.getHexString()}`
  ctx.font = 'bold 112px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // The canvas is drawn UPSIDE DOWN (half turn): the letter is laid in the space's frame,
  // whose +y is the front, and a texture arrives there upside down. It thus reads standing IN FRONT OF
  // the space, as the "P" of a real parking lot reads when driving onto it.
  ctx.translate(64, 64)
  ctx.rotate(Math.PI)
  ctx.fillText('P', 0, 4)
  return new CanvasTexture(canvas)
}

/** A flat stripe (paint) of `len × width`, centered at `(x, y)` of the space's frame. */
function stripe(len: number, width: number, x: number, y: number): BufferGeometry {
  const g = new PlaneGeometry(len, width)
  g.translate(x, y, 0)
  return g
}

/**
 * The DASHED outline of a space: each side is cut into stripes of roughly constant
 * length, the step being adjusted so that a side starts and ends with a dash — a marking that
 * stops in the middle of a gap reads as a broken outline.
 *
 * The BACK side is solid: it says which way the vehicle parks, without arrow or
 * text. A parking lot is painted this way — the solid line is the stop, the opening is in front.
 */
function bayMarking(width: number, length: number): BufferGeometry | null {
  const parts: BufferGeometry[] = []
  const dashed = (span: number, along: 'x' | 'y', offset: number) => {
    const n = Math.max(1, Math.round((span + BAY.gap) / (BAY.dash + BAY.gap)))
    const step = span / n
    const dash = Math.max(BAY.stroke, step - BAY.gap)
    for (let i = 0; i < n; i++) {
      const c = -span / 2 + step * (i + 0.5)
      parts.push(along === 'x' ? stripe(dash, BAY.stroke, c, offset) : stripe(BAY.stroke, dash, offset, c))
    }
  }
  dashed(length, 'y', -width / 2)                 // the two long sides
  dashed(length, 'y', width / 2)
  dashed(width, 'x', length / 2)                  // the front, the way out
  parts.push(stripe(width, BAY.stroke, 0, -length / 2))  // the back, solid: the stop
  return parts.length ? mergeGeometries(parts, false) : null
}

/**
 * The "looks toward" cone of edit mode, copied from the guide of an orientable device
 * (`DeviceMarker.setMoving`): it is the language the app already has to say a DIRECTION, and a space
 * without it is placed blind — the solid back line only shows once the space is drawn.
 *
 * It is placed ahead of the front of the space and sized by it: an 80 cm mower base does not
 * carry the same arrow as a 5 m garage.
 */
function facingCone(length: number): BufferGeometry {
  const reach = Math.min(Math.max(length * 0.42, 0.45), 1.6)
  const w = reach * 0.31
  const shape = new Shape()
  shape.moveTo(0, 0)
  shape.lineTo(-w, reach * 0.84)
  shape.quadraticCurveTo(0, reach, w, reach * 0.84)
  shape.lineTo(0, 0)
  const g = new ShapeGeometry(shape, 12)
  g.translate(0, length / 2 + 0.06, 0.035)
  return g
}

export interface ParkingNodes {
  group: Group
  /** Touchable surface (edit mode): it is what the ray meets, and it alone. */
  fill: Mesh
  /** Edit mode frame, turned off the rest of the time through its MATERIAL (never through `visible`). */
  ring: Mesh
  ringOn: Mesh
  /** The cone that indicates the front, lit with the frame. */
  cone: Mesh
}

/**
 * A space, ready to be placed in its host's group. `z` is the height LOCAL to that group (floor of the
 * level, or terrain); the marking is laid two centimeters above so as not to fight with the
 * ground, the plate of a base rests on it.
 */
export function buildParking(
  p: Parking, z: number, mats: ParkingMaterials, glyph: Texture | null,
  gaps?: Record<ParkingSide, number | null>,
): ParkingNodes {
  const [width, length] = p.size
  const group = new Group()
  group.name = `parking:${p.id}`
  group.position.set(p.center[0], p.center[1], z)
  group.rotation.z = (p.yaw * Math.PI) / 180

  if (isParkingBay(p)) {
    const marking = bayMarking(width, length)
    if (marking) {
      marking.translate(0, 0, 0.02)
      group.add(new Mesh(marking, mats.paint))
    }
    if (glyph) {
      // In the MIDDLE and large: it is what reads at a glance from afar, where a letter placed in
      // a corner was confused with a dash. Larger, hence paler — the space stays discreet.
      const side = Math.min(width, length) * BAY.glyph
      const g = new PlaneGeometry(side, side)
      g.translate(0, 0, 0.021)
      group.add(new Mesh(g, new MeshBasicMaterial({ map: glyph, transparent: true, opacity: 0.22, depthWrite: false })))
    }
  } else {
    const plate = new BoxGeometry(width, length, DOCK.plate)
    plate.translate(0, 0, DOCK.plate / 2)
    const plateMesh = new Mesh(plate, mats.dock)
    plateMesh.receiveShadow = true
    // The block is BEHIND: a robot backs into its base, its contacts are at the back, and it is the
    // end of the plate that one sees sticking out when it sits on it.
    const head = new BoxGeometry(width * 0.8, DOCK.headDepth, DOCK.head)
    head.translate(0, -length / 2 + DOCK.headDepth / 2, DOCK.head / 2)
    const headMesh = new Mesh(head, mats.dock)
    headMesh.castShadow = headMesh.receiveShadow = true
    group.add(plateMesh, headMesh)
  }

  // The four DIMENSION lines, only for the space being adjusted: each one starts from the middle of an
  // edge and goes straight to the host's outline — exactly the interval the number states
  // (same rule as the dimensions of an opening). Drawn over everything: a dimension that a garage
  // wall cuts in two no longer reads.
  if (gaps) {
    for (const side of ['front', 'back', 'left', 'right'] as const) {
      const d = gaps[side]
      if (d === null || d < 1e-3) continue
      const along = side === 'front' || side === 'back'
      const sign = side === 'front' || side === 'right' ? 1 : -1
      const start = (along ? length : width) / 2
      const bar = new BoxGeometry(along ? COTE_BAR : d, along ? d : COTE_BAR, COTE_BAR)
      bar.translate(along ? 0 : sign * (start + d / 2), along ? sign * (start + d / 2) : 0, 0.08)
      group.add(new Mesh(bar, mats.cote))
    }
  }

  // The touchable veil covers EXACTLY the rectangle: what is grabbed by finger is the space, not
  // a box larger than it. It is laid above the marking so that the ray finds it.
  const fillGeo = new PlaneGeometry(width, length)
  fillGeo.translate(0, 0, 0.03)
  const fill = new Mesh(fillGeo, mats.off)
  fill.userData = { role: 'parking', parkingId: p.id }
  const ringGeo = frameGeometry(width, length, 0.04)
  ringGeo.translate(0, 0, 0.031)
  const ring = new Mesh(ringGeo, mats.off)
  const ringOnGeo = frameGeometry(width, length, 0.08)
  ringOnGeo.translate(0, 0, 0.032)
  const ringOn = new Mesh(ringOnGeo, mats.off)
  const cone = new Mesh(facingCone(length), mats.off)
  group.add(fill, ring, ringOn, cone)
  return { group, fill, ring, ringOn, cone }
}

/** A flat frame `bar` meters thick, around a `width × length` rectangle. */
function frameGeometry(width: number, length: number, bar: number): BufferGeometry {
  const parts = [
    stripe(width, bar, 0, length / 2 - bar / 2),
    stripe(width, bar, 0, -length / 2 + bar / 2),
    stripe(bar, length - 2 * bar, -width / 2 + bar / 2, 0),
    stripe(bar, length - 2 * bar, width / 2 - bar / 2, 0),
  ]
  return mergeGeometries(parts, false)!
}
