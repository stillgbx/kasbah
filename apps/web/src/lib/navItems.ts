import type { IconName } from './strokeIcons'
import type { LocalPluginId } from '../stores/localPlugins'

// The rail's views, in their display order. Outside the component because the House view's search
// also goes there (typing "weather" opens the Weather page): a single list, two readings.

/**
 * `local`: the entry only exists on the machine where this local plugin is activated (see `stores/localPlugins`).
 * `plugin`: the entry only exists if this SERVER plugin is turned on in the house — a feature that can
 * be turned off in Settings (the shopping list).
 */
export interface NavItem { name: string; icon: IconName; label: string; local?: LocalPluginId; plugin?: string }

export const NAV_ITEMS: NavItem[] = [
  { name: 'home', icon: 'home', label: 'nav.home' },
  // lights and covers right after the house: what we drive every day, reachable without scrolling
  // the bottom bar on a phone
  { name: 'lights', icon: 'light', label: 'nav.lights' },
  { name: 'covers', icon: 'shutter', label: 'nav.covers' },
  // weather after them: what we look at on arriving
  { name: 'weather', icon: 'cloudSun', label: 'nav.weather' },
  // the calendar with the weather: what we look at on arriving — what it is doing, what awaits us
  { name: 'agenda', icon: 'calendar', label: 'nav.agenda' },
  // school after the calendar: what awaits the children, homework and the teacher's notes
  { name: 'school', icon: 'school', label: 'nav.school' },
  // shopping with the calendar and school: the family's life, which we fill in and consult every day
  { name: 'shopping', icon: 'cart', label: 'nav.shopping', plugin: 'shopping' },
  // music: we start a track, we see the speaker in the 3D
  { name: 'music', icon: 'music', label: 'nav.music' },
  { name: 'media', icon: 'cast', label: 'nav.media' },
  { name: 'cameras', icon: 'camera', label: 'nav.cameras' },
  { name: 'energy', icon: 'bolt', label: 'nav.energy' },
  // technical equipment of the house, like energy — not a media, not a vehicle
  { name: 'water', icon: 'droplet', label: 'nav.water' },
  // heating follows water: two technical installations that we consult, neighbors in the mind
  // as in the boiler room
  { name: 'heating', icon: 'radiator', label: 'nav.heating' },
  { name: 'vehicles', icon: 'vehicle', label: 'nav.vehicles' },
  { name: 'robots', icon: 'mower', label: 'nav.robots' },
  // pets after the robots: two families of devices that live their own life in the house and
  // that we come to consult, not drive daily
  { name: 'pets', icon: 'paw', label: 'nav.pets' },
  // the TENS is personal and only appears on the machine that activated it; it comes before the
  // automations, which precisely cannot touch it
  { name: 'tens', icon: 'pulse', label: 'nav.tens', local: 'tens' },
  // what the house does ON ITS OWN comes last, just before Settings: we tune it and
  // come to check it, we do not drive it daily
  { name: 'automations', icon: 'automation', label: 'nav.automations' },
  { name: 'settings', icon: 'gear', label: 'nav.settings' },
]

/** The entries visible on this machine: neither non-activated local plugins, nor features turned off in the house. */
export const visibleNavItems = (isEnabled: (id: LocalPluginId) => boolean, pluginOn: (id: string) => boolean = () => true) =>
  NAV_ITEMS.filter((it) => (!it.local || isEnabled(it.local)) && (!it.plugin || pluginOn(it.plugin)))

/** The entries that keep their place whatever the order chosen on this device: House first, Settings last. */
export const FIXED_NAV = ['home', 'settings']

/**
 * `items` in the order chosen on this device (`order`, view names). An entry the order does not name
 * (a view added since it was saved) comes after the named ones, in the default order. An empty order
 * is the default order.
 */
export function orderNavItems(items: NavItem[], order: readonly string[]): NavItem[] {
  const rank = (it: NavItem) => { const i = order.indexOf(it.name); return i < 0 ? order.length + NAV_ITEMS.indexOf(it) : i }
  const movable = items.filter((it) => !FIXED_NAV.includes(it.name)).sort((a, b) => rank(a) - rank(b))
  return [...items.filter((it) => it.name === 'home'), ...movable, ...items.filter((it) => it.name === 'settings')]
}
