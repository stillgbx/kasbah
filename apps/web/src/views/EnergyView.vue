<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceEntry, EnergyHistoryPoint, StateFor } from '@kasbah/shared'
import { getTransport } from '../api'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import EvChargerCommands from '../components/controls/EvChargerCommands.vue'
import EnergyFlow from '../components/energy/EnergyFlow.vue'
import InverterFields from '../components/energy/InverterFields.vue'
import { useHomeSummary } from '../composables/useHomeSummary'
import { findEnergySite } from '../lib/energy'
import { formatEnergy, formatPower } from '../lib/format'
import { useDevicesStore } from '../stores/devices'

// Energy view: four tiles (solar, grid, battery, charger) around the "house" ring,
// then the hourly chart of today's production (server history).
const devices = useDevicesStore()
const summary = useHomeSummary()
const { locale } = useI18n()

// the SITE, and not the first `energy` that comes along: an installation also publishes a
// battery per unit, whose state carries neither production nor grid (see `lib/energy.ts`)
const energyEntry = computed(() => findEnergySite(devices.list))
const e = computed(() => energyEntry.value?.state as StateFor<'energy'> | undefined)
const charger = computed(() => summary.chargers.value[0]?.state as StateFor<'ev_charger'> | undefined)

const points = ref<EnergyHistoryPoint[]>([])
async function loadHistory() {
  const id = energyEntry.value?.descriptor.id
  if (!id) return
  try { points.value = (await getTransport().getHistory(id, 24)).points } catch { points.value = [] }
}
onMounted(loadHistory)
watch(() => energyEntry.value?.descriptor.id, loadHistory)
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(loadHistory, 60_000) })
import { onBeforeUnmount } from 'vue'
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

// bars 6 h → 20 h (local hours); future hours are greyed out, past ones on the accent
const HOURS = Array.from({ length: 15 }, (_, i) => 6 + i)
const bars = computed(() => {
  const byHour = new Map<number, EnergyHistoryPoint>()
  const now = new Date()
  for (const p of points.value) { const d = new Date(p.t); if (d.getDate() === now.getDate()) byHour.set(d.getHours(), p) }
  const max = Math.max(1000, ...points.value.map((p) => p.productionW))
  return HOURS.map((h) => {
    const p = byHour.get(h)
    const past = h <= now.getHours()
    return { h, value: p?.productionW ?? 0, pct: p ? Math.max(2, (p.productionW / max) * 100) : 2, past }
  })
})
const send = (deviceId: string, cmd: CommandInput) => devices.sendCommand(deviceId, cmd)
const todayWh = computed(() => e.value?.todayProductionWh ?? points.value.reduce((s, p) => s + p.productionW, 0))
</script>

<template>
  <div class="energy">
    <PageHeader />
    <div class="energy__scroll">
      <div v-if="!e" class="card card--soft empty muted">{{ $t('energy.noData') }}</div>
      <template v-else>
        <!-- Diagram and chart side by side: each half the width on tablet and
             desktop, one under the other below that. -->
        <div class="energy__top">
        <!-- Where the current goes, and in which direction: a number alone does not say whether
             2.4 kW is coming in or going out. The words stay in the nodes, they explain what the
             arrow shows. -->
        <EnergyFlow :energy="e" :charger="charger" />

        <section class="chart card">
          <div class="chart__head">
            <!-- The time scale follows the title, as in the flow block next to it: here the
                 day, reconstructed by the server, and not the instant. -->
            <div class="chart__heading">
              <div class="chart__title">{{ $t('energy.productionToday') }}</div>
              <div class="muted chart__scale">{{ $t('energy.localHistory') }}</div>
            </div>
            <div class="muted chart__total">{{ formatEnergy(todayWh, locale) }} · {{ $t('energy.kWhToday') }}</div>
          </div>
          <div class="chart__bars">
            <div v-for="b in bars" :key="b.h" class="bar" :title="`${b.h} h · ${formatPower(b.value, locale)}`">
              <div class="bar__fill" :class="{ 'bar__fill--past': b.past }" :style="{ height: `${b.pct}%` }" />
            </div>
          </div>
          <div class="chart__axis muted"><span>6h</span><span>13h</span><span>20h</span></div>
          <div v-if="points.length === 0" class="muted chart__hint">{{ $t('energy.noHistory') }}</div>
        </section>
        </div>
      </template>

      <!-- What each inverter produces, array by array: the view told the house's production, not
           that of a module. -->
      <InverterFields v-if="energyEntry" :site="energyEntry" />

      <!-- The devices, as in the Lights and Covers views: this is where the site,
           the batteries and the charger are placed. The panels are deliberately absent — a module
           is not placed on its own, it follows its array (`arrays` of house.json). -->
      <RoomBands :kind="['energy', 'ev_charger']">
        <!-- the charger's manual cancellation in words, at the end of its status line (the status scrolls on the left) -->
        <template #status-after="{ entry }">
          <span v-if="((entry as DeviceEntry).state as StateFor<'ev_charger'>).manualOverride" class="override">{{ $t('charger.manualOverrideShort') }}</span>
        </template>
        <!-- the charger's controls on their own row, under its status, like the heating:
             the same as in its panel (mode, start / stop, cancellation), as row buttons -->
        <template #control="{ entry }">
          <EvChargerCommands v-if="(entry as DeviceEntry).state.kind === 'ev_charger'" variant="row"
                             :descriptor="(entry as DeviceEntry).descriptor" :state="(entry as DeviceEntry).state as StateFor<'ev_charger'>"
                             :disabled="!(entry as DeviceEntry).state.available"
                             @command="(cmd: CommandInput) => send((entry as DeviceEntry).descriptor.id, cmd)" />
        </template>
      </RoomBands>
    </div>
  </div>
</template>

<style scoped>
.energy { height: 100%; display: flex; flex-direction: column; }
.energy__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); display: grid; gap: 20px; align-content: start; }
.empty { padding: 24px; text-align: center; }
/* `stretch`: the two blocks of the row have the SAME height, that of the taller one. */
.energy__top { display: grid; gap: 20px; align-items: stretch; min-width: 0; }
@media (min-width: 900px) { .energy__top { grid-template-columns: 1fr 1fr; } }
/* flexible column: the bars take the height the diagram imposes on the row */
.chart { padding: 18px 20px; display: flex; flex-direction: column; }
.chart__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
/* Scale UNDER the title: on the same line, it pushed the total onto the next line as soon as the
   card went below ~400 px wide, and the header height then followed the length of the total.
   The title has NO `min-width: 0`: that setting lets a flexible element shrink below the width
   of its longest word, and "Production" got cut at 320 px. */
.chart__title { font-weight: 600; font-size: 14px; }
.chart__scale { font-size: 12px; }
.chart__total { font-size: 12px; }
.chart__bars { display: grid; grid-template-columns: repeat(15, 1fr); gap: 10px; flex: 1 1 auto; min-height: 140px; align-items: end; }
.bar { height: 100%; display: flex; align-items: flex-end; }
.bar__fill { width: 100%; border-radius: 6px; background: var(--line); transition: height .4s; }
.bar__fill--past { background: var(--accent); }
.chart__axis { display: flex; justify-content: space-between; font-size: 12px; margin-top: 8px; }
.chart__hint { font-size: 12px; margin-top: 8px; }
.override { flex: 0 0 auto; color: rgb(var(--v-theme-warning)); }
/* Below ~432 px of window, title and total no longer fit on the same line: the total folded
   onto two lines or one DEPENDING on the day's production, so the header grew by itself over
   the hours. Here it takes its own line, and the height no longer depends on the value. */
@media (max-width: 460px) {
  .chart__head { display: block; }
  .chart__total { margin-top: 2px; }
}
</style>
