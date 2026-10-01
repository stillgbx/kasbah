import { describe, expect, it } from 'vitest'
import { defaultState, deviceDescriptorSchema, deviceStateSchema, mergeState, stateKeys, type StateFor } from '@kasbah/shared'
import { VEHICLES_ASLEEP, VEHICLES_ONLINE, VEHICLE_DATA_CHARGING, VEHICLE_DATA_DRIVING, VEHICLE_DATA_PARKED } from './__fixtures__/fleet'
import { bodyColor, CLIMATE_FEATURES, bodyFinish, isResting, modelFromVin, toDataPatch, toDescriptor, toSleepPatch, toSleepState } from './mapping'
import { vehicleDataSchema, vehicleSummarySchema, vehiclesListSchema } from './types'

// Mappage de la Fleet API, éprouvé sur une réponse CAPTURÉE sur le vrai compte (Model S 2017, MCU2) :
// voir l'en-tête de `__fixtures__/fleet.ts`.

const MILE = 1.609344
const summary = vehicleSummarySchema.parse(vehiclesListSchema.parse(VEHICLES_ASLEEP).response[0])
const parked = vehicleDataSchema.parse(VEHICLE_DATA_PARKED).response
const driving = vehicleDataSchema.parse(VEHICLE_DATA_DRIVING).response
const charging = vehicleDataSchema.parse(VEHICLE_DATA_CHARGING).response

/** Un patch n'est bon que si le registre l'accepte : clés du kind, puis état complet valide. */
function accepted(patch: ReturnType<typeof toDataPatch>) {
  for (const k of Object.keys(patch)) expect(stateKeys('vehicle').has(k), `clé ${k}`).toBe(true)
  const merged = mergeState(defaultState('vehicle') as StateFor<'vehicle'>, patch, 1)
  expect(deviceStateSchema.safeParse(merged).success).toBe(true)
  return merged
}

describe('descripteur', () => {
  it('un véhicule = un appareil `vehicle` identifié par son VIN, nommé comme dans l’appli Tesla', () => {
    const d = toDescriptor(summary)
    expect(deviceDescriptorSchema.safeParse(d).success).toBe(true)
    expect(d).toMatchObject({ id: 'tesla:5YJSA7E20HF000001', externalId: '5YJSA7E20HF000001', kind: 'vehicle', name: 'Kasbah S' })
    // la climatisation se déclare d'emblée : l'UI commune grise ce qui n'y est pas
    expect(d.meta).toEqual({ manufacturer: 'Tesla', model: 'Model S', vehicle: { climate: CLIMATE_FEATURES } })
    // phase 1 : lecture seule — ni `lock` ni `charging`, l'UI n'a donc pas à proposer ces boutons.
    // `charge_power` n'est pas une commande : elle dit que la voiture DONNE sa puissance de charge,
    // et dispense l'UI de la faire estimer (donc de demander la capacité de la batterie).
    expect(d.capabilities).toEqual(['soc', 'range', 'location', 'charge_power', 'charge_limit', 'charging', 'climate_precondition'])
  })

  it('la gamme se lit au 4e caractère du VIN, et sert de nom à défaut', () => {
    expect(modelFromVin('5YJ3E1EA1JF000001')).toBe('Model 3')
    expect(modelFromVin('7SAYGDEE0PF000001')).toBe('Model Y')
    expect(modelFromVin('XXXQ0000000000000')).toBeUndefined()
    expect(toDescriptor({ ...summary, display_name: '  ' }).name).toBe('Model S')
    expect(toDescriptor({ ...summary, display_name: null, vin: 'XXXQ0000000000000' }).name).toBe('Tesla')
  })
})

describe('veille', () => {
  it('la liste donne la veille sans réveiller : `asleep` est un état, pas une indisponibilité', () => {
    expect(toSleepPatch(summary)).toEqual({ sleepState: 'asleep' })
    expect(toSleepPatch(vehiclesListSchema.parse(VEHICLES_ONLINE).response[0] as { state: string })).toEqual({ sleepState: 'online' })
  })
  it('une valeur inconnue du fabricant (« waking ») est lue comme éveillé plutôt que de rejeter la liste', () => {
    expect(toSleepState('waking')).toBe('online')
    expect(toSleepState(undefined)).toBe('online')
    expect(toSleepState('offline')).toBe('offline')
  })
})

describe('couleur de carrosserie (`vehicle_config`)', () => {
  it('la couleur choisie DANS la voiture prime sur la peinture d usine', () => {
    // Relevé réel du 2026-09-15 : sortie d'usine en PearlWhite, mais l'écran de bord affiche un
    // bleu que le propriétaire a choisi. C'est celui-là qu'il a en tête, donc celui qu'on peint.
    expect(bodyColor(parked)).toBe('#285ac8')

    // Sans surcharge, le nom de la peinture d'usine, approché par la table.
    expect(bodyColor({ vehicle_config: { exterior_color: 'SteelGrey' } })).toBe('#5c6063')
    expect(bodyColor({ vehicle_config: { exterior_color: 'pearlwhite' } })).toBe('#f2f3f5')

    // Un nom hors table, une surcharge illisible, ou pas de section du tout : rien. La scène garde
    // sa couleur de thème et l'utilisateur tranche — jamais de couleur inventée.
    expect(bodyColor({ vehicle_config: { exterior_color: 'ChartreuseSparkle' } })).toBeUndefined()
    expect(bodyColor({ vehicle_config: { paint_color_override: 'bleu' } })).toBeUndefined()
    expect(bodyColor({})).toBeUndefined()
  })

  it('classe les trois aspects, chacun relevé sur la vraie voiture', () => {
    // Trois basculements de l'écran de bord, trois relevés du 2026-09-15. Aucun aspect inventé.
    expect(bodyFinish(parked)).toBe('matte')                                                        // 0.9 / 0.30
    expect(bodyFinish({ vehicle_config: { paint_color_override: '40,90,200,0.9,0.01' } })).toBe('metallic')
    expect(bodyFinish({ vehicle_config: { paint_color_override: '40,90,200,0.7,0.04' } })).toBe('solid')

    // Les deux axes sont INDÉPENDANTS : la rugosité décide du mat, la métallicité départage les
    // deux brillants. Une première version ne lisait que le quatrième nombre et répondait « mate »
    // quoi qu'il arrive ; une seconde ne lisait que le cinquième et ne savait pas dire « unie ».
    expect(bodyFinish({ vehicle_config: { paint_color_override: '0,0,0,0.7,0.30' } })).toBe('matte')
    expect(bodyFinish({ vehicle_config: { paint_color_override: '0,0,0,0.9,0.04' } })).toBe('metallic')

    // Pas de cinquième nombre, ou pas de section : rien à dire de l'aspect.
    expect(bodyFinish({ vehicle_config: { paint_color_override: '10,20,30,0.9' } })).toBeUndefined()
    expect(bodyFinish({})).toBeUndefined()
  })
})

describe('lecture complète (`vehicle_data`)', () => {
  it('garé, câble branché sur une borne sans courant (`NoPower`) : miles → km, `null` → champ absent', () => {
    const p = toDataPatch(parked)
    accepted(p)
    expect(p.soc).toBe(54)
    expect(p.rangeKm).toBeCloseTo(145.93 * MILE, 1)
    expect(p.pluggedIn).toBe(true)                 // `NoPower` : le câble est là (IEC engagé), la borne ne délivre rien
    expect(p.charging).toBe(false)
    expect(p.chargePowerW).toBe(0)
    expect(p.chargeLimit).toBe(80)
    expect(p.locked).toBe(true)
    expect(p.odometerKm).toBeCloseTo(61234.01676 * MILE, 0)
    expect(p.insideTempC).toBe(25.8)
    expect(p.outsideTempC).toBe(23)
    expect(p.climateOn).toBe(false)
    expect(p.climateTargetC).toBe(15)
    expect(p.seatHeat).toEqual({ fl: 0, fr: 0, rl: 0, rc: 0, rr: 0 })
    expect(p.steeringWheelHeat).toBe(false)
    expect(p.sleepState).toBe('online')
  })

  it('à l’arrêt : vitesse `null` vaut 0, rapport `null` vaut P', () => {
    const p = toDataPatch(parked)
    expect(p.speedKmh).toBe(0)
    expect(p.gear).toBe('P')
  })

  it('les pneus : quatre roues arrondies au centième, une roue `null` est absente et non un 0', () => {
    expect(toDataPatch(parked).tirePressureBar).toEqual({ fl: 3.18, fr: 3.25, rl: 3.25, rr: 3.3 })
    const three = { ...parked, vehicle_state: { ...parked.vehicle_state, tpms_pressure_rr: null } }
    expect(toDataPatch(three).tirePressureBar).toEqual({ fl: 3.18, fr: 3.25, rl: 3.25 })
    // aucune roue mesurée → aucun objet, plutôt qu'un objet vide qui s'afficherait
    const none = { ...parked, vehicle_state: { ...parked.vehicle_state, tpms_pressure_fl: null, tpms_pressure_fr: null, tpms_pressure_rl: null, tpms_pressure_rr: null } }
    expect(toDataPatch(none).tirePressureBar).toBeUndefined()
  })

  it('le cap est repris tel quel (0 = nord), normalisé dans [0, 360[', () => {
    expect(toDataPatch(parked).headingDeg).toBe(112)
    expect(toDataPatch({ ...parked, drive_state: { ...parked.drive_state, heading: 372 } }).headingDeg).toBe(12)
    expect(toDataPatch({ ...parked, drive_state: { ...parked.drive_state, heading: null } }).headingDeg).toBeUndefined()
  })

  it('la position est datée par `gps_as_of` (secondes) ramené en millisecondes', () => {
    expect(toDataPatch(parked).location).toEqual({ lat: 45.188529, lon: 5.724524, at: 1789329492_000 })
    const noGps = { ...parked, drive_state: { ...parked.drive_state, gps_as_of: null } }
    expect(toDataPatch(noGps).location?.at).toBe(1789329806461)
    const noPos = { ...parked, drive_state: { ...parked.drive_state, latitude: null } }
    expect(toDataPatch(noPos).location).toBeUndefined()
  })

  it('en roulant : débranché, mph → km/h, rapport D, déverrouillé', () => {
    const p = toDataPatch(driving)
    accepted(p)
    expect(p.pluggedIn).toBe(false)
    expect(p.charging).toBe(false)
    expect(p.speedKmh).toBeCloseTo(52 * MILE, 1)
    expect(p.gear).toBe('D')
    expect(p.locked).toBe(false)
    expect(p.soc).toBe(48)
  })

  it('en charge : `Charging` et la puissance en watts', () => {
    const p = toDataPatch(charging)
    accepted(p)
    expect(p).toMatchObject({ pluggedIn: true, charging: true, chargePowerW: 7000, soc: 61 })
  })

  it('temps restant : les heures décimales du fabricant en minutes, et rien hors charge', () => {
    expect(toDataPatch(charging).chargeMinutesRemaining).toBe(105)   // 1,75 h
    // débranchée, `time_to_full_charge` reste à sa dernière valeur : on l'efface plutôt que de l'afficher
    expect(toDataPatch(parked).chargeMinutesRemaining).toBeNull()
  })

  it('une section manquante ne fait rien échouer : le patch se réduit à ce qu’on a', () => {
    const bare = vehicleDataSchema.parse({ response: { vin: parked.vin, state: 'online' } }).response
    expect(toDataPatch(bare)).toEqual({ sleepState: 'online' })
  })
})

describe('repos', () => {
  it('garé, personne à bord, pas en charge → au repos : on le laisse s’endormir', () => {
    expect(isResting(parked)).toBe(true)
  })
  it('en route, ou en charge, ou quelqu’un à bord → actif : on continue à lire', () => {
    expect(isResting(driving)).toBe(false)
    expect(isResting(charging)).toBe(false)
    expect(isResting({ ...parked, vehicle_state: { ...parked.vehicle_state, is_user_present: true } })).toBe(false)
  })
})
