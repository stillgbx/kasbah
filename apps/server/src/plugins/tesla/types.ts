import { z } from 'zod'

// Formes des réponses de la Fleet API Tesla. On ne déclare que ce qu'on lit, en `z.looseObject`
// et avec des types LARGES sur ce qu'on ne lit pas (leçon TaHoma : contraindre un champ inutile
// suffit à faire échouer toute la réponse). Les fixtures de `__fixtures__/fleet.ts` sont écrites
// d'après la documentation et les captures publiques de l'API propriétaire ; elles sont à REMPLACER
// par une capture réelle (`GET /api/plugins/tesla/raw`) dès la première liaison du compte.

/** Veille telle que Tesla la nomme dans `GET /api/1/vehicles` : c'est ce qu'on lit SANS réveiller. */
export const TESLA_STATES = ['online', 'asleep', 'offline'] as const
export type TeslaState = (typeof TESLA_STATES)[number]

/** Une entrée de `GET /api/1/vehicles`. `state` est là même quand le véhicule dort. */
export const vehicleSummarySchema = z.looseObject({
  vin: z.string().min(1),
  display_name: z.string().nullable().optional(),
  state: z.string(),
  in_service: z.boolean().optional(),
})
export type VehicleSummary = z.infer<typeof vehicleSummarySchema>

/** Enveloppe commune : `{ response: ... }`, plus `count` sur les listes et `error` sur les refus. */
export const vehiclesListSchema = z.looseObject({
  response: z.array(z.unknown()),
  count: z.number().optional(),
})

/**
 * `GET /api/1/vehicles/{vin}/vehicle_data`. Unités du fabricant : miles, mph, kW, bar, °C, et des
 * `null` un peu partout quand le véhicule n'a pas de valeur (vitesse à l'arrêt, pression d'un pneu
 * qui n'a pas roulé). Tout est optionnel et nullable : une section absente ne fait rien échouer.
 */
const num = z.number().nullable().optional()
const bool = z.boolean().nullable().optional()
const str = z.string().nullable().optional()

export const chargeStateSchema = z.looseObject({
  battery_level: num,
  battery_range: num,
  /** `Charging`, `Stopped`, `Complete`, `Disconnected`, `NoPower`, `Starting`. */
  charging_state: str,
  charger_power: num,
  charge_limit_soc: num,
  charge_port_latch: str,
  charge_port_door_open: bool,
  time_to_full_charge: num,
})
export const driveStateSchema = z.looseObject({
  latitude: num,
  longitude: num,
  speed: num,
  /** Cap, degrés, 0 = nord. */
  heading: num,
  /** `P`, `R`, `N`, `D`, ou `null` à l'arrêt moteur coupé. */
  shift_state: str,
  timestamp: num,
  gps_as_of: num,
})
export const vehicleStateSchema = z.looseObject({
  locked: bool,
  odometer: num,
  tpms_pressure_fl: num,
  tpms_pressure_fr: num,
  tpms_pressure_rl: num,
  tpms_pressure_rr: num,
  is_user_present: bool,
  sentry_mode: bool,
  car_version: str,
  vehicle_name: str,
})
export const climateStateSchema = z.looseObject({
  inside_temp: num,
  outside_temp: num,
  is_climate_on: bool,
  /** Consigne conducteur, °C (même quand l'affichage de la voiture est en °F). */
  driver_temp_setting: num,
})

export const vehicleDataSchema = z.looseObject({
  response: z.looseObject({
    vin: z.string().min(1),
    display_name: str,
    state: str,
    charge_state: chargeStateSchema.optional(),
    drive_state: driveStateSchema.optional(),
    vehicle_state: vehicleStateSchema.optional(),
    climate_state: climateStateSchema.optional(),
    /**
     * Configuration d'usine. On n'en lit que la peinture : `exterior_color` nomme la teinte sortie
     * d'usine (« SteelGrey », « PearlWhite »…), et `paint_color_override` porte la couleur que le
     * propriétaire a choisie DANS SA VOITURE — « 40,90,200,0.9,0.3 » : rouge, vert, bleu, puis ce
     * qui ressemble fort au couple métallicité / rugosité du rendu de Tesla.
     */
    vehicle_config: z.looseObject({
      exterior_color: str,
      paint_color_override: str,
    }).optional(),
  }),
})
export type VehicleData = z.infer<typeof vehicleDataSchema>['response']

/** Réponse d'une commande REST (`/command/...`) : Tesla accuse par `result`, et explique par `reason`. */
export const commandResultSchema = z.looseObject({
  response: z.looseObject({ result: z.boolean(), reason: z.string().optional() }).nullable().optional(),
  error: z.string().optional(),
})

/** Réponse du serveur OAuth (échange de code, rafraîchissement, jeton partenaire). */
export const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional(),
})
export type TokenResponse = z.infer<typeof tokenResponseSchema>

/** `GET /api/1/partner_accounts/public_key?domain=` : ce que Tesla a lu sur le domaine enregistré. */
export const partnerPublicKeySchema = z.looseObject({
  response: z.looseObject({ public_key: z.string().nullable().optional() }).nullable().optional(),
})
