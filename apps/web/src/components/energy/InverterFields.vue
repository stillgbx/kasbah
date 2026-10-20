<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceEntry } from '@kasbah/shared'
import { inverterGroups, isInverter, type InverterCell, type InverterGroup } from '../../lib/energy'
import { formatPower } from '../../lib/format'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'

// What each micro-inverter produces, right now, DRAWN LIKE THE FIELD: one cell per slot, rows and
// columns of the grid declared in the house — the same view as the 3D scene, in text. The top-left
// cell is the top-left module of the roof, and its background gauge says its share of peak: the
// shaded panel, under a leaf or broken shows at a glance, at its place. In a flat list, you would
// have had to read twenty serial numbers to find it.
const props = defineProps<{ site: DeviceEntry }>()
const devices = useDevicesStore()
const house = useHouseStore()
const { t, locale } = useI18n()

/** The inverters of THIS installation: power sensors published by the same plugin as the site. */
const inverters = computed(() => devices.list.filter((e) => isInverter(e.descriptor, props.site.descriptor.pluginId)))
const groups = computed(() => inverterGroups(house.arraysOf(props.site.descriptor.id), inverters.value))

/** Same name as in the "Panel arrays" card: the JSON's, otherwise "Array n". */
function label(g: InverterGroup): string {
  return g.name ?? (g.index === null ? t('energy.invertersLoose') : t('arrays.field', { n: g.index + 1 }))
}
/** What the cell says on hover: the inverter, its place, its power — what the cell does not hold. */
function cellTitle(g: InverterGroup, c: InverterCell): string {
  const place = g.index === null ? t('energy.noSlot') : t('arrays.slot', { r: c.row, c: c.col })
  if (!c.id) return place
  const watts = c.available ? formatPower(c.watts, locale.value) : t('common.unavailable')
  const out = at(g, g.maxOutputW) ? ` · ${t('arrays.maxOutput')} ${formatPower(g.maxOutputW, locale.value)}` : ''
  const rec = at(g, c.maxW) ? ` · ${t('energy.maxReported')} ${formatPower(c.maxW, locale.value)}` : ''
  return `${c.name} · ${place} · ${watts}${out}${rec}`
}
/** Gauge of a cell: its power relative to the field's scale (`scaleW`). */
const fill = (g: InverterGroup, c: InverterCell) => Math.min(1, Math.max(0, c.watts / g.scaleW))
/**
 * Where to place a mark on the gauge (0 = unknown value, so no mark). The scale always contains
 * both marks: neither is discarded for exceeding, it is the scale that opens up.
 */
const at = (g: InverterGroup, watts: number) => (watts > 0 ? Math.min(1, watts / g.scaleW) : 0)
</script>

<template>
  <section v-if="groups.length > 0" class="band">
    <h2 class="band__title muted">{{ $t('arrays.inverters') }}</h2>
    <div class="cards">
      <section v-for="g in groups" :key="g.id || 'loose'" class="card group">
        <div class="group__head">
          <div class="group__title">{{ label(g) }}</div>
          <!-- tabular figures and minimum width: the total changes on its own without moving the title -->
          <div class="muted group__total">{{ formatPower(g.totalW, locale) }}</div>
        </div>
        <!-- the time scale under the title, like the other blocks of the view -->
        <div class="muted group__sub">{{ $t('energy.instant') }}</div>
        <!-- The field grid: as many columns as it declares, row 1 at the top (the origin's, see
             `panelArrayDevices`). It scrolls horizontally rather than squeezing its cells when a
             field is wider than the card. -->
        <div class="grid__scroll">
          <div class="grid" :style="{ '--cols': g.cols }">
            <div v-for="c in g.cells" :key="c.key" class="cell" :data-on="c.id ? '1' : '0'" :title="cellTitle(g, c)">
              <span class="cell__fill" aria-hidden="true" :style="{ '--k': fill(g, c) }" />
              <!-- Two marks at the foot of the gauge. The RECORD first (what this inverter has
                   already put out one day), the CEILING on top (what its datasheet grants it):
                   when the two coincide — the inverter has already hit its maximum — only the
                   ceiling remains, and that is indeed what there is to say. Without them, a gauge
                   that stops at three quarters in fine weather reads as a module that is fading. -->
              <span v-if="c.id && at(g, c.maxW)" class="cell__mark cell__mark--record" aria-hidden="true" :style="{ '--at': at(g, c.maxW) }" />
              <span v-if="c.id && at(g, g.maxOutputW)" class="cell__mark cell__mark--max" aria-hidden="true" :style="{ '--at': at(g, g.maxOutputW) }" />
              <span class="cell__id">{{ c.label }}</span>
              <!-- a silent inverter is not worth 0 W: it reports nothing, and the dash says so -->
              <span v-if="c.id" class="cell__w">{{ c.available ? formatPower(c.watts, locale) : '—' }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.band__title { font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 8px 2px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 16px; align-items: start; }
/* `min-width: 0`: without it, a card would widen to hold the grid of a very wide field, and the
   whole page would overflow instead of the grid scrolling. */
.group { padding: 16px 20px; min-width: 0; }
.group__head { display: flex; align-items: baseline; gap: 12px; }
.group__title { flex: 1 1 0; min-width: 0; font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group__total { flex: 0 0 auto; min-width: 68px; text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; }
.group__sub { font-size: 12px; margin-bottom: 10px; }
.grid__scroll { overflow-x: auto; }
.grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(52px, 1fr)); gap: 5px; }
/* FIXED height, not an aspect ratio: a grid cell that draws its height from its content (or from
   an `aspect-ratio`) does not size its row, and the grid collapses (see the tooling FAQ). */
.cell {
  position: relative; isolation: isolate; overflow: hidden;
  height: 44px; display: grid; align-content: center; justify-items: center; gap: 2px;
  border-radius: 9px; border: 1px solid var(--line); padding: 0 3px; text-align: center;
}
/* cell without an inverter: the slot exists on the roof, it just has nothing to say */
.cell[data-on='0'] { border-style: dashed; opacity: .6; }
/* Gauge of the cell: a band starting from the left edge, with a SHARP edge — it is that edge we
   compare to the clipping line, a fade would make it unreadable. Under the text (negative
   z-index): nothing moves when production changes. */
.cell__fill {
  position: absolute; left: 0; top: 0; bottom: 0; z-index: -1; pointer-events: none;
  width: calc(var(--k) * 100%); background: var(--accent); opacity: .38;
  transition: width .4s ease;
}
/* Marks at the foot of the gauge: a few pixels tall, set on the bottom line, so as not to strike
   through the cell or hinder reading the figure. Over the gauge (but under the text): they stay
   visible whether or not it reached them. */
.cell__mark {
  position: absolute; bottom: 0; z-index: -1; pointer-events: none;
  /* the travel stops at the mark's width: at full scale it stays WHOLE inside the cell,
     where a mark centered on 100% would have been cut in half by the edge */
  left: calc(var(--at) * (100% - 2px)); width: 2px; height: 7px; border-radius: 1px 1px 0 0;
}
/* the color of a cover's favorite-position mark: in this house, a mark is set in `warning` */
.cell__mark--max { background: rgb(var(--v-theme-warning)); }
/* the record is a past fact, not a limit: a cooler tint, and it passes BEHIND the ceiling */
.cell__mark--record { background: rgb(var(--v-theme-success)); }
@media (prefers-reduced-motion: reduce) { .cell__fill { transition: none; } }
.cell__id { font-size: 10px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; line-height: 1; }
.cell__w { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; white-space: nowrap; }
</style>
