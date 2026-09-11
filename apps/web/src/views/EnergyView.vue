<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { EnergyHistoryPoint, StateFor } from '@kasbah/shared'
import { getTransport } from '../api'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import StatTile from '../components/ui/StatTile.vue'
import { useHomeSummary } from '../composables/useHomeSummary'
import { findEnergySite } from '../lib/energy'
import { formatEnergy, formatPercent, formatPower } from '../lib/format'
import { useDevicesStore } from '../stores/devices'

// Vue Énergie : quatre tuiles (solaire, réseau, batterie, borne) autour de l'anneau « maison »,
// puis le graphique horaire de production du jour (historique serveur).
const devices = useDevicesStore()
const summary = useHomeSummary()
const { locale } = useI18n()

// le SITE, et non le premier `energy` venu : une installation publie aussi une batterie par unité,
// dont l'état ne porte ni production ni réseau (voir `lib/energy.ts`)
const energyEntry = computed(() => findEnergySite(devices.list))
const e = computed(() => energyEntry.value?.state as StateFor<'energy'> | undefined)
const charger = computed(() => summary.chargers.value[0]?.state as StateFor<'ev_charger'> | undefined)
const chargerVehicle = computed(() => summary.vehicles.value.find((v) => (v.state as StateFor<'vehicle'>).charging)?.descriptor.name)

const selfConsumption = computed(() => {
  if (!e.value) return 0
  const p = e.value.productionW
  if (p <= 0) return 0
  const exported = Math.max(0, -e.value.gridW)
  return Math.round(Math.min(100, ((p - exported) / p) * 100))
})

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

// barres 6 h → 20 h (heures locales) ; les heures futures sont grisées, les passées sur l'accent
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
const todayWh = computed(() => e.value?.todayProductionWh ?? points.value.reduce((s, p) => s + p.productionW, 0))
</script>

<template>
  <div class="energy">
    <PageHeader />
    <div class="energy__scroll">
      <div v-if="!e" class="card card--soft empty muted">{{ $t('energy.noData') }}</div>
      <template v-else>
        <div class="energy__grid">
          <StatTile icon="solar" :value="formatPower(e.productionW, locale)" :label="$t('energy.production')" :hint="$t('home.solar')" />
          <div class="ring card">
            <div class="ring__inner">
              <div class="muted ring__label">{{ $t('energy.house') }}</div>
              <div class="ring__value">{{ formatPower(e.consumptionW, locale) }}</div>
              <div class="muted ring__label">{{ formatPercent(selfConsumption, locale) }} {{ $t('energy.selfConsumption') }}</div>
            </div>
          </div>
          <StatTile icon="battery" :value="e.batterySoc !== undefined ? formatPercent(e.batterySoc, locale) : '—'"
                    :label="`${$t('energy.battery')}${e.batteryW !== undefined ? ` · ${(e.batteryW >= 0 ? '+' : '') + formatPower(e.batteryW, locale)}` : ''}`"
                    :hint="e.batteryW !== undefined ? $t(e.batteryW >= 0 ? 'energy.charging' : 'energy.discharging') : undefined" />
          <StatTile icon="bolt" :value="formatPower(Math.abs(e.gridW), locale)" :label="`${$t('energy.grid')} · ${$t(e.gridW >= 0 ? 'energy.import' : 'energy.export')}`" />
          <StatTile icon="charger" :value="charger ? formatPower(charger.powerW, locale) : '—'" :label="`${$t('energy.charger')}${chargerVehicle ? ` · ${chargerVehicle}` : ''}`"
                    :hint="charger ? $t(`charger.status.${charger.status}`) : undefined" />
        </div>

        <section class="chart card">
          <div class="chart__head">
            <div class="chart__title">{{ $t('energy.productionToday') }}</div>
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
      </template>

      <!-- Les appareils, comme dans les vues Lumières et Ouvrants : c'est ici qu'on place le site,
           les batteries et la borne. Les panneaux en sont absents volontairement — un module ne se
           place pas seul, il suit son champ (`arrays` de house.json). -->
      <RoomBands :kind="['energy', 'ev_charger']" />
    </div>
  </div>
</template>

<style scoped>
.energy { height: 100%; display: flex; flex-direction: column; }
.energy__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); display: grid; gap: 20px; align-content: start; }
.empty { padding: 24px; text-align: center; }
.energy__grid { display: grid; grid-template-columns: 1fr auto 1fr; grid-template-rows: auto auto; gap: 12px 16px; align-items: stretch; }
.ring { grid-row: 1 / span 2; grid-column: 2; width: 180px; aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center; align-self: center;
  border: 10px solid var(--accent-soft); box-shadow: inset 0 0 0 1px var(--line); }
.ring__inner { text-align: center; padding: 8px; }
.ring__value { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; }
.ring__label { font-size: 12px; }
.chart { padding: 18px 20px; }
.chart__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.chart__title { font-weight: 600; font-size: 14px; }
.chart__total { font-size: 12px; }
.chart__bars { display: grid; grid-template-columns: repeat(15, 1fr); gap: 10px; height: 200px; align-items: end; }
.bar { height: 100%; display: flex; align-items: flex-end; }
.bar__fill { width: 100%; border-radius: 6px; background: var(--line); transition: height .4s; }
.bar__fill--past { background: var(--accent); }
.chart__axis { display: flex; justify-content: space-between; font-size: 12px; margin-top: 8px; }
.chart__hint { font-size: 12px; margin-top: 8px; }
@media (max-width: 900px) {
  .energy__grid { grid-template-columns: 1fr 1fr; }
  .ring { grid-row: auto; grid-column: 1 / span 2; justify-self: center; }
}
</style>
