import type { DeviceKind } from '../devices/kinds'
import { CLIMATE_MODES, WEATHER_CONDITIONS } from '../devices/kinds'
import {
  CHARGER_STATUSES, CLIMATE_ACTIONS, COVER_MOTIONS, MOWER_ACTIVITIES, PLAYBACKS, VACUUM_ACTIVITIES, VEHICLE_SLEEP_STATES,
} from '../devices/state'

// State fields that a `device` predicate OFFERS, by kind: what the editor shows in its
// lists. It is a guide and not a barrier — the engine accepts any key of the kind (`stateKeys`),
// which lets a field added to the contract be usable before it gets here. A test checks that
// each entry does exist in the state of its kind.

export type TriggerFieldType = 'boolean' | 'number' | 'enum'

export interface TriggerField {
  field: string
  type: TriggerFieldType
  /** Possible values of an `enum` field. */
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
