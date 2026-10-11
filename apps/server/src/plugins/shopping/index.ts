import { z } from 'zod'
import { PluginError, type DevicePlugin } from '../../core/plugin'

// L'INTERRUPTEUR de la liste de courses, et rien d'autre. La liste elle-même est une fonction du
// serveur (`core/shopping.ts`, `/api/shopping/*`, outils MCP) : elle a besoin du chemin de la maison
// et de la diffusion WebSocket, que le contrat des plugins ne donne pas, et il n'était pas question de
// l'élargir pour elle. Ce plugin sans appareil la fait figurer dans Réglages → Plugins, avec le même
// interrupteur que les autres ; c'est `plugins.shopping.enabled` de la maison que les routes, le MCP et
// l'écran lisent (`pluginSettingsOf`). Allumée par défaut (`PLUGINS_ON_BY_DEFAULT`) : ni compte ni
// matériel à relier. Coupée, la liste n'est pas effacée — rallumée, elle revient telle quelle.

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
