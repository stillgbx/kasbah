import type { Vec2 } from './geometry/vec2'

// La maison d'une installation NEUVE, telle que l'assistant « Créer une propriété » l'écrit : le
// point 0 (géoréférencé, cap compris), un rez-de-chaussée, une première pièce de 5 × 4 m dont un coin
// est sur le point 0, un terrain rectangulaire autour, et aucun plugin actif. Tout le reste se fait
// ensuite dans le mode édition (contour du terrain, cotes, pièces, niveaux) et dans Réglages (plugins).

export interface NewHouseInput {
  name: string
  kind: 'house' | 'apartment'
  /** Le point 0 : WGS84, et le cap de l'axe local +y (degrés, horaire depuis le nord). */
  origin: { lat: number; lon: number; heading: number; alt?: number }
  /** Terrain (m) ; absent pour un appartement, qui n'a qu'une marge autour de sa pièce. */
  terrain?: { width: number; depth: number }
  /** Libellés écrits dans le fichier, dans la langue de l'écran qui crée. */
  levelName: string
  roomName: string
}

/** La première pièce : 5 × 4 m, coin sur le point 0, le long des axes +x et +y. */
export const FIRST_ROOM: readonly Vec2[] = [[0, 0], [5, 0], [5, 4], [0, 4]]
/** Marge autour de la pièce d'un appartement (m) : un sol où poser un balcon. */
const APARTMENT_MARGIN = 2

const round2 = (v: number) => Math.round(v * 100) / 100

/** Un id de fichier lisible tiré du nom (`Maison du lac` → `maison-du-lac`), unique parmi `taken`. */
export function propertyIdFor(name: string, taken: Iterable<string>): string {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'propriete'
  const used = new Set(taken)
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** Le JSON brut d'une maison neuve (valide pour `parseHouse`). */
export function newHouseJson(id: string, input: NewHouseInput): Record<string, unknown> {
  const xs = FIRST_ROOM.map((p) => p[0]), ys = FIRST_ROOM.map((p) => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const half: Vec2 = input.kind === 'apartment' || !input.terrain
    ? [(Math.max(...xs) - Math.min(...xs)) / 2 + APARTMENT_MARGIN, (Math.max(...ys) - Math.min(...ys)) / 2 + APARTMENT_MARGIN]
    : [input.terrain.width / 2, input.terrain.depth / 2]
  const terrain: Vec2[] = [
    [round2(cx - half[0]), round2(cy - half[1])], [round2(cx + half[0]), round2(cy - half[1])],
    [round2(cx + half[0]), round2(cy + half[1])], [round2(cx - half[0]), round2(cy + half[1])],
  ]
  return {
    schemaVersion: 1,
    id,
    name: input.name,
    origin: { lat: input.origin.lat, lon: input.origin.lon, alt: input.origin.alt ?? 0, heading: input.origin.heading },
    levels: [{ id: 'rdc', name: input.levelName, elevation: 0 }],
    rooms: [{ id: 'piece-1', levelId: 'rdc', name: input.roomName, polygon: FIRST_ROOM.map((p) => [p[0], p[1]]), openings: [] }],
    site: { elevation: 0, terrain, zones: [], parkings: [], garden: [] },
    devices: [],
    ...(input.kind === 'house' ? { roof: { type: 'flat', levelId: 'rdc' } } : {}),
    plugins: {},
    ...(input.kind === 'apartment' ? { meta: { kind: 'apartment' } } : {}),
  }
}
