<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HouseDevice } from '@kasbah/shared'
import { isDeviceOn, statusLabel, toggleCommand } from '../../lib/deviceState'
import { kindIcon } from '../../lib/strokeIcons'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Panneau « pièce » (ou zone du jardin) : fil d'Ariane, titre, appareils avec bascule rapide.
const emit = defineEmits<{ back: [] }>()
const house = useHouseStore()
const devices = useDevicesStore()
const { t, locale } = useI18n()

const target = computed(() => {
  const idx = house.index
  if (!idx || !house.selectedRoomId) return null
  const room = idx.roomsById.get(house.selectedRoomId)
  if (room) return { name: room.name, where: idx.levelsById.get(room.levelId)?.name ?? '', list: idx.devicesByRoom.get(room.id) ?? [] }
  const zone = idx.zonesById.get(house.selectedRoomId)
  if (zone) return { name: zone.name, where: t('home.garden'), list: idx.devicesByZone.get(zone.id) ?? [] }
  return null
})

function row(d: HouseDevice) {
  const descriptor = d.deviceId ? devices.descriptors[d.deviceId] : undefined
  const state = d.deviceId ? devices.states[d.deviceId] : undefined
  const toggle = state ? toggleCommand(state) : null
  return {
    key: d.id, name: d.name ?? descriptor?.name ?? d.id, icon: kindIcon(descriptor?.kind ?? d.kind, descriptor),
    on: !!state && isDeviceOn(state),
    status: descriptor && state ? statusLabel(descriptor, state, t, locale.value) : t('device.unbound', { id: d.deviceId ?? '—' }),
    toggle, deviceId: d.deviceId, available: state?.available ?? false,
  }
}
const rows = computed(() => (target.value?.list ?? []).map(row))
</script>

<template>
  <template v-if="target">
    <button type="button" class="crumb" @click="emit('back')"><StrokeIcon name="back" :size="14" /> {{ $t('nav.home') }}</button>
    <div>
      <div class="title">{{ target.name }}</div>
      <div class="muted sub">{{ target.where }} · {{ $t('home.devicesCount', { n: rows.length }, rows.length) }}</div>
    </div>
    <div class="rows">
      <div v-for="r in rows" :key="r.key" class="dev-row" role="button" tabindex="0" @click="house.selectDevice(r.key)" @keydown.enter="house.selectDevice(r.key)">
        <span class="icon-square" :data-on="r.on ? '1' : '0'"><StrokeIcon :name="r.icon" :size="18" /></span>
        <div class="dev-row__main">
          <div class="dev-row__name">{{ r.name }}</div>
          <div class="dev-row__status">{{ r.status }}</div>
        </div>
        <v-switch v-if="r.toggle && r.deviceId" :model-value="r.on" :disabled="!r.available" class="dev-row__switch"
                  @click.stop @update:model-value="devices.sendCommand(r.deviceId!, r.toggle!)" />
        <StrokeIcon v-else name="chevron" :size="18" class="muted" />
      </div>
    </div>
  </template>
</template>

<style scoped>
.crumb { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted); font-size: 13px; padding: 0; justify-self: start; }
.crumb:hover { color: var(--text); }
.title { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
.sub { font-size: 13px; margin-top: 2px; }
.rows { display: grid; gap: 8px; }
.dev-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius);
  background: var(--surface2); cursor: pointer; transition: filter .15s;
}
.dev-row:hover { filter: brightness(1.03); }
.dev-row__main { flex: 1 1 0; min-width: 0; }
.dev-row__name { font-weight: 500; font-size: 14px; }
.dev-row__status { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dev-row__switch { flex: 0 0 auto; }
</style>
