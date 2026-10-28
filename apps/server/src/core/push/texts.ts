import type { DeviceAlert, PluginHealth, PushLang } from '@kasbah/shared'

// The texts of the notifications. The server writes them (the service worker only shows what it
// receives), in the language of the screen that subscribed. They repeat the words of the alerts of
// the app (`alerts.*`, `weather.alerts.*`, `pets.*` of the web locales, `HomePanel.vue`): a
// notification says what the house panel says.

const TEXTS = {
  fr: {
    update: 'Mise à jour disponible',
    updateVersion: (v: string) => `Mise à jour ${v} disponible`,
    deviceError: 'En défaut',
    vigilance: (level: 'orange' | 'red', type: string) => `Vigilance ${level === 'red' ? 'rouge' : 'orange'} ${type}`,
    vigilanceTypes: {
      wind: 'vent violent', snow_ice: 'neige-verglas', thunderstorm: 'orages', fog: 'brouillard', heat: 'canicule', cold: 'grand froid',
      coastal: 'vagues-submersion', forest_fire: 'feux de forêt', avalanche: 'avalanches', rain: 'pluie', flood: 'crues',
      rain_flood: 'pluie-inondation', other: 'météo',
    } as Record<string, string>,
    foodLow: 'Croquettes à remettre',
    waterLow: 'Bac à remplir',
    desiccant: 'Dessiccant à changer',
    filter: 'Filtre à changer',
    batteryLow: 'Batterie faible',
    tireLow: (tires: string) => `Pneu sous-gonflé (${tires})`,
    tires: { fl: 'AV G', fr: 'AV D', rl: 'AR G', rr: 'AR D' } as Record<string, string>,
    plugin: (id: string) => `Plugin ${id}`,
    pluginStatus: { degraded: 'Dégradé', needs_pairing: 'Appairage requis', error: 'Erreur' } as Record<string, string>,
    testTitle: 'Kasbah',
    testBody: 'Les notifications arrivent sur cet appareil.',
  },
  en: {
    update: 'Update available',
    updateVersion: (v: string) => `Update ${v} available`,
    deviceError: 'Fault',
    vigilance: (level: 'orange' | 'red', type: string) => `${level === 'red' ? 'Red' : 'Orange'} ${type} warning`,
    vigilanceTypes: {
      wind: 'wind', snow_ice: 'snow-ice', thunderstorm: 'thunderstorm', fog: 'fog', heat: 'heatwave', cold: 'cold',
      coastal: 'coastal', forest_fire: 'forest fire', avalanche: 'avalanche', rain: 'rain', flood: 'flood',
      rain_flood: 'rain-flood', other: 'weather',
    } as Record<string, string>,
    foodLow: 'Refill the hopper',
    waterLow: 'Refill the bowl',
    desiccant: 'Replace desiccant',
    filter: 'Replace filter',
    batteryLow: 'Battery low',
    tireLow: (tires: string) => `Tire under-inflated (${tires})`,
    tires: { fl: 'FL', fr: 'FR', rl: 'RL', rr: 'RR' } as Record<string, string>,
    plugin: (id: string) => `Plugin ${id}`,
    pluginStatus: { degraded: 'Degraded', needs_pairing: 'Pairing required', error: 'Error' } as Record<string, string>,
    testTitle: 'Kasbah',
    testBody: 'Notifications reach this device.',
  },
} satisfies Record<PushLang, unknown>

export const textsFor = (lang: PushLang) => TEXTS[lang]

/** What an alert says, in the words of its row in the house panel. */
export function deviceAlertText(a: DeviceAlert, lang: PushLang): string {
  const t = TEXTS[lang]
  switch (a.type) {
    case 'software_update': return a.detail ? t.updateVersion(a.detail) : t.update
    case 'device_error': return a.detail ?? t.deviceError
    case 'vigilance': return t.vigilance(a.severity === 'critical' ? 'red' : 'orange', t.vigilanceTypes[a.detail ?? 'other'] ?? a.detail ?? '')
    case 'supply_low': return a.kind === 'pet_fountain' ? t.waterLow : t.foodLow
    case 'consumable': return a.detail === 'filter' ? t.filter : t.desiccant
    case 'battery_low': return t.batteryLow
    case 'tire_low': return t.tireLow((a.detail ?? '').split(',').map((k) => t.tires[k] ?? k).join(', '))
  }
}

/** A plugin that is not working: its status, then what the server says to do (in English, as in Settings). */
export function pluginAlertText(status: PluginHealth['status'], detail: string | undefined, lang: PushLang): string {
  const label = TEXTS[lang].pluginStatus[status] ?? status
  return detail ? `${label} · ${detail}` : label
}
