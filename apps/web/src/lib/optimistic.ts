import type { CommandInput, DeviceState } from '@kasbah/shared'

/**
 * Effet attendu d'une commande sur l'état courant, appliqué AVANT la réponse serveur pour que
 * l'interface réagisse au doigt. Retourne null quand rien n'est prévisible.
 */
export function optimisticPatch(state: DeviceState, cmd: CommandInput): Partial<DeviceState> | null {
  switch (state.kind) {
    case 'light':
      if (cmd.type !== 'light.set') return null
      return {
        ...(cmd.on !== undefined ? { on: cmd.on } : {}),
        ...(cmd.brightness !== undefined ? (cmd.brightness === 0 ? { on: false } : { on: true, brightness: cmd.brightness }) : {}),
        ...(cmd.colorTempMirek !== undefined ? { colorTempMirek: cmd.colorTempMirek } : {}),
        ...(cmd.color !== undefined ? { color: cmd.color } : {}),
      } as Partial<DeviceState>
    case 'cover':
      switch (cmd.type) {
        case 'cover.open': return { motion: state.position >= 100 ? 'stopped' : 'opening' } as Partial<DeviceState>
        case 'cover.close': return { motion: state.position <= 0 ? 'stopped' : 'closing' } as Partial<DeviceState>
        case 'cover.stop': return { motion: 'stopped' } as Partial<DeviceState>
        case 'cover.set_position': return { motion: cmd.position > state.position ? 'opening' : cmd.position < state.position ? 'closing' : 'stopped' } as Partial<DeviceState>
        case 'cover.set_tilt': return { tilt: cmd.tilt } as Partial<DeviceState>
        default: return null
      }
    case 'media_player':
      switch (cmd.type) {
        case 'media_player.play': return { playback: 'playing' } as Partial<DeviceState>
        case 'media_player.pause': return { playback: 'paused' } as Partial<DeviceState>
        case 'media_player.set_volume': return { volume: cmd.volume } as Partial<DeviceState>
        case 'media_player.set_mute': return { muted: cmd.muted } as Partial<DeviceState>
        default: return null
      }
    case 'climate':
      if (cmd.type === 'climate.set_mode') return { mode: cmd.mode } as Partial<DeviceState>
      if (cmd.type === 'climate.set_target_temp') return { targetTempC: cmd.targetTempC } as Partial<DeviceState>
      return null
    case 'vacuum':
      switch (cmd.type) {
        case 'vacuum.start': return { activity: 'cleaning' } as Partial<DeviceState>
        case 'vacuum.pause': return { activity: 'paused' } as Partial<DeviceState>
        case 'vacuum.dock': return { activity: 'returning' } as Partial<DeviceState>
        default: return null
      }
    case 'mower':
      switch (cmd.type) {
        case 'mower.start': return { activity: 'mowing' } as Partial<DeviceState>
        case 'mower.pause': return { activity: 'paused' } as Partial<DeviceState>
        case 'mower.park': return { activity: state.activity === 'mowing' || state.activity === 'paused' ? 'returning' : state.activity } as Partial<DeviceState>
        default: return null
      }
    case 'ev_charger':
      if (cmd.type === 'ev_charger.stop') return { status: state.status === 'charging' ? 'connected' : state.status, powerW: 0 } as Partial<DeviceState>
      if (cmd.type === 'ev_charger.set_current') return { maxCurrentA: cmd.amps } as Partial<DeviceState>
      return null
    case 'vehicle':
      switch (cmd.type) {
        case 'vehicle.lock': return { locked: true } as Partial<DeviceState>
        case 'vehicle.unlock': return { locked: false } as Partial<DeviceState>
        case 'vehicle.set_charge_limit': return { chargeLimit: cmd.percent } as Partial<DeviceState>
        case 'vehicle.stop_charge': return { charging: false } as Partial<DeviceState>
        default: return null
      }
    default:
      return null
  }
}
