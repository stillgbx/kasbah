<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceDescriptor, FanDirection, StateFor } from '@kasbah/shared'
import { FAN_DIRECTIONS } from '@kasbah/shared'
import Segmented from '../ui/Segmented.vue'

// Carte ventilateur : interrupteur, 6 vitesses (segmenté pleine largeur), sens, minuterie, mute.
// Les vitesses viennent de `meta.fan.speeds` — liste, pas intervalle (même raison que les
// portions de mangeoire). La minuterie affiche les crans télécommande (1 / 2 / 4 h → 59 / 119 / 239).
const props = defineProps<{
  descriptor: DeviceDescriptor
  state: StateFor<'fan'>
  pending?: boolean
  disabled?: boolean
  /** Section embarquée dans une carte lumière : pas de titre redondant. */
  embedded?: boolean
}>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()

const { t } = useI18n()

const has = (c: string) => props.descriptor.capabilities.includes(c as never)
const speeds = computed(() => props.descriptor.meta.fan?.speeds ?? [1, 2, 3, 4, 5, 6])
const speedOptions = computed(() => speeds.value.map((n) => ({
  value: String(n), label: String(n), disabled: props.disabled,
})))

/** Crans de minuterie mesurés sur le CREATE (minutes restantes annoncées). */
const TIMER_PRESETS = [
  { min: 0, key: 'off' },
  { min: 59, key: '1h' },
  { min: 119, key: '2h' },
  { min: 239, key: '4h' },
] as const

const directionOptions = computed(() => FAN_DIRECTIONS.map((d) => ({
  value: d,
  label: t(`fan.directions.${d}`),
  disabled: props.disabled,
})))
const timerOptions = computed(() => TIMER_PRESETS.map((p) => ({
  value: String(p.min),
  label: t(`fan.timers.${p.key}`),
  disabled: props.disabled || (!props.state.on && p.min > 0),
})))
const timerValue = computed(() => String(props.state.timerMin ?? 0))

const emitted = ref<string | null>(null)
function run(key: string, cmd: CommandInput): void {
  emitted.value = key
  emit('command', cmd)
}
watch(() => props.pending, (p) => { if (!p) emitted.value = null })
const waiting = (key: string) => props.pending === true && emitted.value === key

function setSpeed(n: number) {
  run(`speed-${n}`, { type: 'fan.set', speed: n })
}
function setDirection(d: FanDirection) {
  run(`dir-${d}`, { type: 'fan.set', direction: d })
}
function setTimer(min: number) {
  run(`timer-${min}`, { type: 'fan.set', timerMin: min })
}

/** Place réservée : toujours 4 rangées de commandes, même si une capacité manque. */
const showSpeed = computed(() => has('fan_speed'))
const showDir = computed(() => has('fan_direction'))
const showTimer = computed(() => has('fan_timer'))
const showMute = computed(() => has('mute'))
</script>

<template>
  <div class="fan" :class="{ 'fan--embedded': embedded }">
    <div v-if="!embedded" class="fan__head">
      <span class="text-body-2">{{ state.on ? $t('common.on') : $t('common.off') }}</span>
      <v-switch :model-value="state.on" :disabled="disabled" density="compact" hide-details
                :loading="waiting('power')"
                @update:model-value="run('power', { type: 'fan.set', on: !state.on })" />
    </div>
    <div v-else class="fan__head fan__head--embed">
      <span class="text-caption text-medium-emphasis">{{ $t('fan.title') }}</span>
      <v-switch :model-value="state.on" :disabled="disabled" density="compact" hide-details
                :loading="waiting('power')"
                @update:model-value="run('power', { type: 'fan.set', on: !state.on })" />
    </div>

    <!-- Place toujours réservée (règle « rien ne bouge ») : hauteur fixe même ventilateur éteint. -->
    <div class="fan__section" :class="{ 'fan__section--off': !state.on }">
      <div v-if="showSpeed" class="text-caption text-medium-emphasis mb-1">{{ $t('fan.speed') }}</div>
      <Segmented
        v-if="showSpeed"
        :model-value="String(state.speed ?? speeds[0])"
        :options="speedOptions"
        fill
        dense
        :label="$t('fan.speed')"
        @update:model-value="(v) => setSpeed(Number(v))"
      />

      <div v-if="showDir" class="text-caption text-medium-emphasis mb-1 mt-2">{{ $t('fan.direction') }}</div>
      <Segmented
        v-if="showDir"
        :model-value="state.direction ?? 'forward'"
        :options="directionOptions"
        fill
        dense
        :label="$t('fan.direction')"
        @update:model-value="(v) => setDirection(v as FanDirection)"
      />

      <div v-if="showTimer" class="text-caption text-medium-emphasis mb-1 mt-2">{{ $t('fan.timer') }}</div>
      <Segmented
        v-if="showTimer"
        :model-value="timerValue"
        :options="timerOptions"
        fill
        dense
        :label="$t('fan.timer')"
        @update:model-value="(v) => setTimer(Number(v))"
      />

      <div v-if="showMute" class="fan__mute mt-2">
        <span class="text-caption text-medium-emphasis">{{ $t('fan.mute') }}</span>
        <v-switch :model-value="state.muted === true" :disabled="disabled" density="compact" hide-details
                  :loading="waiting('mute')"
                  @update:model-value="run('mute', { type: 'fan.set', muted: !state.muted })" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.fan__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.fan__head--embed { margin-bottom: 4px; }
.fan__mute { display: flex; align-items: center; justify-content: space-between; min-height: 40px; }
/* Place réservée : section toujours présente ; éteint → contrôles grisés mais hauteur inchangée. */
.fan__section { min-height: 168px; }
.fan__section--off { opacity: 0.55; }
.fan--embedded .fan__section { min-height: 168px; }
</style>
