import type { PluginFactory } from '../core/plugin'
import { makeStubPlugin } from './_stub'
import { createAutomowerPlugin } from './automower'
import { createComapPlugin } from './comap'
import { createEnphasePlugin } from './enphase'
import { createGoogleCastPlugin } from './google_cast'
import { createHuePlugin } from './hue'
import { createIrobotPlugin } from './irobot'
import { createMelcloudPlugin } from './melcloud'
import { createMockPlugin } from './mock'
import { createNestPlugin } from './nest'
import { createOpenMeteoPlugin } from './open_meteo'
import { createRenaultPlugin } from './renault'
import { createTahomaPlugin } from './tahoma'
import { createTeslaPlugin } from './tesla'

// Table statique des plugins : typée, grep-able, sans import dynamique. `KASBAH_PLUGINS`
// sélectionne parmi ces ids.

export const PLUGIN_FACTORIES: Record<string, PluginFactory> = {
  mock: createMockPlugin,
  hue: createHuePlugin,
  tahoma: createTahomaPlugin,
  nest: () => createNestPlugin(),
  google_cast: createGoogleCastPlugin,
  enphase: () => createEnphasePlugin(),
  sonos: makeStubPlugin('sonos', 'Sonos'),
  irobot: () => createIrobotPlugin(),
  automower: () => createAutomowerPlugin(),
  melcloud: () => createMelcloudPlugin(),
  comap: () => createComapPlugin(),
  tesla: () => createTeslaPlugin(),
  renault: () => createRenaultPlugin(),
  open_meteo: () => createOpenMeteoPlugin(),
}
