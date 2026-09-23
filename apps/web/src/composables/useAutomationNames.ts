import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Capability, DeviceKind } from '@kasbah/shared'
import type { NameContext } from '../lib/automations'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { useScenesStore } from '../stores/scenes'

// Noms et listes de choix d'une automatisation, tirés des stores : ce que `lib/automations.ts`
// reçoit en contexte pour rester pur, et ce que proposent les listes de l'éditeur. Un id qui
// n'existe plus (plugin éteint, pièce supprimée) se montre TEL QUEL, marqué « inconnu » dans les
// listes : c'est ainsi qu'on le voit et qu'on le remplace.

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

  /** Appareils de ces kinds (et de cette capacité), « Pièce · Nom », triés ; l'id courant s'il a disparu. */
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

  /** Pièces, niveau par niveau (ordre d'affichage de la maison). */
  const roomOptions = computed<Option[]>(() => {
    const idx = house.index
    if (!idx) return []
    return idx.levelsSorted.flatMap((l) => (idx.roomsByLevel.get(l.id) ?? []).map((r) => ({ value: r.id, title: `${l.shortName ?? l.name} · ${r.name}` })))
  })

  /** Portée d'une sélection : niveaux, pièces et zones du jardin, préfixés pour rester distincts. */
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

  /** Ambiances des fabricants, « Groupe · Nom ». */
  const sceneOptions = computed<Option[]>(() =>
    scenes.list.map((e) => ({ value: e.scene.id, title: `${e.scene.group ? `${e.scene.group.name} · ` : ''}${e.scene.name}` })))

  return { names, deviceOptions, roomOptions, scopeOptions, parkingOptions, sceneOptions }
}
