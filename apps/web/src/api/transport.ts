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
  /** Crée une ambiance pour un groupe, en recopiant une ambiance présente ailleurs. */
  createScene(fromSceneId: string, groupName: string): Promise<void>
  /** Supprime une ambiance chez le fabricant (destructif). */
  deleteScene(sceneId: string): Promise<void>
  /** Réglages par plugin (persistés côté serveur, communs aux tablettes). */
  getPluginSettings(): Promise<Record<string, PluginSettings>>
  setPluginSettings(pluginId: string, settings: PluginSettings): Promise<PluginSettings>
  pairHue(): Promise<{ appKey: string; hint: string }>
  /** URL de consentement Google à ouvrir dans un navigateur pour lier le compte Nest. */
  nestAuthUrl(): Promise<{ url: string; redirectUri: string }>
  /**
   * URL WebSocket du flux vidéo d'une caméra (`live_stream`), par convention
   * `/api/plugins/<plugin>/cameras/<externalId>/stream` ; `null` si ce transport n'en sert pas.
   */
  cameraStreamUrl(deviceId: string): string | null
  /**
   * Vignettes des caméras d'un plugin (`externalId` → date), et `watch` pour signaler qu'on regarde
   * la vue Caméras : c'est ce qui fait tenir les sessions de vignettes côté serveur.
   */
  cameraSnapshots(pluginId: string, watch: boolean): Promise<Record<string, { at?: number; live: boolean; inactive?: boolean; paused?: boolean }>>
  /** Arrête (`false`) ou reprend (`true`) la vignette d'une caméra sur la vue Caméras. */
  setCameraSnapshots(deviceId: string, enabled: boolean): Promise<void>
  /** URL de la vignette JPEG d'une caméra ; `at` sert à contourner le cache du navigateur. */
  cameraSnapshotUrl(deviceId: string, at: number): string | null
  /** (Re)place un appareil dans house.json ; renvoie la maison réécrite. */
  placeDevice(id: string, placement: DevicePlacement): Promise<House>
  /** Retire un appareil de house.json (il redevient non placé ou auto-placé) ; renvoie la maison réécrite. */
  removeDevice(id: string): Promise<House>
  /** Écrit l'ordre d'affichage des pièces d'un niveau ; renvoie la maison réécrite. */
  setRoomOrder(levelId: string, roomIds: string[]): Promise<House>
  /** Ouvre le canal de push ; retourne la fonction de fermeture. */
  connect(handlers: TransportHandlers): () => void
}
