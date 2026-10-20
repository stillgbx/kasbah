import { z } from 'zod'
import { finishSchema } from './schema'
import { PlacementError } from './place'

// Appearance of the house written from the UI: finishes of the floor and walls of each room, and of the
// facade. A single patch carries EVERYTHING an editing session changed (several rooms and the
// facade): "Apply" writes it all at once, or nothing. `null` REMOVES the finish (back to the style).
//
// Same function for the raw JSON (server, simulated transport) and for the parsed house (draft
// shown by the scene before writing): what is seen during editing is what will be kept.

const finishOrNull = finishSchema.nullable().optional()

export const appearancePatchSchema = z.object({
  rooms: z.record(z.string().min(1), z.object({ floor: finishOrNull, walls: finishOrNull })).optional(),
  facade: finishOrNull,
})
export type AppearancePatch = z.infer<typeof appearancePatchSchema>

type JsonObject = Record<string, unknown>
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Sets `value` under `key` (null removes); an object that became empty disappears from the file. */
function setKey(obj: JsonObject | undefined, key: string, value: unknown): JsonObject | undefined {
  const next: JsonObject = { ...obj }
  if (value === null) delete next[key]
  else next[key] = value
  return Object.keys(next).length ? next : undefined
}

function withStyle<T extends JsonObject>(owner: T, style: JsonObject | undefined): T {
  const next: JsonObject = { ...owner }
  if (style) next.style = style
  else delete next.style
  return next as T
}

/**
 * Copy of `doc` with the appearance patch applied. An unknown room throws `PlacementError`
 * (400, nothing is written). The validation of the finishes (allowed surface, allowed tint) stays that
 * of the house schema, replayed by `parseHouse` before writing.
 */
export function applyAppearanceToJson<T>(doc: T, patch: AppearancePatch): T {
  if (!isObject(doc)) throw new PlacementError('house document is not an object')
  let out: JsonObject = { ...doc }
  const roomPatches = Object.entries(patch.rooms ?? {})
  if (roomPatches.length) {
    if (!Array.isArray(doc.rooms)) throw new PlacementError('house document has no rooms')
    const rooms = doc.rooms as JsonObject[]
    for (const [id] of roomPatches) {
      if (!rooms.some((r) => isObject(r) && r.id === id)) throw new PlacementError(`unknown room "${id}"`)
    }
    out.rooms = rooms.map((r) => {
      const p = patch.rooms?.[r.id as string]
      if (!p) return r
      let style = isObject(r.style) ? r.style : undefined
      if (p.floor !== undefined) style = setKey(style, 'floorFinish', p.floor)
      if (p.walls !== undefined) style = setKey(style, 'wallFinish', p.walls)
      return withStyle(r, style)
    })
  }
  if (patch.facade !== undefined) {
    const style = setKey(isObject(doc.style) ? doc.style : undefined, 'facade', patch.facade)
    out = withStyle(out, style)
  }
  return out as T
}

/**
 * Composes two patches: `next` takes precedence over `prev`, room by room and surface by surface. It is
 * what the draft does at each gesture — the history keeps the successive states.
 */
export function mergeAppearancePatch(prev: AppearancePatch, next: AppearancePatch): AppearancePatch {
  const rooms: NonNullable<AppearancePatch['rooms']> = { ...prev.rooms }
  for (const [id, p] of Object.entries(next.rooms ?? {})) rooms[id] = { ...rooms[id], ...p }
  const out: AppearancePatch = {}
  if (Object.keys(rooms).length) out.rooms = rooms
  const facade = next.facade !== undefined ? next.facade : prev.facade
  if (facade !== undefined) out.facade = facade
  return out
}
