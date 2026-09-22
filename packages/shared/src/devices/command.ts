import { z } from 'zod'
import { CLIMATE_MODES, FAN_DIRECTIONS, PET_PUMP_MODES, type Capability, type DeviceKind } from './kinds'
import { xySchema } from './state'

// Commandes nommées `<kind>.<verbe>` : le préfixe donne le kind gratuitement et
// `COMMAND_REQUIRES` permet au serveur de refuser une commande non supportée par l'appareil.

const pct = z.number().min(0).max(100)

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
  // ev_charger
  z.object({ type: z.literal('ev_charger.start') }),
  z.object({ type: z.literal('ev_charger.stop') }),
  z.object({ type: z.literal('ev_charger.set_current'), amps: z.number().positive() }),
  // vehicle
  z.object({ type: z.literal('vehicle.lock') }),
  z.object({ type: z.literal('vehicle.unlock') }),
  z.object({ type: z.literal('vehicle.start_charge') }),
  z.object({ type: z.literal('vehicle.stop_charge') }),
  z.object({ type: z.literal('vehicle.set_charge_limit'), percent: pct }),
  z.object({ type: z.literal('vehicle.wake') }),
  /** Relire le véhicule MAINTENANT (lecture facturée) ; le sondage repart de ce moment. */
  z.object({ type: z.literal('vehicle.refresh') }),
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
  'cover.set_preset': 'preset_set',
  'media_player.play': 'playback', 'media_player.pause': 'playback', 'media_player.stop': 'playback',
  'media_player.next': 'track_skip', 'media_player.previous': 'track_skip',
  'media_player.set_volume': 'volume', 'media_player.set_mute': 'mute', 'media_player.seek': 'seek',
  'media_player.play_url': 'play_url',
  'climate.set_mode': 'hvac_mode', 'climate.set_target_temp': 'target_temp',
  'vacuum.start': 'clean', 'vacuum.pause': 'clean', 'vacuum.dock': 'dock', 'vacuum.locate': 'locate',
  'mower.start': 'mow', 'mower.pause': 'mow', 'mower.park': 'park',
  'ev_charger.start': 'charge_control', 'ev_charger.stop': 'charge_control', 'ev_charger.set_current': 'charge_current',
  'vehicle.lock': 'lock', 'vehicle.unlock': 'lock',
  'vehicle.start_charge': 'charging', 'vehicle.stop_charge': 'charging',
  'vehicle.set_charge_limit': 'charge_limit', 'vehicle.wake': 'soc', 'vehicle.refresh': 'soc',
  'pet_feeder.feed': 'feed', 'pet_feeder.call_pet': 'call_pet',
  'pet_fountain.set_power': 'on_off', 'pet_fountain.set_mode': 'pump_mode',
  'fan.set': 'on_off',
}

export function commandKind(cmd: Command | CommandType): DeviceKind {
  const type = typeof cmd === 'string' ? cmd : cmd.type
  return type.slice(0, type.indexOf('.')) as DeviceKind
}
