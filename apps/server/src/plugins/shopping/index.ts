import { z } from 'zod'
import { PluginError, type DevicePlugin } from '../../core/plugin'

// The shopping list's SWITCH, and nothing else. The list itself is a server feature
// (`core/shopping.ts`, `/api/shopping/*`, MCP tools): it needs the house path and the WebSocket
// broadcast, which the plugin contract does not provide, and widening the contract for it was out of
// the question. This device-less plugin makes it show up in Settings → Plugins, with the same switch
// as the others; it is the house's `plugins.shopping.enabled` that the routes, the MCP and the
// screen read (`pluginSettingsOf`). On by default (`PLUGINS_ON_BY_DEFAULT`): no account and no
// hardware to link. Switched off, the list is not erased — switched back on, it returns as it was.

export function createShoppingPlugin(): DevicePlugin {
  return {
    id: 'shopping',
    configSchema: z.object({}),
    async init() {},
    async discover() { return [] },
    async start() {},
    async execute(_externalId, command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `shopping publishes no device (${command.type})`)
    },
    async stop() {},
  }
}
