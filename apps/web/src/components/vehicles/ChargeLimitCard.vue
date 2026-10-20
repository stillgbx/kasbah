<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatPercent } from '../../lib/format'
import StrokeIcon from '../ui/StrokeIcon.vue'

/**
 * The CHARGE TARGET, shared by the Vehicles view card and a vehicle's panel in the
 * House view. One value, two gestures: the steps, which are touched without aiming (80 % is the
 * everyday setting), and the slider, which goes to the exact percent for whoever wants 73.
 *
 * The track shows the WHOLE BATTERY, from 0 to 100: it is of that that a share is set, and a slider
 * that started at 50 would make a 50 % target read as an empty tank. The thumb, for its part, does not
 * go below 50 — no manufacturer accepts less (Tesla reports `charge_limit_soc_min` at
 * 50) — and the out-of-reach share is veiled rather than removed.
 *
 * The parent keeps the value: `preview` while dragging (it HOLDS it, otherwise the slider
 * would go back to the vehicle's on every frame), `change` when the command can go out.
 */
const LIMIT_MIN = 50
const LIMIT_MAX = 100
const LIMIT_STEPS = [50, 60, 70, 80, 90, 100] as const
/** The marks drawn on the track: 100 is the end of the track, a mark there would be half cropped. */
const MARKS = LIMIT_STEPS.filter((p) => p < LIMIT_MAX)

/** `watermark`: the battery as a watermark, like the other sections of the Vehicles view card. */
defineProps<{ value: number; disabled?: boolean; hint?: string; watermark?: boolean }>()
const emit = defineEmits<{ preview: [percent: number]; change: [percent: number] }>()
const { locale } = useI18n()

/**
 * The track goes down to 0, the value does not: we push the input back to the bound instead of letting it
 * display a 20 that nobody will apply.
 */
function clamped(el: HTMLInputElement): number {
  const wanted = Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.round(Number(el.value))))
  if (Number(el.value) !== wanted) el.value = String(wanted)
  return wanted
}
</script>

<template>
  <div class="card card--soft limit">
    <StrokeIcon v-if="watermark" class="limit__wm" name="battery" :size="80" />
    <div class="limit__head">
      <span class="muted limit__k">{{ $t('vehicle.chargeLimit') }}</span>
      <span class="limit__v">{{ formatPercent(value, locale) }}</span>
    </div>
    <div class="limit__steps">
      <button v-for="p in LIMIT_STEPS" :key="p" type="button" class="limit__step"
              :data-on="value === p ? '1' : '0'" :disabled="disabled" :title="hint"
              @click="emit('change', p)">{{ p }}</button>
    </div>
    <!-- the track is drawn separately, inset by half a thumb on each side: it is the only
         way to align the marks exactly on the center of the thumb, which does not reach the edges -->
    <div class="limit__slider" :data-off="disabled ? '1' : '0'">
      <div class="limit__track">
        <div class="limit__fill" :style="{ width: `${value}%` }" />
        <div class="limit__dead" :style="{ width: `${LIMIT_MIN}%` }" />
        <span v-for="p in MARKS" :key="p" class="limit__mark" :style="{ left: `${p}%` }" />
      </div>
      <input class="limit__range" type="range" min="0" :max="LIMIT_MAX" step="1" :value="value"
             :disabled="disabled" :aria-label="$t('vehicle.chargeLimit')" :title="hint"
             @input="emit('preview', clamped($event.target as HTMLInputElement))"
             @change="emit('change', clamped($event.target as HTMLInputElement))" />
    </div>
  </div>
</template>

<style scoped>
/* FIXED heights — the row does not move when the car changes its mind, and the six steps keep
   their place whatever the number. */
.limit { padding: 10px 12px; display: grid; gap: 8px; }
/* the watermark of the Vehicles view card (`.wm` of VehiclesView): under the content, cropped by a
   quarter of its area at the bottom right, no room taken */
.limit { position: relative; overflow: hidden; isolation: isolate; }
/* the battery UPRIGHT (terminal at the top): lying down, it fell at the level of the slider and extended it.
   The body is at the central third of the icon, hence the offsets: stuck to the right edge, cropped at the bottom */
.limit__wm {
  position: absolute; right: -18px; bottom: -25px; z-index: -1; transform: rotate(-90deg);
  color: var(--text); opacity: .07; pointer-events: none;
}
.limit__head { display: flex; align-items: baseline; justify-content: space-between; }
.limit__k { font-size: 11px; }
.limit__v { font-weight: 500; font-size: 14px; font-variant-numeric: tabular-nums; }
.limit__steps { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.limit__step {
  height: 34px; padding: 0; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface); color: var(--text); cursor: pointer;
  font: inherit; font-size: 13px; font-variant-numeric: tabular-nums;
}
.limit__step:hover:not(:disabled) { border-color: var(--accent); }
.limit__step[data-on='1'] { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
.limit__step:disabled { opacity: .45; cursor: default; }
/* the slider: same track as the top gauge, thumb grabbable by finger */
.limit__slider { position: relative; height: 24px; --thumb: 16px; }
.limit__slider[data-off='1'] { opacity: .45; }
.limit__track {
  position: absolute; inset: 50% calc(var(--thumb) / 2) auto; height: 6px;
  transform: translateY(-50%); border-radius: 999px; background: var(--line); overflow: hidden;
}
.limit__fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); }
/* 0–50 %: the share of battery that no manufacturer lets you aim at. Shown — it is the battery —
   but veiled with the card's color, so that it reads that we will not go there. */
.limit__dead { position: absolute; left: 0; top: 0; bottom: 0; background: var(--surface2); opacity: .62; }
.limit__mark {
  position: absolute; top: 0; bottom: 0; width: 2px;
  transform: translateX(-1px); background: var(--surface2);
}
/* the input, transparent, placed OVER the drawn track: it only brings the thumb and the gesture */
.limit__range {
  position: relative; display: block; width: 100%; height: 24px; margin: 0;
  appearance: none; background: none; cursor: pointer;
}
.limit__range:disabled { cursor: default; }
.limit__range::-webkit-slider-runnable-track { height: var(--thumb); background: none; }
.limit__range::-webkit-slider-thumb {
  appearance: none; box-sizing: border-box; width: var(--thumb); height: var(--thumb);
  border-radius: 50%; border: 2px solid var(--surface2); background: var(--accent);
}
.limit__range::-moz-range-track { height: var(--thumb); background: none; border: 0; }
.limit__range::-moz-range-thumb {
  box-sizing: border-box; width: var(--thumb); height: var(--thumb);
  border-radius: 50%; border: 2px solid var(--surface2); background: var(--accent);
}
</style>
