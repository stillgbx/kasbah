import { localToGeo } from '@kasbah/shared'
import type { AnySimDevice, SimScene } from './types'
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
import { camera } from './behaviours/camera'

// The device sets of the three DEMO PROPERTIES (`house/demos/*.json`): each one is linked device
// by device to its house, and together they show everything the application can do. The
// places (Dijon, Pornic, Lille) fall on a public space — a boulevard, the edge of a golf course, a
// main square —, never on someone's house. The vehicles' workplace is 1.3–1.5 km away, so
// that the map frames both (3 km rule of `lib/map.ts`).

/** Origins of the houses: `origin` of `house/demos/tilleuls.json` and `embruns.json` (heading 0). */
const TILLEULS = { lat: 47.309069, lon: 5.046007 }
const TILLEULS_WORK = { lat: 47.3216, lon: 5.0415 }
const EMBRUNS = { lat: 47.1135, lon: -2.1215 }
const EMBRUNS_WORK = { lat: 47.1153, lon: -2.104 }
/**
 * Where a car parks AT THE HOUSE: on its spot (`site.parkings`), not on the origin of the reference frame.
 * The GPS of a parked vehicle thus falls in the margin of the spot, and the scene tucks it in there.
 */
const parked = (home: { lat: number; lon: number }, x: number, y: number) => {
  const g = localToGeo({ ...home, alt: 0, heading: 0 }, [x, y, 0])
  return { lat: g.lat, lon: g.lon }
}

const warm = 454, neutral = 300, cool = 200

/** Les Tilleuls: two-story family house, gable roof — the complete showcase. */
export function tilleulsDevices(opts: { winter?: boolean } = {}): AnySimDevice[] {
  const w = !!opts.winter
  return [
    light('tl-light-salon', { name: 'Suspension salon', colorTemp: true, color: true, effects: ['candle', 'fire', 'sparkle'], on: w, brightness: 70, powerW: 14 }),
    light('tl-light-lampadaire', { name: 'Lampadaire salon', colorTemp: true, brightness: 60, powerW: 9 }),
    light('tl-light-cuisine', { name: 'Spots cuisine', colorTemp: true, brightness: 90, powerW: 30 }),
    light('tl-light-ilot', { name: 'Suspensions îlot', brightness: 80, powerW: 18 }),
    light('tl-light-entree', { name: 'Plafonnier entrée', brightness: 70, powerW: 9 }),
    light('tl-light-bureau', { name: 'Lampe de bureau', colorTemp: true, brightness: 85, powerW: 8 }),
    light('tl-light-cinema', { name: 'Ruban LED home cinéma', colorTemp: true, color: true, effects: ['sparkle', 'prism'], brightness: 40, powerW: 12 }),
    light('tl-light-chambre1', { name: 'Plafonnier chambre 1', colorTemp: true, color: true, brightness: 60, powerW: 9 }),
    light('tl-light-chambre2', { name: 'Plafonnier chambre 2', colorTemp: true, brightness: 60, powerW: 9 }),
    light('tl-light-palier', { name: 'Applique palier', brightness: 50, powerW: 6 }),
    light('tl-light-wc', { name: 'Plafonnier WC', brightness: 80, powerW: 5 }),
    light('tl-light-dressing', { name: 'Spots dressing', brightness: 90, powerW: 8 }),
    light('tl-light-sdb', { name: 'Miroir salle de bain', colorTemp: true, brightness: 100, powerW: 10 }),
    light('tl-light-terrasse', { name: 'Appliques terrasse', colorTemp: true, brightness: 70, powerW: 16 }),
    light('tl-light-jardin', { name: 'Bornes jardin', brightness: 60, powerW: 20 }),
    light('tl-light-piscine', { name: 'Projecteur piscine', color: true, effects: ['candle', 'prism'], brightness: 80, powerW: 35 }),
    // suite ceiling fan: two linked devices, no shared command
    ceilingFanLight('tl-fan-suite_light', { name: 'Plafonnier suite' }),
    ceilingFan('tl-fan-suite_fan', { name: 'Ventilateur suite', linkedLightId: 'mock:tl-fan-suite_light' }),

    // solar and quiet shutter, whose panel is declared as a light sensor
    cover('tl-cover-baie', { name: 'Volet baie salon', deviceClass: 'shutter', position: 100, preset: 27, quiet: true }),
    sensors.shutterLight('tl-sensor-baie-light', 'Volet baie salon · luminosité', 'mock:tl-cover-baie'),
    cover('tl-cover-salon', { name: 'Volet fenêtre salon', deviceClass: 'shutter', position: 100 }),
    cover('tl-cover-cuisine', { name: 'Volet cuisine', deviceClass: 'shutter', position: 100 }),
    cover('tl-cover-bureau', { name: 'Store vénitien bureau', deviceClass: 'blind', position: 100, tilt: true }),
    cover('tl-cover-cinema', { name: 'Rideau home cinéma', deviceClass: 'curtain', position: 0 }),
    cover('tl-cover-chambre1', { name: 'Volet chambre 1', deviceClass: 'shutter', position: w ? 30 : 100 }),
    cover('tl-cover-chambre2', { name: 'Volet chambre 2', deviceClass: 'shutter', position: 100 }),
    cover('tl-cover-suite', { name: 'Volet suite', deviceClass: 'shutter', position: 100 }),
    cover('tl-cover-velux', { name: 'Fenêtre de toit palier', deviceClass: 'window', position: 0 }),
    // in summer the awning is deployed (it is when deployed that it gets noticed), in winter it is retracted
    cover('tl-cover-store', { name: 'Store terrasse', deviceClass: 'awning', position: w ? 100 : 40 }),
    cover('tl-cover-portail', { name: 'Portail', deviceClass: 'gate', position: 0 }),
    cover('tl-cover-garage1', { name: 'Porte de garage gauche', deviceClass: 'garage', position: 0, speedPctPerS: 8 }),
    cover('tl-cover-garage2', { name: 'Porte de garage droite', deviceClass: 'garage', position: 0, speedPctPerS: 8 }),

    mediaPlayer('tl-media-salon', { name: 'Enceinte salon', volume: 30 }),
    mediaPlayer('tl-media-cuisine', { name: 'Écran cuisine', deviceClass: 'display', volume: 45, playing: true }),
    mediaPlayer('tl-media-tv', { name: 'TV home cinéma', deviceClass: 'tv', volume: 25 }),
    // the TV sends its sound through this bar (`meta.audioOutput` in the house)
    mediaPlayer('tl-media-barre', { name: 'Barre de son', model: 'Soundbar', volume: 35 }),
    mediaPlayer('tl-media-suite', { name: 'Réveil suite', volume: 20 }),
    mediaPlayer('tl-media-terrasse', { name: 'Enceinte terrasse', volume: 40 }),

    climate('tl-climate-pac', { name: 'Pompe à chaleur', deviceClass: 'heat_pump', mode: w ? 'heat' : 'auto', targetTempC: w ? 20.5 : 21, currentTempC: w ? 19 : 22 }),
    climate('tl-climate-etage', { name: 'Thermostat étage', deviceClass: 'thermostat', mode: w ? 'heat' : 'eco', targetTempC: 19.5, currentTempC: w ? 18.5 : 21.5, heatPowerW: 900 }),

    camera('tl-cam-sonnette', { name: 'Sonnette', deviceClass: 'doorbell', rings: [11.5, 17.25] }),
    camera('tl-cam-allee', { name: 'Caméra allée', deviceClass: 'camera' }),
    camera('tl-cam-jardin', { name: 'Caméra jardin', deviceClass: 'camera' }),

    vacuum('tl-vacuum', { name: 'Robot aspirateur', startHour: 10 }),
    mower('tl-mower', { name: 'Robot tondeuse', area: [-10, 23, 40, 39], dock: [-8, 25], schedule: w ? null : undefined, home: TILLEULS }),

    sensors.indoorTemp('tl-sensor-chambre1', 'Température chambre 1', w ? 18.5 : 21),
    sensors.outdoorTemp('tl-sensor-ext', 'Température extérieure'),
    sensors.poolTemp('tl-sensor-piscine', 'Température piscine'),
    sensors.filtrationPressure('tl-sensor-filtration', 'Pression filtration'),
    weather('tl-weather', { name: 'Météo' }),
    water('tl-water', { name: "Traitement de l'eau" }),
    petFeeder('tl-pet-feeder', { name: 'Distributeur de croquettes' }),
    petFountain('tl-pet-fountain', { name: 'Fontaine à eau' }),

    vehicle('tl-vehicle-tesla', { name: 'Model S', manufacturer: 'Tesla', model: 'Model S', batteryKwh: 75, rangeKmFull: 480, home: parked(TILLEULS, 15.9, 3.4), work: TILLEULS_WORK, soc: 68, chargeLimit: 80,
      software: { version: '2026.32.7', pending: '2026.38' } }),
    vehicle('tl-vehicle-r5', { name: 'Renault 5', manufacturer: 'Renault', model: 'Renault 5 E-Tech', batteryKwh: 52, rangeKmFull: 410, home: parked(TILLEULS, 18.9, 3.4), work: TILLEULS_WORK, workDays: [], soc: 55, chargeLimit: 80, socMin: 20, chargerPowerW: 0,
      climate: { minC: 16, maxC: 26, stepC: 1, seats: ['fl', 'fr'], seatLevels: 1, steeringWheelHeat: true, heatWhileOff: true } }),
    evCharger('tl-charger', { name: 'Borne de recharge', vehicleId: 'tl-vehicle-tesla' }),
    // an array of twelve modules on the south slope; the last one, shaded by the chimney at the end of the day
    ...Array.from({ length: 12 }, (_, i) => solarPanel(`tl-panel-${String(i + 1).padStart(2, '0')}`, {
      name: `Panneau ${i + 1}`, factor: 0.95 + ((i * 3) % 5) * 0.01, ...(i === 11 ? { shadeFrom: 16 } : {}),
    })),
    energySite('tl-energy', { name: 'Énergie', peakW: 5400, batteryWh: 10_000 }),
  ]
}

export const TILLEULS_SCENES: SimScene[] = [
  { externalId: 'tl-scene-lecture', name: 'Lecture', group: { name: 'Salon', kind: 'room' }, dynamic: false, swatches: ['#fff1d6', '#ffe2b0'],
    lights: { 'tl-light-salon': { on: true, brightness: 100, colorTempMirek: 250 }, 'tl-light-lampadaire': { on: true, brightness: 90, colorTempMirek: 250 } } },
  { externalId: 'tl-scene-detente', name: 'Détente', group: { name: 'Salon', kind: 'room' }, dynamic: false, swatches: ['#ffb46b', '#ff9c4a'],
    lights: { 'tl-light-salon': { on: true, brightness: 35, colorTempMirek: warm }, 'tl-light-lampadaire': { on: true, brightness: 40, colorTempMirek: warm } } },
  { externalId: 'tl-scene-soiree', name: 'Soirée', group: { name: 'Salon', kind: 'room' }, dynamic: true, swatches: ['#ff7a3d', '#c2408f', '#5b3fd1'],
    lights: { 'tl-light-salon': { on: true, brightness: 55, color: { x: 0.52, y: 0.38 } }, 'tl-light-lampadaire': { on: true, brightness: 45, colorTempMirek: warm } } },
  { externalId: 'tl-scene-film', name: 'Film', group: { name: 'Home cinéma', kind: 'room' }, dynamic: false, swatches: ['#2d3fd6'],
    lights: { 'tl-light-cinema': { on: true, brightness: 10, color: { x: 0.17, y: 0.1 } } } },
  { externalId: 'tl-scene-entracte', name: 'Entracte', group: { name: 'Home cinéma', kind: 'room' }, dynamic: false, swatches: ['#ffc98a'],
    lights: { 'tl-light-cinema': { on: true, brightness: 60, colorTempMirek: warm } } },
  { externalId: 'tl-scene-veilleuse', name: 'Veilleuse', group: { name: 'Chambre 1', kind: 'room' }, dynamic: false, swatches: ['#ff8c3a'],
    lights: { 'tl-light-chambre1': { on: true, brightness: 5, color: { x: 0.58, y: 0.39 } } } },
  { externalId: 'tl-scene-reveil', name: 'Réveil', group: { name: 'Chambre 1', kind: 'room' }, dynamic: false, swatches: ['#e8f0ff'],
    lights: { 'tl-light-chambre1': { on: true, brightness: 100, colorTempMirek: cool } } },
  { externalId: 'tl-scene-ete', name: "Soirée d'été", group: { name: 'Extérieur', kind: 'zone' }, dynamic: true, swatches: ['#ffb347', '#3fb8c9', '#ffd77a'],
    lights: { 'tl-light-terrasse': { on: true, brightness: 70, colorTempMirek: warm }, 'tl-light-jardin': { on: true, brightness: 60 }, 'tl-light-piscine': { on: true, brightness: 80, color: { x: 0.16, y: 0.33 } } } },
]

/** Les Embruns: contemporary L-shaped single-story house, flat roof, by the sea. */
export function embrunsDevices(opts: { winter?: boolean } = {}): AnySimDevice[] {
  const w = !!opts.winter
  return [
    light('em-light-sejour', { name: 'Suspensions séjour', colorTemp: true, color: true, effects: ['candle', 'sparkle'], brightness: 75, powerW: 20 }),
    light('em-light-cuisine', { name: 'Spots cuisine', colorTemp: true, brightness: 90, powerW: 24 }),
    light('em-light-entree', { name: 'Plafonnier entrée', brightness: 70, powerW: 8 }),
    light('em-light-couloir', { name: 'Spots couloir', brightness: 50, powerW: 12 }),
    light('em-light-chambre2', { name: 'Plafonnier chambre 2', colorTemp: true, brightness: 60, powerW: 9 }),
    light('em-light-chambre3', { name: 'Lampe chambre 3', color: true, brightness: 50, powerW: 7 }),
    light('em-light-sdb', { name: 'Miroir salle de bain', colorTemp: true, brightness: 100, powerW: 10 }),
    light('em-light-terrasse', { name: 'Éclairage terrasse', colorTemp: true, brightness: 70, powerW: 18 }),
    light('em-light-piscine', { name: 'Projecteur piscine', color: true, brightness: 80, powerW: 30 }),
    ceilingFanLight('em-fan-chambre_light', { name: 'Plafonnier chambre parentale' }),
    ceilingFan('em-fan-chambre_fan', { name: 'Ventilateur chambre parentale', linkedLightId: 'mock:em-fan-chambre_light' }),

    // adjustable sunshades: slats that pivot, the `blind` kind
    cover('em-cover-baie1', { name: 'Brise-soleil baie ouest', deviceClass: 'blind', position: 100, tilt: true }),
    cover('em-cover-baie2', { name: 'Brise-soleil baie est', deviceClass: 'blind', position: 100, tilt: true }),
    cover('em-cover-chambre', { name: 'Brise-soleil chambre', deviceClass: 'blind', position: w ? 100 : 20, tilt: true }),
    cover('em-cover-chambre2', { name: 'Volet chambre 2', deviceClass: 'shutter', position: 100 }),
    cover('em-cover-chambre3', { name: 'Volet chambre 3', deviceClass: 'shutter', position: 100 }),
    cover('em-cover-voile', { name: "Voile d'ombrage", deviceClass: 'awning', position: w ? 100 : 30 }),
    cover('em-cover-portail', { name: 'Portail coulissant', deviceClass: 'gate', position: 0 }),

    mediaPlayer('em-media-sejour', { name: 'Enceinte séjour', volume: 30, playing: true }),
    mediaPlayer('em-media-tv', { name: 'TV séjour', deviceClass: 'tv', volume: 25 }),
    mediaPlayer('em-media-cuisine', { name: 'Écran cuisine', deviceClass: 'display', volume: 40 }),

    climate('em-climate', { name: 'Climatisation réversible', deviceClass: 'thermostat', mode: w ? 'heat' : 'auto', targetTempC: w ? 20 : 22, currentTempC: w ? 18.5 : 23 }),
    camera('em-cam-sonnette', { name: 'Sonnette', deviceClass: 'doorbell', rings: [10.25] }),
    camera('em-cam-portail', { name: 'Caméra portail', deviceClass: 'camera' }),

    vacuum('em-vacuum', { name: 'Robot aspirateur', startHour: 9 }),
    mower('em-mower', { name: 'Robot tondeuse', area: [-11, -20, 32, -15], dock: [-10, -15.5], schedule: w ? null : undefined, home: EMBRUNS }),

    sensors.indoorTemp('em-sensor-chambre', 'Température chambre parentale', w ? 18 : 23),
    sensors.outdoorTemp('em-sensor-ext', 'Température extérieure'),
    sensors.poolTemp('em-sensor-piscine', 'Température piscine'),
    weather('em-weather', { name: 'Météo' }),
    petFountain('em-pet-fountain', { name: 'Fontaine à eau' }),

    vehicle('em-vehicle', { name: 'Renault 5', manufacturer: 'Renault', model: 'Renault 5 E-Tech', batteryKwh: 52, rangeKmFull: 410, home: parked(EMBRUNS, 19.5, 6), work: EMBRUNS_WORK, soc: 72, chargeLimit: 90, socMin: 20,
      climate: { minC: 16, maxC: 26, stepC: 1, seats: ['fl', 'fr'], seatLevels: 1, steeringWheelHeat: true, heatWhileOff: true } }),
    evCharger('em-charger', { name: 'Borne du carport', vehicleId: 'em-vehicle' }),
    // two rows of five modules on a frame: a flat roof tilts them toward the sun
    ...Array.from({ length: 10 }, (_, i) => solarPanel(`em-panel-${String(i + 1).padStart(2, '0')}`, {
      name: `Panneau ${i + 1}`, factor: 0.97 + ((i * 3) % 5) * 0.01,
    })),
    energySite('em-energy', { name: 'Énergie', peakW: 4500 }),
  ]
}

export const EMBRUNS_SCENES: SimScene[] = [
  { externalId: 'em-scene-lumineux', name: 'Lumineux', group: { name: 'Séjour', kind: 'room' }, dynamic: false, swatches: ['#f4f7ff'],
    lights: { 'em-light-sejour': { on: true, brightness: 100, colorTempMirek: cool } } },
  { externalId: 'em-scene-cinema', name: 'Cinéma', group: { name: 'Séjour', kind: 'room' }, dynamic: false, swatches: ['#4a3fd1'],
    lights: { 'em-light-sejour': { on: true, brightness: 12, color: { x: 0.2, y: 0.12 } } } },
  { externalId: 'em-scene-aperitif', name: 'Apéritif', group: { name: 'Séjour', kind: 'room' }, dynamic: true, swatches: ['#ff9a3c', '#ff5e62', '#ffc371'],
    lights: { 'em-light-sejour': { on: true, brightness: 60, color: { x: 0.55, y: 0.4 } } } },
  { externalId: 'em-scene-nuit', name: "Nuit d'été", group: { name: 'Extérieur', kind: 'zone' }, dynamic: true, swatches: ['#2ec4d6', '#ffcf7a'],
    lights: { 'em-light-terrasse': { on: true, brightness: 50, colorTempMirek: warm }, 'em-light-piscine': { on: true, brightness: 90, color: { x: 0.15, y: 0.3 } } } },
]

/** Belvédère: upper-floor apartment, balcony, neither garden nor vehicle. */
export function belvedereDevices(opts: { winter?: boolean } = {}): AnySimDevice[] {
  const w = !!opts.winter
  return [
    light('ap-light-sejour', { name: 'Suspension séjour', colorTemp: true, color: true, effects: ['candle', 'fire'], on: w, brightness: 65, powerW: 12 }),
    light('ap-light-lampadaire', { name: 'Lampadaire', colorTemp: true, brightness: 50, powerW: 9 }),
    light('ap-light-cuisine', { name: 'Réglette cuisine', colorTemp: true, brightness: 90, powerW: 14 }),
    light('ap-light-entree', { name: 'Plafonnier entrée', brightness: 70, powerW: 7 }),
    light('ap-light-chambre1', { name: 'Lampe de chevet', colorTemp: true, brightness: 40, powerW: 6 }),
    light('ap-light-chambre2', { name: 'Veilleuse chambre 2', color: true, brightness: 20, powerW: 4 }),
    light('ap-light-sdb', { name: 'Plafonnier salle d\'eau', brightness: 100, powerW: 8 }),
    light('ap-light-balcon', { name: 'Guirlande balcon', color: true, effects: ['sparkle'], brightness: 60, powerW: 6 }),
    ceilingFanLight('ap-fan-chambre_light', { name: 'Plafonnier chambre 1' }),
    ceilingFan('ap-fan-chambre_fan', { name: 'Ventilateur chambre 1', linkedLightId: 'mock:ap-fan-chambre_light' }),

    cover('ap-cover-rideau', { name: 'Rideau séjour', deviceClass: 'curtain', position: 100 }),
    cover('ap-cover-sejour', { name: 'Volet séjour', deviceClass: 'shutter', position: 100, preset: 40 }),
    cover('ap-cover-chambre1', { name: 'Volet chambre 1', deviceClass: 'shutter', position: 100 }),
    cover('ap-cover-chambre2', { name: 'Volet chambre 2', deviceClass: 'shutter', position: w ? 0 : 100 }),

    mediaPlayer('ap-media-tv', { name: 'TV séjour', deviceClass: 'tv', volume: 20 }),
    mediaPlayer('ap-media-barre', { name: 'Barre de son', model: 'Soundbar', volume: 30 }),
    mediaPlayer('ap-media-cuisine', { name: 'Enceinte cuisine', volume: 35, playing: true }),
    mediaPlayer('ap-media-chambre', { name: 'Réveil chambre 1', volume: 15 }),

    climate('ap-climate', { name: 'Thermostat', deviceClass: 'thermostat', mode: w ? 'heat' : 'eco', targetTempC: w ? 20 : 19, currentTempC: w ? 19 : 21 }),
    camera('ap-cam-interphone', { name: 'Interphone', deviceClass: 'doorbell', rings: [18.5] }),
    camera('ap-cam-sejour', { name: 'Caméra séjour', deviceClass: 'camera' }),

    vacuum('ap-vacuum', { name: 'Robot aspirateur', startHour: 14, durationMin: 30 }),
    sensors.indoorTemp('ap-sensor-chambre2', 'Température chambre 2', w ? 19 : 21.5),
    sensors.outdoorTemp('ap-sensor-balcon', 'Température balcon'),
    weather('ap-weather', { name: 'Météo' }),
    petFeeder('ap-pet-feeder', { name: 'Distributeur de croquettes' }),
    petFountain('ap-pet-fountain', { name: 'Fontaine à eau' }),
  ]
}

export const BELVEDERE_SCENES: SimScene[] = [
  { externalId: 'ap-scene-cosy', name: 'Cosy', group: { name: 'Séjour', kind: 'room' }, dynamic: false, swatches: ['#ffb26b', '#ffd9a8'],
    lights: { 'ap-light-sejour': { on: true, brightness: 30, colorTempMirek: warm }, 'ap-light-lampadaire': { on: true, brightness: 45, colorTempMirek: warm } } },
  { externalId: 'ap-scene-diner', name: 'Dîner', group: { name: 'Séjour', kind: 'room' }, dynamic: false, swatches: ['#ffe7c2'],
    lights: { 'ap-light-sejour': { on: true, brightness: 80, colorTempMirek: neutral }, 'ap-light-lampadaire': { on: false } } },
  { externalId: 'ap-scene-fete', name: 'Fête', group: { name: 'Séjour', kind: 'room' }, dynamic: true, swatches: ['#ff3cac', '#784ba0', '#2b86c5'],
    lights: { 'ap-light-sejour': { on: true, brightness: 70, color: { x: 0.45, y: 0.2 } }, 'ap-light-lampadaire': { on: true, brightness: 60, colorTempMirek: warm } } },
  { externalId: 'ap-scene-veilleuse', name: 'Veilleuse', group: { name: 'Chambre 2', kind: 'room' }, dynamic: false, swatches: ['#ff9140'],
    lights: { 'ap-light-chambre2': { on: true, brightness: 8, color: { x: 0.57, y: 0.4 } } } },
  { externalId: 'ap-scene-guirlande', name: 'Guirlande', group: { name: 'Balcon', kind: 'room' }, dynamic: true, swatches: ['#ffd23f', '#ee4266', '#3bceac'],
    lights: { 'ap-light-balcon': { on: true, brightness: 70, color: { x: 0.5, y: 0.42 } } } },
]
