import type { DeviceEntry } from '@kasbah/shared'

// Pont tardif vers le registre / l'hôte : le plugin n'a pas `PluginContext.execute` pour un autre
// fabricant. `app.ts` branche après `PluginHost` ; les tests injectent directement via deps.

export interface YtmusicBridge {
  getDevice(deviceId: string): DeviceEntry | undefined
  playUrl(
    deviceId: string,
    url: string,
    meta?: { title?: string; artist?: string; artUrl?: string },
  ): Promise<void>
}

let bridge: YtmusicBridge | null = null

export function setYtmusicBridge(next: YtmusicBridge | null): void {
  bridge = next
}

export function getYtmusicBridge(): YtmusicBridge | null {
  return bridge
}
