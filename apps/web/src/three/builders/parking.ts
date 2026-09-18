import {
  BoxGeometry, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  type BufferGeometry, type Texture,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { isParkingBay, type Parking, type ParkingSide } from '@kasbah/shared'

// Ce qu'on VOIT d'une place de stationnement. Deux dessins, parce que ce sont deux objets :
//
// - une place de voiture est une PEINTURE au sol — des tirets fins, un « P », et un trait plein côté
//   avant, qui est ce qui distingue l'avant de l'arrière sans écrire une flèche. Elle doit se lire
//   quand on la cherche et disparaître quand on regarde la maison : c'est la demande, « discret ».
// - la base d'un robot est un OBJET — une plaque au sol et un bloc de tête, comme les bases de robot
//   aspirateur. Un marquage au sol ne dirait pas qu'il y a quelque chose là où le robot se recharge.
//
// Tout est construit dans le repère de la place (origine au centre, +y vers l'avant) : le groupe
// porte la position et la rotation, et le reste ne connaît que des mètres.

/** Cotes du marquage d'une place de voiture (m). */
const BAY = { dash: 0.3, gap: 0.22, stroke: 0.06, glyph: 0.62, glyphInset: 0.5 } as const
/** Cotes d'une base de robot (m) : la plaque, puis le bloc de tête où le robot vient toucher. */
const DOCK = { plate: 0.03, head: 0.16, headDepth: 0.1 } as const
/** Épaisseur (m) d'une ligne de cote, celle des cotes d'ouverture. */
const COTE_BAR = 0.02

export interface ParkingMaterials {
  /** Le marquage au sol : peinture claire, sans reflet, jamais opaque. */
  paint: MeshBasicMaterial
  /** La ligne de cote, pendant qu'on règle une place. */
  cote: MeshBasicMaterial
  /** La plaque et le bloc d'une base de robot. */
  dock: MeshStandardMaterial
  /** Voile touchable de la place CHOISIE en mode édition. */
  fillOn: MeshBasicMaterial
  /** Cadre du mode édition, au repos puis choisi. */
  ring: MeshBasicMaterial
  ringOn: MeshBasicMaterial
  /**
   * Ce qui ÉTEINT un voile ou un cadre : un matériau invisible, jamais `Object3D.visible` — cette
   * propriété-là dit « mon niveau est masqué », et l'éteindre rendrait la place injoignable au doigt
   * (même piège que les poignées d'ouverture).
   */
  off: MeshBasicMaterial
}

/**
 * La couleur de la peinture au sol, et elle NE SUIT PAS le thème de l'app : un marquage de parking
 * est blanc dans le monde, comme le toit et la pelouse gardent leur couleur de matière quel que soit
 * le thème (voir `styles/`). Essayé d'abord avec `theme.onSurface` — en thème sombre il donnait du
 * blanc (juste), en thème clair un trait ANTHRACITE sur le béton, qu'aucun parking ne porte.
 */
const PAINT = 0xe8eef4

export function parkingMaterials(accent: Color): ParkingMaterials {
  const trait = accent.clone().lerp(new Color(0xffffff), 0.2).multiplyScalar(1.15)
  return {
    // `depthWrite: false` : la peinture est posée à deux centimètres du sol, elle ne doit pas
    // disputer la profondeur à ce qui se gare dessus.
    paint: new MeshBasicMaterial({ color: PAINT, transparent: true, opacity: 0.46, depthWrite: false, side: DoubleSide }),
    cote: new MeshBasicMaterial({ color: trait, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, side: DoubleSide }),
    dock: new MeshStandardMaterial({ color: 0x2d3138, roughness: 0.7, metalness: 0.1 }),
    fillOn: new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide }),
    ring: new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide }),
    ringOn: new MeshBasicMaterial({ color: trait, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, side: DoubleSide }),
    off: new MeshBasicMaterial({ visible: false }),
  }
}

/**
 * Le « P » du marquage, dessiné dans un canevas plutôt que dans une police 3D : une lettre est une
 * IMAGE ici, elle ne porte ni volume ni ombre, et charger une police pour un caractère coûterait
 * plus cher que la place entière. `null` là où il n'y a pas de canevas (tests hors navigateur) —
 * le reste du marquage se passe très bien de sa lettre.
 */
export function parkingGlyphTexture(color: Color): Texture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = `#${color.getHexString()}`
  ctx.font = 'bold 104px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('P', 64, 68)
  return new CanvasTexture(canvas)
}

/** Une bande plate (peinture) de `len × width`, centrée en `(x, y)` du repère de la place. */
function stripe(len: number, width: number, x: number, y: number): BufferGeometry {
  const g = new PlaneGeometry(len, width)
  g.translate(x, y, 0)
  return g
}

/**
 * Le contour en TIRETS d'une place : chaque côté est découpé en bandes de longueur à peu près
 * constante, le pas étant ajusté pour qu'un côté commence et finisse par un tiret — un marquage qui
 * s'arrête au milieu d'un vide se lit comme un contour cassé.
 *
 * Le côté AVANT est plein : c'est lui qui dit dans quel sens l'engin se range, sans flèche ni texte.
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
  dashed(length, 'y', -width / 2)                 // les deux longs côtés
  dashed(length, 'y', width / 2)
  dashed(width, 'x', -length / 2)                 // l'arrière
  parts.push(stripe(width, BAY.stroke, 0, length / 2))   // l'avant, plein
  return parts.length ? mergeGeometries(parts, false) : null
}

export interface ParkingNodes {
  group: Group
  /** Surface touchable (mode édition) : c'est elle que le rayon rencontre, et elle seule. */
  fill: Mesh
  /** Cadre du mode édition, éteint le reste du temps par son MATÉRIAU (jamais par `visible`). */
  ring: Mesh
  ringOn: Mesh
}

/**
 * Une place, prête à poser dans le groupe de son hôte. `z` est la hauteur LOCALE à ce groupe (sol du
 * niveau, ou terrain) ; le marquage se pose deux centimètres au-dessus pour ne pas se battre avec le
 * sol, la plaque d'une base repose dessus.
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
      const g = new PlaneGeometry(BAY.glyph, BAY.glyph)
      g.translate(0, -length / 2 + BAY.glyphInset, 0.021)
      group.add(new Mesh(g, new MeshBasicMaterial({ map: glyph, transparent: true, opacity: 0.5, depthWrite: false })))
    }
  } else {
    const plate = new BoxGeometry(width, length, DOCK.plate)
    plate.translate(0, 0, DOCK.plate / 2)
    const plateMesh = new Mesh(plate, mats.dock)
    plateMesh.receiveShadow = true
    // le bloc de tête est là où le robot vient toucher, donc DEVANT lui : au bout de la plaque, du
    // côté vers lequel la base regarde
    const head = new BoxGeometry(width * 0.8, DOCK.headDepth, DOCK.head)
    head.translate(0, length / 2 - DOCK.headDepth / 2, DOCK.head / 2)
    const headMesh = new Mesh(head, mats.dock)
    headMesh.castShadow = headMesh.receiveShadow = true
    group.add(plateMesh, headMesh)
  }

  // Les quatre lignes de COTE, seulement pour la place qu'on règle : chacune part du milieu d'un
  // bord et va droit jusqu'au contour de l'hôte — exactement l'intervalle que le nombre annonce
  // (même règle que les cotes d'une ouverture). Dessinées par-dessus tout : une cote qu'un mur de
  // garage coupe en deux ne se lit plus.
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

  // Le voile touchable couvre EXACTEMENT le rectangle : ce qu'on attrape au doigt est la place, pas
  // une boîte plus grande qu'elle. Il est posé au-dessus du marquage pour que le rayon le trouve.
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
  group.add(fill, ring, ringOn)
  return { group, fill, ring, ringOn }
}

/** Un cadre plat de `bar` mètres d'épaisseur, autour d'un rectangle `width × length`. */
function frameGeometry(width: number, length: number, bar: number): BufferGeometry {
  const parts = [
    stripe(width, bar, 0, length / 2 - bar / 2),
    stripe(width, bar, 0, -length / 2 + bar / 2),
    stripe(bar, length - 2 * bar, -width / 2 + bar / 2, 0),
    stripe(bar, length - 2 * bar, width / 2 - bar / 2, 0),
  ]
  return mergeGeometries(parts, false)!
}
