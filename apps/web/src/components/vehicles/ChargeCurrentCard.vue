<script setup lang="ts">
import StrokeIcon from '../ui/StrokeIcon.vue'

/**
 * The CURRENT the vehicle draws while charging (A), shared by the Vehicles view card and a
 * vehicle's panel in the House view — the setting of the Tesla app and screen. The thumb goes from
 * 5 A (the Tesla app's floor) to the ceiling the cable and charger allow (`chargeCurrentMaxA`).
 *
 * Same contract as `ChargeLimitCard`: the parent keeps the value, `preview` while dragging,
 * `change` when the command can go out. `value` absent = not read yet: "—" and greyed out.
 */
const CURRENT_MIN_A = 5

const props = defineProps<{ value?: number; max?: number; disabled?: boolean; hint?: string; watermark?: boolean }>()
const emit = defineEmits<{ preview: [amps: number]; change: [amps: number] }>()

const top = () => Math.max(CURRENT_MIN_A, props.max ?? 32)
function clamped(el: HTMLInputElement): number {
  return Math.min(top(), Math.max(CURRENT_MIN_A, Math.round(Number(el.value))))
}
</script>

<template>
  <div class="card card--soft amps">
    <StrokeIcon v-if="watermark" class="amps__wm" name="bolt" :size="64" />
    <div class="amps__head">
      <span class="muted amps__k">{{ $t('vehicle.chargeCurrent') }}</span>
      <span class="amps__v">{{ value ?? '—' }}<template v-if="value !== undefined">&nbsp;A</template></span>
    </div>
    <div class="amps__slider" :data-off="disabled || value === undefined ? '1' : '0'">
      <div class="amps__track">
        <div class="amps__fill" :style="{ width: `${value === undefined ? 0 : ((value - CURRENT_MIN_A) / Math.max(1, top() - CURRENT_MIN_A)) * 100}%` }" />
      </div>
      <input class="amps__range" type="range" :min="CURRENT_MIN_A" :max="top()" step="1" :value="value ?? CURRENT_MIN_A"
             :disabled="disabled || value === undefined" :aria-label="$t('vehicle.chargeCurrent')" :title="hint"
             @input="emit('preview', clamped($event.target as HTMLInputElement))"
             @change="emit('change', clamped($event.target as HTMLInputElement))" />
    </div>
    <div class="muted amps__ends"><span>{{ CURRENT_MIN_A }}&nbsp;A</span><span>{{ top() }}&nbsp;A</span></div>
  </div>
</template>

<style scoped>
/* FIXED heights, the same slider as the charge target's */
.amps { padding: 10px 12px; display: grid; gap: 6px; position: relative; overflow: hidden; isolation: isolate; }
.amps__wm { position: absolute; right: -12px; bottom: -16px; z-index: -1; color: var(--text); opacity: .07; pointer-events: none; }
.amps__head { display: flex; align-items: baseline; justify-content: space-between; }
.amps__k { font-size: 11px; }
.amps__v { font-weight: 500; font-size: 14px; font-variant-numeric: tabular-nums; }
.amps__ends { display: flex; justify-content: space-between; font-size: 11px; font-variant-numeric: tabular-nums; }
.amps__slider { position: relative; height: 24px; --thumb: 16px; }
.amps__slider[data-off='1'] { opacity: .45; }
.amps__track {
  position: absolute; inset: 50% calc(var(--thumb) / 2) auto; height: 6px;
  transform: translateY(-50%); border-radius: 999px; background: var(--line); overflow: hidden;
}
.amps__fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); }
.amps__range {
  position: relative; display: block; width: 100%; height: 24px; margin: 0;
  appearance: none; background: none; cursor: pointer;
}
.amps__range:disabled { cursor: default; }
.amps__range::-webkit-slider-runnable-track { height: var(--thumb); background: none; }
.amps__range::-webkit-slider-thumb {
  appearance: none; box-sizing: border-box; width: var(--thumb); height: var(--thumb);
  border-radius: 50%; border: 2px solid var(--surface2); background: var(--accent);
}
.amps__range::-moz-range-track { height: var(--thumb); background: none; border: 0; }
.amps__range::-moz-range-thumb {
  box-sizing: border-box; width: var(--thumb); height: var(--thumb);
  border-radius: 50%; border: 2px solid var(--surface2); background: var(--accent);
}
</style>
