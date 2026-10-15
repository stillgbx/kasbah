import { z } from 'zod'
import { CLIMATE_MODES, FAN_DIRECTIONS, PET_PUMP_MODES, SETTABLE_CHARGE_MODES, type Capability, type DeviceKind } from './kinds'
import { xySchema } from './state'

// Commandes nommées `<kind>.<verbe>` : le préfixe donne le kind gratuitement et
// `COMMAND_REQUIRES` permet au serveur de refuser une commande non supportée par l'appareil.

const pct = z.number().min(0).max(100)
const seatLevel = z.number().int().min(0).max(3)

export const commandSchema = z.discriminatedUnion('type', [
  // light — une seule commande fusionnée (miroir du PUT Hue, évite 4 allers-retours par mouvement de picker)
  z.object({
    type: z.literal('light.set'),
    on: z.boolean().optional(),
    brightness: pct.optional(),
    colorTempMirek: z.number().optional(),
    color: xySchema.optional(),
    /** Nom d'effet pris dans `meta.effects` ; `no_effect` l'arrête. */
    effect: z.string().optional(),
    transitionMs: z.number().int().min(0).optional(),
  }),
  // cover
  z.object({ type: z.literal('cover.open') }),
  z.object({ type: z.literal('cover.close') }),
  z.object({ type: z.literal('cover.stop') }),
  z.object({ type: z.literal('cover.set_position'), position: pct }),
  z.object({ type: z.literal('cover.set_tilt'), tilt: pct }),
  // rappel de la position favorite du moteur : aucun paramètre, la valeur vit dans l'appareil
  z.object({ type: z.literal('cover.preset') }),
  // réécriture de cette mémoire : la position à graver est explicite, pas déduite de l'appareil,
  // pour que l'appelant grave ce qu'il MONTRE et non ce qu'un moteur en cours de course renvoie
  z.object({ type: z.literal('cover.set_preset'), position: pct }),
  // mode discret : un interrupteur tenu par le plugin, appliqué aux courses suivantes — il ne bouge rien
  z.object({ type: z.literal('cover.set_quiet'), on: z.boolean() }),
  // media_player
  z.object({ type: z.literal('media_player.play') }),
  z.object({ type: z.literal('media_player.pause') }),
  /** Arrêter ce qui occupe le lecteur : fermer l'appli à l'écran (Cast : `STOP` de la session), pas seulement suspendre. */
  z.object({ type: z.literal('media_player.stop') }),
  z.object({ type: z.literal('media_player.next') }),
  z.object({ type: z.literal('media_player.previous') }),
  z.object({ type: z.literal('media_player.set_volume'), volume: pct }),
  z.object({ type: z.literal('media_player.set_mute'), muted: z.boolean() }),
  /** Se placer dans le morceau (capacité `seek`) ; sans effet sur un direct, qui n'a pas de durée. */
  z.object({ type: z.literal('media_player.seek'), positionS: z.number().min(0) }),
  /** Charger et lire un flux HTTP(S) (capacité `play_url`) : MP3, AAC, HLS… pas une page web. */
  z.object({
    type: z.literal('media_player.play_url'),
    url: z.string().url().max(2048).refine((u) => /^https?:\/\//i.test(u), 'http or https only'),
    /** Titre affiché (DIDL Sonos / métadonnées Cast) ; sinon le hostname de l'URL. */
    title: z.string().trim().min(1).max(512).optional(),
    /** Artiste / sous-titre optionnel. */
    artist: z.string().trim().min(1).max(512).optional(),
    /** Pochette absolue HTTP(S) que l'enceinte peut télécharger (ex. `i.ytimg.com`). */
    artUrl: z.string().url().max(2048).refine((u) => /^https?:\/\//i.test(u), 'http or https only').optional(),
    /**
     * Le catalogue marque ce titre EXPLICIT. Aucune enceinte ne le publie : c'est le service qui
     * lance la lecture qui le sait, et il le dit ici pour que l'état le porte ensuite partout où le
     * morceau s'affiche.
     */
    explicit: z.boolean().optional(),
    /**
     * Le service sait que c'est un DIRECT (une radio) : l'URL ne le dit pas toujours — un Icecast
     * `.aac` ressemble à un fichier. L'enceinte le publie ensuite en `nowPlaying.live`.
     */
    live: z.boolean().optional(),
  }),
  // climate
  z.object({ type: z.literal('climate.set_mode'), mode: z.enum(CLIMATE_MODES) }),
  z.object({ type: z.literal('climate.set_target_temp'), targetTempC: z.number() }),
  // vacuum
  z.object({ type: z.literal('vacuum.start') }),
  z.object({ type: z.literal('vacuum.pause') }),
  z.object({ type: z.literal('vacuum.dock') }),
  z.object({ type: z.literal('vacuum.locate') }),
  // mower
  z.object({ type: z.literal('mower.start'), durationMin: z.number().int().positive().optional() }),
  z.object({ type: z.literal('mower.pause') }),
  z.object({ type: z.literal('mower.park'), untilNextSchedule: z.boolean().default(true) }),
  /** Tondre UNE zone de travail, pendant ce temps (Husqvarna exige la durée), puis rentrer. */
  z.object({ type: z.literal('mower.start_in_area'), workAreaId: z.number().int().min(0), durationMin: z.number().int().positive() }),
  z.object({ type: z.literal('mower.set_stay_out_zone'), zoneId: z.string().min(1), enabled: z.boolean() }),
  // lève l'erreur en cours, quand le fabricant la dit confirmable (`errorConfirmable`)
  z.object({ type: z.literal('mower.confirm_error') }),
  // ev_charger
  z.object({ type: z.literal('ev_charger.start') }),
  z.object({ type: z.literal('ev_charger.stop') }),
  z.object({ type: z.literal('ev_charger.set_current'), amps: z.number().positive() }),
  /**
   * Fin d'un forçage : la borne reprend le mode choisi dans l'appli du fabricant (charge verte,
   * programmée…), au lieu d'obéir au dernier démarrer / arrêter. Rien si elle y est déjà revenue.
   */
  z.object({ type: z.literal('ev_charger.resume_mode') }),
  /**
   * Choisir le mode de la borne. Le même mode alors qu'une annulation manuelle tient revient à
   * `resume_mode` ; le même mode sans annulation ne fait rien.
   */
  z.object({ type: z.literal('ev_charger.set_mode'), mode: z.enum(SETTABLE_CHARGE_MODES) }),
  // vehicle
  z.object({ type: z.literal('vehicle.lock') }),
  z.object({ type: z.literal('vehicle.unlock') }),
  z.object({ type: z.literal('vehicle.start_charge') }),
  z.object({ type: z.literal('vehicle.stop_charge') }),
  z.object({ type: z.literal('vehicle.set_charge_limit'), percent: pct }),
  z.object({ type: z.literal('vehicle.wake') }),
  /**
   * Préconditionner l'habitacle (chauffer ou rafraîchir avant de partir). `targetTempC` absent = la
   * consigne que la voiture garde déjà ; bornes = celles de Tesla (`min/max_avail_temp`, 15-28 °C).
   * Le plugin RÉVEILLE la voiture s'il le faut : c'est le but même de la commande, un matin où elle dort.
   * Batterie trop faible (Tesla : sous 20 %), le plugin refuse en `LOW_BATTERY` : l'appli Tesla sait
   * forcer, l'API REST non (choix de l'utilisateur du 2026-10-01 : ne pas chercher de détour).
   */
  z.object({ type: z.literal('vehicle.climate_start'), targetTempC: z.number().min(15).max(28).optional() }),
  z.object({ type: z.literal('vehicle.climate_stop') }),
  /**
   * Régler sans mettre en marche : consigne, crans des sièges (0-3), volant. Ne RÉVEILLE jamais la
   * voiture, à l'inverse de `climate_start`. Champ absent = pas touché.
   */
  z.object({
    type: z.literal('vehicle.climate_set'),
    targetTempC: z.number().min(15).max(28).optional(),
    seatHeat: z.object({
      fl: seatLevel.optional(), fr: seatLevel.optional(), rl: seatLevel.optional(), rc: seatLevel.optional(), rr: seatLevel.optional(),
    }).optional(),
    steeringWheelHeat: z.boolean().optional(),
  }),
  /** Relire le véhicule MAINTENANT (lecture facturée) ; le sondage repart de ce moment. */
  z.object({ type: z.literal('vehicle.refresh') }),
  /**
   * Installer la mise à jour logicielle DÉJÀ TÉLÉCHARGÉE (`softwareUpdate.status` `available` ou
   * `scheduled`), dans `delayS` secondes — 0 = maintenant. Reprogrammer déplace l'heure. La voiture
   * est inutilisable pendant l'installation (Tesla : une vingtaine de minutes) : un geste confirmé.
   */
  z.object({ type: z.literal('vehicle.schedule_update'), delayS: z.number().int().min(0).max(86_400) }),
  /** Annuler une installation programmée ; la mise à jour reste disponible. */
  z.object({ type: z.literal('vehicle.cancel_update') }),
  // pet_feeder
  /**
   * Servir une ration TOUT DE SUITE, en plus du plan de repas (qui n'est pas touché). `amount` est
   * dans l'unité que l'appareil déclare (`meta.petFeeder.unit`) : des TASSES sur une Fresh Element
   * Solo, des grammes ailleurs. La ration n'est pas libre non plus — chaque modèle n'accepte qu'une
   * liste de valeurs (`meta.petFeeder.portions`), et le serveur refuse ce qui n'y est pas plutôt
   * que de laisser le fabricant l'arrondir en silence.
   */
  z.object({ type: z.literal('pet_feeder.feed'), amount: z.number().positive().max(1000) }),
  /** Jouer le son enregistré pour appeler l'animal. Aucun état ne change. */
  z.object({ type: z.literal('pet_feeder.call_pet') }),
  // pet_fountain
  z.object({ type: z.literal('pet_fountain.set_power'), on: z.boolean() }),
  z.object({ type: z.literal('pet_fountain.set_mode'), mode: z.enum(PET_PUMP_MODES) }),
  // fan — une seule commande fusionnée, comme `light.set` (pas quatre verbes)
  z.object({
    type: z.literal('fan.set'),
    on: z.boolean().optional(),
    speed: z.number().int().positive().optional(),
    direction: z.enum(FAN_DIRECTIONS).optional(),
    timerMin: z.number().int().min(0).optional(),
    muted: z.boolean().optional(),
  }),
])
export type Command = z.infer<typeof commandSchema>
export type CommandInput = z.input<typeof commandSchema>
export type CommandType = Command['type']
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>

/** Capacité requise pour accepter chaque commande. */
export const COMMAND_REQUIRES: Record<CommandType, Capability> = {
  'light.set': 'on_off',
  'cover.open': 'open_close', 'cover.close': 'open_close', 'cover.stop': 'stop',
  'cover.set_position': 'position', 'cover.set_tilt': 'tilt', 'cover.preset': 'preset',
  'cover.set_preset': 'preset_set', 'cover.set_quiet': 'quiet',
  'media_player.play': 'playback', 'media_player.pause': 'playback', 'media_player.stop': 'playback',
  'media_player.next': 'track_skip', 'media_player.previous': 'track_skip',
  'media_player.set_volume': 'volume', 'media_player.set_mute': 'mute', 'media_player.seek': 'seek',
  'media_player.play_url': 'play_url',
  'climate.set_mode': 'hvac_mode', 'climate.set_target_temp': 'target_temp',
  'vacuum.start': 'clean', 'vacuum.pause': 'clean', 'vacuum.dock': 'dock', 'vacuum.locate': 'locate',
  'mower.start': 'mow', 'mower.pause': 'mow', 'mower.park': 'park',
  'mower.start_in_area': 'work_areas', 'mower.set_stay_out_zone': 'stay_out_zones', 'mower.confirm_error': 'confirm_error',
  'ev_charger.start': 'charge_control', 'ev_charger.stop': 'charge_control', 'ev_charger.set_current': 'charge_current',
  'ev_charger.resume_mode': 'charge_control', 'ev_charger.set_mode': 'charge_mode',
  'vehicle.lock': 'lock', 'vehicle.unlock': 'lock',
  'vehicle.start_charge': 'charging', 'vehicle.stop_charge': 'charging',
  'vehicle.set_charge_limit': 'charge_limit', 'vehicle.wake': 'soc', 'vehicle.refresh': 'soc',
  'vehicle.climate_start': 'climate_precondition', 'vehicle.climate_stop': 'climate_precondition', 'vehicle.climate_set': 'climate_precondition',
  'vehicle.schedule_update': 'software_update', 'vehicle.cancel_update': 'software_update',
  'pet_feeder.feed': 'feed', 'pet_feeder.call_pet': 'call_pet',
  'pet_fountain.set_power': 'on_off', 'pet_fountain.set_mode': 'pump_mode',
  'fan.set': 'on_off',
}

export function commandKind(cmd: Command | CommandType): DeviceKind {
  const type = typeof cmd === 'string' ? cmd : cmd.type
  return type.slice(0, type.indexOf('.')) as DeviceKind
}
