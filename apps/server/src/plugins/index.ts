import type { PluginFactory } from '../core/plugin'
import { createAgendaPlugin } from './agenda'
import { createAutomowerPlugin } from './automower'
import { createClaudePlugin } from './claude'
import { createComapPlugin } from './comap'
import { createEnphasePlugin } from './enphase'
import { createGoogleCastPlugin } from './google_cast'
import { createHuePlugin } from './hue'
import { createIrobotPlugin } from './irobot'
import { createMelcloudPlugin } from './melcloud'
import { createMixcloudPlugin } from './mixcloud'
import { createMockPlugin } from './mock'
import { createNestPlugin } from './nest'
import { createOpenMeteoPlugin } from './open_meteo'
import { createPetkitPlugin } from './petkit'
import { createRadioPlugin } from './radio'
import { createRenaultPlugin } from './renault'
import { createSonosPlugin } from './sonos'
import { createTahomaPlugin } from './tahoma'
import { createTeslaPlugin } from './tesla'
import { createToutemonanneePlugin } from './toutemonannee'
import { createTuyaPlugin } from './tuya'
import { createYtmusicPlugin } from './ytmusic'

// Table statique des plugins : typée, grep-able, sans import dynamique. Tous sont instanciés ;
// ceux qui tournent sont cochés dans Réglages → Plugins (`plugins` du fichier de la maison).

export const PLUGIN_FACTORIES: Record<string, PluginFactory> = {
  mock: createMockPlugin,
  hue: createHuePlugin,
  tahoma: createTahomaPlugin,
  nest: () => createNestPlugin(),
  google_cast: createGoogleCastPlugin,
  enphase: () => createEnphasePlugin(),
  sonos: () => createSonosPlugin(),
  irobot: () => createIrobotPlugin(),
  automower: () => createAutomowerPlugin(),
  melcloud: () => createMelcloudPlugin(),
  comap: () => createComapPlugin(),
  tesla: () => createTeslaPlugin(),
  renault: () => createRenaultPlugin(),
  open_meteo: () => createOpenMeteoPlugin(),
  petkit: () => createPetkitPlugin(),
  ytmusic: () => createYtmusicPlugin(),
  radio: () => createRadioPlugin(),
  mixcloud: () => createMixcloudPlugin(),
  tuya: () => createTuyaPlugin(),
  agenda: () => createAgendaPlugin(),
  toutemonannee: () => createToutemonanneePlugin(),
  claude: () => createClaudePlugin(),
}
