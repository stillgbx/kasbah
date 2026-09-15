import { BoxGeometry, Mesh, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { LevelGeometry, OpeningRect, Vec2, WallPrism } from '@kasbah/shared'
import type { MaterialSet } from './materials'
import { extrudePolygon } from './shapes'

// Détail ARCHITECTURAL procédural : ce qui fait qu'une boîte extrudée devient un bâtiment. Aucun
// asset, aucune donnée de plus dans house.json — tout se déduit des prismes de murs et des
// rectangles d'ouvertures (`packages/shared/src/house/geometry`). Quatre familles :
//  - l'ENCADREMENT d'une baie (quatre montants pour une fenêtre, trois pour une porte), posé à
//    mi-épaisseur du mur, là où est déjà le vitrage — le volet, lui, vit près de la face
//    extérieure (`markers.ts`, 0,8 de l'épaisseur) et ne le touche pas ;
//  - l'APPUI d'une fenêtre, qui déborde de la façade et dont le dessus AFFLEURE l'allège : un
//    volet fermé descend jusque là, un appui plus haut le couperait ;
//  - le COURONNEMENT des murs, une lisse plus claire qui déborde d'un centimètre de chaque face :
//    vue du dessus, c'est elle qui dessine le plan ; de côté, c'est l'arête du mur ;
//  - le SOUBASSEMENT des murs extérieurs, une bande plus sombre qui pose la maison sur son sol,
//    et qui rentre de huit millimètres côté pièce — une plinthe.
// Plus le VANTAIL d'une porte (fermé, côté intérieur) : une baie vide se lit comme un trou.
//
// Les décalages se font ACROSS le mur seulement, jamais le long : deux morceaux d'un même mur
// (plein, linteau, plein) gardent des couronnements qui se touchent exactement, sans recouvrement
// — deux dessus coplanaires qui se chevauchent scintillent. Il reste une encoche d'un centimètre
// à chaque angle extérieur, invisible à l'échelle d'une maison.
//
// Une géométrie FUSIONNÉE par matériau et par niveau : une maison de trente baies, ce sont trois
// appels de dessin de plus, pas trois cents.

const FRAME = 0.06          // largeur vue d'un montant de fenêtre (m)
const DOOR_FRAME = 0.07     // idem, porte
const CAP_H = 0.03          // hauteur du couronnement, pris SUR le mur…
const CAP_UP = 0.005        // …plus ce qu'il dépasse (deux dessus coplanaires scintilleraient)
const CAP_OUT = 0.01        // débord du couronnement de chaque côté
const PLINTH_H = 0.28
const PLINTH_OUT = 0.015    // débord du soubassement côté façade
const PLINTH_IN = 0.008     // et côté pièce : la plinthe
const SILL_H = 0.05
const SILL_OUT = 0.05       // débord de l'appui devant la façade
const SILL_SIDE = 0.04      // et de chaque côté de la baie
const LEAF = 0.04           // épaisseur d'un vantail
const EPS = 1e-6

/**
 * Une boîte dans le repère d'une baie : x le long du mur depuis le bord gauche, y dans l'épaisseur
 * depuis la face intérieure, z depuis l'allège. `at` est le CENTRE de la boîte.
 */
function boxAt(o: OpeningRect, size: readonly [number, number, number], at: readonly [number, number, number]): BufferGeometry {
  const g = new BoxGeometry(size[0], size[1], size[2])
  // Après `rotateZ`, l'axe y local suit la perpendiculaire GAUCHE de `u` — et la normale extérieure
  // d'un mur (pièce CCW) est la perpendiculaire DROITE. Sans ce signe, cadres et appuis partaient
  // dans la pièce : constaté sur la vraie maison, appui posé au pied de la fenêtre côté parquet.
  const side = Math.sign(-o.u[1] * o.normal[0] + o.u[0] * o.normal[1]) || 1
  g.translate(at[0], side * at[1], at[2])
  g.rotateZ(Math.atan2(o.u[1], o.u[0]))
  g.translate(o.origin[0], o.origin[1], o.origin[2])
  return g
}

/**
 * Encadrement d'une baie (montants SOMBRES : sur un mur clair, c'est le cadre qui dessine la
 * fenêtre — la maquette a des menuiseries anthracite) et appui d'une fenêtre (CLAIR, avec les lisses).
 */
function frameOfOpening(o: OpeningRect, frames: BufferGeometry[], trim: BufferGeometry[]): void {
  if (o.type === 'passage') return
  const f = o.type === 'window' ? FRAME : DOOR_FRAME
  const { width: w, height: h, depth: d } = o
  if (w <= 2 * f + EPS || h <= f + EPS) return
  const fd = Math.min(0.12, Math.max(0.04, d * 0.4))        // profondeur du cadre dans l'épaisseur
  frames.push(
    boxAt(o, [f, fd, h], [f / 2, d / 2, h / 2]),
    boxAt(o, [f, fd, h], [w - f / 2, d / 2, h / 2]),
    boxAt(o, [w - 2 * f, fd, f], [w / 2, d / 2, h - f / 2]),
  )
  if (o.type === 'window') {
    frames.push(boxAt(o, [w - 2 * f, fd, f], [w / 2, d / 2, f / 2]))
    const sy = 0.06 + SILL_OUT
    trim.push(boxAt(o, [w + 2 * SILL_SIDE, sy, SILL_H], [w / 2, d - 0.06 + sy / 2, -SILL_H / 2]))
  }
}

/** Le vantail fermé d'une porte, côté intérieur ; une porte de garage remplit sa baie. */
function leafOfOpening(o: OpeningRect, out: BufferGeometry[]): void {
  if (o.type !== 'door' && o.type !== 'garage') return
  const f = DOOR_FRAME
  const { width: w, height: h, depth: d } = o
  if (w <= 2 * f + EPS || h <= f + EPS) return
  const thick = o.type === 'garage' ? 0.05 : LEAF
  out.push(boxAt(o, [w - 2 * f, thick, h - f], [w / 2, o.type === 'garage' ? d / 2 : d * 0.35, (h - f) / 2]))
}

/**
 * Le quad d'un morceau de mur est [P0, Q0, Q1, P1] : P sur la ligne intérieure, Q sur la ligne
 * extérieure (`pieceFootprint`). On le décale ACROSS seulement : `inward` côté P, `outward` côté Q.
 */
function acrossOffset(fp: WallPrism['footprint'], inward: number, outward: number): Vec2[] {
  const [p0, q0, q1, p1] = fp
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1]
  const L = Math.hypot(dx, dy) || 1
  let nx = dy / L, ny = -dx / L                              // une perpendiculaire…
  if ((q0[0] - p0[0]) * nx + (q0[1] - p0[1]) * ny < 0) { nx = -nx; ny = -ny }   // …orientée vers Q
  return [
    [p0[0] - nx * inward, p0[1] - ny * inward],
    [q0[0] + nx * outward, q0[1] + ny * outward],
    [q1[0] + nx * outward, q1[1] + ny * outward],
    [p1[0] - nx * inward, p1[1] - ny * inward],
  ]
}

/** Couronnement : sur chaque morceau qui atteint le haut de SON mur (le plein et le linteau, pas l'allège). */
function capsOfWalls(walls: readonly WallPrism[], out: BufferGeometry[]): void {
  const top = new Map<string, number>()
  for (const w of walls) {
    const k = `${w.roomId}/${w.segment}`
    top.set(k, Math.max(top.get(k) ?? -Infinity, w.z1))
  }
  for (const w of walls) {
    if (w.z1 < top.get(`${w.roomId}/${w.segment}`)! - EPS) continue
    out.push(extrudePolygon(acrossOffset(w.footprint, CAP_OUT, CAP_OUT), w.z1 - CAP_H, w.z1 + CAP_UP))
  }
}

/** Soubassement : les morceaux de mur EXTÉRIEUR qui partent du sol (une porte y laisse son trou). */
function plinthsOfWalls(walls: readonly WallPrism[], out: BufferGeometry[]): void {
  for (const w of walls) {
    if (w.kind !== 'exterior' || w.z0 > EPS) continue
    // deux millimètres au-dessus du sol fini : le débord ne partage pas sa face avec le plancher
    out.push(extrudePolygon(acrossOffset(w.footprint, PLINTH_IN, PLINTH_OUT), w.z0 + 0.002, Math.min(w.z1, w.z0 + PLINTH_H)))
  }
}

function meshOf(parts: BufferGeometry[], material: MaterialSet['trim'], name: string): Mesh | null {
  if (parts.length === 0) return null
  // une boîte est INDEXÉE, une extrusion ne l'est pas : `mergeGeometries` refuse de mélanger les deux
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p))
  const g = mergeGeometries(flat, false)
  for (const p of parts) p.dispose()
  for (const p of flat) if (!parts.includes(p)) p.dispose()
  if (!g) return null
  const mesh = new Mesh(g, material)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  // rangé avec les murs du niveau (fantôme d'un étage au-dessus, retour au matériau) ; pas de pièce
  mesh.userData = { role: 'wall', kind: 'detail', material }
  return mesh
}

/** Le détail d'un niveau : au plus quatre maillages (lisses, encadrements, soubassement, vantaux). */
export function buildDetails(level: LevelGeometry, mats: MaterialSet): Mesh[] {
  const trim: BufferGeometry[] = []
  const frames: BufferGeometry[] = []
  const plinth: BufferGeometry[] = []
  const doors: BufferGeometry[] = []
  for (const o of level.openings) { frameOfOpening(o, frames, trim); leafOfOpening(o, doors) }
  capsOfWalls(level.walls, trim)
  plinthsOfWalls(level.walls, plinth)
  return [
    meshOf(trim, mats.trim, 'details:trim'),
    meshOf(frames, mats.frame, 'details:frames'),
    meshOf(plinth, mats.plinth, 'details:plinth'),
    meshOf(doors, mats.door, 'details:doors'),
  ].filter((m): m is Mesh => m !== null)
}
