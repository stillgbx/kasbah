import type { Command, DeviceDescriptor, DeviceEventKind, DeviceKind, DeviceReleaseNotes, DeviceState, PluginScene, SiteMap, StateFor, WeatherForecast } from '@kasbah/shared'
import type { Rng } from './rng'
import type { World, WorldConfig } from './world'

export type SimErrorCode = 'UNSUPPORTED_COMMAND' | 'DEVICE_UNAVAILABLE' | 'UPSTREAM_ERROR' | 'TIMEOUT' | 'LOW_BATTERY'
export class SimError extends Error {
  constructor(readonly code: SimErrorCode, message: string) {
    super(message)
    this.name = 'SimError'
  }
}

export interface TickCtx {
  /** Temps simulé (ms epoch). */
  simTime: number
  /** Pas de temps simulé (s). */
  dtS: number
  /** Accélération du temps simulé (×1 = temps réel) : ce qui doit suivre l'horloge MURALE s'en sert. */
  timeScale: number
  /** Heure locale fractionnaire [0, 24). */
  hour: number
  /** Jour de semaine local, 0 = dimanche. */
  dow: number
  /** Décalage fuseau (minutes, convention Date.getTimezoneOffset : positif à l'ouest d'UTC). */
  tzOffsetMin: number
  rng: Rng
  world: World
  /** État courant d'un autre appareil de la simulation (couplages : borne ↔ véhicule). */
  getState(externalId: string): DeviceState | undefined
  /** Événement transitoire de l'appareil en cours de tick (coup de sonnette) : rien n'est conservé. */
  emitEvent?(event: DeviceEventKind): void
}

export interface SimDevice<K extends DeviceKind = DeviceKind> {
  descriptor: DeviceDescriptor
  /**
   * Cet appareil simulé fait partie de l'INSTALLATION d'un autre kind : l'exclure avec elle (voir
   * `Simulation.hiddenFor`). Un panneau photovoltaïque est un capteur de puissance, mais il
   * appartient à l'installation solaire ; sans ce lien, se débarrasser d'une production solaire
   * simulée obligerait à exclure TOUS les capteurs, vrais compteurs de piscine compris.
   */
  partOf?: DeviceKind
  /** État courant, MUTÉ par tick/apply ; le moteur calcule le diff et émet les patchs. */
  state: StateFor<K>
  tick(ctx: TickCtx): void
  /** Applique une commande de façon synchrone ; lève SimError si non supportée. */
  apply?(cmd: Command, ctx: TickCtx): void
  /** Prévisions (appareil `weather`), déduites du monde à l'instant du contexte. */
  forecast?(ctx: TickCtx): SimForecast
  /** Notes de version (véhicule qui déclare `release_notes`). */
  releaseNotes?(lang?: string): SimReleaseNotes
  /** Carte du terrain (tondeuse qui déclare `site_map`). */
  siteMap?(): SimSiteMap
}

/** Prévisions telles que la simulation les rend : le serveur y ajoute le `deviceId`. */
export type SimForecast = Omit<WeatherForecast, 'deviceId'>
/** Notes de version telles que la simulation les rend : le serveur y ajoute le `deviceId`. */
export type SimReleaseNotes = Omit<DeviceReleaseNotes, 'deviceId'>
/** Carte d'un terrain telle que la simulation la rend : le serveur y ajoute le `deviceId`. */
export type SimSiteMap = Omit<SiteMap, 'deviceId'>

/** Union des SimDevice par kind (SimDevice<K> est invariant en K à cause de `state` mutable). */
export type AnySimDevice = { [K in DeviceKind]: SimDevice<K> }[DeviceKind]

export interface ChaosConfig {
  /** Toutes les ~N s, un appareil au hasard devient indisponible. */
  flipEveryS: number
  flipForS: number
  /** Probabilité qu'une commande échoue en UPSTREAM_ERROR. */
  failRate: number
  /** Probabilité qu'une commande traîne `latencyMs` avant de répondre. */
  slowRate: number
  latencyMs: number
}

export interface Scenario {
  name: string
  build(rng: Rng): AnySimDevice[]
  chaos?: ChaosConfig
  /** Réglages « monde » (pic solaire, saison). */
  world?: Partial<WorldConfig>
  /** Ambiances du fabricant simulé (scènes de lampes rappelables), comme celles d'un pont Hue. */
  scenes?: SimScene[]
}

/** Valeurs posées sur une lampe par le rappel d'une ambiance. */
export interface SimSceneLight { on: boolean; brightness?: number; colorTempMirek?: number; color?: { x: number; y: number } }

/**
 * Ambiance simulée : ce que le pont publierait (nom, groupe, aperçu) et ce qu'elle POSE sur ses
 * lampes. Elle reste active tant qu'on ne touche pas l'une de ses lampes à la main, comme chez Hue.
 */
export interface SimScene extends Pick<PluginScene, 'externalId' | 'name' | 'group' | 'dynamic' | 'swatches'> {
  lights: Record<string, SimSceneLight>
}
