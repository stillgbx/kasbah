import type { CommandInput, DeviceEntry, DevicePlacement, EnergyHistory, HealthResponse, House, PluginSceneEntry, PluginSettings, SceneRecallInput, SceneUpdate, ServerMessage } from '@kasbah/shared'

// Abstraction du canal serveur. Deux implémentations : HTTP + WebSocket (réel) et simulation
// in-process (tests, démo statique sans serveur). Les commandes passent TOUJOURS par une requête
// (codes d'erreur, timeout, fonctionne pendant une reconnexion) ; le WS ne fait que pousser.

export type ConnectionStatus = 'connecting' | 'online' | 'stale' | 'offline'

export interface TransportHandlers {
  onMessage(msg: ServerMessage): void
  onStatus(status: ConnectionStatus): void
}

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export interface Transport {
  getHouse(): Promise<House>
  getDevices(): Promise<DeviceEntry[]>
  getHealth(): Promise<HealthResponse>
  getHistory(deviceId: string, hours?: number): Promise<EnergyHistory>
  sendCommand(deviceId: string, command: CommandInput): Promise<void>
  getScenes(): Promise<PluginSceneEntry[]>
  /** Rappelle une scène du fabricant (fixe ou palette animée). */
  recallScene(sceneId: string, recall: SceneRecallInput): Promise<void>
  /** Écrit une préférence de scène chez le fabricant (source de vérité unique). */
  updateScene(sceneId: string, update: SceneUpdate): Promise<void>
  /** Réglages par plugin (persistés côté serveur, communs aux tablettes). */
  getPluginSettings(): Promise<Record<string, PluginSettings>>
  setPluginSettings(pluginId: string, settings: PluginSettings): Promise<PluginSettings>
  pairHue(): Promise<{ appKey: string; hint: string }>
  /** (Re)place un appareil dans house.json ; renvoie la maison réécrite. */
  placeDevice(id: string, placement: DevicePlacement): Promise<House>
  /** Ouvre le canal de push ; retourne la fonction de fermeture. */
  connect(handlers: TransportHandlers): () => void
}
