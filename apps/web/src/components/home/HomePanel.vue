<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HouseDevice } from '@kasbah/shared'
import { useHomeSummary } from '../../composables/useHomeSummary'
import { formatPercent, formatPower } from '../../lib/format'
import { isDeviceOn } from '../../lib/deviceState'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import StatTile from '../ui/StatTile.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import type { IconName } from '../../lib/strokeIcons'

// Panneau « maison » : 4 tuiles de synthèse, scènes, liste des pièces (puis zones du jardin).
const house = useHouseStore()
const devices = useDevicesStore()
const summary = useHomeSummary()
const { t, locale } = useI18n()

const stats = computed(() => {
  const out: { value: string; label: string }[] = []
  if (summary.lights.value.length) out.push({ value: String(summary.lightsOn.value), label: t('home.lightsOn') })
  if (summary.covers.value.length) out.push({ value: `${summary.coversOpen.value}/${summary.covers.value.length}`, label: t('home.shuttersOpen') })
  const e = summary.energy.value
  if (e) out.push({ value: formatPower(e.productionW, locale.value), label: t('home.solar') })
  if (e?.batterySoc !== undefined) out.push({ value: formatPercent(e.batterySoc, locale.value), label: t('home.battery') })
  return out.slice(0, 4)
})

function counts(list: HouseDevice[]) {
  const bound = list.filter((d) => d.deviceId && devices.states[d.deviceId])
  const on = bound.filter((d) => isDeviceOn(devices.states[d.deviceId!]!)).length
  return `${t('home.devicesCount', { n: list.length }, list.length)} · ${t('home.active', { n: on }, on)}`
}

const rooms = computed(() => {
  const idx = house.index
  if (!idx) return []
  return idx.levelsSorted.flatMap((level) => (idx.roomsByLevel.get(level.id) ?? []).filter((r) => r.kind !== 'stairs').map((room) => ({
    id: room.id, name: room.name, sub: counts(idx.devicesByRoom.get(room.id) ?? []), where: level.name,
  })))
})
const zones = computed(() => {
  const idx = house.index
  if (!idx) return []
  return house.zones.map((z) => ({ id: z.id, name: z.name, sub: counts(idx.devicesByZone.get(z.id) ?? []), where: t('home.garden') })).filter((z) => (idx.devicesByZone.get(z.id) ?? []).length > 0)
})
const scenes = computed(() => house.house?.scenes ?? [])
const sceneIcon = (icon?: string): IconName => (icon === 'leave' || icon === 'night' || icon === 'movie' ? icon : 'bolt')
</script>

<template>
  <div v-if="stats.length" class="tiles">
    <StatTile v-for="s in stats" :key="s.label" :value="s.value" :label="s.label" />
  </div>

  <section v-if="scenes.length" class="block">
    <div class="section-label">{{ $t('home.scenes') }}</div>
    <div class="chips">
      <button v-for="s in scenes" :key="s.id" type="button" class="pill" @click="devices.runScene(s.actions)">
        <StrokeIcon :name="sceneIcon(s.icon)" :size="16" />{{ s.name }}
      </button>
    </div>
  </section>

  <section class="block">
    <div class="section-label">{{ $t('home.rooms') }}</div>
    <button v-for="r in [...rooms, ...zones]" :key="r.id" type="button" class="room-row" :data-on="house.selectedRoomId === r.id ? '1' : '0'" @click="house.selectRoom(r.id)">
      <div class="room-row__main">
        <div class="room-row__name">{{ r.name }}</div>
        <div class="room-row__sub">{{ r.sub }}</div>
      </div>
      <div class="room-row__where">{{ r.where }}</div>
    </button>
  </section>

  <div class="muted text-center hint">{{ $t('home.selectHint') }}</div>
</template>

<style scoped>
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.block { display: grid; gap: 8px; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.room-row {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--radius); border: 0;
  background: var(--surface2); color: var(--text); text-align: left; width: 100%; transition: background .15s;
}
.room-row:hover { filter: brightness(1.03); }
.room-row[data-on='1'] { outline: 2px solid var(--accent); outline-offset: -2px; }
.room-row__main { flex: 1 1 0; min-width: 0; }
.room-row__name { font-weight: 500; font-size: 14px; }
.room-row__sub { font-size: 12px; color: var(--muted); }
.room-row__where { font-size: 12px; color: var(--muted); white-space: nowrap; }
.hint { font-size: 12px; }
</style>
