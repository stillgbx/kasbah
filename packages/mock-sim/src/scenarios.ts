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

// Scénarios : `default` reproduit la maison démo (ids stables liés dans house/demo-house.json),
// `empty` teste le rendu sans appareil, `chaos` exerce les erreurs/indisponibilités, `winter`
// change la saison. Le site énergie est TOUJOURS construit en dernier (il lit les charges du tick).

export const SCENARIO_NAMES = ['default', 'empty', 'chaos', 'winter'] as const
export type ScenarioName = (typeof SCENARIO_NAMES)[number]

// Maison et destination de la simulation : deux endroits qui comptent pour l'utilisateur, et non
// des coordonnées au hasard. Séparées de 2,3 km, donc la carte du véhicule cadre les deux (la règle
// des 3 km de `lib/map.ts`) : la démo montre la voiture PAR RAPPORT à la maison, ce qui est tout
// l'intérêt. `HOME` vaut l'origine de `house/demo-house.json` : la voiture garée se pose sur la maison.
const HOME = { lat: 47.309343, lon: 5.045591 }
const WORK = { lat: 47.3216, lon: 5.0415 }

function defaultDevices(opts: { winter?: boolean } = {}) {
  return [
    light('light-living', { name: 'Plafonnier salon', colorTemp: true, color: true, on: !!opts.winter, brightness: 70, powerW: 12 }),
    light('light-kitchen', { name: 'Spots cuisine', colorTemp: true, brightness: 90, powerW: 30 }),
    light('light-bedroom1', { name: 'Lampe chambre 1', brightness: 40, powerW: 9 }),
    cover('cover-living', { name: 'Volet baie', position: 100, preset: 27 }),
    cover('cover-kitchen', { name: 'Volet cuisine', position: 100 }),
    cover('cover-bedroom1', { name: 'Volet chambre 1', position: opts.winter ? 30 : 100, tilt: true }),
    mediaPlayer('speaker-living', { name: 'Enceinte salon', volume: 30 }),
    mediaPlayer('speaker-kitchen', { name: 'Enceinte cuisine', volume: 45, playing: true }),
    climate('climate-heatpump', { name: 'Pompe à chaleur', mode: opts.winter ? 'heat' : 'auto', targetTempC: opts.winter ? 20.5 : 21, currentTempC: opts.winter ? 19 : 22 }),
    vacuum('vacuum-roomba', { name: 'Aspirateur' }),
    mower('mower-automower', { name: 'Tondeuse', area: [-1, 12, 26, 22], dock: [12, 16], schedule: opts.winter ? null : undefined }),
    sensors.indoorTemp('sensor-bedroom1-temp', 'Température chambre 1', opts.winter ? 18.5 : 21),
    sensors.outdoorTemp('sensor-outdoor-temp', 'Température extérieure'),
    sensors.poolTemp('sensor-pool-temp', 'Température piscine'),
    sensors.filtrationPressure('sensor-filtration-pressure', 'Pression filtration'),
    vehicle('vehicle-tesla', { name: 'Tesla', manufacturer: 'Tesla', model: 'Model Y', batteryKwh: 75, rangeKmFull: 450, home: HOME, work: WORK, soc: 68, chargeLimit: 80 }),
    vehicle('vehicle-r5', { name: 'R5', manufacturer: 'Renault', model: 'Renault 5 E-Tech', batteryKwh: 52, rangeKmFull: 410, home: HOME, work: WORK, workDays: [], soc: 55, chargeLimit: 80, socMin: 20, chargerPowerW: 0 }),
    evCharger('charger-home', { name: 'Borne de recharge', vehicleId: 'vehicle-tesla' }),
    // deux champs de dix modules (liés dans house/demo-house.json) : le sud plein rendement, le
    // dernier ombré par la cheminée en fin de journée ; le nord moins exposé
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
}

export function resolveScenario(s: ScenarioName | Scenario): Scenario {
  if (typeof s === 'string') {
    const found = SCENARIOS[s]
    if (!found) throw new Error(`unknown mock scenario "${s}" (known: ${SCENARIO_NAMES.join(', ')})`)
    return found
  }
  return s
}
