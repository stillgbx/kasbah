import { z } from 'zod'

// Shapes of the local API's responses, as the REAL gateway sends them (see
// `__fixtures__/gateway.ts`). We only declare what we read: zod drops the rest, so a gateway more
// talkative than expected makes nothing fail.

/** `/production.json?details=1` — one entry per measurement source. */
const productionEntrySchema = z.object({
  /** `inverters` = sum of the inverters' last reports; `eim` = the CT, real time. */
  type: z.string(),
  measurementType: z.string().optional(),
  activeCount: z.number().optional(),
  readingTime: z.number().optional(),
  wNow: z.number(),
  whToday: z.number().optional(),
  whLifetime: z.number().optional(),
  /** AC Battery (`acb`) state: `idle`, `charging`… Absent from the other entries. */
  state: z.string().optional(),
})
export type ProductionEntry = z.infer<typeof productionEntrySchema>

export const productionSchema = z.object({
  production: z.array(productionEntrySchema),
  consumption: z.array(productionEntrySchema).default([]),
  /** AC Battery only. The IQ batteries are elsewhere (`/ivp/ensemble/`). */
  storage: z.array(productionEntrySchema).default([]),
})
export type ProductionReport = z.infer<typeof productionSchema>

/** `/api/v1/production/inverters` — one microinverter per entry, refreshed every ~5 min. */
export const inverterSchema = z.object({
  serialNumber: z.string().min(1),
  /** Last report (epoch SECONDS): it is what tells whether an inverter has gone silent. */
  lastReportDate: z.number(),
  lastReportWatts: z.number(),
  maxReportWatts: z.number().optional(),
})
export const invertersSchema = z.array(inverterSchema)
export type Inverter = z.infer<typeof inverterSchema>

/**
 * `/ivp/livedata/status` — aggregates in MILLIWATTS. The only route giving the batteries' power and
 * their overall charge. Answers with fresh values even when `connection.sc_stream` is `disabled`
 * (verified on the real gateway).
 */
const aggregateSchema = z.object({ agg_p_mw: z.number() })
export const livedataSchema = z.object({
  connection: z.object({ sc_stream: z.string().optional() }).optional(),
  meters: z.object({
    pv: aggregateSchema.optional(),
    /** POSITIVE = the battery DISCHARGES (balance `load = pv + storage + grid`). Opposite of the contract. */
    storage: aggregateSchema.optional(),
    /** NEGATIVE = grid export, like `net-consumption`. */
    grid: aggregateSchema.optional(),
    load: aggregateSchema.optional(),
    /** Overall charge of the IQ batteries (%). `acb_agg_soc` is the AC Battery's. */
    enc_agg_soc: z.number().optional(),
    enc_agg_energy: z.number().optional(),
  }).optional(),
})
export type Livedata = z.infer<typeof livedataSchema>

/** `/ivp/ensemble/inventory` — inventory by family (`ENCHARGE` = IQ battery, `ENPOWER`…). */
export const ensembleDeviceSchema = z.object({
  serial_num: z.string().min(1),
  part_num: z.string().optional(),
  communicating: z.boolean().optional(),
  /** Charge of THIS battery (%). */
  percentFull: z.number().optional(),
  temperature: z.number().optional(),
  /** Nominal capacity (Wh). */
  encharge_capacity: z.number().optional(),
  admin_state_str: z.string().optional(),
  last_rpt_date: z.number().optional(),
})
export const ensembleInventorySchema = z.array(z.object({
  type: z.string(),
  devices: z.array(ensembleDeviceSchema).default([]),
}))
export type EnsembleDevice = z.infer<typeof ensembleDeviceSchema>

/**
 * `/ivp/ensemble/power` — power per battery. The key carries a trailing COLON on the vendor's side
 * (`"devices:"`), it is not a typo here.
 */
export const ensemblePowerSchema = z.object({
  'devices:': z.array(z.object({
    serial_num: z.string().min(1),
    /** MILLIWATTS, positive when DISCHARGING (same convention as `livedata.meters.storage`). */
    real_power_mw: z.number(),
    soc: z.number().optional(),
  })).default([]),
})
export type EnsemblePower = z.infer<typeof ensemblePowerSchema>

/** Inventory family of the IQ batteries. */
export const ENCHARGE = 'ENCHARGE'
