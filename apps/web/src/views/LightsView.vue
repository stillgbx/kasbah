<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DeviceEntry, StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import RoomBrightness from '../components/devices/RoomBrightness.vue'
import LightsMaster from '../components/devices/LightsMaster.vue'
import RoomLightsToggle from '../components/devices/RoomLightsToggle.vue'
import { lightTintCss } from '../lib/lightTint'
import { useDevicesStore } from '../stores/devices'

// Vue Lumières : la liste par pièce et son diagnostic de liaison vivent dans `RoomBands`
// (partagé avec la vue Ouvrants) ; il ne reste ici que le contrôle propre à une lampe —
// interrupteur, et curseur de gradation quand elle est allumée et sait varier.
const devices = useDevicesStore()

const lights = computed(() => devices.list.filter((e) => e.state.kind === 'light'))
const onCount = computed(() => lights.value.filter((e) => (e.state as StateFor<'light'>).on && e.state.available).length)

// Valeur locale pendant le glissement, effacée dès que la commande est partie (l'état reprend la main).
const draft = ref<Record<string, number>>({})
function drag(id: string, v: number) { draft.value = { ...draft.value, [id]: v } }
function commit(id: string, v: number) {
  void devices.sendCommand(id, { type: 'light.set', brightness: Math.round(v) })
  const next = { ...draft.value }
  delete next[id]
  draft.value = next
}
</script>

<template>
  <div class="page">
    <PageHeader>
      <!-- tout éteindre ou tout allumer sans parcourir les pièces : deux gestes nommés plutôt qu'un
           interrupteur, parce que la maison est rarement toute allumée ou toute éteinte -->
      <div class="head">
        <div class="muted count">{{ $t('lights.summary', { on: onCount, total: lights.length }) }}</div>
        <LightsMaster :device-ids="lights.map((e) => e.descriptor.id)" :label="$t('lights.all')" />
      </div>
    </PageHeader>
    <div class="page__scroll">
      <div v-if="lights.length === 0" class="card card--soft empty muted">{{ $t('lights.none') }}</div>
      <RoomBands kind="light">
        <!-- interrupteur maître de la pièce : tout allumer / tout éteindre sans parcourir les lignes -->
        <template #room-action="{ entries }">
          <RoomLightsToggle :device-ids="entries.map((e: DeviceEntry) => e.descriptor.id)" />
        </template>
        <!-- luminosité de toute la pièce, sous son en-tête : le même geste que l'interrupteur maître,
             en nuances. Place réservée quand la pièce est éteinte. -->
        <template #room-under="{ entries }">
          <RoomBrightness :device-ids="entries.map((e: DeviceEntry) => e.descriptor.id)" />
        </template>
        <!-- la couleur de la lampe en fond de ligne, comme la pochette d'un lecteur dans la vue Médias -->
        <template #backdrop="{ entry }">
          <Transition name="rowtint">
            <div v-if="lightTintCss(entry.state as StateFor<'light'>)" class="row-tint"
                 :style="{ background: lightTintCss(entry.state as StateFor<'light'>) }" aria-hidden="true" />
          </Transition>
        </template>
        <template #control="{ entry, on }">
          <v-switch :model-value="on" :disabled="!entry.state.available" density="compact" hide-details class="row__switch"
                    @update:model-value="devices.sendCommand(entry.descriptor.id, { type: 'light.set', on: !on })" />
          <!-- le curseur garde sa place lampe éteinte (invisible, inactif) : allumer une lampe ne
               fait plus descendre les lignes du dessous — règle « rien ne doit bouger » -->
          <v-slider v-if="entry.descriptor.capabilities.includes('brightness')"
                    :model-value="draft[entry.descriptor.id] ?? (entry.state as StateFor<'light'>).brightness ?? 100"
                    :min="1" :max="100" :step="1" density="compact" hide-details class="row__slider"
                    :class="{ 'row__slider--off': !on }" :disabled="!on || !entry.state.available" :aria-hidden="on ? 'false' : 'true'"
                    @update:model-value="(v: number) => drag(entry.descriptor.id, v)"
                    @end="(v: number) => commit(entry.descriptor.id, v)" />
        </template>
      </RoomBands>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); }
.head { display: flex; align-items: center; gap: 14px; }
.count { font-size: 13px; }
.empty { padding: 24px; text-align: center; }
.row__switch { flex: 0 0 auto; }
.row__slider { grid-column: 1 / -1; margin: 0 4px; transition: opacity .2s ease; }
/* place réservée : invisible mais présent, la ligne a la même hauteur allumée ou éteinte */
.row__slider--off { visibility: hidden; }
/* teinte de la lampe derriere la ligne : sous l'icone et le nom, fondue avant les touches ; deborde de 4 px pour couvrir jusqu'aux bords */
.row-tint { position: absolute; inset: 0 -4px; z-index: -1; pointer-events: none; }
.rowtint-enter-active, .rowtint-leave-active { transition: opacity .4s ease; }
.rowtint-enter-from, .rowtint-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .rowtint-enter-active, .rowtint-leave-active { transition: none; } }
</style>
