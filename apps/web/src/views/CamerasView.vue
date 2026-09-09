<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DeviceEntry } from '@kasbah/shared'
import { getTransport } from '../api'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import CameraVideo from '../components/controls/CameraVideo.vue'
import { useDevicesStore } from '../stores/devices'

// Vue Caméras : tout ce qui est du kind `camera` (caméras, sonnettes, écrans à caméra), par pièce,
// avec le diagnostic de liaison de `RoomBands` — partagé avec Lumières et Ouvrants. Une caméra n'a
// pas de commande (l'API Nest ne sait pas l'éteindre), donc pas d'interrupteur : chaque ligne porte
// une tuile vidéo. Tant qu'on ne demande pas le direct, la tuile montre la VIGNETTE que le serveur
// rafraîchit pour toutes les caméras dont il tient une session (voir `NEST_LIVE_BUDGET`) ; un appui
// lance le direct, avec les mêmes boutons arrêter / son que la carte détail.
//
// Tant que la vue est ouverte, elle se signale au serveur toutes les 5 s : c'est ce qui tient les
// sessions de vignettes ouvertes — et ce qui les ferme, 15 s après le départ de la dernière tablette.
const devices = useDevicesStore()

const cameras = computed(() => devices.list.filter((e) => e.state.kind === 'camera'))
const onlineCount = computed(() => cameras.value.filter((e) => e.state.available).length)
const streamable = (e: DeviceEntry) => e.descriptor.capabilities.includes('live_stream') && (e.descriptor.meta.camera?.protocols ?? []).includes('rtsp')

/** Par `deviceId` : date de la dernière vignette, et « inactive » si le flux de la caméra échoue. */
const snapshots = ref<Record<string, { at?: number; inactive?: boolean; paused?: boolean }>>({})
let pollTimer: ReturnType<typeof setInterval> | null = null

async function poll() {
  const plugins = [...new Set(cameras.value.filter(streamable).map((e) => e.descriptor.pluginId))]
  const next: Record<string, { at?: number; inactive?: boolean; paused?: boolean }> = { ...snapshots.value }
  await Promise.all(plugins.map(async (pluginId) => {
    try {
      const list = await getTransport().cameraSnapshots(pluginId, true)
      for (const [externalId, s] of Object.entries(list)) next[`${pluginId}:${externalId}`] = { ...(s.at !== undefined ? { at: s.at } : {}), ...(s.inactive ? { inactive: true } : {}), ...(s.paused ? { paused: true } : {}) }
    } catch { /* serveur injoignable : on garde les dates connues, la bannière de connexion prévient */ }
  }))
  snapshots.value = next
}

/** Bouton stop / reprise d'une tuile : le serveur retient l'arrêt, on relit tout de suite l'état. */
async function setSnapshots(deviceId: string, enabled: boolean) {
  snapshots.value = { ...snapshots.value, [deviceId]: { ...snapshots.value[deviceId], ...(enabled ? { paused: false } : { paused: true }) } }
  try { await getTransport().setCameraSnapshots(deviceId, enabled) } catch { /* le sondage suivant remettra l'état vrai */ }
  await poll()
}

onMounted(() => { void poll(); pollTimer = setInterval(() => void poll(), 5000) })
onBeforeUnmount(() => { if (pollTimer) clearInterval(pollTimer) })
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
          <span v-if="!streamable(entry)" class="chip muted">
            {{ entry.descriptor.capabilities.includes('chime') ? $t('camera.classes.doorbell') : '' }}
            {{ entry.descriptor.capabilities.includes('live_stream') ? $t('camera.video.webrtcLater') : $t('camera.noStream') }}
          </span>
          <span v-else class="chip muted">{{ entry.descriptor.capabilities.includes('chime') ? $t('camera.classes.doorbell') : '' }} RTSP</span>
          <!-- la tuile prend sa propre ligne : en 4e colonne elle serait un timbre-poste -->
          <CameraVideo v-if="streamable(entry) && entry.state.available" :device-id="entry.descriptor.id" :autoplay="false"
                       :snapshot-at="snapshots[entry.descriptor.id]?.at ?? null" :inactive="snapshots[entry.descriptor.id]?.inactive ?? false"
                       :paused="snapshots[entry.descriptor.id]?.paused ?? false" class="tile" @snapshots="(enabled) => setSnapshots(entry.descriptor.id, enabled)" />
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
.tile { grid-column: 1 / -1; margin: 4px 0 6px; }
</style>
