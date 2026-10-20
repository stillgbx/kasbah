import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Capability, DeviceKind } from '@kasbah/shared'
import type { NameContext } from '../lib/automations'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { useScenesStore } from '../stores/scenes'

// Names and choice lists of an automation, drawn from the stores: what `lib/automations.ts`
// receives as context to stay pure, and what the editor's lists offer. An id that
// no longer exists (plugin off, room deleted) is shown AS IS, marked "unknown" in the
// lists: that is how it is seen and replaced.

export interface Option { value: string; title: string }

export function useAutomationNames() {
  const devices = useDevicesStore()
  const house = useHouseStore()
  const scenes = useScenesStore()
  const { t } = useI18n()

  const names: NameContext = {
    deviceName: (id) => house.houseDeviceFor(id)?.name ?? devices.descriptors[id]?.name ?? id,
    roomName: (id) => house.index?.roomsById.get(id)?.name ?? id,
    levelName: (id) => house.index?.levelsById.get(id)?.name ?? id,
    zoneName: (id) => house.index?.zonesById.get(id)?.name ?? id,
    parkingName: (id) => { const p = house.effective?.site.parkings.find((x) => x.id === id); return p?.name ?? id },
    sceneName: (id) => scenes.entries[id]?.scene.name ?? id,
  }

  const roomOf = (deviceId: string) => {
    const roomId = house.houseDeviceFor(deviceId)?.roomId
    return roomId ? names.roomName(roomId) : ''
  }

  /** Devices of these kinds (and this capability), "Room · Name", sorted; the current id if it has disappeared. */
  function deviceOptions(kinds: readonly DeviceKind[] | null, current?: string, capability?: Capability): Option[] {
    const opts = Object.values(devices.descriptors)
      .filter((d) => (!kinds || kinds.includes(d.kind)) && (!capability || d.capabilities.includes(capability)))
      .map((d) => {
        const room = roomOf(d.id)
        const unavailable = devices.states[d.id]?.available === false ? ` (${t('common.unavailable').toLowerCase()})` : ''
        return { value: d.id, title: `${room ? `${room} · ` : ''}${names.deviceName(d.id)}${unavailable}` }
      })
      .sort((a, b) => a.title.localeCompare(b.title))
    if (current && !devices.descriptors[current]) opts.unshift({ value: current, title: `${current} (${t('automations.unknown')})` })
    return opts
  }

  /** Rooms, level by level (the house's display order). */
  const roomOptions = computed<Option[]>(() => {
    const idx = house.index
    if (!idx) return []
    return idx.levelsSorted.flatMap((l) => (idx.roomsByLevel.get(l.id) ?? []).map((r) => ({ value: r.id, title: `${l.shortName ?? l.name} · ${r.name}` })))
  })

  /** Scope of a selection: levels, rooms and garden zones, prefixed to stay distinct. */
  const scopeOptions = computed<Option[]>(() => {
    const idx = house.index
    if (!idx) return []
    return [
      ...idx.levelsSorted.map((l) => ({ value: `level:${l.id}`, title: `${t('automations.scope.level')} · ${l.name}` })),
      ...roomOptions.value.map((o) => ({ value: `room:${o.value}`, title: o.title })),
      ...(house.effective?.site.zones ?? []).map((z) => ({ value: `zone:${z.id}`, title: `${t('automations.scope.zone')} · ${z.name}` })),
    ]
  })

  const parkingOptions = computed<Option[]>(() =>
    (house.effective?.site.parkings ?? []).map((p) => ({ value: p.id, title: p.name ?? p.id })))

  /** Vendors' light scenes, "Group · Name". */
  const sceneOptions = computed<Option[]>(() =>
    scenes.list.map((e) => ({ value: e.scene.id, title: `${e.scene.group ? `${e.scene.group.name} · ` : ''}${e.scene.name}` })))

  return { names, deviceOptions, roomOptions, scopeOptions, parkingOptions, sceneOptions }
}
