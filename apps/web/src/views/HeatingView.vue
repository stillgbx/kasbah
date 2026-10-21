<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import type { CommandInput, DeviceEntry, StateFor } from '@kasbah/shared'
import { getTransport } from '../api'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import HeatingControl from '../components/heating/HeatingControl.vue'
import HeatingHistoryChart from '../components/heating/HeatingHistoryChart.vue'
import HeatingUnitCard from '../components/heating/HeatingUnitCard.vue'
import type { HeatingPoint, MelcloudUnit } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { formatPercent } from '../lib/format'

// Heating view. Only two tiers:
//
//  1. the MACHINE and its HISTORY, side by side at the top — what belongs to no room and
//     is only read here;
//  2. the DEVICES, in their rooms, with their controls on their own row (`RoomBands`,
//     like the Lights and Covers views).
//
// There is NO extra zone list. The first version had one, and it repeated the
// same devices as the room bands thirty centimeters lower, in a different order: you
// looked twice, and set in one place what you read in the other. A heating device is now
// set where it is in the house, period.
//
// The machine and the history are not devices: they come from the plugin, not from the registry.

const devices = useDevicesStore()

const units = ref<MelcloudUnit[]>([])
const history = ref<HeatingPoint[]>([])
const pollMs = ref(60_000)

/**
 * The machine state and the history are not pushed by the WebSocket (they are not device
 * states): this page asks for them again itself, at the rate of the server poll (`pollMs`, which
 * the server returns). No point going faster than that — it would re-read the same thing.
 */
async function refresh() {
  try {
    const [sys, hist] = await Promise.all([getTransport().melcloudSystem(), getTransport().melcloudHistory()])
    units.value = sys.units
    history.value = hist.hourly
    pollMs.value = sys.pollMs || hist.pollMs || pollMs.value
  } catch {
    // plugin off or account not linked: the page keeps its devices and drops the machine part
    units.value = []
  }
}
onMounted(refresh)
const { pause } = useIntervalFn(refresh, pollMs)
onUnmounted(pause)

const send = (deviceId: string, cmd: CommandInput) => devices.sendCommand(deviceId, cmd)
/** The device that is heating right now is brought forward (warm tint, `--emph`). */
const heating = (e: DeviceEntry) => e.state.kind === 'climate' && (e.state as StateFor<'climate'>).action === 'heating'
const humidityOf =(e: DeviceEntry) => e.state.kind === 'climate' ? (e.state as StateFor<'climate'>).humidity : undefined
</script>

<template>
  <div class="page">
    <PageHeader />
    <div class="page__scroll">
      <!-- First row: the machine on the left, what it has done on the right. Two columns as soon
           as the width allows (same threshold as the Water and Energy views), one under the other
           otherwise. -->
      <div v-if="units.length" class="heat__top">
        <div class="heat__units">
          <HeatingUnitCard v-for="u in units" :key="u.deviceId" :unit="u" />
        </div>
        <HeatingHistoryChart :points="history" :poll-ms="pollMs" />
      </div>

      <RoomBands kind="climate" class="heat__bands" :emphasize="heating">
        <!-- "currently heating" or "idle", following the two temperatures that the status
             already shows: text, as the Media view puts the playback state before the title. Not
             a pill — this application uses none anywhere else in a list. -->
        <template #status-after="{ entry }">
          <span class="act" :data-hot="heating(entry as DeviceEntry) ? '1' : '0'">· {{ $t(`climate.actions.${(entry as DeviceEntry).state.kind === 'climate' ? ((entry as DeviceEntry).state as StateFor<'climate'>).action ?? 'idle' : 'idle'}`) }}</span>
          <!-- the indoor humidity, when the device measures it (Nest thermostat) -->
          <span v-if="humidityOf(entry as DeviceEntry) !== undefined" class="act">· {{ $t('climate.humidity') }} {{ formatPercent(humidityOf(entry as DeviceEntry)!, $i18n.locale) }}</span>
        </template>
        <!-- the controls on their own row, like a cover's buttons or a light's slider:
             nothing can overlap the name or the link pill -->
        <template #control="{ entry }">
          <HeatingControl :entry="entry as DeviceEntry" @command="send" />
        </template>
      </RoomBands>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); display: grid; gap: 16px; align-content: start; }
/* Same threshold as the Water and Energy views, so that the three pages behave the same at the
   same window width. And like them, we leave the grid's default `stretch`: side by side, the two
   cards have the SAME height. `align-items: start` gave a machine 68 px shorter than the
   history, and two misaligned bottom edges that broke the row. */
.heat__top { display: grid; gap: 16px; min-width: 0; }
/* the left column passes the stretch on to its card, instead of keeping it for itself */
.heat__units { display: grid; gap: 16px; min-width: 0; grid-auto-rows: 1fr; }
/* the state following the temperatures, in the same ink as the rest of the status */
.act { flex: 0 0 auto; white-space: nowrap; }
/* warm, not the accent: the accent already means "on", and a zone that is on is not heating */
.heat__bands { --emph: #e07b39; }
/* the colour only: a bold weight would widen the word and push what follows it */
.act[data-hot='1'] { color: var(--emph); }
@media (min-width: 1040px) { .heat__top { grid-template-columns: 1fr 1fr; } }
</style>
