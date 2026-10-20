import type { Scenario } from './types'
import { WINTER_WORLD } from './world'
import { light } from './behaviours/light'
import { cover } from './behaviours/cover'
import { mediaPlayer } from './behaviours/media'
import { climate } from './behaviours/climate'
import { mower, vacuum } from './behaviours/robots'
import { sensors } from './behaviours/sensor'
import { energySite, solarPanel } from './behaviours/energy'
import { evCharger, vehicle } from './behaviours/ev'
import { weather } from './behaviours/weather'
import { water } from './behaviours/water'
import { petFeeder, petFountain } from './behaviours/pets'
import { ceilingFan, ceilingFanLight } from './behaviours/fan'
import { BELVEDERE_SCENES, EMBRUNS_SCENES, TILLEULS_SCENES, belvedereDevices, embrunsDevices, tilleulsDevices } from './demos'

// Scenarios: `default` reproduces the TEST house (stable ids linked in house/demo-house.json),
// `empty` tests rendering without a device, `chaos` exercises errors/unavailabilities, `winter`
// changes the season. `tilleuls`, `embruns` and `belvedere` are the device sets of the three demo
// properties (`house/demos/`), with their winter variant. The energy site is ALWAYS built
// last (it reads the loads of the tick).

export const SCENARIO_NAMES = [
  'default', 'empty', 'chaos', 'winter',
  'tilleuls', 'tilleuls-winter', 'embruns', 'embruns-winter', 'belvedere', 'belvedere-winter',
] as const
export type ScenarioName = (typeof SCENARIO_NAMES)[number]

// House and destination of the simulation, two public places in Dijon (the cours du Général-de-Gaulle,
// the place de la Libération) 1.4 km from each other, so the vehicle's map frames both (the
// 3 km rule of `lib/map.ts`): the demo shows the car RELATIVE TO the house, which is the whole
// point. `HOME` is the origin of `house/demo-house.json`: the parked car sits on the house.
const HOME = { lat: 47.309343, lon: 5.045591 }
const WORK = { lat: 47.3216, lon: 5.0415 }

function defaultDevices(opts: { winter?: boolean } = {}) {
  return [
    light('light-living', { name: 'Plafonnier salon', colorTemp: true, color: true, on: !!opts.winter, brightness: 70, powerW: 12 }),
    light('light-kitchen', { name: 'Spots cuisine', colorTemp: true, brightness: 90, powerW: 30 }),
    light('light-bedroom1', { name: 'Lampe chambre 1', brightness: 40, powerW: 9 }),
    cover('cover-living', { name: 'Volet baie', deviceClass: 'shutter', position: 100, preset: 27, quiet: true }),
    // solar shutter: its panel is declared as a light sensor, linked to the shutter
    sensors.shutterLight('sensor-living-light', 'Volet baie · luminosité', 'mock:cover-living'),
    cover('cover-kitchen', { name: 'Volet cuisine', deviceClass: 'shutter', position: 100 }),
    cover('cover-bedroom1', { name: 'Volet chambre 1', deviceClass: 'shutter', position: opts.winter ? 30 : 100, tilt: true }),
    // Three kinds of cover, because they do not behave the same way in the UI: the shutter
    // opens, the AWNING rolls up (and unfolds flat, so at rest at 100), the GATE faces
    // the street (no global gesture opens it, and it expects no opening). In summer the awning is
    // deployed — it is when deployed that it gets noticed; in winter it is retracted.
    cover('cover-terrace', { name: 'Store terrasse', deviceClass: 'awning', position: opts.winter ? 100 : 40 }),
    cover('cover-gate', { name: 'Portail', deviceClass: 'gate', position: 0 }),
    mediaPlayer('speaker-living', { name: 'Enceinte salon', volume: 30 }),
    mediaPlayer('speaker-kitchen', { name: 'Enceinte cuisine', volume: 45, playing: true }),
    climate('climate-heatpump', { name: 'Pompe à chaleur', mode: opts.winter ? 'heat' : 'auto', targetTempC: opts.winter ? 20.5 : 21, currentTempC: opts.winter ? 19 : 22 }),
    vacuum('vacuum-roomba', { name: 'Aspirateur' }),
    mower('mower-automower', { name: 'Tondeuse', area: [-1, 12, 26, 22], dock: [12, 16], schedule: opts.winter ? null : undefined, home: HOME }),
    sensors.indoorTemp('sensor-bedroom1-temp', 'Température chambre 1', opts.winter ? 18.5 : 21),
    sensors.outdoorTemp('sensor-outdoor-temp', 'Température extérieure'),
    weather('weather', { name: 'Météo' }),
    sensors.poolTemp('sensor-pool-temp', 'Température piscine'),
    sensors.filtrationPressure('sensor-filtration-pressure', 'Pression filtration'),
    water('water-station', { name: "Traitement de l'eau" }),
    // pets: a feeder and a fountain, like the real device set (two of each, a single
    // unit is enough to verify the cards and the view)
    petFeeder('pet-feeder-kitchen', { name: 'Mangeoire cuisine' }),
    petFountain('pet-fountain-kitchen', { name: 'Fontaine cuisine' }),
    // CREATE ceiling fan: two linked devices (no shared command).
    ceilingFanLight('fan-chambre2_light', { name: 'Plafonnier chambre 2' }),
    ceilingFan('fan-chambre2_fan', { name: 'Ventilateur chambre 2', linkedLightId: 'mock:fan-chambre2_light' }),
    vehicle('vehicle-tesla', { name: 'Tesla', manufacturer: 'Tesla', model: 'Model Y', batteryKwh: 75, rangeKmFull: 450, home: HOME, work: WORK, soc: 68, chargeLimit: 80,
      software: { version: '2026.32.7', pending: '2026.38' } }),
    vehicle('vehicle-r5', { name: 'R5', manufacturer: 'Renault', model: 'Renault 5 E-Tech', batteryKwh: 52, rangeKmFull: 410, home: HOME, work: WORK, workDays: [], soc: 55, chargeLimit: 80, socMin: 20, chargerPowerW: 0,
      // like the Renault plugin: front seats and steering wheel on / off, adjustable with the climate off
      climate: { minC: 16, maxC: 26, stepC: 1, seats: ['fl', 'fr'], seatLevels: 1, steeringWheelHeat: true, heatWhileOff: true } }),
    evCharger('charger-home', { name: 'Borne de recharge', vehicleId: 'vehicle-tesla' }),
    // two arrays of ten modules (linked in house/demo-house.json): the south at full efficiency, the
    // last one shaded by the chimney at the end of the day; the north less exposed
    ...Array.from({ length: 10 }, (_, i) => solarPanel(`panel-s${String(i + 1).padStart(2, '0')}`, {
      name: `Panneau sud ${i + 1}`, factor: 0.95 + ((i * 3) % 5) * 0.01, ...(i === 9 ? { shadeFrom: 16 } : {}),
    })),
    ...Array.from({ length: 10 }, (_, i) => solarPanel(`panel-n${String(i + 1).padStart(2, '0')}`, {
      name: `Panneau nord ${i + 1}`, factor: 0.6 + ((i * 3) % 5) * 0.01,
    })),
    energySite('energy-site', { name: 'Énergie Enphase', peakW: opts.winter ? 6000 : 6000, batteryWh: 5000 }),
  ]
}

export const SCENARIOS: Record<ScenarioName, Scenario> = {
  default: { name: 'default', build: () => defaultDevices() },
  empty: { name: 'empty', build: () => [] },
  chaos: {
    name: 'chaos',
    build: () => defaultDevices(),
    chaos: { flipEveryS: 30, flipForS: 10, failRate: 0.1, slowRate: 0.1, latencyMs: 3000 },
  },
  winter: { name: 'winter', build: () => defaultDevices({ winter: true }), world: WINTER_WORLD },
  tilleuls: { name: 'tilleuls', build: () => tilleulsDevices(), scenes: TILLEULS_SCENES },
  'tilleuls-winter': { name: 'tilleuls-winter', build: () => tilleulsDevices({ winter: true }), scenes: TILLEULS_SCENES, world: WINTER_WORLD },
  embruns: { name: 'embruns', build: () => embrunsDevices(), scenes: EMBRUNS_SCENES },
  'embruns-winter': { name: 'embruns-winter', build: () => embrunsDevices({ winter: true }), scenes: EMBRUNS_SCENES, world: WINTER_WORLD },
  belvedere: { name: 'belvedere', build: () => belvedereDevices(), scenes: BELVEDERE_SCENES },
  'belvedere-winter': { name: 'belvedere-winter', build: () => belvedereDevices({ winter: true }), scenes: BELVEDERE_SCENES, world: WINTER_WORLD },
}

export function resolveScenario(s: ScenarioName | Scenario): Scenario {
  if (typeof s === 'string') {
    const found = SCENARIOS[s]
    if (!found) throw new Error(`unknown mock scenario "${s}" (known: ${SCENARIO_NAMES.join(', ')})`)
    return found
  }
  return s
}
