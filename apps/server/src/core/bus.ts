import type { DeviceEntry, DeviceEventKind, DeviceId, DeviceState, PluginSceneEntry, PluginSceneState, SceneId } from '@kasbah/shared'

// Typed event bus, the only channel between the registry and its consumers (WS hub, later automations).

export interface BusEvents {
  state: (deviceId: DeviceId, state: DeviceState) => void
  availability: (deviceIds: DeviceId[], available: boolean) => void
  devices: (entries: DeviceEntry[]) => void
  scenes: (entries: PluginSceneEntry[]) => void
  scene: (sceneId: SceneId, state: PluginSceneState) => void
  /** Transient device event (doorbell, motion) — pushed as is, never coalesced. */
  deviceEvent: (deviceId: DeviceId, event: DeviceEventKind, at: number) => void
}

export class Bus {
  private listeners: { [K in keyof BusEvents]: Set<BusEvents[K]> } = {
    state: new Set(), availability: new Set(), devices: new Set(), scenes: new Set(), scene: new Set(), deviceEvent: new Set(),
  }

  on<K extends keyof BusEvents>(event: K, fn: BusEvents[K]): () => void {
    this.listeners[event].add(fn)
    return () => this.listeners[event].delete(fn)
  }

  emit<K extends keyof BusEvents>(event: K, ...args: Parameters<BusEvents[K]>): void {
    for (const fn of this.listeners[event]) (fn as (...a: Parameters<BusEvents[K]>) => void)(...args)
  }

  listenerCount(event: keyof BusEvents): number { return this.listeners[event].size }
}
