<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DeviceEntry } from '@kasbah/shared'
import { getTransport } from '../api'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import CameraVideo from '../components/controls/CameraVideo.vue'
import { useDevicesStore } from '../stores/devices'

// Cameras view: everything of kind `camera` (cameras, doorbells, screens with a camera), by room,
// with the link diagnostic of `RoomBands` — shared with Lights and Covers. A camera has no
// command (the Nest API cannot turn it off), so no switch: each row carries a video tile. As
// long as live is not requested, the tile shows the THUMBNAIL that the server refreshes for all
// the cameras it holds a session for (see `NEST_LIVE_BUDGET`); a press starts the live stream,
// with the same stop / sound buttons as the detail card.
//
// As long as the view is open, it reports itself to the server every 5 s: that is what keeps the
// thumbnail sessions open — and what closes them, 15 s after the last screen leaves.
const devices = useDevicesStore()

const cameras = computed(() => devices.list.filter((e) => e.state.kind === 'camera'))
const streamable = (e: DeviceEntry) => e.descriptor.capabilities.includes('live_stream') && (e.descriptor.meta.camera?.protocols ?? []).includes('rtsp')

/**
 * By `deviceId`: date of the last thumbnail, "inactive" if the camera's stream fails, and
 * "refreshing" while the server opens a session for it and no image has come yet.
 */
type TileState = { at?: number; inactive?: boolean; paused?: boolean; refreshing?: boolean }
const snapshots = ref<Record<string, TileState>>({})
// "Active" = a camera whose stream worked on the last try. Google does not expose the connectivity
// of cameras (no Connectivity trait, unlike the thermostat): only the stream attempt says it, so
// a camera that is off is only known as such (`inactive`) after a pass of the rotation.
const activeCount = computed(() => cameras.value.filter((e) => !snapshots.value[e.descriptor.id]?.inactive).length)
let pollTimer: ReturnType<typeof setInterval> | null = null

/** At most three simultaneous live streams: beyond that, the Live button of the other tiles is disabled. */
const LIVE_MAX = 3
const liveIds = ref<Set<string>>(new Set())
const liveAllowed = (deviceId: string) => liveIds.value.size < LIVE_MAX || liveIds.value.has(deviceId)
function setLive(deviceId: string, active: boolean) {
  const next = new Set(liveIds.value)
  if (active) next.add(deviceId); else next.delete(deviceId)
  liveIds.value = next
}

async function poll() {
  const plugins = [...new Set(cameras.value.filter(streamable).map((e) => e.descriptor.pluginId))]
  const next: Record<string, TileState> = { ...snapshots.value }
  await Promise.all(plugins.map(async (pluginId) => {
    try {
      const list = await getTransport().cameraSnapshots(pluginId, true)
      for (const [externalId, s] of Object.entries(list)) {
        next[`${pluginId}:${externalId}`] = {
          ...(s.at !== undefined ? { at: s.at } : {}), ...(s.inactive ? { inactive: true } : {}), ...(s.paused ? { paused: true } : {}),
          ...(s.refreshing ? { refreshing: true } : {}),
        }
      }
    } catch { /* server unreachable: we keep the known dates, the connection banner warns */ }
  }))
  snapshots.value = next
}

/** Stop / resume button of a tile: the server remembers the stop, we re-read the state right away. */
async function setSnapshots(deviceId: string, enabled: boolean) {
  snapshots.value = { ...snapshots.value, [deviceId]: { ...snapshots.value[deviceId], ...(enabled ? { paused: false } : { paused: true }) } }
  try { await getTransport().setCameraSnapshots(deviceId, enabled) } catch { /* the next poll will set the true state back */ }
  await poll()
}

onMounted(() => { void poll(); pollTimer = setInterval(() => void poll(), 5000) })
onBeforeUnmount(() => { if (pollTimer) clearInterval(pollTimer) })
</script>

<template>
  <div class="page">
    <PageHeader>
      <div class="muted count">{{ $t('cameras.summary', { active: activeCount, total: cameras.length }) }}</div>
    </PageHeader>
    <div class="page__scroll">
      <div v-if="cameras.length === 0" class="card card--soft empty muted">{{ $t('cameras.none') }}</div>
      <RoomBands kind="camera">
        <!-- the protocol at the end of the status line rather than a badge in front: less width stolen from the name -->
        <template #status-after="{ entry }">
          <span v-if="streamable(entry)" class="proto">RTSP</span>
        </template>
        <template #control="{ entry }">
          <!-- the tile takes its own line: in the 4th column it would be a postage stamp -->
          <CameraVideo v-if="streamable(entry) && entry.state.available" :device-id="entry.descriptor.id" :autoplay="false"
                       :snapshot-at="snapshots[entry.descriptor.id]?.at ?? null" :inactive="snapshots[entry.descriptor.id]?.inactive ?? false"
                       :paused="snapshots[entry.descriptor.id]?.paused ?? false" :refreshing="snapshots[entry.descriptor.id]?.refreshing ?? false" :live-allowed="liveAllowed(entry.descriptor.id)" class="tile"
                       @snapshots="(enabled) => setSnapshots(entry.descriptor.id, enabled)" @live="(active) => setLive(entry.descriptor.id, active)" />
          <div v-else-if="!streamable(entry)" class="tile note muted">{{ entry.descriptor.capabilities.includes('live_stream') ? $t('camera.video.webrtcLater') : $t('camera.noStream') }}</div>
        </template>
      </RoomBands>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); }
.count { font-size: 13px; }
.empty { padding: 24px; text-align: center; }
.proto { font-size: 11px; letter-spacing: .04em; color: var(--muted); white-space: nowrap; }
.note { display: grid; place-items: center; min-height: 64px; padding: 16px; text-align: center; font-size: 13px; border-radius: 12px; background: rgba(0, 0, 0, .25); }
.tile { grid-column: 1 / -1; margin: 4px 0 6px; }
</style>
