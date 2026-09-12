<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { isDeviceOn } from '../../lib/deviceState'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import RoomLightsToggle from '../devices/RoomLightsToggle.vue'

// Lignes de pièce (ou de zone du jardin), partagées par le panneau maison et le panneau d'un
// niveau : nom, compteurs, interrupteur maître des lampes, sélection au clic. `where` ne sert qu'au
// panneau maison, qui mêle tous les niveaux — dans un niveau, il répéterait le titre.
const props = defineProps<{ rows: { id: string; name: string; where?: string; deviceIds: (string | undefined)[] }[] }>()
const house = useHouseStore()
const devices = useDevicesStore()
const { t } = useI18n()

/** « 5 appareils · 2 actifs » : l'inventaire de la pièce, et ce qui y est actif en ce moment. */
function counts(ids: (string | undefined)[]) {
  const bound = ids.filter((id): id is string => !!id && !!devices.states[id])
  // actif par lui-même, ou parce qu'il joue le son d'un autre (barre de son d'une TV, `lib/audioRouting.ts`)
  const on = bound.filter((id) => isDeviceOn(devices.states[id]!, devices.descriptors[id]) || house.soundRoutes.relays.has(id)).length
  return `${t('home.devicesCount', { n: ids.length }, ids.length)} · ${t('home.active', { n: on }, on)}`
}
const list = computed(() => props.rows.map((r) => ({ ...r, sub: counts(r.deviceIds) })))
</script>

<template>
  <!-- `div` et non `button` : la ligne porte un interrupteur, et un bouton dans un bouton n'est pas
       du HTML valide (l'imbrication casse le clic sur Safari iOS) -->
  <div v-for="r in list" :key="r.id" class="room-row" role="button" tabindex="0"
       :data-on="house.selectedRoomId === r.id ? '1' : '0'" @click="house.selectRoom(r.id)" @keydown.enter="house.selectRoom(r.id)">
    <div class="room-row__main">
      <div class="room-row__name">{{ r.name }}</div>
      <div class="room-row__sub">{{ r.sub }}</div>
    </div>
    <div v-if="r.where" class="room-row__where">{{ r.where }}</div>
    <!-- éteindre une pièce sans y entrer : le geste le plus court depuis le panneau -->
    <RoomLightsToggle :device-ids="r.deviceIds" />
  </div>
</template>

<style scoped>
.room-row {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--radius); border: 0;
  background: var(--surface2); color: var(--text); text-align: left; width: 100%; transition: background .15s;
  cursor: pointer;
}
.room-row:hover { filter: brightness(1.03); }
.room-row[data-on='1'] { outline: 2px solid var(--accent); outline-offset: -2px; }
.room-row__main { flex: 1 1 0; min-width: 0; }
/* une ligne chacun, coupés aux points de suspension comme partout ailleurs : l'interrupteur maître
   a pris 52 px, et sans cela « Salle de Jeux · Rez-de-chaussée » passait sur deux lignes — la
   liste n'aurait plus eu des lignes de même hauteur */
.room-row__name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.room-row__sub { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.room-row__where { font-size: 12px; color: var(--muted); white-space: nowrap; }
</style>
