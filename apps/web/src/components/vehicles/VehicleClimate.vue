<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceDescriptor, StateFor, VehicleSeat } from '@kasbah/shared'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { formatTemp } from '../../lib/format'
import { useDevicesStore } from '../../stores/devices'

/**
 * A vehicle's air conditioning, COMMON to all: start, setpoint, heated seats and steering wheel.
 * The panel ALWAYS shows the maximum — five seats and the steering wheel — and grays out what this vehicle
 * cannot do (`meta.vehicle.climate`): nothing appears or disappears from one car to another,
 * and the user sees what is missing instead of looking for it.
 *
 * Two rules come from the plugin, not from here:
 *  - the START wakes the car if needed (`vehicle.climate_start`) — the acknowledgment arrives in one
 *    second, the A/C some twenty later: the button holds the wait until `climateOn` is seen;
 *  - a SETTING never wakes (`vehicle.climate_set`). Asleep, the chosen setpoint is therefore
 *    HELD here and goes out with the start; seats and steering wheel wait for the A/C to run.
 */
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'vehicle'> }>()
const devices = useDevicesStore()
const { t, locale } = useI18n()
const id = computed(() => props.descriptor.id)
const features = computed(() => props.descriptor.meta.vehicle?.climate)
const asleep = computed(() => props.state.sleepState === 'asleep' || props.state.sleepState === 'offline')
const on = computed(() => props.state.climateOn === true)

/** Same ceiling as the view's wake-up: a car out of range does not block the button. */
const WARM_MAX_MS = 90_000
const warming = ref(false)
let warmTimer: ReturnType<typeof setTimeout> | null = null
function stopWarming(): void {
  warming.value = false
  if (warmTimer) clearTimeout(warmTimer)
  warmTimer = null
}
watch(on, (v) => { if (v) stopWarming() })
const busy = computed(() => warming.value || devices.isPending(id.value))

// ── setpoint ───────────────────────────────────────────────────────────────────────────────────

/** The setpoint chosen and not yet confirmed by the car; `null` = the car's. */
const wanted = ref<number | null>(null)
const SEND_AFTER_MS = 800
let sendTimer: ReturnType<typeof setTimeout> | null = null
const target = computed(() => wanted.value ?? props.state.climateTargetC)
watch(() => props.state.climateTargetC, (v) => { if (v !== undefined && v === wanted.value) wanted.value = null })
const canTune = computed(() => !!features.value && props.state.available)
function step(dir: 1 | -1): void {
  const f = features.value
  if (!f) return
  const from = target.value ?? (f.minC + f.maxC) / 2
  const next = Math.min(f.maxC, Math.max(f.minC, Math.round((from + dir * f.stepC) / f.stepC) * f.stepC))
  if (next === target.value) return
  wanted.value = next
  if (sendTimer) clearTimeout(sendTimer)
  // asleep: held, it will go out with the start; awake: sent once the clicks are over
  if (asleep.value) return
  sendTimer = setTimeout(() => {
    sendTimer = null
    const value = wanted.value
    if (value === null) return
    void devices.sendCommand(id.value, { type: 'vehicle.climate_set', targetTempC: value }).then((ok) => { if (!ok) wanted.value = null })
  }, SEND_AFTER_MS)
}

// ── start ──────────────────────────────────────────────────────────────────────────────────────

async function toggle(): Promise<void> {
  if (on.value) { await devices.sendCommand(id.value, { type: 'vehicle.climate_stop' }); return }
  if (sendTimer) { clearTimeout(sendTimer); sendTimer = null }
  const targetTempC = wanted.value ?? undefined
  warming.value = true
  // battery too low: the plugin refuses (`LOW_BATTERY`) and the notification says so
  const ok = await devices.sendCommand(id.value, { type: 'vehicle.climate_start', ...(targetTempC !== undefined ? { targetTempC } : {}) })
  if (ok) warmTimer = setTimeout(stopWarming, WARM_MAX_MS)
  else stopWarming()
}
onBeforeUnmount(() => { stopWarming(); if (sendTimer) clearTimeout(sendTimer) })

// ── seats and steering wheel ──────────────────────────────────────────────────────────────────

/** Top view: the front row carries the steering wheel between the two seats. */
const FRONT: (VehicleSeat | 'wheel')[] = ['fl', 'wheel', 'fr']
const REAR: VehicleSeat[] = ['rl', 'rc', 'rr']
const hasSeat = (s: VehicleSeat) => features.value?.seats.includes(s) === true
const levels = computed(() => features.value?.seatLevels ?? 3)
const levelOf = (s: VehicleSeat) => props.state.seatHeat?.[s] ?? 0
/** Heating assumes the A/C is running (Tesla), except where these are preconditioning options (R5). */
const heatable = computed(() => props.state.available && (features.value?.heatWhileOff === true || (on.value && !asleep.value)))
function cycleSeat(s: VehicleSeat): void {
  const next = (levelOf(s) + 1) % (levels.value + 1)
  void devices.sendCommand(id.value, { type: 'vehicle.climate_set', seatHeat: { [s]: next } })
}
function toggleWheel(): void {
  void devices.sendCommand(id.value, { type: 'vehicle.climate_set', steeringWheelHeat: props.state.steeringWheelHeat !== true })
}
/** Bars lit: with a single level (on / off), on = all three, for an identical layout. */
const lit = (s: VehicleSeat) => (levels.value === 1 ? (levelOf(s) > 0 ? 3 : 0) : levelOf(s))

/** A single help line, always present: the reason for what is grayed out, or the wait in progress. */
const hint = computed(() => {
  if (!props.state.available) return t('vehicle.climatePanel.unavailable')
  if (warming.value) return t('vehicle.climatePanel.warming')
  if (!on.value && features.value?.heatWhileOff) return t('vehicle.climatePanel.presetHint')
  if (!on.value) return asleep.value ? t('vehicle.climateWakeHint') : t('vehicle.climatePanel.offHint')
  return t('vehicle.climateStopHint')
})
const unsupported = t('vehicle.climatePanel.unsupported')
</script>

<template>
  <div class="clim">
    <div class="clim__head">
      <button type="button" class="pill clim__power" :data-on="on ? '1' : '0'" :disabled="!state.available || busy"
              :aria-busy="busy" :aria-pressed="on" @click="toggle">
        <!-- the spinner takes the icon's PLACE, same size: the button does not change width -->
        <v-progress-circular v-if="busy" indeterminate size="16" width="2" />
        <StrokeIcon v-else name="thermostat" :size="16" />{{ $t('vehicle.climate') }}
      </button>
      <div class="clim__temp">
        <button type="button" class="clim__step" :disabled="!canTune" :title="canTune ? undefined : unsupported"
                :aria-label="$t('vehicle.climatePanel.colder')" @click="step(-1)">
          <StrokeIcon name="minus" :size="16" />
        </button>
        <div class="clim__target">
          <span class="clim__value">{{ target === undefined ? '—' : formatTemp(target, locale) }}</span>
          <span class="muted clim__inside">{{ $t('vehicle.climatePanel.inside', { temp: state.insideTempC === undefined ? '—' : formatTemp(state.insideTempC, locale) }) }}</span>
        </div>
        <button type="button" class="clim__step" :disabled="!canTune" :title="canTune ? undefined : unsupported"
                :aria-label="$t('vehicle.climatePanel.warmer')" @click="step(1)">
          <StrokeIcon name="plus" :size="16" />
        </button>
      </div>
    </div>
    <!-- the cabin seen from above: front (seat, steering wheel, seat), then the bench -->
    <div class="clim__cabin" role="group" :aria-label="$t('vehicle.climatePanel.cabin')">
      <template v-for="slot in FRONT" :key="slot">
        <button v-if="slot === 'wheel'" type="button" class="clim__seat" :data-on="state.steeringWheelHeat ? '1' : '0'"
                :disabled="!features?.steeringWheelHeat || !heatable" :title="features?.steeringWheelHeat ? undefined : unsupported"
                :aria-pressed="state.steeringWheelHeat === true" @click="toggleWheel">
          <span class="clim__seat-k">{{ $t('vehicle.climatePanel.wheel') }}</span>
          <span class="clim__bars" aria-hidden="true"><i v-for="n in 3" :key="n" :data-lit="state.steeringWheelHeat ? '1' : '0'" /></span>
        </button>
        <button v-else type="button" class="clim__seat" :data-on="levelOf(slot) > 0 ? '1' : '0'"
                :disabled="!hasSeat(slot) || !heatable" :title="hasSeat(slot) ? undefined : unsupported"
                :aria-label="$t('vehicle.climatePanel.seatLevel', { seat: $t(`vehicle.seat.${slot}`), level: levelOf(slot) })" @click="cycleSeat(slot)">
          <span class="clim__seat-k">{{ $t(`vehicle.seat.${slot}`) }}</span>
          <span class="clim__bars" aria-hidden="true"><i v-for="n in 3" :key="n" :data-lit="n <= lit(slot) ? '1' : '0'" /></span>
        </button>
      </template>
      <button v-for="slot in REAR" :key="slot" type="button" class="clim__seat" :data-on="levelOf(slot) > 0 ? '1' : '0'"
              :disabled="!hasSeat(slot) || !heatable" :title="hasSeat(slot) ? undefined : unsupported"
              :aria-label="$t('vehicle.climatePanel.seatLevel', { seat: $t(`vehicle.seat.${slot}`), level: levelOf(slot) })" @click="cycleSeat(slot)">
        <span class="clim__seat-k">{{ $t(`vehicle.seat.${slot}`) }}</span>
        <span class="clim__bars" aria-hidden="true"><i v-for="n in 3" :key="n" :data-lit="n <= lit(slot) ? '1' : '0'" /></span>
      </button>
    </div>
    <p class="muted clim__hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
/* `min-width: 0`: the panel is an element of the card's grid; without it, its minimum width
   widens the column and pushes ALL the card's content out of its frame (seen at 828 px) */
.clim { min-width: 0; padding: 8px; display: grid; gap: 12px; }
/* Taller than its content (the panel placed on the Vehicles view card, on a large screen):
   the seats take all the room, and the help goes down to the bottom. At its natural height
   (House view panel, phone), `1fr` is worth the content: nothing changes. */
.clim { grid-template-rows: auto 1fr auto; }
/* too narrow for one line: the setpoint goes below. Depends only on the width, never on the state */
.clim__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.clim__power { flex: 0 0 auto; padding: 0 10px; }
.clim__temp { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.clim__step {
  width: 32px; height: 32px; display: grid; place-items: center; padding: 0;
  border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--text); cursor: pointer;
}
.clim__step:disabled { opacity: .45; cursor: default; }
/* FIXED width: "20,5 °C" and "—" occupy the same place, the ± buttons do not move */
.clim__target { width: 84px; display: grid; justify-items: center; }
.clim__value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.clim__inside { font-size: 11px; white-space: nowrap; }
/* `minmax(52px, 1fr)` rows: at natural height, 52 px; stretched, the seats share all
   the room (a fixed ceiling in `minmax` applied EVERYWHERE: the grid with no given height raises
   its rows to their maximum) */
.clim__cabin { display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: minmax(52px, 1fr); gap: 8px; }
.clim__seat {
  min-width: 0; height: 100%; display: grid; place-content: center; justify-items: center; gap: 4px; padding: 6px 4px;
  border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 12px; cursor: pointer;
}
.clim__seat[data-on='1'] { border-color: var(--accent); }
.clim__seat:disabled { opacity: .45; cursor: default; }
.clim__seat-k { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clim__bars { display: flex; gap: 3px; }
.clim__bars i { width: 12px; height: 3px; border-radius: 2px; background: var(--line); }
.clim__bars i[data-lit='1'] { background: var(--accent); }
/* a reserved line: the panel does not change height when the reason changes */
.clim__hint { margin: 0; font-size: 11px; min-height: 2lh; align-self: end; }
</style>
