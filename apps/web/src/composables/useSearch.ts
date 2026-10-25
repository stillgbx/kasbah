import { computed, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { pluginSettingsOf, roomKey, type DeviceDescriptor } from '@kasbah/shared'
import { deviceIcon } from '../lib/deviceIcons'
import { visibleNavItems } from '../lib/navItems'
import { useLocalPluginsStore } from '../stores/localPlugins'
import { normalize, queryTerms, scoreQuery } from '../lib/search'
import type { IconName } from '../lib/strokeIcons'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { useScenesStore } from '../stores/scenes'

// What the House view's search can reach, and what validating a result does. Nothing
// is indexed: the entities already live in the stores, we flatten them into `SearchEntry` (the
// `computed` is only redone on a change of house, devices or light scenes) and each
// keystroke sweeps the list. No plugin has a field to declare: the device contract already carries the
// name, the kind and the room.
//
// A result NAVIGATES, it never acts: the same setters as the tap in the scene
// (`selectRoom`, `selectDevice`…), which frame the 3D and open the right panel. A light scene
// therefore takes you where its pill is touched, it does not recall itself.

export type SearchFamily = 'room' | 'zone' | 'level' | 'device' | 'scene' | 'page'

export interface SearchEntry {
  key: string
  label: string
  /** Where the thing is ("1st floor", "Living room") or what it is ("Level", "Page"). */
  sub: string
  /**
   * What else can be typed to land on it, and which only shows if that is how one
   * arrived: a device's brand and model ("COMAP Proteo V3"), a level's short name
   * ("GF"). A device often carries the name the vendor gave it — a Renault
   * is called "GA-123-BX" —, and nobody looks for a car by its plate.
   */
  alias?: string
  icon: IconName
  family: SearchFamily
  go: () => void
}

export interface SearchHit extends SearchEntry { score: number }

/** One letter would bring back the whole house: we wait for the second character. */
export const MIN_QUERY = 2
/** Beyond that, the list is no longer readable — it is the next keystroke that sorts, not scrolling. */
export const MAX_RESULTS = 20

/** "COMAP Proteo V3", "Tesla Model S", "Renault": what a device is, for whoever searches it that way. */
function madeBy(descriptor: DeviceDescriptor | undefined): string | undefined {
  const parts = [descriptor?.meta.manufacturer, descriptor?.meta.model].filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

/** On equal score, the order of the families: the room before the light that names it, the page last. */
const FAMILY_RANK: Record<SearchFamily, number> = { room: 0, zone: 1, level: 2, device: 3, scene: 4, page: 5 }

/** The name comes BEFORE the brand, always: the slightest name match beats "Tesla". */
const NAME_WEIGHT = 10

/**
 * A choice made through the Ctrl+K palette that targets the house: the House view, kept alive, opens
 * its panel at each increment — it alone knows whether it is collapsed (narrow window).
 */
export const homePanelRequest = ref(0)

/** The header's button, on every page: the Ctrl+K palette opens at each increment. */
export const paletteRequest = ref(0)

/** `withHome`: the palette lives on all pages, so the House page is a destination there. */
export function useSearch(query: Ref<string>, { withHome = false } = {}) {
  const house = useHouseStore()
  const devices = useDevicesStore()
  const scenes = useScenesStore()
  const router = useRouter()
  const localPlugins = useLocalPluginsStore()
  const { t } = useI18n()

  const entries = computed<SearchEntry[]>(() => {
    const out: SearchEntry[] = []
    const index = house.index

    for (const level of house.levels) {
      out.push({ key: `level:${level.id}`, label: level.name, sub: t('search.level'), alias: level.shortName, icon: 'layers', family: 'level', go: () => house.selectLevel(level.id) })
    }
    for (const room of index?.roomsById.values() ?? []) {
      const level = index?.levelsById.get(room.levelId)
      out.push({ key: `room:${room.id}`, label: room.name, sub: level?.name ?? t('search.room'), icon: 'room', family: 'room', go: () => house.selectRoom(room.id) })
    }
    for (const zone of house.zones) {
      out.push({ key: `zone:${zone.id}`, label: zone.name, sub: t('home.garden'), icon: 'room', family: 'zone', go: () => house.selectRoom(zone.id) })
    }

    // House devices: those of the JSON and those auto-placement put there. Their name comes
    // from the descriptor when the JSON gives none (the general case); a dead link has
    // none and is then searched by its id, which is telling ("light.cube-salon").
    for (const hd of house.effective?.devices ?? []) {
      const descriptor = hd.deviceId ? devices.descriptors[hd.deviceId] : undefined
      const room = hd.roomId ? index?.roomsById.get(hd.roomId) : undefined
      const zone = hd.zoneId ? index?.zonesById.get(hd.zoneId) : undefined
      const level = hd.levelId ? index?.levelsById.get(hd.levelId) : undefined
      out.push({
        key: `device:${hd.id}`,
        label: hd.name ?? descriptor?.name ?? hd.id,
        sub: room?.name ?? zone?.name ?? level?.name ?? '',
        alias: madeBy(descriptor),
        icon: deviceIcon(descriptor),
        family: 'device',
        go: () => house.selectDevice(hd.id),
      })
    }
    // Devices that no room of the house claims: absent from the scene, but their panel
    // opens anyway (`resolveDevice` accepts a plugin id as key) — and that is where they
    // get placed. Hiding them from the search would make a device "unfindable" without saying why.
    for (const descriptor of Object.values(devices.descriptors)) {
      if (index?.devicesByBinding.has(descriptor.id)) continue
      out.push({
        key: `device:${descriptor.id}`,
        label: descriptor.name,
        sub: t('rooms.origins.unplaced'),
        alias: madeBy(descriptor),
        icon: deviceIcon(descriptor),
        family: 'device',
        go: () => house.selectDevice(descriptor.id),
      })
    }

    // A room's light scene leads to its room, the others (vendor zone, unknown room) to the
    // house panel: in both cases, where its pill is found.
    const rooms = [...(index?.roomsById.values() ?? [])]
    for (const e of scenes.list) {
      const group = e.scene.group
      const room = group?.kind === 'room' ? rooms.find((r) => roomKey(r.name) === roomKey(group.name)) : undefined
      out.push({
        key: `scene:${e.scene.id}`,
        label: e.scene.name,
        sub: room?.name ?? group?.name ?? t('search.scene'),
        icon: 'sparkle',
        family: 'scene',
        go: () => (room ? house.selectRoom(room.id) : house.backToHome()),
      })
    }

    for (const item of visibleNavItems(localPlugins.isEnabled, (id) => pluginSettingsOf(house.house?.plugins ?? {}, id).enabled)) {
      if (item.name === 'home' && !withHome) continue    // we are already there: the search lives on it
      out.push({ key: `page:${item.name}`, label: t(item.label), sub: t('search.page'), icon: item.icon, family: 'page', go: () => { void router.push({ name: item.name }) } })
    }
    return out
  })

  /** Normalized names and aliases, in the order of the entries: computed once, not at each keystroke. */
  const haystacks = computed(() => entries.value.map((e) => [normalize(e.label), e.alias ? normalize(e.alias) : '']))

  const results = computed<SearchHit[]>(() => {
    const terms = queryTerms(query.value)
    if (terms.join('').length < MIN_QUERY) return []
    const hits: SearchHit[] = []
    const list = entries.value, hay = haystacks.value
    for (let i = 0; i < list.length; i++) {
      const entry = list[i]!, [name, alias] = hay[i]!
      const byName = scoreQuery(name!, terms)
      if (byName !== null) { hits.push({ ...entry, score: byName * NAME_WEIGHT }); continue }
      // found by the brand: we SAY so in place of the location, otherwise the line looks like it came from nowhere
      const byAlias = alias ? scoreQuery(alias, terms) : null
      if (byAlias !== null) hits.push({ ...entry, sub: entry.alias!, score: byAlias })
    }
    hits.sort((a, b) => b.score - a.score || FAMILY_RANK[a.family] - FAMILY_RANK[b.family] || a.label.localeCompare(b.label))
    return hits.slice(0, MAX_RESULTS)
  })

  return { results }
}
