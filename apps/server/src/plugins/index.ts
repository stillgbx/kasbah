import type { PluginFactory } from '../core/plugin'
import { makeStubPlugin } from './_stub'
import { createGoogleCastPlugin } from './google_cast'
import { createHuePlugin } from './hue'
import { createMockPlugin } from './mock'
import { createNestPlugin } from './nest'
import { createTahomaPlugin } from './tahoma'

// Table statique des plugins : typée, grep-able, sans import dynamique. `KASBAH_PLUGINS`
// sélectionne parmi ces ids.

export const PLUGIN_FACTORIES: Record<string, PluginFactory> = {
  mock: createMockPlugin,
  hue: createHuePlugin,
  tahoma: createTahomaPlugin,
  nest: () => createNestPlugin(),
  google_cast: createGoogleCastPlugin,
  sonos: makeStubPlugin('sonos', 'Sonos'),
  irobot: makeStubPlugin('irobot', 'iRobot'),
  automower: makeStubPlugin('automower', 'Husqvarna Automower'),
  melcloud: makeStubPlugin('melcloud', 'Mitsubishi MELCloud'),
  comap: makeStubPlugin('comap', 'COMAP Proteo'),
  enphase: makeStubPlugin('enphase', 'Enphase Enlighten'),
  tesla: makeStubPlugin('tesla', 'Tesla Fleet API'),
  renault: makeStubPlugin('renault', 'Renault'),
}
