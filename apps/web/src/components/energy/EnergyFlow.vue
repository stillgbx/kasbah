<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElementSize, usePreferredReducedMotion } from '@vueuse/core'
import type { StateFor } from '@kasbah/shared'
import { IDLE_W } from '../../lib/energy'
import { formatEnergyTotal, type EnergyTotals } from '../../lib/energyPeriods'
import { formatPercent, formatPower } from '../../lib/format'
import StrokeIcon from '../ui/StrokeIcon.vue'
import type { IconName } from '../../lib/strokeIcons'

// Energy flow diagram. The HOUSE is at the center, in a ring that shows where its consumption
// comes from — solar, battery, grid — and the sources around it, linked at right angles. A dot
// runs along each line in the real direction of the current: a number alone does not say whether
// 2.4 kW is coming in or going out. The WORDS remain — "export", "discharge" — to explain the
// arrow.
//
// The SVG reference frame is the MEASURED scene, in pixels: one SVG unit per pixel, so nothing is
// stretched, the angles stay square and the dot stays a disc. Measuring rather than fixing an
// aspect ratio, because neither `aspect-ratio` nor a percentage `padding` sizes a grid row — the
// card stayed 79 px tall while the diagram spread over 467 px.
//
// Nothing moves when a value changes: the nodes are permanent, the three ring shares are always
// listed (even at zero), and an idle flow keeps its line, in grey.
//
// Over a PERIOD (`totals`), the same diagram tells what flowed: energies instead of powers, the
// ring from what fed the house over the period, and no dot — over a day or a year the current went
// both ways, a direction would lie. `scale` says which period, under the title.

const props = defineProps<{
  energy: StateFor<'energy'>
  charger?: StateFor<'ev_charger'> | undefined
  totals?: EnergyTotals | null
  scale?: string
}>()
const { t, locale } = useI18n()
/** Unique ids: two diagrams on a page must not share their paths. */
const uid = useId()
const reduced = usePreferredReducedMotion()

const stage = ref<HTMLElement | null>(null)
const { width, height } = useElementSize(stage)
/** As long as the scene is not measured, there is no frame to draw in. */
const measured = computed(() => width.value > 0 && height.value > 0)

/** Anchor of each source, as a fraction of the scene. The house takes the center. */
const POS = {
  solar: { x: 0.16, y: 0.22 },
  battery: { x: 0.84, y: 0.22 },
  grid: { x: 0.16, y: 0.78 },
  charger: { x: 0.84, y: 0.78 },
} as const
type NodeKey = keyof typeof POS

/** Ring radius: a share of the smallest dimension, so that it fits in every frame. */
const radius = computed(() => Math.max(44, Math.min(width.value, height.value) * 0.22))
const centre = computed(() => ({ x: width.value / 2, y: height.value / 2 }))

/** Power at which the dot moves fastest. */
const FULL_W = 6000
/** Dot radii, in pixels since the frame is too. */
const DOT = { halo: 9, core: 4 }

const e = computed(() => props.energy)

interface Flow { key: NodeKey; direction: 'in' | 'out' | 'idle'; watts: number }

/**
 * `in`: the current goes from the source TO the house. `out`: it leaves it. The path is always
 * written from the source to the house, and `out` makes the dot go backwards.
 */
const flows = computed<Flow[]>(() => {
  const s = e.value
  const tt = props.totals
  if (tt) {
    // over a period: a source is lit when something flowed through it, whatever the direction
    const lit = (key: NodeKey, wh: number): Flow => (wh > 0 ? { key, direction: 'in', watts: 0 } : { key, direction: 'idle', watts: 0 })
    return [
      lit('solar', tt.productionWh ?? 0),
      lit('grid', (tt.importWh ?? 0) + (tt.exportWh ?? 0)),
      lit('battery', (tt.chargeWh ?? 0) + (tt.dischargeWh ?? 0)),
      lit('charger', tt.evseWh ?? 0),
    ]
  }
  const flow = (key: NodeKey, towardsHouse: number): Flow =>
    Math.abs(towardsHouse) < IDLE_W
      ? { key, direction: 'idle', watts: 0 }
      : { key, direction: towardsHouse > 0 ? 'in' : 'out', watts: Math.abs(towardsHouse) }
  return [
    flow('solar', s.productionW),                     // solar feeds, never the other way round
    flow('grid', s.gridW),                            // `gridW` > 0 = draw from the grid, so toward the house
    flow('battery', -(s.batteryW ?? 0)),              // `batteryW` > 0 = charging, so from the house
    flow('charger', -(props.charger?.powerW ?? 0)),   // the charger consumes
  ]
})

const flowOf = (key: NodeKey) => flows.value.find((f) => f.key === key)!
/** A flow under the threshold goes nowhere: no word must give it a direction. */
const idle = (key: NodeKey) => flowOf(key).direction === 'idle'

/** Elbow radius. A sharp angle reads badly at this stroke width. */
const CORNER = 14
/**
 * Offset of the vertical segment from the center, as a share of the radius: where the arrival
 * lands on the ring.
 */
const APPROACH = 0.45

/**
 * L-shaped path: we leave the source by the SIDE, horizontally, then go down or up to arrive at
 * the TOP or BOTTOM of the ring. The arrival point is computed with Pythagoras, to touch the circle
 * exactly — an approximate distance would bite into it or stop in the void. The start is taken
 * at the center of the source: its opaque box hides the end that passes through it.
 */
function path(key: NodeKey): string {
  const p = POS[key]
  const c = centre.value, r = radius.value
  const x0 = p.x * width.value, y0 = p.y * height.value
  const dx = (p.x < 0.5 ? -1 : 1) * r * APPROACH
  const xv = c.x + dx
  const yIn = c.y + (p.y < 0.5 ? -1 : 1) * Math.sqrt(Math.max(1, r * r - dx * dx))
  const sx = Math.sign(xv - x0), sy = Math.sign(yIn - y0)
  const k = Math.min(CORNER, Math.abs(xv - x0) / 2, Math.abs(yIn - y0) / 2)
  const n = (v: number) => v.toFixed(1)
  return `M ${n(x0)} ${n(y0)} H ${n(xv - sx * k)} Q ${n(xv)} ${n(y0)} ${n(xv)} ${n(y0 + sy * k)} V ${n(yIn)}`
}

/**
 * One full turn of the dot. Deliberately SLOW: the diagram is watched, it does not race. Nine
 * seconds when almost nothing flows, five at full power.
 */
const duration = (watts: number) => `${(9 - 4 * Math.min(1, watts / FULL_W)).toFixed(1)}s`
const pathId = (key: NodeKey) => `flow-${uid}-${key}`

/**
 * Where what the house consumes comes from. The contract's balance reads
 * `consumption = production + grid − battery`, so what feeds it is the draw from the grid, the
 * discharge, and solar for the rest. A charge or an export are NOT shares of the consumption:
 * they leave it.
 */
const mix = computed(() => {
  const s = e.value
  const tt = props.totals
  if (tt) {
    // over a period, the vendor (or the server's integration) already split the house
    const parts = { solar: tt.solarHomeWh ?? 0, battery: tt.batteryHomeWh ?? 0, grid: tt.gridHomeWh ?? 0 }
    const total = parts.solar + parts.battery + parts.grid
    const share = (wh: number) => (total > 0 ? wh / total : 0)
    return [
      { key: 'solar' as const, label: t('home.solar'), part: share(parts.solar) },
      { key: 'battery' as const, label: t('energy.battery'), part: share(parts.battery) },
      { key: 'grid' as const, label: t('energy.grid'), part: share(parts.grid) },
    ]
  }
  // same threshold as the lines: a source under `IDLE_W` makes no dot move, so it must not
  // claim a share of the ring — "1% battery" without an electron was confusing
  const over = (w: number) => (w >= IDLE_W ? w : 0)
  const fromGrid = over(Math.max(0, s.gridW))
  const fromBattery = over(Math.max(0, -(s.batteryW ?? 0)))
  // bounded by PRODUCTION: solar cannot give the house more than it produces. Left alone, it picked
  // up the whole gap between the meters — "1% Solar" at night, panels off.
  const fromSolar = over(Math.min(Math.max(0, s.productionW), Math.max(0, s.consumptionW - fromGrid - fromBattery)))
  const total = fromSolar + fromGrid + fromBattery
  const share = (w: number) => (total > 0 ? w / total : 0)
  return [
    { key: 'solar' as const, label: t('home.solar'), part: share(fromSolar) },
    { key: 'battery' as const, label: t('energy.battery'), part: share(fromBattery) },
    { key: 'grid' as const, label: t('energy.grid'), part: share(fromGrid) },
  ]
})

/** Ring in its own SQUARE frame: no distortion to correct. */
const RING = { r: 44, w: 9 }
const CIRC = 2 * Math.PI * RING.r
/** Each share starts where the previous one stops; the CSS rotation puts the start at the top. */
const arcs = computed(() => {
  let start = 0
  return mix.value.map((m) => {
    const len = m.part * CIRC
    const arc = { key: m.key, len, offset: -start }
    start += len
    return arc
  })
})

interface NodeView { key: NodeKey; icon: IconName; value: string; label: string; hint: string; shown: boolean }

/** An energy of the period, or a dash when no day carried it. */
const wh = (v: number | undefined) => (v === undefined ? '—' : formatEnergyTotal(v, locale.value))

const nodes = computed<NodeView[]>(() => {
  const s = e.value
  const battW = s.batteryW ?? 0
  const tt = props.totals
  const hasBattery = s.batterySoc !== undefined || s.batteryW !== undefined
  if (tt) {
    // the value is what came INTO the house's side (import, discharge), the hint what went the other way
    return [
      { key: 'solar', icon: 'solar', value: wh(tt.productionWh), label: t('energy.production'), hint: '', shown: true },
      {
        key: 'battery', icon: 'battery', value: wh(tt.dischargeWh), label: t('energy.battery'),
        hint: tt.chargeWh !== undefined ? t('energy.periodCharged', { e: wh(tt.chargeWh) }) : '', shown: hasBattery,
      },
      {
        key: 'grid', icon: 'grid', value: wh(tt.importWh), label: t('energy.grid'),
        hint: tt.exportWh !== undefined ? t('energy.periodExported', { e: wh(tt.exportWh) }) : '', shown: true,
      },
      { key: 'charger', icon: 'charger', value: wh(tt.evseWh), label: t('energy.charger'), hint: '', shown: !!props.charger },
    ]
  }
  return [
    { key: 'solar', icon: 'solar', value: formatPower(s.productionW, locale.value), label: t('energy.production'), hint: '', shown: true },
    {
      key: 'battery', icon: 'battery',
      value: s.batterySoc !== undefined ? formatPercent(s.batterySoc, locale.value) : '—',
      label: t('energy.battery'),
      // "Charging" / "Discharging" only makes sense if a dot is moving: otherwise the sign of
      // the noise flipped the word from one reading to the next, battery at rest.
      hint: s.batteryW === undefined ? ''
        : idle('battery') ? t('energy.idle')
        : `${t(battW >= 0 ? 'energy.charging' : 'energy.discharging')} ${formatPower(Math.abs(battW), locale.value)}`,
      shown: hasBattery,
    },
    {
      key: 'grid', icon: 'grid', value: formatPower(Math.abs(s.gridW), locale.value),
      label: t('energy.grid'), hint: idle('grid') ? t('energy.idle') : t(s.gridW >= 0 ? 'energy.import' : 'energy.export'), shown: true,
    },
    {
      key: 'charger', icon: 'charger', value: formatPower(props.charger?.powerW ?? 0, locale.value),
      label: t('energy.charger'), hint: props.charger ? t(`charger.status.${props.charger.status}`) : '', shown: !!props.charger,
    },
  ]
})

const shown = (key: NodeKey) => nodes.value.find((n) => n.key === key)!.shown
</script>

<template>
  <section class="flow card" :aria-label="$t('energy.flowTitle')">
    <!-- What the block shows, spelled out: here the instant, next to it the day. The two blocks of
         the row do not speak of the same time scale, and nothing said so. -->
    <div class="flow__head">
      <div class="flow__title">{{ $t('energy.flowTitle') }}</div>
      <div class="muted flow__scale">{{ scale ?? $t('energy.instant') }}</div>
    </div>
    <!-- The frame clips, the scene keeps its minimum width: below it, the four nodes and the
         ring CANNOT fit side by side, and overlapped instead of being readable. -->
    <div class="flow__viewport">
      <div ref="stage" class="flow__stage">
        <svg v-if="measured" class="flow__links" :viewBox="`0 0 ${Math.round(width)} ${Math.round(height)}`" aria-hidden="true">
          <template v-for="f in flows" :key="f.key">
            <path v-if="shown(f.key)" :id="pathId(f.key)" class="flow__wire" :d="path(f.key)" />
          </template>
          <!-- a single dot per active path, slow: it goes from the source to the house, or the reverse -->
          <template v-for="f in flows" :key="`dot-${f.key}`">
            <g v-if="shown(f.key) && f.direction !== 'idle' && !totals" class="flow__dot">
              <circle class="flow__halo" :r="DOT.halo" />
              <circle class="flow__core" :r="DOT.core" />
              <animateMotion v-if="reduced !== 'reduce'" :dur="duration(f.watts)" repeatCount="indefinite"
                             calcMode="linear" :keyPoints="f.direction === 'out' ? '1;0' : '0;1'" keyTimes="0;1">
                <mpath :href="`#${pathId(f.key)}`" />
              </animateMotion>
            </g>
          </template>
        </svg>

        <!-- The house, at the center, in the ring of the origin of its consumption. -->
        <div class="hub" :style="{ width: `${radius * 2}px`, height: `${radius * 2}px` }">
          <svg class="hub__ring" viewBox="0 0 100 100" :aria-label="$t('energy.mix')">
            <circle class="hub__track" cx="50" cy="50" :r="RING.r" :stroke-width="RING.w" />
            <circle v-for="a in arcs" :key="a.key" class="hub__arc" :data-part="a.key"
                    cx="50" cy="50" :r="RING.r" :stroke-width="RING.w"
                    :stroke-dasharray="`${a.len.toFixed(2)} ${(CIRC - a.len).toFixed(2)}`"
                    :stroke-dashoffset="a.offset.toFixed(2)" />
          </svg>
          <div class="hub__inner">
            <StrokeIcon class="hub__icon" name="home" :size="18" />
            <span class="hub__value">{{ totals ? wh(totals.consumptionWh) : formatPower(e.consumptionW, locale) }}</span>
            <span class="muted hub__label">{{ $t('energy.house') }}</span>
          </div>
        </div>

        <!-- The three shares, ALWAYS listed, even at zero: a share that appears must not
             shift its neighbors. -->
        <div class="legend">
          <span v-for="m in mix" :key="m.key" class="legend__item" :data-part="m.key" :data-on="m.part > 0 ? '1' : '0'">
            <span class="legend__dot" />{{ formatPercent(Math.round(m.part * 100), locale) }}
            <span class="muted legend__label">{{ m.label }}</span>
          </span>
        </div>

        <div v-for="n in nodes" v-show="n.shown" :key="n.key" class="node"
             :data-on="flowOf(n.key).direction !== 'idle' ? '1' : '0'"
             :style="{ left: `${POS[n.key].x * 100}%`, top: `${POS[n.key].y * 100}%` }">
          <span class="node__icon"><StrokeIcon :name="n.icon" :size="16" /></span>
          <span class="node__value">{{ n.value }}</span>
          <span class="muted node__label">{{ n.label }}</span>
          <!-- space held even when empty: a flow that reverses must not resize its node -->
          <span class="muted node__hint">{{ n.hint || ' ' }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* NO `overflow` on the card: a grid cell that clips its content no longer contributes to the
   height of its row, and the card stayed 79 px tall on top of the chart below. The clipping
   lives on the scene, which is not a grid cell.
   The width comes from the column that hosts it (`energy__top`), not from the card. */
/* `min-width: 0`: without it, a grid cell takes the MINIMUM width of its content, and the floor
   width of the scene bubbled up until it made the whole page overflow. */
.flow { padding: 0; min-width: 0; }
/* The title is inset, the diagram touches the edges: that is already the card's stance. The scale
   is UNDER the title, not beside it: beside it, it competed with the total of the neighboring
   block, whose length varies with the value — the header then changed height. */
.flow__head { padding: 18px 20px 0; }
.flow__title { font-weight: 600; font-size: 14px; }
.flow__scale { font-size: 12px; }
/* The frame clips and scrolls horizontally; the DEFINED height lives on the scene, the only one
   that truly sizes the grid row. */
.flow__viewport { overflow-x: auto; overflow-y: hidden; border-radius: var(--radius); }
/* 380 px: below it, the left node bites into the ring (measured, not estimated). */
.flow__stage { position: relative; width: 100%; min-width: 380px; height: clamp(320px, 40vh, 420px); }
.flow__links { position: absolute; inset: 0; width: 100%; height: 100%; }
.flow__wire { fill: none; stroke: var(--line); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.flow__halo { fill: var(--accent); opacity: 0.18; }
.flow__core { fill: var(--accent); }

.hub {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  display: grid; place-items: center; border-radius: 50%; background: var(--surface2);
}
.hub__ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.hub__track, .hub__arc { fill: none; }
.hub__track { stroke: var(--line); }
.hub__arc { stroke-linecap: butt; transition: stroke-dasharray .4s ease, stroke-dashoffset .4s ease; }
/* Three shares drawn from the SINGLE accent: full for solar, half for the battery, neutral grey
   for the grid. No new color, so the four accents of the setting are respected. */
.hub__arc[data-part='solar'] { stroke: var(--accent); }
.hub__arc[data-part='battery'] { stroke: var(--accent); opacity: 0.45; }
.hub__arc[data-part='grid'] { stroke: var(--muted); }
.legend__item[data-part='solar'] .legend__dot { background: var(--accent); }
.legend__item[data-part='battery'] .legend__dot { background: var(--accent); opacity: 0.45; }
.legend__item[data-part='grid'] .legend__dot { background: var(--muted); }
.hub__inner { display: grid; justify-items: center; text-align: center; z-index: 1; }
.hub__icon { color: var(--accent); }
.hub__value { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.hub__label { font-size: 12px; }

/* At the BOTTOM of the scene, not just under the ring: centered there, it bit into the Grid node. */
.legend { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: flex; gap: 12px; white-space: nowrap; font-size: 11px; }
.legend__item { display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; }
.legend__item[data-on='0'] { opacity: 0.4; }
.legend__dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
.legend__label { font-size: 11px; }

.node {
  position: absolute; transform: translate(-50%, -50%);
  display: grid; justify-items: center; gap: 1px;
  padding: 8px 10px; border-radius: var(--radius);
  background: var(--surface); border: 1px solid var(--line);
  min-width: 96px; text-align: center;
}
.node[data-on='1'] { border-color: var(--accent); }
.node__icon { display: inline-flex; color: var(--muted); }
.node[data-on='1'] .node__icon { color: var(--accent); }
/* never on two lines: a year in kWh ("1 426 kWh") folded its unit under the number */
.node__value { font-size: 17px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.node__label { font-size: 12px; }
.node__hint { font-size: 11px; min-height: 1.2em; white-space: nowrap; }
</style>
