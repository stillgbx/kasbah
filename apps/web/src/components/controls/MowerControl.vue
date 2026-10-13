<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatPercent } from '../../lib/format'
import { mowerStatus } from '../../lib/mowerTask'
import MarqueeText from '../ui/MarqueeText.vue'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'mower'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { d, t, locale } = useI18n()
// la ligne d'état, la même que sur la vue Robots : l'erreur du fabricant (« Erreur 2 · No loop
// signal · il y a 3 h »), sinon ce qui retient le robot, sinon OÙ il tond. Ligne réservée, fixe :
// rien ne bouge quand la phrase change ou s'efface ; trop longue, elle défile
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => { clock = setInterval(() => { now.value = Date.now() }, 30_000) })
onBeforeUnmount(() => clearInterval(clock))
const status = computed(() => mowerStatus(props.state, t, now.value, locale.value))
</script>

<template>
  <div>
    <!-- l'activité est déjà le grand titre du panneau : ici, le prochain départ seul, ligne réservée -->
    <div class="text-caption text-medium-emphasis mower__next">{{ state.nextStartAt ? $t('mower.nextStart', { time: d(new Date(state.nextStartAt), 'short') }) : '' }}</div>
    <MarqueeText class="text-caption mower__status" :class="state.activity === 'error' ? 'text-error' : 'text-medium-emphasis'" :text="status" />
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
  </div>
</template>

<style scoped>
.mower__next { min-height: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mower__status { min-height: 20px; margin: 0 0 4px; }
</style>
