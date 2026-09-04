import { z } from 'zod'
import { PluginError, type DevicePlugin } from '../../core/plugin'

/**
 * Squelette d'un plugin non encore implémenté : déclaré (visible dans /api/health en
 * `not_implemented`), aucun appareil, toute commande refusée en 501.
 */
export function makeStubPlugin(id: string, vendor: string): () => DevicePlugin {
  return () => ({
    id,
    configSchema: z.object({}),
    async init() {},
    async discover() { return [] },
    async start() {},
    async execute(_externalId, command) {
      throw new PluginError('NOT_IMPLEMENTED', `${vendor} plugin is not implemented yet (${command.type})`)
    },
    async stop() {},
    health() { return { status: 'not_implemented' as const, detail: vendor } },
  })
}
