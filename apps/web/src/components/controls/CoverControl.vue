<script setup lang="ts">
import { ref, watch } from 'vue'
import { mdiArrowCollapseDown, mdiArrowCollapseUp, mdiStop } from '@mdi/js'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'cover'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const position = ref(props.state.position)
const dragging = ref(false)
watch(() => props.state.position, (v) => { if (!dragging.value) position.value = v })
const hasTilt = props.descriptor.capabilities.includes('tilt')
const hasStop = props.descriptor.capabilities.includes('stop')
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-2">
      <span class="text-h5 font-weight-medium">{{ Math.round(position) }} %</span>
      <v-chip size="small" :color="state.motion === 'stopped' ? undefined : 'primary'" variant="tonal">{{ $t(`cover.${state.motion}`) }}</v-chip>
    </div>
    <div class="d-flex ga-2 mb-3">
      <v-btn class="flex-grow-1" height="56" variant="tonal" color="primary" :prepend-icon="mdiArrowCollapseUp" :disabled="disabled"
             @click="emit('command', { type: 'cover.open' })">{{ $t('common.open') }}</v-btn>
      <v-btn v-if="hasStop" class="flex-grow-1" height="56" variant="tonal" :prepend-icon="mdiStop" :disabled="disabled"
             @click="emit('command', { type: 'cover.stop' })">{{ $t('common.stop') }}</v-btn>
      <v-btn class="flex-grow-1" height="56" variant="tonal" color="primary" :prepend-icon="mdiArrowCollapseDown" :disabled="disabled"
             @click="emit('command', { type: 'cover.close' })">{{ $t('common.closeCover') }}</v-btn>
    </div>
    <div class="text-caption text-medium-emphasis">{{ $t('cover.position') }}</div>
    <v-slider v-model="position" :min="0" :max="100" :step="5" :disabled="disabled" color="primary" show-ticks
              @start="dragging = true" @end="(v: number) => { dragging = false; emit('command', { type: 'cover.set_position', position: Math.round(v) }) }" />
    <template v-if="hasTilt">
      <div class="text-caption text-medium-emphasis">{{ $t('cover.tilt') }} · {{ state.tilt ?? 0 }} %</div>
      <v-slider :model-value="state.tilt ?? 0" :min="0" :max="100" :step="10" :disabled="disabled" color="secondary"
                @end="(v: number) => emit('command', { type: 'cover.set_tilt', tilt: Math.round(v) })" />
    </template>
  </div>
</template>
