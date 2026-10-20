<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Capability, CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatPercent } from '../../lib/format'
import { mowerStatus } from '../../lib/mowerTask'
import MarqueeText from '../ui/MarqueeText.vue'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'mower'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { d, t, locale } = useI18n()
// the status line, the same as on the Robots view: the vendor's error ("Error 2 · No loop
// signal · 3 h ago"), otherwise what holds the robot back, otherwise WHERE it mows. Reserved, fixed line:
// nothing moves when the sentence changes or clears; too long, it scrolls
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => { clock = setInterval(() => { now.value = Date.now() }, 30_000) })
onBeforeUnmount(() => clearInterval(clock))
const status = computed(() => mowerStatus(props.state, t, now.value, locale.value))
const has = (c: Capability) => props.descriptor.capabilities.includes(c)
// an error the vendor clears remotely: the link, at the end of the status line
const confirmable = computed(() => has('confirm_error') && props.state.activity === 'error' && props.state.errorConfirmable === true)
</script>

<template>
  <div>
    <!-- the activity is already the panel's big title: here, the next start only, reserved line -->
    <div class="text-caption text-medium-emphasis mower__next">{{ state.nextStartAt ? $t('mower.nextStart', { time: d(new Date(state.nextStartAt), 'short') }) : '' }}</div>
    <div class="mower__statusrow">
      <MarqueeText class="text-caption mower__status" :class="state.activity === 'error' ? 'text-error' : 'text-medium-emphasis'" :text="status" />
      <button v-if="confirmable" type="button" class="text-caption text-error mower__confirm" :disabled="disabled"
              @click="emit('command', { type: 'mower.confirm_error' })">{{ $t('mower.confirmError') }}</button>
    </div>
    <div class="text-caption text-medium-emphasis">{{ $t('mower.battery') }} · {{ formatPercent(state.battery, $i18n.locale) }}</div>
    <v-progress-linear :model-value="state.battery" rounded height="8" :color="state.battery < 20 ? 'error' : 'success'" class="mb-4" />
    <div class="d-flex ga-2">
      <v-btn class="flex-grow-1" height="56" color="primary" variant="tonal" :prepend-icon="state.activity === 'mowing' ? 'pause' : 'play'" :disabled="disabled"
             @click="emit('command', state.activity === 'mowing' ? { type: 'mower.pause' } : { type: 'mower.start', durationMin: 60 })">
        {{ state.activity === 'mowing' ? $t('common.pause') : $t('mower.startFor') }}
      </v-btn>
      <v-btn class="flex-grow-1" height="56" variant="tonal" prepend-icon="parking" :disabled="disabled || state.activity === 'parked'"
             @click="emit('command', { type: 'mower.park', untilNextSchedule: true })">{{ $t('common.park') }}</v-btn>
    </div>
    <!-- "Mow" without a duration: the robot forgets pause and setpoints and follows its schedule -->
    <v-btn v-if="has('schedule') && has('mow')" block class="mt-2" height="44" variant="tonal" prepend-icon="calendar" :disabled="disabled"
           @click="emit('command', { type: 'mower.start' })">{{ $t('mower.resumeSchedule') }}</v-btn>
  </div>
</template>

<style scoped>
.mower__next { min-height: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mower__statusrow { display: flex; align-items: baseline; gap: 10px; min-height: 20px; margin: 0 0 4px; }
.mower__status { flex: 1 1 auto; min-width: 0; }
.mower__confirm { flex: none; padding: 0; border: 0; background: none; line-height: 20px; font-weight: 500; text-decoration: underline; cursor: pointer; }
</style>
