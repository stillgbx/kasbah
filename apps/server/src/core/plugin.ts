import type { Command, DeviceDescriptor, PluginHealth, StatePatch } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import type { z } from 'zod'
import type { Clock } from './clock'

// Contrat d'un plugin d'appareils. Un plugin ne connaît ni HTTP ni WebSocket : il découvre des
// descripteurs, pousse des patchs d'état via le contexte et exécute des commandes.

export const PLUGIN_ERROR_CODES = [
  'DEVICE_UNAVAILABLE', 'UNSUPPORTED_COMMAND', 'UPSTREAM_ERROR', 'RATE_LIMITED', 'NEEDS_PAIRING', 'TIMEOUT', 'NOT_IMPLEMENTED',
] as const
export type PluginErrorCode = (typeof PLUGIN_ERROR_CODES)[number]

export class PluginError extends Error {
  constructor(readonly code: PluginErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PluginError'
  }
}

export interface PluginContext {
  pluginId: string
  /** Sortie de `configSchema.parse(process.env)`. */
  config: Record<string, unknown>
  logger: Logger
  clock: Clock
  /** Annulé par stop() : à passer aux fetch/pollers. */
  signal: AbortSignal
  /** Patch d'état ; `available: true` est ajouté implicitement sauf mention contraire. */
  emitState(externalId: string, patch: StatePatch): void
  setAvailable(externalId: string | '*', available: boolean): void
  /** Remplace l'ensemble des appareils du plugin (découverte tardive, ajout/suppression). */
  emitDevices(descriptors: DeviceDescriptor[]): void
}

export interface DevicePlugin {
  readonly id: string
  /** Sélectionne et valide ses propres clés d'environnement (ex. HUE_*). */
  readonly configSchema: z.ZodType<Record<string, unknown>>
  init(ctx: PluginContext): Promise<void>
  discover(): Promise<DeviceDescriptor[]>
  start(): Promise<void>
  /** Résout à l'accusé de réception du fabricant ; lève PluginError sinon. */
  execute(externalId: string, command: Command): Promise<void>
  stop(): Promise<void>
  /** Routes propres au plugin, montées sous /api/plugins/<id>/. */
  registerRoutes?(app: FastifyInstance): void
  health?(): PluginHealth
}

export type PluginFactory = () => DevicePlugin
