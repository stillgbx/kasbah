import { z } from 'zod'
import { finishSchema } from './schema'
import { PlacementError } from './place'

// Apparence de la maison écrite depuis l'UI : finitions du sol et des murs de chaque pièce, et de la
// façade. Un seul patch porte TOUT ce qu'une séance d'édition a changé (plusieurs pièces et la
// façade) : « Valider » l'écrit d'un coup, ou rien. `null` RETIRE la finition (retour au style).
//
// Même fonction pour le JSON brut (serveur, transport simulé) et pour la maison parsée (brouillon
// montré par la scène avant l'écriture) : ce qu'on voit pendant l'édition est ce qu'on gardera.

const finishOrNull = finishSchema.nullable().optional()

export const appearancePatchSchema = z.object({
  rooms: z.record(z.string().min(1), z.object({ floor: finishOrNull, walls: finishOrNull })).optional(),
  facade: finishOrNull,
})
export type AppearancePatch = z.infer<typeof appearancePatchSchema>

type JsonObject = Record<string, unknown>
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Pose `value` sous `key` (null retire) ; un objet devenu vide disparaît du fichier. */
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
 * Copie de `doc` avec le patch d'apparence appliqué. Une pièce inconnue lève `PlacementError`
 * (400, rien n'est écrit). La validation des finitions (surface admise, teinte permise) reste celle
 * du schéma de la maison, rejouée par `parseHouse` avant l'écriture.
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
 * Compose deux patchs : `next` passe devant `prev`, pièce par pièce et surface par surface. C'est
 * ce que fait le brouillon à chaque geste — l'historique garde les états successifs.
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
