import type { DeviceDescriptor, StatePatch } from '@kasbah/shared'
import { feederDataSchema, fountainDataSchema, rosterSchema, workRecordSchema, type FeederData, type RosterDevice } from './types'

// PetKit mapping → Kasbah contract.
//
// Two rules held everywhere: what the machine doesn't say stays UNKNOWN (never 0, never false —
// contract rule), and we only publish fields whose meaning is established. The dozens of other
// keys the API returns (notification settings, meal plans, videos) have no carrier in the contract
// and aren't looking for one: they are readable through `GET /api/plugins/petkit/raw`.

export const PLUGIN_ID = 'petkit'

/** Covered models. This house's feeder is a `d4`, the fountain a `ctw3`. */
export const FEEDER_TYPES = ['d3', 'd4', 'd4h'] as const
export const FOUNTAIN_TYPES = ['ctw2', 'ctw3'] as const

/**
 * Accepted portions, PER MODEL, **in the API's RAW unit** — the vendor imposes them and they can't
 * be inferred. A `d4` only knows five; a `d3` accepts anything from 5 to 200. A model missing from
 * this table is offered no portion rather than invented ones.
 */
export const RAW_PORTIONS: Record<string, number[]> = {
  d4: [10, 20, 30, 40, 50],
  d4h: [10, 20, 30, 40, 50],
  d3: Array.from({ length: 40 }, (_, i) => (i + 1) * 5),
}

/**
 * The unit a model counts in. A `d4` declares `settings.factor: 10` and counts in TENTHS OF A CUP;
 * a `d3` weighs in grams. The table gives the unit, the device gives the factor — displaying
 * "30 g" where the machine means 0.3 cup is off by a factor of three, and that's the mistake we
 * made until 09/21.
 */
export const FEEDER_UNITS: Record<string, 'cup' | 'g'> = { d4: 'cup', d4h: 'cup', d3: 'g' }

/**
 * Models that can CALL the animal. Not the Fresh Element Solo: it has no speaker, and
 * `d4/callPet` answers **404** (verified on 09/21, like `call_pet` and `soundList`). The button
 * existed and did nothing — it was the user who noticed. Only the models with camera and
 * microphone (YumShare range) carry the feature.
 */
export const CALL_PET_TYPES: readonly string[] = ['d4h', 'd4sh']
/** Fallback factor when the machine doesn't declare it: 10 for a feeder counting in cups. */
const DEFAULT_FACTOR: Record<string, number> = { d4: 10, d4h: 10, d3: 1 }

/** Raw quantity → displayed unit. Three decimals are enough (tenths of a cup have one). */
const toUnit = (raw: number, factor: number): number => Math.round((raw / factor) * 1000) / 1000

/**
 * Where to read the state, per family. It's NOT the same path on both sides: a feeder answers on
 * `<type>/device_detail`, a Bluetooth fountain on `<type>/deviceData` — and `ctw3/device_detail`
 * returns a plain 404 (verified on 09/21). The wrong path can't be guessed, it has to be observed.
 */
export const detailPath = (type: string): string =>
  (FOUNTAIN_TYPES as readonly string[]).includes(type) ? `${type}/deviceData` : `${type}/device_detail`

/** Commercial names, so the card says "Fresh Element Solo" and not "d4". */
const MODEL_NAMES: Record<string, string> = {
  d3: 'Fresh Element Infinity', d4: 'Fresh Element Solo', d4h: 'YumShare Solo',
  ctw2: 'Eversweet', ctw3: 'Eversweet Max',
}

export interface PetkitDevice {
  externalId: string
  deviceId: string
  /** Lowercase model code (`d4`, `ctw3`), as it goes into the API PATHS. */
  type: string
  /** NUMERIC model code, expected by the Bluetooth calls (24 for a Ctw3). */
  typeId: string | null
  /** Quantity divisor, declared by the machine (`settings.factor`); known at the first detail. */
  factor: number | null
  /** The device's owner, required by the visit log; known at the first detail. */
  userId: string | null
  name: string
  groupId: string
  mac: string | null
  kind: 'pet_feeder' | 'pet_fountain'
}

/** Flattens the inventory, which arrives flat or grouped by family depending on the account. */
export function toDevices(body: unknown, groupId = ''): PetkitDevice[] {
  const parsed = rosterSchema.safeParse(body)
  if (!parsed.success) return []
  const flat: { dev: RosterDevice; groupId: string }[] = []
  // The roster is requested PER GROUP: the device doesn't repeat its group's identifier, it's the
  // caller who knows it. We keep `dev.groupId` when it's there, for the grouped shape.
  for (const d of parsed.data.devices ?? []) flat.push({ dev: d, groupId: String(d.groupId ?? groupId) })
  for (const g of parsed.data.list ?? []) {
    for (const d of g.devices ?? []) flat.push({ dev: d, groupId: String(d.groupId ?? g.groupId ?? '') })
  }
  const out: PetkitDevice[] = []
  for (const { dev, groupId } of flat) {
    const type = String(dev.type ?? dev.deviceType ?? '').toLowerCase()
    const kind = (FEEDER_TYPES as readonly string[]).includes(type) ? 'pet_feeder'
      : (FOUNTAIN_TYPES as readonly string[]).includes(type) ? 'pet_fountain' : null
    if (!kind) continue
    const rawId = dev.id ?? dev.deviceId
    if (rawId === undefined) continue
    const deviceId = String(rawId)
    out.push({
      // the type goes into the external id: two devices of different models may carry the same
      // numeric identifier at PetKit, and the id must stay stable from one startup to the next
      externalId: `${type}-${deviceId}`,
      deviceId, type, groupId,
      typeId: dev.deviceTypeId === undefined ? null : String(dev.deviceTypeId),
      factor: null,
      userId: null,
      // FALLBACK name only: the roster carries none. The real name, the one the user gave in the
      // app, arrives with the first detail (`toIdentity`).
      name: (dev.name ?? dev.deviceName)?.trim() || `${MODEL_NAMES[type] ?? type} ${deviceId}`,
      mac: dev.mac ?? null,
      kind,
    })
  }
  return out
}

export function toDescriptor(d: PetkitDevice): DeviceDescriptor {
  const model = MODEL_NAMES[d.type] ?? d.type
  if (d.kind === 'pet_feeder') {
    const raw = RAW_PORTIONS[d.type]
    const unit = FEEDER_UNITS[d.type]
    const factor = d.factor ?? DEFAULT_FACTOR[d.type] ?? 1
    const portions = raw && unit ? raw.map((v) => toUnit(v, factor)) : undefined
    return {
      id: `${PLUGIN_ID}:${d.externalId}`, pluginId: PLUGIN_ID, externalId: d.externalId, kind: 'pet_feeder', name: d.name,
      // `feed` only if we KNOW which portions this model accepts AND in which unit: declaring the
      // capability without the list would display an empty section of buttons, and without the
      // unit would display numbers that mean nothing.
      capabilities: [
        ...(portions ? (['feed'] as const) : []),
        ...(CALL_PET_TYPES.includes(d.type) ? (['call_pet'] as const) : []),
        'consumables', 'battery',
      ],
      meta: { manufacturer: 'PetKit', model, ...(portions && unit ? { petFeeder: { portions, unit } } : {}) },
    }
  }
  return {
    id: `${PLUGIN_ID}:${d.externalId}`, pluginId: PLUGIN_ID, externalId: d.externalId, kind: 'pet_fountain', name: d.name,
    // `water_usage` doesn't mean "a volume": an Eversweet Max measures no milliliter (it returns -1)
    // but it COUNTS the animal's VISITS and their duration, which the vendor's app displays as
    // "6 fois". That's what we publish.
    capabilities: ['water_usage', 'on_off', 'pump_mode', 'consumables', 'battery'],
    meta: { manufacturer: 'PetKit', model },
  }
}

/**
 * The name and Bluetooth address, as the DETAIL carries them — the roster doesn't give them.
 * `btMac` is a feeder's own radio address; `mac` the device's. For a fountain, it's `mac` that
 * serves as the relay's target.
 */
export function toIdentity(body: unknown): { name: string | null; mac: string | null; factor: number | null; userId: string | null } {
  const o = (body ?? {}) as { name?: unknown; mac?: unknown; btMac?: unknown; userId?: unknown; settings?: { factor?: unknown } }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const f = o.settings?.factor
  return {
    name: str(o.name),
    mac: str(o.mac) ?? str(o.btMac),
    factor: typeof f === 'number' && f > 0 ? f : null,
    userId: str(o.userId) ?? (typeof o.userId === 'number' ? String(o.userId) : null),
  }
}

export function toFeederPatch(body: unknown, type: string, now: number): StatePatch<'pet_feeder'> {
  const parsed = feederDataSchema.safeParse(body)
  if (!parsed.success) return {}
  const d = parsed.data
  const st = d.state
  if (!st) return {}
  const factor = d.settings?.factor ?? DEFAULT_FACTOR[type] ?? 1
  const patch: StatePatch<'pet_feeder'> = {}
  // `food` counts the remaining portions on some models and is 0/1 on others: in both cases, 0
  // means "nothing left". So we derive ONLY the shortage from it, never a level.
  if (st.food !== undefined) patch.foodLow = st.food <= 0
  if (st.feeding !== undefined) patch.feeding = st.feeding > 0
  if (st.desiccantLeftDays !== undefined) patch.desiccantDays = Math.max(0, Math.round(st.desiccantLeftDays))
  // The real machine, on mains power and WITHOUT batteries, answers `batteryPower: 0`. Publishing
  // 0 % would read as "flat battery" where there simply is no battery. So we only publish positive
  // values — missing battery and empty battery are deliberately conflated here: both call for the
  // same action, going to look at the machine (same tradeoff as a vacuum's tank).
  if (st.batteryPower !== undefined && st.batteryPower > 0) patch.batteryPct = clampPct(st.batteryPower)
  const feed = st.feedState
  if (feed?.realAmountTotal !== undefined) patch.servedToday = toUnit(Math.max(0, feed.realAmountTotal), factor)
  if (feed?.planAmountTotal !== undefined) patch.plannedToday = toUnit(Math.max(0, feed.planAmountTotal), factor)
  // Absent from a `d4`: without a weighing tray, the machine doesn't know what was EATEN. The line
  // then stays empty rather than showing the served amount under another name.
  if (feed?.eatAmountTotal !== undefined) patch.eatenToday = toUnit(Math.max(0, feed.eatAmountTotal), factor)
  const next = nextMeal(d, now)
  patch.nextMealAt = next?.at ?? null
  patch.nextMealAmount = next ? toUnit(next.amount, factor) : null
  // `null` clears: a resolved error must disappear from the card, not stay stuck there.
  patch.errorMessage = st.errorMsg?.trim() ? st.errorMsg.trim() : null
  return patch
}

/**
 * The next SCHEDULED meal before midnight. The plan arrives as seven lists, one per day of the
 * week (`repeats`: 1 = Monday … 7 = Sunday), each carrying meals timed in SECONDS since midnight.
 * We take today's and the first meal still to come.
 *
 * Nothing after the day's last meal: we return `undefined` rather than tomorrow's first, because
 * "next meal 01:00" shown in the evening would read as within the hour.
 */
function nextMeal(d: FeederData, now: number): { at: number; amount: number } | undefined {
  const day = new Date(now)
  // `repeats` counts from MONDAY, `getDay()` from Sunday.
  const weekday = ((day.getDay() + 6) % 7) + 1
  const today = d.multiFeedItem?.feedDailyList?.find((l) => Number(l.repeats) === weekday)
  if (!today || today.suspended) return undefined
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const upcoming = (today.items ?? [])
    .filter((i) => i.time !== undefined && midnight + i.time * 1000 > now)
    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0))[0]
  return upcoming?.time === undefined ? undefined : { at: midnight + upcoming.time * 1000, amount: upcoming.amount ?? 0 }
}

export function toFountainPatch(body: unknown, now: number): StatePatch<'pet_fountain'> {
  const parsed = fountainDataSchema.safeParse(body)
  if (!parsed.success) return {}
  const d = parsed.data
  const patch: StatePatch<'pet_fountain'> = {}
  // The pump's on/off state is IN `status`, not at the top level — read from the wrong place, it
  // would never be found and the fountain would look permanently off.
  if (d.status?.powerStatus !== undefined) patch.on = d.status.powerStatus > 0
  // 2 = on/rest cycle (the app says "Intermittent"), otherwise continuous flow.
  if (d.mode !== undefined) patch.mode = d.mode === 2 ? 'intermittent' : 'continuous'
  patch.filterPct = known(d.filterPercent) ? clampPct(d.filterPercent) : null
  patch.filterDays = known(d.filterExpectedDays) ? Math.round(d.filterExpectedDays) : null
  if (d.lackWarning !== undefined) patch.waterLow = d.lackWarning > 0
  if (d.electricity?.batteryPercent !== undefined) patch.batteryPct = clampPct(d.electricity.batteryPercent)
  patch.todayMl = known(d.todayCleanWater) ? d.todayCleanWater : null
  if (d.breakdownWarning !== undefined) patch.errorMessage = d.breakdownWarning > 0 ? 'breakdown' : null
  // Date of the reading: the fountain gives it, failing that the moment of the successful relay.
  // Without it, the card would pass off as real time a value sometimes several hours old.
  patch.syncedAt = parseSync(d.syncTime ?? d.updateAt) ?? now
  return patch
}

const clampPct = (v: number): number => Math.min(100, Math.max(0, Math.round(v)))

/**
 * **`-1` is the "I don't count that" sentinel**, not a value. The real fountain answers -1 for
 * today's water, the filter days and the cumulative pump time. Bringing them to 0 would display
 * "0 mL drunk" and "0 filter days": two false statements, where there's nothing to say (same
 * pitfall as the missing sensor returned as -39 by MELCloud).
 */
const known = (v: number | undefined): v is number => v !== undefined && v >= 0

/** PetKit dates arrive as ISO; an unreadable value means "we can't date it". */
function parseSync(v: string | undefined): number | undefined {
  if (!v) return undefined
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : undefined
}

/**
 * The day's visits, read from `getWorkRecord`: how many times the animal came to drink, and how
 * long it stayed on average. It's the only consumption measure an Eversweet Max can produce — it
 * doesn't know milliliters.
 */
export function toDrinkPatch(body: unknown): StatePatch<'pet_fountain'> {
  const parsed = workRecordSchema.safeParse(body)
  if (!parsed.success) return {}
  const stays = parsed.data.map((r) => r.stayTime).filter((v): v is number => v !== undefined && v >= 0)
  return {
    drinksToday: parsed.data.length,
    // Without a recorded duration, the average doesn't exist: we CLEAR it rather than return 0,
    // which would read as "it came without drinking".
    drinkAvgS: stays.length ? Math.round(stays.reduce((a, b) => a + b, 0) / stays.length) : null,
  }
}
