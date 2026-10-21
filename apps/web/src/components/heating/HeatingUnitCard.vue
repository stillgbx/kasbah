<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MelcloudUnit } from '../../api/transport'
import type { IconName } from '../../lib/strokeIcons'
import { formatPercent, formatTemp } from '../../lib/format'
import StrokeIcon from '../ui/StrokeIcon.vue'

// The state of the MACHINE, as opposed to that of the zones: what runs, what heats in addition to the
// compressor, and whether it is in trouble. These measurements are not devices of the house — a dozen
// sensors for values that are only consulted here would clutter the inventory, the search and
// the 3D scene. They come from the plugin (`GET /api/plugins/melcloud/system`).
//
// Layout: the `icon | label | value` lines of the Weather view (`.wx-detail`), in two
// columns when the card is wide. The previous version squeezed four measurements onto a 14 px line and
// aligned four mute pills below: unreadable, and above all it SILENCED half of
// what the machine says. Here the space serves a purpose — the condensing temperature,
// the circulators counted, and the two electric backups told apart, which had been
// merged into a single indicator although they do not cost the same.
//
// Nothing moves: the ten lines are ALWAYS there, in the same order. A machine that starts
// defrosting lights up a line that is already present, it pushes nothing down.

const props = defineProps<{ unit: MelcloudUnit }>()
const { t, locale } = useI18n()

const temp = (v: number | null) => (v === null ? '—' : formatTemp(v, locale.value))

/** Flow / return difference: what the machine actually gives to the circuit. Absent if either is missing. */
const deltaT = computed(() => {
  const { flowTempC: f, returnTempC: r } = props.unit
  return f === null || r === null ? null : Math.round((f - r) * 10) / 10
})

interface Line { key: string; icon: IconName; label: string; value: string; on: boolean; warn?: boolean }

/**
 * Measurements first, states after. An inactive state keeps its line and shows a dash:
 * that is what lets you read "no, the electric backup is not running" as quickly as the
 * opposite — an unlit pill, for its part, gets mistaken for a pill one has not noticed.
 */
const lines = computed<Line[]>(() => {
  const u = props.unit
  const flag = (on: boolean) => (on ? t('heating.unit.active') : '—')
  const running = u.pumps.filter(Boolean).length
  return [
    { key: 'flow', icon: 'arrowUp', label: t('heating.unit.flow'), value: temp(u.flowTempC), on: u.flowTempC !== null },
    { key: 'return', icon: 'arrowDown', label: t('heating.unit.return'), value: temp(u.returnTempC), on: u.returnTempC !== null },
    { key: 'delta', icon: 'unfold', label: t('heating.unit.delta'), value: deltaT.value === null ? '—' : `${deltaT.value.toLocaleString(locale.value)} °`, on: deltaT.value !== null },
    { key: 'condensing', icon: 'flask', label: t('heating.unit.condensing'), value: temp(u.condensingTempC), on: u.condensingTempC !== null },
    { key: 'demand', icon: 'gauge', label: t('heating.unit.demand'), value: u.demandPercent === null ? '—' : formatPercent(u.demandPercent, locale.value), on: u.demandPercent !== null },
    { key: 'defrost', icon: 'snow', label: t('heating.unit.lamps.defrost'), value: flag(u.defrosting), on: u.defrosting },
    { key: 'booster', icon: 'bolt', label: t('heating.unit.lamps.booster'), value: flag(u.boosterHeater), on: u.boosterHeater, warn: true },
    { key: 'immersion', icon: 'bolt', label: t('heating.unit.lamps.immersion'), value: flag(u.immersionHeater), on: u.immersionHeater, warn: true },
    { key: 'pump', icon: 'waves', label: t('heating.unit.lamps.pump'), value: running ? t('heating.unit.pumpsOf', { n: running, total: u.pumps.length }) : '—', on: running > 0 },
    { key: 'valve', icon: 'wrench', label: t('heating.unit.lamps.valve'), value: flag(u.valve3Way), on: u.valve3Way },
  ]
})

/**
 * "Unreachable" is read from `stale`, never from `offline`: on this machine, the vendor ticks
 * `Offline` although it reports every minute. The server decides on freshness.
 */
const seen = computed(() => (props.unit.lastSeen === null ? null : new Date(props.unit.lastSeen)))
</script>

<template>
  <section class="card unit">
    <div class="unit__head">
      <span class="icon-square" :data-on="unit.power && !unit.stale ? '1' : '0'">
        <StrokeIcon name="heatpump" :size="18" />
      </span>
      <div class="unit__main">
        <div class="unit__name">{{ unit.name }}</div>
        <div class="muted unit__sub">
          {{ unit.stale ? $t('heating.unit.offline') : unit.heating ? $t('heating.unit.heating') : unit.power ? $t('heating.unit.on') : $t('heating.unit.standby') }}
          <template v-if="unit.wifi"> · {{ unit.wifi }}</template>
        </div>
      </div>
      <div class="unit__stat">
        <div class="unit__value">{{ temp(unit.outdoorTempC) }}</div>
        <div class="muted unit__status">{{ $t('heating.unit.outdoor') }}</div>
      </div>
    </div>

    <!-- `hasError` and never the code: at this vendor, 8000 is the value of GOOD operation -->
    <p v-if="unit.error.hasError" class="unit__alert small">
      <StrokeIcon name="alert" :size="14" />
      {{ unit.error.message ?? $t('heating.unit.errorCode', { code: unit.error.code ?? '?' }) }}
    </p>

    <dl class="unit__rows">
      <div v-for="l in lines" :key="l.key" class="line" :data-on="l.on ? '1' : '0'" :data-warn="l.warn ? '1' : '0'">
        <StrokeIcon :name="l.icon" :size="18" class="line__icon" />
        <dt class="line__label">{{ l.label }}</dt>
        <dd class="line__value">{{ l.value }}</dd>
      </div>
    </dl>

    <p class="muted small unit__seen">
      {{ seen ? $t('heating.unit.lastSeen', { time: seen.toLocaleTimeString($i18n.locale, { hour: '2-digit', minute: '2-digit' }) }) : $t('heating.unit.neverSeen') }}
      <template v-if="!unit.energyMeter"> · {{ $t('heating.unit.noMeter') }}</template>
    </p>
  </section>
</template>

<style scoped>
/* `space-between`: stretched to the height of the neighboring history, the card spreads its blocks instead
   of packing them at the top and leaving a hole under the last one. */
.unit { padding: 14px 16px; display: grid; gap: 12px; min-width: 0; align-content: space-between; }
.unit__head { display: flex; align-items: center; gap: 12px; }
.unit__main { flex: 1 1 auto; min-width: 0; }
.unit__name { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unit__sub { font-size: 12px; margin-top: 2px; min-height: 1em; }
.unit__stat { flex: 0 0 auto; text-align: right; }
.unit__value { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.unit__status { font-size: 12px; margin-top: 2px; }
.unit__alert { display: flex; align-items: center; gap: 8px; margin: 0; color: #d24a43; }

/* Two columns as soon as the card is wide enough: ten lines in a single column would make a
   card twice as tall as the neighboring history. */
.unit__rows { display: grid; gap: 2px 24px; margin: 0; grid-template-columns: 1fr; }
@media (min-width: 520px) { .unit__rows { grid-template-columns: 1fr 1fr; } }
/* the Weather view's line: icon, label, value, fixed height */
.line { display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 10px; height: 30px; min-width: 0; }
.line__icon { color: var(--muted); }
.line__label { margin: 0; font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.line__value { margin: 0; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--muted); }
/* what runs is visible: the value takes the text ink, the icon turns to the accent */
.line[data-on="1"] .line__value { color: var(--text); }
.line[data-on="1"] .line__icon { color: var(--accent); }
/* an ELECTRIC backup that runs is what costs a lot on this card: it announces itself in orange */
.line[data-on="1"][data-warn="1"] .line__icon,
.line[data-on="1"][data-warn="1"] .line__value { color: #d38b22; }
.unit__seen { margin: 0; }
.small { font-size: 12px; }
</style>
