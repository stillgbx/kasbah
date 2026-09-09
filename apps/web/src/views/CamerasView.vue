<script setup lang="ts">
import { computed } from 'vue'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import { useDevicesStore } from '../stores/devices'

// Vue Caméras : tout ce qui est du kind `camera` (caméras, sonnettes, écrans à caméra), par pièce,
// avec le diagnostic de liaison de `RoomBands` — partagé avec Lumières et Ouvrants. Une caméra n'a
// pas de commande (l'API Nest ne sait pas l'éteindre), donc pas d'interrupteur : la 4e colonne
// porte ce que le fabricant déclare du flux (protocole), en attendant la vidéo elle-même.
const devices = useDevicesStore()

const cameras = computed(() => devices.list.filter((e) => e.state.kind === 'camera'))
const onlineCount = computed(() => cameras.value.filter((e) => e.state.available).length)
</script>

<template>
  <div class="page">
    <PageHeader>
      <div class="muted count">{{ $t('cameras.summary', { online: onlineCount, total: cameras.length }) }}</div>
    </PageHeader>
    <div class="page__scroll">
      <div v-if="cameras.length === 0" class="card card--soft empty muted">{{ $t('cameras.none') }}</div>
      <RoomBands kind="camera">
        <template #control="{ entry }">
          <span class="chip muted" :title="$t('camera.stream', { protocols: (entry.descriptor.meta.camera?.protocols ?? []).map((p) => $t(`camera.protocols.${p}`)).join(', ') || '—' })">
            {{ entry.descriptor.capabilities.includes('chime') ? $t('camera.classes.doorbell') : '' }}
            {{ (entry.descriptor.meta.camera?.protocols ?? []).map((p) => $t(`camera.protocols.${p}`)).join(' · ') }}
          </span>
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
.chip { font-size: 11px; letter-spacing: .03em; white-space: nowrap; }
</style>
