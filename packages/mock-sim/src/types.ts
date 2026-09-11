import type { Command, DeviceDescriptor, DeviceKind, DeviceState, StateFor } from '@kasbah/shared'
import type { Rng } from './rng'
import type { World, WorldConfig } from './world'

export type SimErrorCode = 'UNSUPPORTED_COMMAND' | 'DEVICE_UNAVAILABLE' | 'UPSTREAM_ERROR' | 'TIMEOUT'
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
}

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
}
