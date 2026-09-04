import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { indexHouse, type House, type HouseDevice, type HouseIndex, type Level, type Room, type Zone } from '@kasbah/shared'
import { getTransport } from '../api'

// Maison (immuable : `shallowRef`, ré-indexée quand l'objet change) + sélection courante :
// niveau focalisé (ou jardin, ou tout), pièce/zone, appareil. Partagée par la scène, les panneaux et l'URL.

export type FloorTab = 'garden' | 'all' | string

export const useHouseStore = defineStore('house', () => {
  const house = shallowRef<House | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const index = computed<HouseIndex | null>(() => (house.value ? indexHouse(house.value) : null))
  const levels = computed<Level[]>(() => index.value?.levelsSorted ?? [])
  const zones = computed<Zone[]>(() => house.value?.site.zones ?? [])

  /** null = toute la maison (ou le jardin si `gardenFocus`). */
  const focusedLevelId = ref<string | null>(null)
  const gardenFocus = ref(false)
  /** Pièce ou zone sélectionnée. */
  const selectedRoomId = ref<string | null>(null)
  /** Id d'appareil de la MAISON (HouseDevice.id), ou id de plugin pour un appareil non placé. */
  const selectedKey = ref<string | null>(null)

  const floorTab = computed<FloorTab>(() => (focusedLevelId.value ?? (gardenFocus.value ? 'garden' : 'all')))
  const selectedRoom = computed<Room | null>(() => (selectedRoomId.value ? index.value?.roomsById.get(selectedRoomId.value) ?? null : null))
  const selectedZone = computed<Zone | null>(() => (selectedRoomId.value ? index.value?.zonesById.get(selectedRoomId.value) ?? null : null))

  async function load() {
    loading.value = true
    error.value = null
    try { house.value = await getTransport().getHouse() }
    catch (err) { error.value = (err as Error).message }
    finally { loading.value = false }
  }

  function setFloorTab(tab: FloorTab) {
    gardenFocus.value = tab === 'garden'
    focusedLevelId.value = tab === 'garden' || tab === 'all' ? null : tab
    if (selectedRoomId.value) {
      const room = index.value?.roomsById.get(selectedRoomId.value)
      const zone = index.value?.zonesById.get(selectedRoomId.value)
      if ((room && room.levelId !== focusedLevelId.value) || (zone && tab !== 'garden')) selectedRoomId.value = null
    }
    if (tab === 'garden' || tab === 'all') selectedKey.value = null
  }

  function focusLevel(levelId: string | null) { setFloorTab(levelId ?? 'all') }

  function selectRoom(roomId: string | null) {
    selectedKey.value = null
    if (!roomId) { selectedRoomId.value = null; return }
    const room = index.value?.roomsById.get(roomId)
    if (room) { gardenFocus.value = false; focusedLevelId.value = room.levelId }
    else if (index.value?.zonesById.has(roomId)) { gardenFocus.value = true; focusedLevelId.value = null }
    selectedRoomId.value = roomId
  }

  function selectDevice(key: string | null) {
    selectedKey.value = key
    if (!key) return
    const hd = index.value?.devicesById.get(key)
    if (!hd) return
    if (hd.roomId) {
      selectedRoomId.value = hd.roomId
      const room = index.value?.roomsById.get(hd.roomId)
      if (room) { focusedLevelId.value = room.levelId; gardenFocus.value = false }
    } else if (hd.levelId) { focusedLevelId.value = hd.levelId; gardenFocus.value = false }
    else if (hd.zoneId) { selectedRoomId.value = hd.zoneId; gardenFocus.value = true; focusedLevelId.value = null }
  }

  function clearSelection() { selectedKey.value = null }
  function backToHome() { selectedKey.value = null; selectedRoomId.value = null }

  /** Appareil maison lié à un id de plugin. */
  function houseDeviceFor(pluginDeviceId: string): HouseDevice | undefined {
    return index.value?.devicesByBinding.get(pluginDeviceId)
  }

  return {
    house, loading, error, index, levels, zones,
    focusedLevelId, gardenFocus, selectedRoomId, selectedKey, floorTab, selectedRoom, selectedZone,
    load, setFloorTab, focusLevel, selectRoom, selectDevice, clearSelection, backToHome, houseDeviceFor,
  }
})
