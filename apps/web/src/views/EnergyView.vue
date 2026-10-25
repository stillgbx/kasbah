<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceEnergyDays, DeviceEntry, EnergyHistoryPoint, StateFor } from '@kasbah/shared'
import { getTransport } from '../api'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import EvChargerCommands from '../components/controls/EvChargerCommands.vue'
import EnergyFlow from '../components/energy/EnergyFlow.vue'
import InverterFields from '../components/energy/InverterFields.vue'
import Segmented from '../components/ui/Segmented.vue'
import { useHomeSummary } from '../composables/useHomeSummary'
import type { PeriodMode } from '../lib/consumption'
import { findEnergySite } from '../lib/energy'
import { ENERGY_PERIODS, MODE_PERIODS, formatEnergyTotal, inverterTotals, periodBars, periodTotals, type EnergyPeriod } from '../lib/energyPeriods'
import { formatEnergy, formatPower } from '../lib/format'
import { useDevicesStore } from '../stores/devices'

// Energy view: the flow diagram and the production chart side by side, then the inverters and the
// devices. A period selector drives the two blocks of the top row: the instant, or what flowed over
// the day, the week, the month, the year or since commissioning — the week, the month and the year
// cut rolling or calendar. The periods come from the site's daily history (`energy_history`):
// without it, the view shows the instant only.
const devices = useDevicesStore()
const summary = useHomeSummary()
const { locale, t } = useI18n()

// the SITE, and not the first `energy` that comes along: an installation also publishes a
// battery per unit, whose state carries neither production nor grid (see `lib/energy.ts`)
const energyEntry = computed(() => findEnergySite(devices.list))
const e = computed(() => energyEntry.value?.state as StateFor<'energy'> | undefined)
const charger = computed(() => summary.chargers.value[0]?.state as StateFor<'ev_charger'> | undefined)
const hasHistory = computed(() => energyEntry.value?.descriptor.capabilities.includes('energy_history') ?? false)

const period = ref<EnergyPeriod>('instant')
const mode = ref<PeriodMode>('rolling')
const periodic = computed(() => hasHistory.value && period.value !== 'instant')
/** On a phone the periods scroll sideways: the one chosen is brought into view. */
const periodsScroll = ref<HTMLElement | null>(null)
watch(period, async () => {
  await nextTick()
  const on = periodsScroll.value?.querySelector<HTMLElement>('[data-on="1"]')
  const box = periodsScroll.value
  if (!on || !box) return
  const left = on.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft
  if (left < box.scrollLeft) box.scrollLeft = left
  else if (left + on.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = left + on.offsetWidth - box.clientWidth
})
const periodOptions = computed(() => ENERGY_PERIODS.map((p) => ({ value: p, label: t(`energy.periods.${p}`) })))
// greyed rather than hidden outside the week, the month and the year: the row keeps its shape
const modeOptions = computed(() => (['rolling', 'calendar'] as const).map((m) => ({
  value: m, label: t(`energy.modes.${m}`), disabled: !MODE_PERIODS.includes(period.value),
})))

const now = ref(Date.now())
const points = ref<EnergyHistoryPoint[]>([])
async function loadHistory() {
  const id = energyEntry.value?.descriptor.id
  if (!id) return
  try { points.value = (await getTransport().getHistory(id, 24)).points } catch { points.value = [] }
}
const days = ref<DeviceEnergyDays | null>(null)
/** Only while a period is shown: the instant does not need the daily history. */
async function loadDays() {
  const id = energyEntry.value?.descriptor.id
  if (!id || !periodic.value) return
  try { days.value = await getTransport().getEnergyDays(id) } catch { days.value = null }
}
onMounted(loadHistory)
watch(() => energyEntry.value?.descriptor.id, () => { void loadHistory(); void loadDays() })
watch(periodic, loadDays)
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(() => { now.value = Date.now(); void loadHistory(); void loadDays() }, 60_000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const since = computed(() => days.value?.since ?? null)
const totals = computed(() => (periodic.value
  ? periodTotals(days.value?.days ?? [], period.value, mode.value, now.value, since.value, e.value)
  : null))

/** Which period the two blocks speak of, under their titles. */
const scale = computed(() => {
  const p = period.value
  if (!periodic.value) return t('energy.instant')
  if (p === 'day') return t('energy.today')
  if (p === 'lifetime') {
    return since.value !== null
      ? t('energy.scale.lifetime', { date: new Date(since.value).toLocaleDateString(locale.value, { dateStyle: 'medium' }) })
      : t('energy.scale.lifetimeUnknown')
  }
  if (mode.value === 'rolling') return t(`energy.scale.rolling.${p}`)
  const d = new Date(now.value)
  if (p === 'week') return t('energy.scale.thisWeek')
  if (p === 'month') { const m = d.toLocaleDateString(locale.value, { month: 'long', year: 'numeric' }); return m.charAt(0).toUpperCase() + m.slice(1) }
  return String(d.getFullYear())
})
/** The period as the inverters' cells show it: their own totals, under the same scale as the blocks above. */
const inverterPeriod = computed(() => (periodic.value && days.value?.inverters
  ? { scale: scale.value, wh: inverterTotals(days.value.inverters, period.value, mode.value, now.value, since.value) }
  : null))
const scaleNoted = computed(() => (totals.value?.incomplete ? `${scale.value} · ${t('energy.incomplete')}` : scale.value))

/** The hours of the day (6 h → 20 h) for the instant and the day, the steps of the period otherwise. */
const hourly = computed(() => !periodic.value || period.value === 'day')

interface Bar { key: number; pct: number; on: boolean; title: string }
// bars 6 h → 20 h (local hours); future hours are greyed out, past ones on the accent
const HOURS = Array.from({ length: 15 }, (_, i) => 6 + i)
const periodList = computed(() => (hourly.value ? [] : periodBars(
  days.value?.days ?? [], period.value as 'week' | 'month' | 'year' | 'lifetime', mode.value, now.value, since.value, e.value,
)))
function stepLabel(at: number): string {
  const d = new Date(at)
  if (period.value === 'week') return d.toLocaleDateString(locale.value, { weekday: 'short' })
  if (period.value === 'month') return d.toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })
  if (period.value === 'lifetime') return d.toLocaleDateString(locale.value, { month: 'short', year: '2-digit' })
  return d.toLocaleDateString(locale.value, { month: 'short' })
}
const bars = computed<Bar[]>(() => {
  if (hourly.value) {
    const byHour = new Map<number, EnergyHistoryPoint>()
    const today = new Date(now.value)
    for (const p of points.value) { const d = new Date(p.t); if (d.getDate() === today.getDate()) byHour.set(d.getHours(), p) }
    const max = Math.max(1000, ...points.value.map((p) => p.productionW))
    return HOURS.map((h) => {
      const p = byHour.get(h)
      return { key: h, pct: p ? Math.max(2, (p.productionW / max) * 100) : 2, on: h <= today.getHours(), title: `${h} h · ${formatPower(p?.productionW ?? 0, locale.value)}` }
    })
  }
  const max = Math.max(1, ...periodList.value.map((b) => b.wh ?? 0))
  return periodList.value.map((b) => ({
    key: b.t, pct: b.wh ? Math.max(2, (b.wh / max) * 100) : 2, on: b.wh !== null && !b.future,
    title: `${stepLabel(b.t)} · ${b.wh === null ? '—' : formatEnergyTotal(b.wh, locale.value)}`,
  }))
})
/** Three marks under the bars: the first step, the middle one, the last one. */
const axis = computed(() => {
  if (hourly.value) return ['6h', '13h', '20h']
  const list = periodList.value
  if (!list.length) return ['', '', '']
  return [list[0]!, list[Math.floor((list.length - 1) / 2)]!, list[list.length - 1]!].map((b) => stepLabel(b.t))
})
const emptyChart = computed(() => (hourly.value ? points.value.length === 0 : !periodList.value.some((b) => b.wh !== null)))

const send = (deviceId: string, cmd: CommandInput) => devices.sendCommand(deviceId, cmd)
const todayWh = computed(() => e.value?.todayProductionWh ?? points.value.reduce((s, p) => s + p.productionW, 0))
const chartTotal = computed(() => (periodic.value && period.value !== 'day'
  ? formatEnergyTotal(totals.value?.productionWh ?? 0, locale.value)
  : formatEnergy(todayWh.value, locale.value)))
</script>

<template>
  <div class="energy">
    <PageHeader />
    <div class="energy__scroll">
      <div v-if="!e" class="card card--soft empty muted">{{ $t('energy.noData') }}</div>
      <template v-else>
        <!-- The period of the two blocks below, and how the week, the month and the year are cut.
             The cut stays in place, greyed, for the periods it does not change. -->
        <div v-if="hasHistory" class="energy__periods">
          <div ref="periodsScroll" class="energy__periodsScroll">
            <Segmented v-model="period" :options="periodOptions" dense :label="$t('energy.periodLabel')" />
          </div>
          <Segmented v-model="mode" :options="modeOptions" dense :label="$t('energy.modeLabel')" />
        </div>
        <!-- Diagram and chart side by side: each half the width on tablet and
             desktop, one under the other below that. -->
        <div class="energy__top">
        <!-- Where the current goes, and in which direction: a number alone does not say whether
             2.4 kW is coming in or going out. The words stay in the nodes, they explain what the
             arrow shows. -->
        <EnergyFlow :energy="e" :charger="charger" :totals="totals" :scale="scaleNoted" />

        <section class="chart card">
          <div class="chart__head">
            <!-- The time scale follows the title, as in the flow block next to it: the day,
                 reconstructed by the server, or the period chosen above. -->
            <div class="chart__heading">
              <div class="chart__title">{{ hourly ? $t('energy.productionToday') : $t('energy.production') }}</div>
              <div class="muted chart__scale">{{ periodic && period !== 'day' ? scaleNoted : $t('energy.localHistory') }}</div>
            </div>
            <div class="muted chart__total">{{ chartTotal }} · {{ periodic && period !== 'day' ? $t('energy.produced') : $t('energy.kWhToday') }}</div>
          </div>
          <div class="chart__bars" :class="{ 'chart__bars--dense': bars.length > 15 }" :style="{ gridTemplateColumns: `repeat(${bars.length}, 1fr)` }">
            <div v-for="b in bars" :key="b.key" class="bar" :title="b.title">
              <div class="bar__fill" :class="{ 'bar__fill--past': b.on }" :style="{ height: `${b.pct}%` }" />
            </div>
          </div>
          <div class="chart__axis muted"><span v-for="(a, i) in axis" :key="i">{{ a }}</span></div>
          <div v-if="emptyChart" class="muted chart__hint">{{ hourly ? $t('energy.noHistory') : $t('energy.noPeriodHistory') }}</div>
        </section>
        </div>
      </template>

      <!-- What each inverter produces, array by array: the view told the house's production, not
           that of a module. -->
      <InverterFields v-if="energyEntry" :site="energyEntry" :period="inverterPeriod" />

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
/* The two selectors share a line while they fit, then the cut goes under the periods: the wrap
   depends on the width only, never on the period chosen. The periods scroll sideways rather than
   overflowing the page on a phone. */
.energy__periods { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; min-width: 0; }
.energy__periodsScroll { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.energy__periodsScroll::-webkit-scrollbar { display: none; }
/* `stretch`: the two blocks of the row have the SAME height, that of the taller one. */
.energy__top { display: grid; gap: 20px; align-items: stretch; min-width: 0; }
@media (min-width: 900px) { .energy__top { grid-template-columns: 1fr 1fr; } }
/* flexible column: the bars take the height the diagram imposes on the row */
.chart { padding: 18px 20px; display: flex; flex-direction: column; min-width: 0; }
.chart__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
/* Scale UNDER the title: on the same line, it pushed the total onto the next line as soon as the
   card went below ~400 px wide, and the header height then followed the length of the total.
   The title has NO `min-width: 0`: that setting lets a flexible element shrink below the width
   of its longest word, and "Production" got cut at 320 px. */
.chart__title { font-weight: 600; font-size: 14px; }
.chart__scale { font-size: 12px; }
.chart__total { font-size: 12px; }
.chart__bars { display: grid; gap: 10px; flex: 1 1 auto; min-height: 140px; align-items: end; }
/* a month of days: ten-pixel gaps would leave the bars no width on a phone */
.chart__bars--dense { gap: 3px; }
.bar { height: 100%; display: flex; align-items: flex-end; min-width: 0; }
.bar__fill { width: 100%; border-radius: 6px; background: var(--line); transition: height .4s; }
.chart__bars--dense .bar__fill { border-radius: 3px; }
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
