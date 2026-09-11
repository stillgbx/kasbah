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

/**
 * Appairage de la passerelle Enphase, tel que l'UI le voit. Le jeton n'y figure jamais : seul le
 * serveur le détient, et `tokenFile` dit où il le garde — `null` si rien n'est gardé, et l'UI
 * prévient alors que l'appairage ne survivra pas à un redémarrage.
 */
export interface EnphaseTokenStatus {
  paired: boolean
  host: string
  serial?: string
  software?: string
  stage: 'ok' | 'expiring' | 'expired' | 'none'
  daysLeft?: number
  expiresAt?: number
  role?: string
  username?: string
  source?: 'config' | 'cache' | 'minted'
  renewUnderDays: number
  tokenFile: string | null
}

export type EnphasePairing = { token: string } | { user: string; password: string; force?: boolean }

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
  /** État de l'appairage de la passerelle Enphase. Ne porte jamais le jeton lui-même. */
  enphaseTokenStatus(): Promise<EnphaseTokenStatus>
  /**
   * Appaire la passerelle Enphase : un jeton déjà obtenu, ou les identifiants du compte qui servent
   * une fois à en frapper un et ne sont pas conservés. `force` remplace un jeton encore valable.
   */
  pairEnphase(body: EnphasePairing): Promise<EnphaseTokenStatus>
  /**
   * Fait oublier un appareil au plugin qui le retenait (`meta.forgettable`), par convention
   * `DELETE /api/plugins/<plugin>/devices/<externalId>` : il quitte l'inventaire jusqu'à ce qu'il
   * se réannonce. Sert aux appareils découverts sur le réseau et disparus pour de bon.
   */
  forgetDevice(deviceId: string): Promise<void>
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
