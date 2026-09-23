import type { DeviceKind } from '../devices/kinds'
import { CLIMATE_MODES, WEATHER_CONDITIONS } from '../devices/kinds'
import {
  CHARGER_STATUSES, CLIMATE_ACTIONS, COVER_MOTIONS, MOWER_ACTIVITIES, PLAYBACKS, VACUUM_ACTIVITIES, VEHICLE_SLEEP_STATES,
} from '../devices/state'

// Champs d'état qu'un prédicat `device` PROPOSE, par kind : ce que l'éditeur affiche dans ses
// listes. C'est un guide et non une barrière — le moteur accepte toute clé du kind (`stateKeys`),
// ce qui laisse un champ ajouté au contrat utilisable avant d'arriver ici. Un test vérifie que
// chaque entrée existe bien dans l'état de son kind.

export type TriggerFieldType = 'boolean' | 'number' | 'enum'

export interface TriggerField {
  field: string
  type: TriggerFieldType
  /** Valeurs possibles d'un champ `enum`. */
  values?: readonly string[]
}

const bool = (field: string): TriggerField => ({ field, type: 'boolean' })
const num = (field: string): TriggerField => ({ field, type: 'number' })
const oneOf = (field: string, values: readonly string[]): TriggerField => ({ field, type: 'enum', values })

export const TRIGGER_FIELDS: Partial<Record<DeviceKind, readonly TriggerField[]>> = {
  light: [bool('on'), num('brightness')],
  cover: [num('position'), oneOf('motion', COVER_MOTIONS)],
  media_player: [oneOf('playback', PLAYBACKS), num('volume'), bool('muted')],
  climate: [oneOf('mode', CLIMATE_MODES), oneOf('action', CLIMATE_ACTIONS), num('currentTempC'), num('targetTempC'), num('humidity')],
  vacuum: [oneOf('activity', VACUUM_ACTIVITIES), num('battery'), bool('binFull')],
  mower: [oneOf('activity', MOWER_ACTIVITIES), num('battery')],
  sensor: [num('value')],
  energy: [num('productionW'), num('consumptionW'), num('gridW'), num('batteryW'), num('batterySoc')],
  ev_charger: [oneOf('status', CHARGER_STATUSES), num('powerW')],
  vehicle: [num('soc'), num('rangeKm'), bool('pluggedIn'), bool('charging'), bool('locked'), oneOf('sleepState', VEHICLE_SLEEP_STATES), num('speedKmh')],
  weather: [oneOf('condition', WEATHER_CONDITIONS), num('tempC'), num('windKmh'), num('windGustKmh'), num('precipProbability'), bool('isDay'), num('uvIndex'), num('humidity')],
  water: [num('flowLph'), bool('warning'), bool('defect')],
  pet_feeder: [bool('foodLow'), bool('feeding')],
  pet_fountain: [bool('on'), bool('waterLow')],
  fan: [bool('on'), num('speed')],
}
