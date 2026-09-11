import { z } from 'zod'

// Formes des réponses de l'API locale, telles que la VRAIE passerelle les envoie (voir
// `__fixtures__/gateway.ts`). On ne déclare que ce qu'on lit : zod laisse tomber le reste, et une
// passerelle plus bavarde qu'attendu ne fait donc rien échouer.

/** `/production.json?details=1` — une entrée par source de mesure. */
const productionEntrySchema = z.object({
  /** `inverters` = somme des derniers rapports des onduleurs ; `eim` = le CT, temps réel. */
  type: z.string(),
  measurementType: z.string().optional(),
  activeCount: z.number().optional(),
  readingTime: z.number().optional(),
  wNow: z.number(),
  whToday: z.number().optional(),
  whLifetime: z.number().optional(),
  /** État de l'AC Battery (`acb`) : `idle`, `charging`… Absent des autres entrées. */
  state: z.string().optional(),
})
export type ProductionEntry = z.infer<typeof productionEntrySchema>

export const productionSchema = z.object({
  production: z.array(productionEntrySchema),
  consumption: z.array(productionEntrySchema).default([]),
  /** AC Battery seulement. Les batteries IQ sont ailleurs (`/ivp/ensemble/`). */
  storage: z.array(productionEntrySchema).default([]),
})
export type ProductionReport = z.infer<typeof productionSchema>

/** `/api/v1/production/inverters` — un micro-onduleur par entrée, rafraîchi toutes les ~5 min. */
export const inverterSchema = z.object({
  serialNumber: z.string().min(1),
  /** Dernier rapport (SECONDES epoch) : c'est ce qui dit si un onduleur s'est tu. */
  lastReportDate: z.number(),
  lastReportWatts: z.number(),
  maxReportWatts: z.number().optional(),
})
export const invertersSchema = z.array(inverterSchema)
export type Inverter = z.infer<typeof inverterSchema>

/**
 * `/ivp/livedata/status` — agrégats en MILLIWATTS. Seule route qui donne la puissance des batteries
 * et leur charge d'ensemble. Répond avec des valeurs fraîches même quand `connection.sc_stream`
 * vaut `disabled` (vérifié sur la vraie passerelle).
 */
const aggregateSchema = z.object({ agg_p_mw: z.number() })
export const livedataSchema = z.object({
  connection: z.object({ sc_stream: z.string().optional() }).optional(),
  meters: z.object({
    pv: aggregateSchema.optional(),
    /** POSITIF = la batterie DÉCHARGE (bilan `load = pv + storage + grid`). Inverse du contrat. */
    storage: aggregateSchema.optional(),
    /** NÉGATIF = injection réseau, comme `net-consumption`. */
    grid: aggregateSchema.optional(),
    load: aggregateSchema.optional(),
    /** Charge d'ensemble des batteries IQ (%). `acb_agg_soc` est celle de l'AC Battery. */
    enc_agg_soc: z.number().optional(),
    enc_agg_energy: z.number().optional(),
  }).optional(),
})
export type Livedata = z.infer<typeof livedataSchema>

/** `/ivp/ensemble/inventory` — inventaire par famille (`ENCHARGE` = batterie IQ, `ENPOWER`…). */
export const ensembleDeviceSchema = z.object({
  serial_num: z.string().min(1),
  part_num: z.string().optional(),
  communicating: z.boolean().optional(),
  /** Charge de CETTE batterie (%). */
  percentFull: z.number().optional(),
  temperature: z.number().optional(),
  /** Capacité nominale (Wh). */
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
 * `/ivp/ensemble/power` — puissance par batterie. La clé porte un DEUX-POINTS final chez le
 * fabricant (`"devices:"`), ce n'est pas une faute de frappe ici.
 */
export const ensemblePowerSchema = z.object({
  'devices:': z.array(z.object({
    serial_num: z.string().min(1),
    /** MILLIWATTS, positif en DÉCHARGE (même convention que `livedata.meters.storage`). */
    real_power_mw: z.number(),
    soc: z.number().optional(),
  })).default([]),
})
export type EnsemblePower = z.infer<typeof ensemblePowerSchema>

/** Famille d'inventaire des batteries IQ. */
export const ENCHARGE = 'ENCHARGE'
