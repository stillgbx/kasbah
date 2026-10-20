import { z } from 'zod'
import type { DeviceDescriptor, StatePatch } from '@kasbah/shared'

// Proteo 2 station → Kasbah contract. PURE functions, tested on the captured fixture
// (`__fixtures__/station.ts`). ONE SINGLE `water` device: the station stays a single object, not six
// sensors — that is the owner's choice.
//
// The protocol fits in one request: `{"<id>":{"msgId":N,"read":[...]}}`. The root id and `msgId` are
// mere echoes (the station sends back what it is given); `msgId` is however MANDATORY, without it
// the station answers `null`. `ROOT_ID` is therefore arbitrary — the value from the captured
// example — and the mapping reads the response by its FIRST value rather than by that literal name,
// so as to assume nothing more than "the station echoes the key it was sent".

export const PLUGIN_ID = 'comap'
export const STATION_ID = 'station'
export const ROOT_ID = '1234567'

/** The 9 keys fit in a single request: one round trip per poll is enough. */
export const READ_KEYS = ['status', 'about', 'alert', 'config', 'consumption', 'flow', 'lamp', 'rtc', 'wear'] as const

export function readRequest(msgId: number): Record<string, unknown> {
  return { [ROOT_ID]: { msgId, read: READ_KEYS } }
}

// Only fields whose meaning is established are declared: `alert` (D001-D021), `config` and `lamp`
// are ignored by zod (extra keys silently dropped), not decoded at random. `rtc` is the exception:
// the station's clock dates the consumption history (`history.ts`), which needs a reliable instant,
// not the — possibly skewed — one of the server reading it.
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
    /** Monthly history of the calendar year, index 0 = January — see `history.ts:monthlyOf`. */
    year: z.array(z.number()).length(12).optional(),
  }).optional(),
  flow: z.object({ inst: z.number().optional() }).optional(),
  wear: z.object({
    prefilt: z.number().optional(),
    filt1: z.number().optional(),
    filt2: z.number().optional(),
    lamp: z.number().optional(),
  }).optional(),
  /** `date`: [day, month, year]; `time`: [hour, minute] — confirmed on the real station. */
  rtc: z.object({
    date: z.tuple([z.number(), z.number(), z.number()]),
    time: z.tuple([z.number(), z.number()]),
  }).optional(),
})
export type Read = z.infer<typeof readSchema>

const envelopeSchema = z.record(z.string(), z.object({ msgId: z.number().optional(), read: readSchema.optional() }))

/** Extracts the `read` block, whatever the echoed root key. `undefined` = unexpected response. */
export function parseRead(raw: unknown): Read | undefined {
  const parsed = envelopeSchema.safeParse(raw)
  if (!parsed.success) return undefined
  return Object.values(parsed.data)[0]?.read
}

/** `about.mod`: the model as the station names it ("Proteo V3"). Absent until a read has succeeded. */
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
 * The station state, from a successful `read`. ALL fields are optional in the contract: only those
 * THIS response carries are set, never a zero for a missing field — a `0 %` wear or a `0 L`
 * consumption would claim a measurement we do not have.
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
