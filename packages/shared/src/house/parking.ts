import type { DeviceKind } from '../devices/kinds'
import type { DeviceState } from '../devices/state'
import { pointInPolygon, type Vec2 } from './geometry/vec2'
import type { House, Parking, Room, Zone } from './schema'

// Ce qu'une place de stationnement sait faire : dire où sont ses quatre coins, à quelle distance
// tombe un point, et — le tout venant — quel engin s'y range. Le format du champ vit dans
// `schema.ts` (`parkingSchema`), qui dit POURQUOI il existe ; ici, c'est la règle.
//
// Rien de tout cela ne touche Three : la scène 3D applique ce que ces fonctions décident, et les
// tests vérifient la règle sans monter de scène.

/**
 * Distance (m) au-delà du rectangle où un engin s'accroche encore, quand la place n'en dit rien.
 * Deux mètres : l'ordre de grandeur du biais qui reste une fois le `gpsOffset` d'un appareil réglé
 * (récepteur contre un mur, origine de la maison approchée). Plus large, deux places voisines se
 * disputeraient la même voiture ; plus étroit, une voiture garée à sa place n'y rentrerait pas.
 */
export const PARKING_SNAP_MARGIN = 2

/** Arrondi au centimètre : ce que ces fonctions rendent part dans `house.json` (cf. `openings.ts`). */
const cm = (v: number) => Math.round(v * 100) / 100

/**
 * Repère de la place : `fwd` vers l'avant, `right` vers sa droite. `yaw` suit la convention des
 * appareils (0 = face à +y, sens trigonométrique), donc l'avant est `(-sin yaw, cos yaw)`.
 */
export function parkingAxes(p: Pick<Parking, 'yaw'>): { fwd: Vec2; right: Vec2 } {
  const a = (p.yaw * Math.PI) / 180
  const s = Math.sin(a), c = Math.cos(a)
  return { fwd: [-s, c], right: [c, s] }
}

/** Les quatre coins, dans l'ordre avant-droit, avant-gauche, arrière-gauche, arrière-droit. */
export function parkingCorners(p: Parking): [Vec2, Vec2, Vec2, Vec2] {
  const { fwd, right } = parkingAxes(p)
  const [w, l] = p.size
  const at = (u: number, v: number): Vec2 => [
    p.center[0] + fwd[0] * u + right[0] * v,
    p.center[1] + fwd[1] * u + right[1] * v,
  ]
  return [at(l / 2, w / 2), at(l / 2, -w / 2), at(-l / 2, -w / 2), at(-l / 2, w / 2)]
}

/** Un point dans le repère de la place : `[le long (avant +), le travers (droite +)]`, en mètres. */
export function toParkingFrame(p: Parking, xy: Vec2): Vec2 {
  const { fwd, right } = parkingAxes(p)
  const dx = xy[0] - p.center[0], dy = xy[1] - p.center[1]
  return [dx * fwd[0] + dy * fwd[1], dx * right[0] + dy * right[1]]
}

/** Distance (m) d'un point au rectangle de la place — **0 s'il est dedans**. */
export function parkingDistance(p: Parking, xy: Vec2): number {
  const [u, v] = toParkingFrame(p, xy)
  const [w, l] = p.size
  return Math.hypot(Math.max(0, Math.abs(u) - l / 2), Math.max(0, Math.abs(v) - w / 2))
}

/**
 * Cet appareil a-t-il le droit de cette place ? Le kind d'abord (une voiture ne se gare pas sur la
 * base d'un robot), puis la réservation : une place qui nomme un appareil n'est qu'à lui.
 */
export function parkingAccepts(p: Parking, kind: DeviceKind, deviceId?: string): boolean {
  if (p.accepts !== kind) return false
  return p.deviceId === undefined || p.deviceId === deviceId
}

/**
 * L'engin est-il RANGÉ, c'est-à-dire immobile pour de bon ?
 *
 * La règle est « au repos sauf preuve du contraire », et c'est un choix : la R5 ne publie ni vitesse,
 * ni rapport, ni état de veille (seule la Tesla les donne). Exiger la preuve de l'arrêt reviendrait
 * à ne jamais ranger la voiture qui en a le plus besoin. On accroche donc par défaut, et on lâche
 * dès que le fabricant DIT que l'engin bouge — une Tesla qui roule continue de suivre son GPS.
 */
export function atRest(state: DeviceState | undefined): boolean {
  if (!state) return true
  if (state.kind === 'mower') return state.activity === 'parked' || state.activity === 'charging'
  if (state.kind === 'vacuum') return state.activity === 'docked'
  if (state.kind === 'vehicle') return !(state.speedKmh !== undefined && state.speedKmh > 0) && state.gear !== 'D' && state.gear !== 'R'
  return true
}

/** Un engin candidat à une place : sa clé dans la scène, ce qu'il est, et où son GPS le pose. */
export interface ParkingCandidate {
  key: string
  kind: DeviceKind
  deviceId?: string
  point: Vec2
  atRest: boolean
}

/** Où la place range l'engin : son centre, et son cap. */
export interface ParkingFix { parkingId: string; position: Vec2; yaw: number }

/**
 * Qui se range où, pour tous les engins d'un coup. Le résultat est indexé par `key` de candidat.
 *
 * Une place ne reçoit qu'UN engin et un engin ne prend qu'UNE place : sans cela, deux voitures
 * rentrées le même soir se superposeraient dans le garage le plus proche des deux relevés. Le plus
 * près sert le premier — c'est la seule règle qui ne dépende pas de l'ordre du fichier.
 */
export function assignParkings(
  parkings: readonly Parking[], candidates: readonly ParkingCandidate[],
): Map<string, ParkingFix> {
  const pairs: { key: string; parking: Parking; d: number }[] = []
  for (const c of candidates) {
    if (!c.atRest) continue
    for (const p of parkings) {
      if (!parkingAccepts(p, c.kind, c.deviceId)) continue
      const d = parkingDistance(p, c.point)
      if (d <= (p.margin ?? PARKING_SNAP_MARGIN)) pairs.push({ key: c.key, parking: p, d })
    }
  }
  pairs.sort((a, b) => a.d - b.d)
  const out = new Map<string, ParkingFix>()
  const taken = new Set<string>()
  for (const { key, parking } of pairs) {
    if (out.has(key) || taken.has(parking.id)) continue
    out.set(key, { parkingId: parking.id, position: [...parking.center], yaw: parking.yaw })
    taken.add(parking.id)
  }
  return out
}

/** Ce qui PORTE une place : la pièce où elle est posée, sinon la zone, sinon le terrain. */
export interface ParkingHost { kind: 'room' | 'zone' | 'terrain'; id: string; name: string; polygon: Vec2[] }

/**
 * L'hôte d'une place, cherché sous son centre. Les pièces sont essayées du niveau le plus BAS au
 * plus haut, comme pour le cap d'un véhicule (`HouseScene.vehicleYaw`) : on se gare au rez-de-
 * chaussée, pas dans la chambre qui le surplombe.
 *
 * C'est lui qui donne les quatre cotes du panneau : on mesure une place au mètre ruban depuis les
 * murs du garage, pas depuis l'origine d'un fichier.
 */
export function parkingHost(house: House, p: Parking): ParkingHost | null {
  const elevation = (levelId: string) => house.levels.find((l) => l.id === levelId)?.elevation ?? 0
  const rooms: Room[] = [...house.rooms].sort((a, b) => elevation(a.levelId) - elevation(b.levelId))
  const room = rooms.find((r) => pointInPolygon(p.center, r.polygon))
  if (room) return { kind: 'room', id: room.id, name: room.name, polygon: room.polygon }
  const zone: Zone | undefined = house.site.zones.find((z) => z.kind !== 'pool' && pointInPolygon(p.center, z.polygon))
  if (zone) return { kind: 'zone', id: zone.id, name: zone.name, polygon: zone.polygon }
  if (pointInPolygon(p.center, house.site.terrain)) return { kind: 'terrain', id: 'terrain', name: '', polygon: house.site.terrain }
  return null
}

/** Les quatre côtés d'une place, dans l'ordre où le panneau les montre. */
export const PARKING_SIDES = ['front', 'back', 'left', 'right'] as const
export type ParkingSide = (typeof PARKING_SIDES)[number]

/** Distance du bord `side` au contour de l'hôte, `null` si le rayon n'en rencontre aucun. */
function gapTo(host: readonly Vec2[], from: Vec2, dir: Vec2): number | null {
  let best: number | null = null
  const n = host.length
  for (let i = 0; i < n; i++) {
    const a = host[i]!, b = host[(i + 1) % n]!
    const e: Vec2 = [b[0] - a[0], b[1] - a[1]]
    const den = dir[0] * e[1] - dir[1] * e[0]
    if (Math.abs(den) < 1e-9) continue
    const t = ((a[0] - from[0]) * e[1] - (a[1] - from[1]) * e[0]) / den      // le long du rayon
    const s = ((a[0] - from[0]) * dir[1] - (a[1] - from[1]) * dir[0]) / den  // le long de l'arête
    if (t < -1e-9 || s < -1e-9 || s > 1 + 1e-9) continue
    if (best === null || t < best) best = t
  }
  return best
}

/**
 * Les quatre cotes d'une place dans son hôte : ce qui la sépare du contour devant, derrière, à
 * gauche et à droite. C'est ainsi qu'on pose une place de garage — à tant du mur du fond, à tant du
 * mur de côté — et ce sont les quatre nombres que le panneau règle, comme les deux cotes d'une
 * ouverture (`openingGaps`).
 *
 * Chaque cote part du MILIEU du bord concerné, droit devant lui. Un côté qui ne rencontre pas le
 * contour (place à cheval sur le bord de son hôte) vaut `null` : on n'invente pas une mesure.
 *
 * **Gauche et droite se disent depuis la place**, c'est-à-dire assis dans la voiture garée : la
 * droite de la place est la droite du conducteur.
 */
export function parkingGaps(host: readonly Vec2[], p: Parking): Record<ParkingSide, number | null> {
  const { fwd, right } = parkingAxes(p)
  const [w, l] = p.size
  const edge = (dir: Vec2, half: number): Vec2 => [p.center[0] + dir[0] * half, p.center[1] + dir[1] * half]
  const back: Vec2 = [-fwd[0], -fwd[1]], left: Vec2 = [-right[0], -right[1]]
  const one = (dir: Vec2, half: number) => {
    const d = gapTo(host, edge(dir, half), dir)
    return d === null ? null : cm(Math.max(0, d))
  }
  return { front: one(fwd, l / 2), back: one(back, l / 2), left: one(left, w / 2), right: one(right, w / 2) }
}

/**
 * Cote voulue sur un côté → nouveau centre. La place GLISSE de ce qui manque, le long de l'axe du
 * côté saisi : régler la cote avant recule ou avance la voiture, la cote de gauche la déporte.
 *
 * Le rectangle n'est pas borné ici : un centre sorti de l'hôte se voit tout de suite (les cotes
 * passent à « — »), et borner reviendrait à refuser en silence une place qu'on est en train de
 * déplacer d'un mur à l'autre.
 */
export function fitParkingGap(host: readonly Vec2[], p: Parking, side: ParkingSide, wanted: number): Vec2 | null {
  const gaps = parkingGaps(host, p)
  const now = gaps[side]
  if (now === null) return null
  const { fwd, right } = parkingAxes(p)
  const axis: Vec2 = side === 'front' ? fwd : side === 'back' ? [-fwd[0], -fwd[1]] : side === 'right' ? right : [-right[0], -right[1]]
  const move = now - Math.max(0, wanted)
  return [cm(p.center[0] + axis[0] * move), cm(p.center[1] + axis[1] * move)]
}

/**
 * Cotes d'une place qu'on vient de poser, par nature de ce qui s'y range. Valeurs de CATALOGUE,
 * comme celles d'une ouverture (`newOpeningDims`) : une place de voiture fait 2,50 m sur 5 m, une
 * base de tondeuse tient dans 60 cm. Elles n'ont pas à être justes, elles ont à être reconnaissables
 * dans la scène — les quatre cotes du panneau les corrigent ensuite au centimètre.
 */
export function newParkingSize(kind: DeviceKind): [number, number] {
  if (kind === 'vehicle') return [2.5, 5]
  if (kind === 'mower') return [0.6, 0.8]
  return [0.5, 0.5]
}

/** Ce qu'on affiche pour DÉSIGNER une place : son nom s'il lui en a été donné un, sinon son id. */
export const parkingLabel = (p: Parking): string => p.name ?? p.id

/** Une place est-elle DESSINÉE au sol (marquage) plutôt qu'en objet (base de robot) ? */
export const isParkingBay = (p: Parking): boolean => p.accepts === 'vehicle'
