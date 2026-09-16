import { z } from 'zod'
import type { DeviceDescriptor, StatePatch } from '@kasbah/shared'

// Station Proteo 2 → contrat Kasbah. Fonctions PURES, testées sur la fixture capturée
// (`__fixtures__/station.ts`). UN SEUL appareil `water` : la station reste un objet unique, pas six
// capteurs — c'est le choix du propriétaire.
//
// Le protocole tient en une requête : `{"<id>":{"msgId":N,"read":[...]}}`. L'identifiant racine et
// `msgId` sont de simples échos (la station renvoie ce qu'on lui donne) ; `msgId` est en revanche
// OBLIGATOIRE, sans lui elle répond `null`. `ROOT_ID` est donc arbitraire — la valeur de l'exemple
// capturé — et le mappage lit la réponse par sa PREMIÈRE valeur plutôt que par ce nom littéral, pour
// ne rien supposer de plus que « la station échote la clé qu'on lui a envoyée ».

export const PLUGIN_ID = 'comap'
export const STATION_ID = 'station'
export const ROOT_ID = '1234567'

/** Les 9 clés tiennent dans une seule requête : un aller-retour par sondage suffit. */
export const READ_KEYS = ['status', 'about', 'alert', 'config', 'consumption', 'flow', 'lamp', 'rtc', 'wear'] as const

export function readRequest(msgId: number): Record<string, unknown> {
  return { [ROOT_ID]: { msgId, read: READ_KEYS } }
}

// Seuls les champs dont le sens est établi sont déclarés : `alert` (D001-D021), `config`, `lamp` et
// `rtc` sont ignorés par zod (extra keys silencieusement écartées), pas décodés au hasard.
const readSchema = z.object({
  status: z.object({
    warning: z.number().optional(),
    defect: z.number().optional(),
    uvc: z.number().optional(),
  }).optional(),
  about: z.object({ mod: z.string().optional() }).optional(),
  consumption: z.object({
    day: z.number().optional(),
    week: z.number().optional(),
    month: z.number().optional(),
  }).optional(),
  flow: z.object({ inst: z.number().optional() }).optional(),
  wear: z.object({
    prefilt: z.number().optional(),
    filt1: z.number().optional(),
    filt2: z.number().optional(),
    lamp: z.number().optional(),
  }).optional(),
})
export type Read = z.infer<typeof readSchema>

const envelopeSchema = z.record(z.string(), z.object({ msgId: z.number().optional(), read: readSchema.optional() }))

/** Extrait le bloc `read`, quelle que soit la clé racine échotée. `undefined` = réponse inattendue. */
export function parseRead(raw: unknown): Read | undefined {
  const parsed = envelopeSchema.safeParse(raw)
  if (!parsed.success) return undefined
  return Object.values(parsed.data)[0]?.read
}

/** `about.mod` : le modèle tel que la station le nomme (« Proteo V3 »). Absent tant qu'aucune lecture n'a réussi. */
export function modelOf(read: Read): string | undefined {
  return read.about?.mod
}

export function toDescriptor(model?: string): DeviceDescriptor {
  return {
    id: `${PLUGIN_ID}:${STATION_ID}`,
    pluginId: PLUGIN_ID,
    externalId: STATION_ID,
    kind: 'water',
    name: 'Station de filtration',
    capabilities: ['consumables', 'water_flow', 'water_usage', 'uv_lamp'],
    meta: { manufacturer: 'COMAP', ...(model ? { model } : {}) },
  }
}

const round = (v: number) => Math.round(v)
const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
const litres = (v: number) => Math.max(0, round(v))

/**
 * L'état de la station, d'après une lecture `read` réussie. TOUS les champs sont optionnels dans le
 * contrat : seuls ceux que CETTE réponse porte sont posés, jamais un zéro pour un champ absent — un
 * `0 %` d'usure ou un `0 L` de consommation affirmerait une mesure qu'on n'a pas.
 */
export function toStatePatch(read: Read): StatePatch<'water'> {
  const patch: StatePatch<'water'> = {}
  if (read.wear?.prefilt !== undefined) patch.prefilterPct = clampPct(read.wear.prefilt)
  if (read.wear?.filt1 !== undefined) patch.carbon1Pct = clampPct(read.wear.filt1)
  if (read.wear?.filt2 !== undefined) patch.carbon2Pct = clampPct(read.wear.filt2)
  if (read.wear?.lamp !== undefined) patch.uvLampPct = clampPct(read.wear.lamp)
  if (read.status?.uvc !== undefined) patch.uvOn = read.status.uvc !== 0
  if (read.flow?.inst !== undefined) patch.flowLph = litres(read.flow.inst)
  if (read.consumption?.day !== undefined) patch.todayL = litres(read.consumption.day)
  if (read.consumption?.week !== undefined) patch.weekL = litres(read.consumption.week)
  if (read.consumption?.month !== undefined) patch.monthL = litres(read.consumption.month)
  if (read.status?.warning !== undefined) patch.warning = read.status.warning !== 0
  if (read.status?.defect !== undefined) patch.defect = read.status.defect !== 0
  return patch
}
