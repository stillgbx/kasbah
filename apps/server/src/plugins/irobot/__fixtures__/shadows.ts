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
//   14:26:43  cycle=clean  phase=stop       en pause depuis 14 min (cf. epochs)  → PAUSED
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
  // `scrub: 1` = ce robot LAVE (c'est un Combo) ; `pw: 0` = il ne rend plus son mot de passe local
  cap: { scrub: 1, pw: 0, pmaps: 9, maps: 3 },
  signal: { rssi: -41, snr: 55, noise: -96 },
}

const mission = (over: Record<string, unknown>): RobotShadow['cleanMissionStatus'] => ({
  cycle: 'none', phase: 'charge', expireM: 0, rechrgM: 0, error: 0, notReady: 0,
  mssnM: 0, operatingMode: 0, initiator: 'manual', nMssn: 100, ...over,
})

/**
 * 14:26:43 — mission ouverte mais robot immobile : EN PAUSE. `lastCommand` le confirme.
 *
 * Les epochs sont ceux de la capture et ne valent pas l'heure de celle-ci : la mission a démarré à
 * 14:11:37 (`mssnStrtTm`) et la pause a été demandée à 14:12:41 (`lastCommand.time`) — c'est donc un
 * robot arrêté depuis quatorze minutes qu'on a relevé.
 */
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

/**
 * Patin de serpillière POSÉ, relevé le 19/09 à 16:02 : `detectedPad` passe de `"invalid"` à
 * `"reusableWet"` dans la seconde qui suit la pose. Ce sont les deux seules valeurs observées sur ce
 * robot ; d'autres existent sûrement (patin sec, patin jetable), d'où la règle de lecture « tout ce
 * qui n'est pas `invalid` est un patin », plutôt qu'une liste blanche devinée.
 *
 * Le réservoir, lui, est resté à 10 — et l'appli du fabricant affichait au même moment sa goutte
 * quasi vide avec « Remplissez le réservoir de Robby » : c'est ce qui établit que `tankLvl` est un
 * POUR CENT et non une échelle maison.
 */
export const MOP_ATTACHED: RobotShadow = {
  ...DOCKED,
  detectedPad: 'reusableWet',
  tankLvl: 10,
  tankPresent: true,
}

/** Réservoir retiré : le niveau qui traîne dans l'ombre ne veut plus rien dire. CONSTRUITE. */
export const TANK_REMOVED: RobotShadow = {
  ...MOP_ATTACHED,
  tankPresent: false,
}
