<script setup lang="ts">
import { computed, ref } from 'vue'
import type { StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
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
      <div class="muted count">{{ $t('lights.summary', { on: onCount, total: lights.length }) }}</div>
    </PageHeader>
    <div class="page__scroll">
      <div v-if="lights.length === 0" class="card card--soft empty muted">{{ $t('lights.none') }}</div>
      <RoomBands kind="light">
        <template #control="{ entry, on }">
          <v-switch :model-value="on" :disabled="!entry.state.available" density="compact" hide-details class="row__switch"
                    @update:model-value="devices.sendCommand(entry.descriptor.id, { type: 'light.set', on: !on })" />
          <v-slider v-if="entry.descriptor.capabilities.includes('brightness') && on"
                    :model-value="draft[entry.descriptor.id] ?? (entry.state as StateFor<'light'>).brightness ?? 100"
                    :min="1" :max="100" :step="1" density="compact" hide-details class="row__slider"
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
.count { font-size: 13px; }
.empty { padding: 24px; text-align: center; }
.row__switch { flex: 0 0 auto; }
.row__slider { grid-column: 1 / -1; margin: 0 4px; }
</style>
