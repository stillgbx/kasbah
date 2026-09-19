import type { DeviceDescriptor, StateFor, StatePatch } from '@kasbah/shared'
import type { DiscoveredRobot } from './discovery'
import type { RobotShadow } from './mqtt'
import type { StoredRobot } from './types'

// Ombre MQTT d'un robot iRobot → contrat Kasbah. Fonctions PURES, testées sur l'ombre CAPTURÉE sur
// le Roomba Combo du parc (19/09/2026), jamais sur une documentation.
//
// Un robot = un appareil `vacuum`, identifié par son BLID (stable, sans `:` ni espace : c'est ce
// que `house.json` liera, et c'est déjà l'identifiant MQTT).
//
// CE QUE LA CAPTURE A APPRIS, et qu'on n'aurait pas deviné :
//   - l'ombre a 80 clés de premier niveau, dont une vingtaine de compteurs de vie (`bbrun`,
//     `bbmssn`, `bbchg`) — la phase 1 n'en publie aucune, le contrat `vacuum` n'a pas où les mettre ;
//   - la serpillière a TROIS champs distincts (`detectedPad`, `tankPresent`, `tankLvl`) et le robot
//     capturé annonçait `detectedPad: "invalid"` patin retiré — hors contrat en phase 1 ;
//   - `bin.type: "std"` existe à côté de `present` et `full` : seul `full` nous concerne.

export const PLUGIN_ID = 'irobot'

/** Ce qu'un Roomba sait faire, dans le vocabulaire du contrat. */
export const CAPABILITIES = ['clean', 'dock', 'battery', 'locate'] as const

export type VacuumActivity = StateFor<'vacuum'>['activity']

/** Section de l'ombre qui porte l'activité. Tout y est facultatif : le robot parle en deltas. */
export interface CleanMissionStatus {
  cycle?: string
  phase?: string
  error?: number
  notReady?: number
  initiator?: string
}

export function readMissionStatus(shadow: RobotShadow): CleanMissionStatus {
  const cms = shadow.cleanMissionStatus
  if (cms === null || typeof cms !== 'object' || Array.isArray(cms)) return {}
  const o = cms as Record<string, unknown>
  return {
    cycle: typeof o.cycle === 'string' ? o.cycle : undefined,
    phase: typeof o.phase === 'string' ? o.phase : undefined,
    error: typeof o.error === 'number' ? o.error : undefined,
    notReady: typeof o.notReady === 'number' ? o.notReady : undefined,
    initiator: typeof o.initiator === 'string' ? o.initiator : undefined,
  }
}

/**
 * L'activité tient à DEUX champs, jamais à un seul — c'est pourquoi l'ombre doit être accumulée
 * avant d'être mappée (`mergeShadow`) : un delta qui ne porte que `phase` ne suffit pas à décider.
 *
 * `phase` observé sur le vrai robot : `run` (nettoie), `stop` (arrêté), `charge` (sur la
 * base), `hmMidMsn` / `hmPostMsn` / `hmUsrDock` (retour), `evac` (vidange dans la base), `stuck`.
 * `cycle` : `none` au repos, `clean` / `spot` / `dock` / `evac` pendant une mission.
 */
export function toActivity(cms: CleanMissionStatus): VacuumActivity {
  if ((cms.error ?? 0) > 0) return 'error'
  switch (cms.phase) {
    case 'stuck': return 'error'
    case 'run': case 'new': return 'cleaning'
    case 'hmMidMsn': case 'hmPostMsn': case 'hmUsrDock': case 'dock': return 'returning'
    // `evac` = le robot est SUR sa base, en train de s'y vider : posé, donc, et non en mission
    case 'charge': case 'evac': return 'docked'
    case 'pause': return 'paused'
    case 'stop': return stoppedActivity(cms)
    default: return 'docked'
  }
}

/**
 * Le seul cas que l'ombre ne tranche pas d'elle-même. `phase: "stop"` veut dire « immobile », et
 * c'est `cycle` qui dit s'il reste une mission à reprendre :
 *
 *   - `cycle` autre que `none` → une mission est ouverte et suspendue : EN PAUSE. C'est l'état
 *     capturé le 19/09 (`cycle: "clean"`, `phase: "stop"`, `lastCommand: {command: "pause"}`).
 *   - `cycle: "none"` → aucune mission. Le robot est au repos, et le contrat `vacuum` n'a pas
 *     d'état « arrêté là où il est » (le `mower` l'a, pas lui) : `docked` est le repos par défaut
 *     du kind, c'est donc lui qu'on rend, faute de mieux à dire.
 */
function stoppedActivity(cms: CleanMissionStatus): VacuumActivity {
  return (cms.cycle ?? 'none') === 'none' ? 'docked' : 'paused'
}

function readNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** `bin.full` du robot réel : `{present, full, type}`. Seul `full` entre au contrat. */
function readBinFull(shadow: RobotShadow): boolean | undefined {
  const bin = shadow.bin
  if (bin === null || typeof bin !== 'object' || Array.isArray(bin)) return undefined
  const full = (bin as Record<string, unknown>).full
  return typeof full === 'boolean' ? full : undefined
}

/**
 * L'état publié à la maison. `battery` est BORNÉE : le contrat la veut en pour cent, et une ombre
 * incomplète (le robot n'a pas encore dit sa batterie) ne doit pas publier `undefined` dans un
 * champ obligatoire — d'où le patch partiel, que le registre sait fondre.
 */
export function toStatePatch(shadow: RobotShadow): StatePatch<'vacuum'> {
  const cms = readMissionStatus(shadow)
  const patch: StatePatch<'vacuum'> = { activity: toActivity(cms) }
  const bat = readNumber(shadow.batPct)
  if (bat !== undefined) patch.battery = Math.max(0, Math.min(100, Math.round(bat)))
  const binFull = readBinFull(shadow)
  if (binFull !== undefined) patch.binFull = binFull
  const code = cms.error ?? 0
  patch.errorMessage = code > 0 ? errorText(code) : null
  return patch
}

/**
 * Le descripteur. Le nom vient du robot lui-même (`name` dans l'ombre) ou, avant toute connexion,
 * de ce que le compte en disait — un robot éteint doit rester nommé dans l'inventaire.
 */
export function toDescriptor(robot: { blid: string; name?: string | null; sku?: string | null }, shadow?: RobotShadow): DeviceDescriptor {
  const fromShadow = typeof shadow?.name === 'string' ? shadow.name.trim() : ''
  const name = fromShadow || robot.name?.trim() || 'Roomba'
  const model = (typeof shadow?.sku === 'string' ? shadow.sku : robot.sku ?? undefined)?.trim() || undefined
  return {
    id: `${PLUGIN_ID}:${robot.blid}`,
    pluginId: PLUGIN_ID,
    externalId: robot.blid,
    kind: 'vacuum',
    name,
    capabilities: [...CAPABILITIES],
    meta: { manufacturer: 'iRobot', ...(model ? { model } : {}) },
  }
}

/** Ce que le compte sait d'un robot, complété par ce que le réseau en a trouvé. */
export function mergeRobotIdentity(stored: StoredRobot, found?: DiscoveredRobot): { blid: string; name: string | null; sku: string | null; ip: string | null } {
  return {
    blid: stored.blid,
    name: found?.name ?? stored.name,
    sku: found?.sku ?? stored.sku,
    ip: found?.ip ?? null,
  }
}

/**
 * Commandes du contrat → SUITE de verbes à publier sur le topic `cmd`. Une suite, et non un verbe,
 * pour deux raisons apprises sur le vrai robot :
 *
 *  1. `vacuum.start` n'a pas un seul verbe. Le robot distingue `start` (nouvelle mission) de
 *     `resume` (reprendre celle qui est en pause) ; le contrat n'a qu'un bouton, c'est donc
 *     l'ACTIVITÉ courante qui décide. VÉRIFIÉ sur Robby : le robot a répondu `lastCommand:
 *     {command: "resume", initiator: "localApp"}` et est reparti.
 *
 *  2. **`dock` est IGNORÉ pendant le nettoyage.** Mesuré le 19/09 à 14:58 : le robot a bien
 *     enregistré `lastCommand: {command: "dock"}` et n'a rien fait — deux minutes et demie plus
 *     tard il était toujours en `phase: "run"`. Aucune erreur, aucun refus : le message est accepté
 *     et sans effet. Il faut l'arrêter d'abord — `pause` puis `dock` le ramène (vérifié : paused à
 *     15:03:10, returning à 15:03:18, docked à 15:04:08). C'est ce que fait l'appli du fabricant,
 *     et c'est pourquoi rendre ici un simple `['dock']` donnerait un bouton qui ment.
 */
export function toRobotCommands(type: string, activity: VacuumActivity): string[] | null {
  switch (type) {
    case 'vacuum.start': return [activity === 'paused' ? 'resume' : 'start']
    case 'vacuum.pause': return ['pause']
    case 'vacuum.dock': return activity === 'cleaning' ? ['pause', 'dock'] : ['dock']
    case 'vacuum.locate': return ['find']
    default: return null
  }
}

/**
 * Textes d'erreur du fabricant. Table PARTIELLE et non vérifiée sur ce robot : elle reprend les
 * codes que les implémentations tierces corroborent, et tout code inconnu ressort en `Error N`
 * plutôt qu'en libellé inventé. Même parti pris que la table Husqvarna — sauf que le contrat
 * `vacuum` n'a pas de champ `errorCode`, donc le numéro n'apparaît que dans ce texte de repli.
 * À compléter au fur et à mesure que le vrai robot produit des codes (route `/raw`).
 */
export const ERROR_TEXT: Record<number, string> = {
  1: 'Left wheel off floor', 2: 'Main brushes stuck', 3: 'Right wheel off floor',
  4: 'Left wheel stuck', 5: 'Right wheel stuck', 6: 'Stuck near a cliff',
  7: 'Left wheel error', 8: 'Brush stuck', 9: 'Stuck on a cliff',
  10: 'Left wheel stuck', 11: 'Internal error', 12: 'Cliff sensor error',
  13: 'Both wheels off floor', 14: 'Bin missing', 15: 'Reboot required',
  16: 'Bumped unexpectedly', 17: 'Path blocked', 18: 'Docking issue',
  19: 'Undocking issue', 20: 'Docking issue', 21: 'Navigation problem',
  23: 'Battery issue', 26: 'Vacuum problem', 29: 'Software update needed',
  36: 'Bin full', 38: 'Internal communication error', 46: 'Low battery',
}

export function errorText(code: number): string { return ERROR_TEXT[code] ?? `Error ${code}` }
