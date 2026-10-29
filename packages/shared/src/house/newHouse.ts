import type { Vec2 } from './geometry/vec2'

// The house of a NEW installation, as the "Create a property" wizard writes it: the
// point 0 (georeferenced, heading included), a ground floor, a first 5 × 4 m room with one corner
// on point 0, a rectangular terrain around it, and no active plugin. Everything else is done
// afterwards in edit mode (terrain outline, measurements, rooms, levels) and in Settings (plugins).

export interface NewHouseInput {
  name: string
  kind: 'house' | 'apartment'
  /** Point 0: WGS84, and the heading of the local +y axis (degrees, clockwise from north). */
  origin: { lat: number; lon: number; heading: number; alt?: number }
  /** Terrain (m); absent for an apartment, which only has a margin around its room. */
  terrain?: { width: number; depth: number }
  /** Labels written in the file, in the language of the screen that creates. */
  levelName: string
  roomName: string
}

/** The first room: 5 × 4 m, corner on point 0, along the +x and +y axes. */
export const FIRST_ROOM: readonly Vec2[] = [[0, 0], [5, 0], [5, 4], [0, 4]]
/** Margin around the room of an apartment (m): a floor on which to place a balcony. */
const APARTMENT_MARGIN = 2

const round2 = (v: number) => Math.round(v * 100) / 100

/** A readable file id drawn from the name (`Maison du lac` → `maison-du-lac`), unique among `taken`. */
export function propertyIdFor(name: string, taken: Iterable<string>): string {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'propriete'
  const used = new Set(taken)
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** The raw JSON of a new house (valid for `parseHouse`). */
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
    ...(input.kind === 'house' ? { roofs: [{ type: 'flat', levelId: 'rdc' }] } : {}),
    plugins: {},
    ...(input.kind === 'apartment' ? { meta: { kind: 'apartment' } } : {}),
  }
}
