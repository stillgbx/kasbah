import type { RobotShadow } from '../mqtt'

// Ombres d'un Roomba Combo RÉEL (`sku c755840`, firmware `stingray+24.29.5`), capturées le
// 19/09/2026 sur le courtier local du robot, puis jouées en le pilotant depuis l'appli du fabricant.
//
// CE QUI EST GARDÉ ET CE QUI NE L'EST PAS. Le robot publie 80 clés de premier niveau ; celles qui
// portent son réseau (`netinfo` : adresse, passerelle, BSSID ; `wlcfg` : SSID) et son matériel
// (`hwPartsRev` : adresse MAC et numéros de série, `batInfo`, `secureBoot`) sont écartées — pas
// parce qu'elles gênent le test, mais parce qu'une fixture est un fichier versionné. Le reste est
// la valeur réelle, bizarreries comprises : `detectedPad: "invalid"` (patin retiré), `tankLvl: 10`,
// `bin.type: "std"`, `dock.state: 300`.
//
// LES QUATRE ÉTATS viennent d'une séquence réellement jouée, horodatée dans le journal de session :
//   14:26:43  cycle=clean  phase=stop       mission en pause depuis 18 min      → PAUSED
//   14:28:59  cycle=clean  phase=hmUsrDock  « rentre », demandé par l'appli     → RETURNING
//   14:30:33  cycle=clean  phase=charge     ARRIVÉ, mission encore ouverte      → DOCKED_MISSION_OPEN
//   14:30:37  cycle=none   phase=charge     mission refermée, 4 s plus tard     → DOCKED
//   14:34:04  cycle=clean  phase=run        reparti                             → CLEANING
//
// Ces quatre secondes entre `phase=charge` et `cycle=none` sont la raison d'être de
// `DOCKED_MISSION_OPEN` : un mappage qui lirait `cycle` avant `phase` y publierait « en pause » sur
// un robot posé sur sa base.

/** Le tronc commun : ce que le robot dit de lui quoi qu'il fasse. */
const BASE: RobotShadow = {
  name: 'Robby',
  sku: 'c755840',
  softwareVer: 'stingray+24.29.5+2024-11-22-e0a36542cf4+Firmware-Production+246',
  connected: true,
  batPct: 100,
  bin: { present: true, full: false, type: 'std' },
  binPause: true,
  // la serpillière du Combo : trois champs, aucun encore au contrat en phase 1
  tankLvl: 10,
  tankPresent: true,
  detectedPad: 'invalid',
  padWetness: { reusable: 2 },
  evacAllowed: true,
  schedHold: false,
  dock: { known: true, state: 300, cap: { evac: 1, fr: 0, pw: 0, pd: 0 } },
  signal: { rssi: -41, snr: 55, noise: -96 },
}

const mission = (over: Record<string, unknown>): RobotShadow['cleanMissionStatus'] => ({
  cycle: 'none', phase: 'charge', expireM: 0, rechrgM: 0, error: 0, notReady: 0,
  mssnM: 0, operatingMode: 0, initiator: 'manual', nMssn: 100, ...over,
})

/** 14:26 — mission ouverte mais robot immobile : EN PAUSE. `lastCommand` le confirme. */
export const PAUSED: RobotShadow = {
  ...BASE,
  cleanMissionStatus: mission({ cycle: 'clean', phase: 'stop', mssnStrtTm: 1789819897, expireTm: 1789825305 }),
  lastCommand: { command: 'pause', initiator: 'manual', time: 1789819961 },
}

/** 14:28 — retour demandé depuis l'appli du fabricant (`initiator: "rmtApp"`). */
export const RETURNING: RobotShadow = {
  ...BASE,
  cleanMissionStatus: mission({ cycle: 'clean', phase: 'hmUsrDock', operatingMode: 1 }),
  lastCommand: { command: 'dock', initiator: 'rmtApp', time: 1789820941 },
}

/** 14:30:33 — POSÉ sur sa base, mais la mission n'est pas encore refermée. Le cas piégeux. */
export const DOCKED_MISSION_OPEN: RobotShadow = {
  ...BASE,
  cleanMissionStatus: mission({ cycle: 'clean', phase: 'charge' }),
}

/** 14:30:37 — mission refermée : au repos sur sa base. */
export const DOCKED: RobotShadow = {
  ...BASE,
  cleanMissionStatus: mission({ cycle: 'none', phase: 'charge' }),
}

/** 14:34 — reparti nettoyer, lancé depuis l'appli. */
export const CLEANING: RobotShadow = {
  ...BASE,
  cleanMissionStatus: mission({ cycle: 'clean', phase: 'run', initiator: 'rmtApp' }),
  lastCommand: { command: 'start', initiator: 'rmtApp', time: 1789821244 },
}

/**
 * Bac plein : la seule alarme que le contrat `vacuum` sait porter aujourd'hui.
 *
 * CONSTRUITE, non capturée — le bac du robot réel était vide pendant toute la séance. Le champ,
 * lui, est bien celui que le robot publie (`bin.full`, vu à `false`) : seule sa valeur est posée
 * à la main. À remplacer par une vraie capture le jour où le bac se remplit.
 */
export const BIN_FULL: RobotShadow = {
  ...DOCKED,
  bin: { present: true, full: true, type: 'std' },
}

/**
 * Robot en défaut.
 *
 * CONSTRUITE, non capturée — le robot n'est tombé en panne à aucun moment de la séance, et on n'a
 * pas voulu l'y mettre. C'est donc la fixture la moins sûre du lot : le code 17 et l'appariement
 * `error` non nul ↔ `phase: "stuck"` viennent de ce que les implémentations tierces rapportent,
 * pas de ce robot. À remplacer par un relevé de `/raw` au premier vrai incident.
 */
export const STUCK: RobotShadow = {
  ...BASE,
  cleanMissionStatus: mission({ cycle: 'clean', phase: 'stuck', error: 17 }),
}
