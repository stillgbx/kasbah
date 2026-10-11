import type { Command, CommandInput } from '../devices/command'

// « Pendant N minutes » : la commande qui défait celle d'une action, au bout du délai. Seulement
// les inverses ÉVIDENTS (ouvrir ↔ fermer, allumer ↔ éteindre…) : une position, une luminosité, un
// volume ou une consigne n'ont pas d'inverse sans relever la valeur d'avant, qu'on ne fait pas.

/** La commande ne fait QUE basculer `on` (pas de luminosité, de vitesse, de couleur…). */
const onlyOn = (cmd: { on?: boolean }): cmd is { on: boolean } =>
  typeof cmd.on === 'boolean' && Object.keys(cmd).every((k) => k === 'type' || k === 'on')

export function inverseCommand(cmd: CommandInput): Command | undefined {
  switch (cmd.type) {
    case 'light.set': return onlyOn(cmd) ? { type: 'light.set', on: !cmd.on } : undefined
    case 'fan.set': return onlyOn(cmd) ? { type: 'fan.set', on: !cmd.on } : undefined
    case 'pet_fountain.set_power': return { type: 'pet_fountain.set_power', on: !cmd.on }
    case 'cover.open': return { type: 'cover.close' }
    case 'cover.close': return { type: 'cover.open' }
    case 'media_player.play': return { type: 'media_player.stop' }
    case 'media_player.play_url': return { type: 'media_player.stop' }
    case 'vacuum.start': return { type: 'vacuum.dock' }
    case 'mower.start': return { type: 'mower.park', untilNextSchedule: true }
    case 'vehicle.lock': return { type: 'vehicle.unlock' }
    case 'vehicle.unlock': return { type: 'vehicle.lock' }
    case 'vehicle.start_charge': return { type: 'vehicle.stop_charge' }
    case 'vehicle.stop_charge': return { type: 'vehicle.start_charge' }
    case 'vehicle.climate_start': return { type: 'vehicle.climate_stop' }
    case 'ev_charger.start': return { type: 'ev_charger.stop' }
    case 'ev_charger.stop': return { type: 'ev_charger.start' }
    default: return undefined
  }
}
