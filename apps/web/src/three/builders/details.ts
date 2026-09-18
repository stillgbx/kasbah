import { BoxGeometry, Matrix4, Mesh, Vector3, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { LevelGeometry, OpeningMaterial, OpeningRect, OpeningType, RoofDescriptor, Vec2, Vec3, WallPrism } from '@kasbah/shared'
import { joineryMaterial, type JoineryRole, type MaterialSet } from './materials'
import { extrudePolygon, extrudeRing, insetPolygon } from './shapes'

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
/** Aucune ouverture habillée : le cas de toutes les maisons qui n'ont pas d'ouvrant lié. */
const EMPTY_SET: ReadonlySet<string> = new Set<string>()
/** Jeu (m) entre deux vantaux pleins : c'est ce trait qui fait lire une porte à deux battants. */
const LEAF_GAP = 0.02

/**
 * Ce qui est VITRÉ : une fenêtre, une baie, une porte vitrée. Ces trois-là reçoivent un vitrage dans
 * leur embrasure (`buildPane`) ; une porte pleine, un passage et une porte de garage, non.
 *
 * Déclaré ici, dans un module FEUILLE : `buildHouse` importe déjà `buildDetails` d'ici, et l'inverse
 * ferait un cycle — Vite réévalue un module à chaud, et un cycle le laisse à moitié initialisé
 * (cf. `6_faq/6_0_pieges-outillage.md`).
 */
export const GLAZED_OPENINGS: ReadonlySet<OpeningType> = new Set<OpeningType>(['window', 'bay', 'glass-door'])

/**
 * Vitrée pour de bon : par sa NATURE, ou parce que le relevé lui donne le verre pour matière. Une
 * porte pleine déclarée en verre reçoit alors son vitrage et perd son panneau opaque — c'est tout
 * ce que « matière : verre » veut dire, et c'est la seule matière qui touche la géométrie.
 */
export const isGlazed = (o: OpeningRect): boolean => o.material === 'glass' || GLAZED_OPENINGS.has(o.type)

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
 *
 * Trois familles se distinguent au premier coup d'œil, et c'est voulu — l'utilisateur corrige un
 * relevé, il doit voir qu'il a désigné la bonne ouverture :
 *  - une FENÊTRE : cadre sur ses quatre côtés, plus un appui qui déborde de la façade ;
 *  - une BAIE VITRÉE : cadre sur quatre côtés aussi (elle a une traverse basse, c'est son rail),
 *    mais AUCUN appui — elle descend au sol — et un refend vertical par vantail, sans quoi trois
 *    mètres de verre d'un seul tenant ne ressemblent à rien ;
 *  - une PORTE, vitrée ou pleine : trois côtés, pas de traverse basse (c'est le seuil), pas d'appui.
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
  // traverse basse : l'allège d'une fenêtre, le rail d'une baie ; une porte a un seuil, pas une traverse
  if (o.type === 'window' || o.type === 'bay') frames.push(boxAt(o, [w - 2 * f, fd, f], [w / 2, d / 2, f / 2]))
  if (o.type === 'window') {
    const sy = 0.06 + SILL_OUT
    trim.push(boxAt(o, [w + 2 * SILL_SIDE, sy, SILL_H], [w / 2, d - 0.06 + sy / 2, -SILL_H / 2]))
  }
  // Un REFEND par joint entre vantaux, sur tout ce qui est vitré : sans eux, trois mètres de verre
  // d'un seul tenant ne ressemblent à rien. La baie en prenait déjà d'office ; c'est maintenant le
  // nombre de vantaux qui décide (`openingLeaves` rend la même chose quand le fichier se tait).
  if (isGlazed(o)) {
    for (let i = 1; i < o.leaves; i++) frames.push(boxAt(o, [f, fd, h - 2 * f], [(i * w) / o.leaves, d / 2, h / 2]))
  }
}

/** Les `n` vantaux d'une baie large de `inner`, avec leur jeu : largeur d'un vantail, et son bord gauche. */
function leafSpans(inner: number, n: number): { width: number; x0: (i: number) => number } | null {
  const gap = n > 1 ? LEAF_GAP : 0
  const width = (inner - gap * (n - 1)) / n
  return width > EPS ? { width, x0: (i: number) => i * (width + gap) } : null
}

/**
 * Ce qui REMPLIT la baie : le vantail plein d'une porte (côté intérieur), le tablier d'une porte de
 * garage — et, pour une porte VITRÉE, un simple cadre de vantail, sombre, autour du verre déjà posé
 * par `buildPane`. Un panneau opaque y cacherait précisément ce qui la définit.
 */
function leafOfOpening(o: OpeningRect, out: BufferGeometry[], frames: BufferGeometry[]): void {
  if (o.type !== 'door' && o.type !== 'garage' && o.type !== 'glass-door') return
  const f = DOOR_FRAME
  const { width: w, height: h, depth: d } = o
  if (w <= 2 * f + EPS || h <= f + EPS) return
  const span = leafSpans(w - 2 * f, o.leaves)
  if (!span) return
  if (isGlazed(o)) {
    const lh = h - f, r = f * 0.8                   // le battant est un peu plus fin que le dormant
    const y = d * 0.35
    for (let i = 0; i < o.leaves; i++) {
      const x = f + span.x0(i), lw = span.width
      if (lw <= 2 * r + EPS) continue
      frames.push(
        boxAt(o, [r, LEAF, lh], [x + r / 2, y, lh / 2]),
        boxAt(o, [r, LEAF, lh], [x + lw - r / 2, y, lh / 2]),
        boxAt(o, [lw - 2 * r, LEAF, r], [x + lw / 2, y, lh - r / 2]),
        boxAt(o, [lw - 2 * r, LEAF, r], [x + lw / 2, y, r / 2]),
      )
    }
    return
  }
  // vantaux PLEINS : un panneau par vantail, séparés par leur jeu — une porte à deux battants se
  // reconnaît à ce trait vertical, pas à un panneau deux fois plus large
  const thick = o.type === 'garage' ? 0.05 : LEAF
  const y = o.type === 'garage' ? d / 2 : d * 0.35
  for (let i = 0; i < o.leaves; i++) {
    out.push(boxAt(o, [span.width, thick, h - f], [f + span.x0(i) + span.width / 2, y, (h - f) / 2]))
  }
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

/**
 * La MENUISERIE se fusionne par teinte, pas en bloc : une ouverture qui ne demande ni matière ni
 * couleur retombe sur le matériau partagé de son rôle, et n'ajoute donc aucun appel de dessin. Une
 * maison ordinaire garde ses deux maillages ; seules les ouvertures qui veulent autre chose en
 * coûtent un de plus, et deux fenêtres de la même teinte le partagent.
 */
type Buckets = Map<string, { parts: BufferGeometry[]; material?: OpeningMaterial; color?: string }>
function bucket(buckets: Buckets, o: OpeningRect): BufferGeometry[] {
  // la clé VIDE est celle du réglage par défaut : c'est elle qui garde son maillage sans suffixe
  const key = o.material || o.color ? `${o.material ?? ''}|${o.color ?? ''}` : ''
  let b = buckets.get(key)
  if (!b) { b = { parts: [], ...(o.material ? { material: o.material } : {}), ...(o.color ? { color: o.color } : {}) }; buckets.set(key, b) }
  return b.parts
}
function meshesOf(buckets: Buckets, mats: MaterialSet, role: JoineryRole, name: string): (Mesh | null)[] {
  return [...buckets].map(([key, b]) => meshOf(b.parts, joineryMaterial(mats, role, b.material, b.color), key ? `${name}#${key}` : name))
}

/** Le détail d'un niveau : lisses, encadrements, soubassement, vantaux — les deux derniers par teinte. */
export function buildDetails(level: LevelGeometry, mats: MaterialSet, dressed: ReadonlySet<string> = EMPTY_SET): Mesh[] {
  const trim: BufferGeometry[] = []
  const plinth: BufferGeometry[] = []
  const frames: Buckets = new Map()
  const doors: Buckets = new Map()
  for (const o of level.openings) {
    frameOfOpening(o, bucket(frames, o), trim)
    // Le vantail d'une baie HABILLÉE par un ouvrant appartient à l'appareil : c'est lui qui le
    // dessine, à ses cotes et à ses couleurs, et qui l'ouvre. En dessiner un second ici laissait une
    // porte de garage fermée derrière le tablier qui vient de remonter. Le DORMANT et le VITRAGE,
    // eux, restent au bâti : un volet ne retire ni le cadre ni la vitre de la fenêtre qu'il couvre.
    if (!dressed.has(o.openingId)) leafOfOpening(o, bucket(doors, o), bucket(frames, o))
  }
  capsOfWalls(level.walls, trim)
  plinthsOfWalls(level.walls, plinth)
  return [
    meshOf(trim, mats.trim, 'details:trim'),
    ...meshesOf(frames, mats, 'frame', 'details:frames'),
    meshOf(plinth, mats.plinth, 'details:plinth'),
    ...meshesOf(doors, mats, 'door', 'details:doors'),
  ].filter((m): m is Mesh => m !== null)
}

// ---- le toit ------------------------------------------------------------------------------------

const FASCIA_DROP = 0.18      // hauteur d'une planche de rive (m)
const FASCIA_T = 0.04         // son épaisseur
const FASCIA_GAP = 0.01       // décollée du pignon : deux faces coplanaires scintilleraient
const PARAPET_H = 0.35        // acrotère d'un toit plat, au-dessus de la dalle
const PARAPET_T = 0.2

/**
 * Une planche le long d'une arête 3D, pendue sous elle et poussée vers `out` : un parallélépipède
 * (une boîte unitaire à laquelle on donne une base oblique), pour que la planche d'une rive en pente
 * suive la pente en gardant ses faces verticales.
 */
function board(a: Vec3, b: Vec3, out: Vec2): BufferGeometry {
  const g = new BoxGeometry(1, 1, 1)
  const e = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const m = new Matrix4().makeBasis(e, new Vector3(out[0] * FASCIA_T, out[1] * FASCIA_T, 0), new Vector3(0, 0, FASCIA_DROP))
  const k = FASCIA_GAP + FASCIA_T / 2
  m.setPosition((a[0] + b[0]) / 2 + out[0] * k, (a[1] + b[1]) / 2 + out[1] * k, (a[2] + b[2]) / 2 - FASCIA_DROP / 2)
  g.applyMatrix4(m)
  return g
}

/**
 * Le détail du toit. Toit à deux pentes : une planche de RIVE sous chaque arête de versant qui n'est
 * pas le faîte (égouts et rives de pignon) — c'est l'épaisseur visible d'un toit qui n'en a pas
 * (`faces` est un jeu de plans, `thickness` 0). Toit plat : un ACROTÈRE, muret dans le matériau des
 * murs qui court sur le pourtour de la dalle, couronné comme les murs.
 */
export function buildRoofDetails(roof: RoofDescriptor, mats: MaterialSet): Mesh[] {
  const out: Mesh[] = []
  if (roof.type === 'flat') {
    const inner = insetPolygon(roof.outline, PARAPET_T)
    const z0 = roof.zRidge, z1 = roof.zRidge + PARAPET_H
    const wall = new Mesh(extrudeRing(roof.outline, inner, z0, z1), mats.wall)
    wall.name = 'roof:parapet'
    wall.userData = { role: 'roof', material: mats.wall }
    const cap = new Mesh(extrudeRing(insetPolygon(roof.outline, -CAP_OUT), insetPolygon(inner, CAP_OUT), z1 - CAP_H, z1 + CAP_UP), mats.trim)
    cap.name = 'roof:parapet-cap'
    cap.userData = { role: 'roof', material: mats.trim }
    out.push(wall, cap)
  } else {
    const parts: BufferGeometry[] = []
    for (const face of roof.faces) {
      // un pignon est vertical : son emprise au sol n'a pas d'aire
      let area = 0
      for (let i = 0; i < face.length; i++) {
        const p = face[i]!, q = face[(i + 1) % face.length]!
        area += p[0] * q[1] - q[0] * p[1]
      }
      if (Math.abs(area) < EPS) continue
      const cx = face.reduce((s, p) => s + p[0], 0) / face.length
      const cy = face.reduce((s, p) => s + p[1], 0) / face.length
      for (let i = 0; i < face.length; i++) {
        const a = face[i]!, b = face[(i + 1) % face.length]!
        if (a[2] >= roof.zRidge - EPS && b[2] >= roof.zRidge - EPS) continue   // le faîte n'a pas de rive
        const L = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (L < EPS) continue
        let out2: Vec2 = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L]
        if (out2[0] * ((a[0] + b[0]) / 2 - cx) + out2[1] * ((a[1] + b[1]) / 2 - cy) < 0) out2 = [-out2[0], -out2[1]]
        parts.push(board(a, b, out2))
      }
    }
    const fascia = meshOf(parts, mats.frame, 'roof:fascia')
    if (fascia) { fascia.userData = { role: 'roof', material: mats.frame }; out.push(fascia) }
  }
  for (const m of out) { m.castShadow = true; m.receiveShadow = true }
  return out
}
