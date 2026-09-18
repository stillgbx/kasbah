import type { HouseDefaults } from './defaults'
import { dist, type Vec2 } from './geometry/vec2'
import { classifySegments, isWalled, type WallSegment } from './geometry/walls'
import type { Opening, OpeningType, Room } from './schema'

// Où une ouverture a le DROIT de se poser sur le contour de sa pièce, et ce que devient un point
// attrapé à la souris. La règle est celle de `validate.ts` — segment mur (jamais « none »), tenant
// dans sa longueur, sans chevaucher une voisine — mais prise à l'endroit : la validation REFUSE,
// ici on RAMÈNE à l'emplacement admissible le plus proche. Un glissement ne doit jamais produire
// une maison que le serveur rejette ; il doit buter.

/**
 * Plus petite cote d'une ouverture (m). Une ouverture de zéro disparaîtrait de la scène sans qu'on
 * sache pourquoi ; c'est le même garde-fou que les bornes de taille d'un ouvrant posé dehors.
 */
export const MIN_OPENING_DIM = 0.3

/**
 * Arrondi au centimètre. Ce que rendent les fonctions d'ajustement part dans house.json : une allège
 * de `0.2999999999999998` y resterait, illisible pour qui relit son relevé. Le centimètre est la
 * précision d'un mètre ruban, donc celle du fichier.
 */
const cm = (v: number) => Math.round(v * 100) / 100

/** Place d'une ouverture sur le contour : l'arête qui la porte, et la distance depuis son coin. */
export interface OpeningSlot { segment: number; offset: number }

/** Intervalle de `offset` admissible : une ouverture large de `width` peut commencer entre min et max. */
interface Range { min: number; max: number }

/**
 * Intervalles libres d'un segment, une fois retirées les ouvertures déjà posées dessus.
 * `taken` est donné en abscisses curvilignes [début, fin] sur le segment.
 */
function freeRanges(L: number, width: number, taken: readonly [number, number][]): Range[] {
  const sorted = [...taken].sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  let cursor = 0
  for (const [u0, u1] of sorted) {
    if (u0 - cursor >= width) out.push({ min: cursor, max: u0 - width })
    cursor = Math.max(cursor, u1)
  }
  if (L - cursor >= width) out.push({ min: cursor, max: L - width })
  return out
}

/** Les ouvertures d'un segment, sauf celle qu'on déplace. */
function neighbours(room: Room, segment: number, exceptId: string): [number, number][] {
  return room.openings
    .filter((o) => o.id !== exceptId && o.segment === segment)
    .map((o) => [o.offset, o.offset + o.width] as [number, number])
}

/**
 * Segments capables de porter une ouverture large de `width` : ceux qui sont un mur (une terrasse
 * n'en a pas, un segment « none » est une ouverture de plain-pied) et où il reste la place.
 */
export function hostSegments(
  room: Room, roomsOnLevel: readonly Room[], defaults: HouseDefaults, width: number, exceptId: string,
): { seg: WallSegment; ranges: Range[] }[] {
  if (!isWalled(room)) return []
  return classifySegments(room, roomsOnLevel, defaults)
    .filter((seg) => seg.kind !== 'none')
    .map((seg) => ({ seg, ranges: freeRanges(seg.L, width, neighbours(room, seg.index, exceptId)) }))
    .filter((c) => c.ranges.length > 0)
}

/** L'intervalle libre qui CONTIENT `offset`, ou, à défaut, le plus proche. */
function rangeAt(ranges: readonly Range[], offset: number): Range | null {
  let best: Range | null = null
  for (const r of ranges) {
    if (offset >= r.min - 1e-6 && offset <= r.max + 1e-6) return r
    const d = Math.min(Math.abs(offset - r.min), Math.abs(offset - r.max))
    if (!best || d < Math.min(Math.abs(offset - best.min), Math.abs(offset - best.max))) best = r
  }
  return best
}

/** Ramène `offset` dans l'intervalle libre le plus proche ; `null` si le segment ne peut rien porter. */
function snapIntoRanges(ranges: readonly Range[], offset: number): number | null {
  let best: number | null = null
  for (const r of ranges) {
    const v = Math.min(r.max, Math.max(r.min, offset))
    if (best === null || Math.abs(v - offset) < Math.abs(best - offset)) best = v
  }
  return best
}

/** Distance (m) du point au segment lui-même (projection ramenée entre ses deux bouts). */
function distToSegment(p: Vec2, seg: WallSegment): number {
  const t = Math.min(seg.L, Math.max(0, (p[0] - seg.a[0]) * seg.d[0] + (p[1] - seg.a[1]) * seg.d[1]))
  return dist(p, [seg.a[0] + seg.d[0] * t, seg.a[1] + seg.d[1] * t])
}

/**
 * Point du repère maison → emplacement admissible sur le CONTOUR de la pièce. Deux questions, dans
 * cet ordre, parce que c'est ainsi qu'on lit le geste :
 *
 * 1. **Quel mur ?** Le plus proche du doigt, parmi ceux qui peuvent la recevoir. C'est ce qui fait
 *    passer les coins : on tire vers le mur d'à côté, l'ouverture y va.
 * 2. **Où sur ce mur ?** Le doigt projeté, ramené dans un intervalle libre.
 *
 * `from` = la place qu'occupe l'ouverture en ce moment. Donnée, elle rend le geste CONTINU : sur son
 * propre mur, l'ouverture reste dans l'intervalle libre où elle se trouve, donc elle BUTE sur sa
 * voisine au lieu de se téléporter de l'autre côté dès que le doigt dépasse le milieu. Pour aller
 * au-delà d'une voisine, on fait le tour de la pièce — c'est ce que « courir le long des murs » veut
 * dire, et c'est ce qui rend le geste prévisible. Sans `from`, le plus proche gagne.
 */
export function slotFromPoint(
  room: Room, roomsOnLevel: readonly Room[], defaults: HouseDefaults,
  point: Vec2, width: number, exceptId: string, from?: OpeningSlot,
): OpeningSlot | null {
  const hosts = hostSegments(room, roomsOnLevel, defaults, width, exceptId)
  let nearest: { seg: WallSegment; ranges: Range[] } | null = null
  let best = Infinity
  for (const host of hosts) {
    const d = distToSegment(point, host.seg)
    if (d < best) { best = d; nearest = host }
  }
  if (!nearest) return null
  const t = (point[0] - nearest.seg.a[0]) * nearest.seg.d[0] + (point[1] - nearest.seg.a[1]) * nearest.seg.d[1]
  const here = from && from.segment === nearest.seg.index ? rangeAt(nearest.ranges, from.offset) : null
  const offset = snapIntoRanges(here ? [here] : nearest.ranges, t - width / 2)
  return offset === null ? null : { segment: nearest.seg.index, offset }
}

/** Longueur (m) de l'arête qui porte `segment`, ou 0 si elle n'existe pas. */
function segmentLength(room: Room, segment: number): number {
  const n = room.polygon.length
  const a = room.polygon[segment]
  const b = room.polygon[(segment + 1) % n]
  return a && b ? dist(a, b) : 0
}

/**
 * Ce qu'on affiche pour DÉSIGNER une ouverture : son nom s'il lui en a été donné un, sinon son
 * identifiant de relevé. Une seule règle, pour que le panneau, la liste de la pièce et l'étiquette
 * de la scène ne disent jamais trois choses différentes de la même fenêtre.
 */
export const openingLabel = (o: Opening): string => o.name ?? o.id

/**
 * Les deux cotes qui comptent quand on pose une ouverture : ce qui la sépare de chaque bout de son
 * mur. C'est ainsi qu'on relève une maison au mètre ruban — depuis les coins, pas depuis une origine
 * de fichier — et c'est ce que la scène annote pendant le déplacement.
 *
 * **Gauche et droite se disent DE L'INTÉRIEUR de la pièce**, parce que c'est de là qu'on mesure. Le
 * fichier, lui, ne connaît que `offset`, la distance au coin `polygon[segment]` ; la convention est
 * donc posée ICI, une fois, plutôt que laissée à chaque écran qui affiche les deux nombres — une
 * inversion silencieuse s'est déjà produite, et elle ne se voit qu'en se mettant dans la pièce.
 *
 * La correspondance ne dépend pas de la pièce : `ccwPolygonSchema` impose le sens trigonométrique,
 * donc l'intérieur est TOUJOURS à gauche de l'arête `polygon[i] → polygon[i+1]`. Un observateur
 * placé dedans et tourné vers le mur a donc `polygon[segment]` — l'origine d'`offset` — à sa DROITE.
 */
export function openingGaps(room: Room, opening: Opening): { left: number; right: number } {
  const right = opening.offset
  const left = Math.max(0, segmentLength(room, opening.segment) - opening.offset - opening.width)
  return { left, right }
}

/**
 * Le vide où l'ouverture est POSÉE : l'intervalle libre de son mur qui la contient, voisines
 * retirées, en abscisses curvilignes depuis le coin `polygon[segment]`.
 *
 * C'est la place réellement disponible, et non ce qui reste à droite de l'ouverture : élargir une
 * fenêtre qui a un mètre libre à sa gauche et dix centimètres à sa droite doit pouvoir prendre les
 * deux, quitte à la faire glisser.
 */
export function freeSpan(
  room: Room, roomsOnLevel: readonly Room[], defaults: HouseDefaults, opening: Opening,
): { u0: number; u1: number } | null {
  if (!isWalled(room)) return null
  const seg = classifySegments(room, roomsOnLevel, defaults)[opening.segment]
  if (!seg || seg.kind === 'none') return null
  let u0 = 0
  let u1 = seg.L
  for (const [a, b] of neighbours(room, opening.segment, opening.id)) {
    if (b <= opening.offset + 1e-6) u0 = Math.max(u0, b)          // voisine à gauche
    else if (a >= opening.offset + opening.width - 1e-6) u1 = Math.min(u1, a)   // à droite
    else return null                                              // chevauchement déjà écrit : on ne décide rien
  }
  return u1 > u0 ? { u0, u1 } : null
}

/**
 * Largeur voulue → largeur retenue et place où elle PASSE. L'ouverture ne bouge que si elle doit :
 * on garde son bord gauche tant qu'il y a la place à droite, et on la fait glisser vers la gauche
 * quand il n'y en a plus.
 *
 * C'est la différence avec un simple bornage : taper 3 m dans une fenêtre qui a 3 m de mur libre
 * mais seulement 1 m à sa droite donnait 1 m, sans dire pourquoi. Maintenant elle fait 3 m et s'est
 * déplacée — ce que les deux cotes du panneau montrent, puisqu'elles ont changé avec elle.
 */
export function fitWidth(
  room: Room, roomsOnLevel: readonly Room[], defaults: HouseDefaults, opening: Opening, wanted: number,
): { width: number; offset: number } | null {
  const span = freeSpan(room, roomsOnLevel, defaults, opening)
  if (!span) return null
  const width = cm(Math.min(Math.max(wanted, MIN_OPENING_DIM), span.u1 - span.u0))
  return { width, offset: cm(Math.min(Math.max(opening.offset, span.u0), span.u1 - width)) }
}

/**
 * Hauteur voulue → hauteur retenue et allège où elle PASSE. Même règle, dans l'autre sens : une
 * hauteur qui ne tient plus sous le plafond fait DESCENDRE l'allège au lieu d'être rognée. Elle ne
 * descend que de ce qu'il faut, et jamais sous le sol.
 */
export function fitHeight(sill: number, height: number, ceiling: number, wanted: number): { height: number; sill: number } {
  const h = cm(Math.min(Math.max(wanted, MIN_OPENING_DIM), Math.max(MIN_OPENING_DIM, ceiling)))
  return { height: h, sill: cm(Math.min(Math.max(0, sill), Math.max(0, ceiling - h))) }
}

/**
 * Place voulue, donnée par l'une des DEUX cotes du panneau → `offset` retenu. Les côtés se disent de
 * l'INTÉRIEUR de la pièce, comme pour `openingGaps` : on saisit la cote qu'on a mesurée au mètre
 * ruban depuis un coin, l'autre suit.
 */
export function fitGap(
  room: Room, roomsOnLevel: readonly Room[], defaults: HouseDefaults, opening: Opening,
  side: 'left' | 'right', wanted: number,
): number | null {
  const span = freeSpan(room, roomsOnLevel, defaults, opening)
  if (!span) return null
  const L = segmentLength(room, opening.segment)
  const target = side === 'right' ? wanted : L - opening.width - wanted
  return cm(Math.min(Math.max(target, span.u0), span.u1 - opening.width))
}

/**
 * Cotes admissibles d'une ouverture. La largeur est bornée par le VIDE où elle est posée, pas par ce
 * qui reste à sa droite : on peut l'élargir jusqu'à remplir son intervalle, elle glissera pour
 * passer (`fitWidth`). La hauteur est bornée par le plafond, pas par ce qui reste au-dessus de
 * l'allège : c'est l'allège qui descend (`fitHeight`). L'allège, elle, est bornée par la hauteur.
 */
export function openingLimits(
  room: Room, roomsOnLevel: readonly Room[], defaults: HouseDefaults, opening: Opening, ceiling: number,
): { maxWidth: number; maxHeight: number; maxSill: number } {
  const span = freeSpan(room, roomsOnLevel, defaults, opening)
  return {
    maxWidth: Math.max(MIN_OPENING_DIM, span ? span.u1 - span.u0 : opening.width),
    maxHeight: Math.max(MIN_OPENING_DIM, ceiling),
    maxSill: Math.max(0, ceiling - opening.height),
  }
}

/**
 * Cotes d'une ouverture qu'on vient de poser, par nature. Ce sont des valeurs de CATALOGUE — une
 * porte fait 90 cm, une baie 2,40 m — que le relevé corrigera au centimètre dans le panneau : elles
 * n'ont pas à être justes, elles ont à être plausibles pour qu'on reconnaisse ce qu'on vient de
 * poser dans la scène.
 *
 * La hauteur vient de la maison (`doorHeight`) pour tout ce qui descend au sol, l'allège aussi
 * (`windowSill`) : régler ces défauts une fois doit valoir pour ce qu'on pose ensuite. Une fenêtre
 * de 1,20 m sur une allège de 0,90 m arrive pile à la hauteur d'une porte — c'est ce qu'on voit sur
 * une façade, et c'est pourquoi les deux nombres vont ensemble.
 */
export function newOpeningDims(type: OpeningType, defaults: HouseDefaults): { width: number; height: number; sill: number } {
  if (type === 'window') return { width: 1.2, height: 1.2, sill: defaults.windowSill }
  const width = type === 'garage' || type === 'bay' ? 2.4 : 0.9
  return { width, height: defaults.doorHeight, sill: 0 }
}
