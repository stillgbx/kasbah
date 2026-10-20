import type { Command, DeviceEntry } from '@kasbah/shared'

// Late bridge to the registry / host, for music SOURCES (YouTube Music, radios…): they have no
// devices, nor `PluginContext.execute` towards another vendor's players. `app.ts` wires it after
// `PluginHost`; tests inject directly through deps.

export interface PlaybackBridge {
  getDevice(deviceId: string): DeviceEntry | undefined
  /** Command to another plugin's player: `play_url`, `pause` of the stream being replaced, `stop` of a transfer's source. */
  execute(deviceId: string, command: Command): Promise<void>
  /** Every state a player publishes: the queue sees the end of a track there. Returns an unsubscribe. */
  onState(cb: (deviceId: string, state: unknown) => void): () => void
}

let bridge: PlaybackBridge | null = null

export function setPlaybackBridge(next: PlaybackBridge | null): void {
  bridge = next
}

export function getPlaybackBridge(): PlaybackBridge | null {
  return bridge
}
