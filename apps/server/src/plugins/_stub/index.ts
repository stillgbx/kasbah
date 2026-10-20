import { z } from 'zod'
import { PluginError, type DevicePlugin } from '../../core/plugin'

/**
 * Skeleton of a plugin not implemented yet: declared (visible in /api/health as
 * `not_implemented`), no device, every command refused with a 501.
 */
export function makeStubPlugin(id: string, vendor: string): () => DevicePlugin {
  return () => ({
    id,
    configSchema: z.object({}),
    implemented: false,
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
