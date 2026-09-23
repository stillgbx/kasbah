import type { Command, DeviceEntry } from '@kasbah/shared'

// Pont tardif vers le registre / l'hôte, pour les SOURCES musicales (YouTube Music, radios…) : elles
// n'ont pas d'appareils, ni `PluginContext.execute` vers les lecteurs d'un autre fabricant. `app.ts`
// branche après `PluginHost` ; les tests injectent directement via deps.

export interface PlaybackBridge {
  getDevice(deviceId: string): DeviceEntry | undefined
  /** Commande à un lecteur d'un autre plugin : `play_url`, `pause` du flux qu'on remplace, `stop` de la source d'un transfert. */
  execute(deviceId: string, command: Command): Promise<void>
  /** Chaque état publié par un lecteur : la file y voit la fin d'un titre. Rend de quoi se désabonner. */
  onState(cb: (deviceId: string, state: unknown) => void): () => void
}

let bridge: PlaybackBridge | null = null

export function setPlaybackBridge(next: PlaybackBridge | null): void {
  bridge = next
}

export function getPlaybackBridge(): PlaybackBridge | null {
  return bridge
}
