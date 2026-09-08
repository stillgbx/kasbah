<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { hexToRgb, mirekToRgb, rgbToHex, rgbToXy, xyToRgb, type CommandInput, type DeviceDescriptor, type StateFor } from '@kasbah/shared'
import { formatKelvin } from '../../lib/format'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'light'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()

const has = (c: string) => props.descriptor.capabilities.includes(c as never)
const [mirekMin, mirekMax] = props.descriptor.meta.colorTempMirek ?? [153, 500]

// Valeurs locales pendant le glissement ; resynchronisées depuis l'état quand on ne touche pas.
const brightness = ref(props.state.brightness ?? 100)
const mirek = ref(props.state.colorTempMirek ?? 366)
watch(() => props.state.brightness, (v) => { if (v !== undefined) brightness.value = v })
watch(() => props.state.colorTempMirek, (v) => { if (v !== undefined) mirek.value = v })

const hex = computed(() => (props.state.color ? rgbToHex(xyToRgb(props.state.color.x, props.state.color.y)) : rgbToHex(mirekToRgb(mirek.value))))
const swatch = computed(() => (props.state.on ? hex.value : 'transparent'))

// Effets du fabricant (bougie, feu, cosmos…) : liste fournie par le descripteur, libellé traduit
// quand on le connaît, nom brut sinon (les ponts en ajoutent à chaque firmware).
const { t } = useI18n()
const effects = computed(() => (props.descriptor.meta.effects ?? []).map((value) => ({
  value, title: t(`light.effects.${value}`, value),
})))

const sendColor = useDebounceFn((h: string) => {
  const { x, y } = rgbToXy(hexToRgb(h))
  emit('command', { type: 'light.set', on: true, color: { x: +x.toFixed(4), y: +y.toFixed(4) } })
}, 200)
</script>

<template>
  <div class="light-control">
    <div v-if="has('color') || has('color_temp')" class="d-flex align-center ga-3 mb-2">
      <span class="light-swatch" :style="{ background: swatch, boxShadow: state.on ? `0 0 18px ${hex}` : 'none' }" />
      <span class="text-body-2 muted">{{ state.on ? $t('common.on') : $t('common.off') }}</span>
    </div>

    <template v-if="has('brightness')">
      <div class="text-caption text-medium-emphasis">{{ $t('light.brightness') }} · {{ Math.round(brightness) }} %</div>
      <v-slider v-model="brightness" :min="1" :max="100" :step="1" :disabled="disabled" color="warning"
                @end="(v: number) => emit('command', { type: 'light.set', brightness: Math.round(v) })" />
    </template>

    <template v-if="has('color_temp')">
      <div class="text-caption text-medium-emphasis">{{ $t('light.colorTemp') }} · {{ formatKelvin(mirek) }}</div>
      <v-slider v-model="mirek" :min="mirekMin" :max="mirekMax" :step="1" :disabled="disabled" class="ct-slider" track-color="transparent"
                @end="(v: number) => emit('command', { type: 'light.set', colorTempMirek: Math.round(v) })">
        <template #prepend><span class="text-caption">{{ $t('light.cold') }}</span></template>
        <template #append><span class="text-caption">{{ $t('light.warm') }}</span></template>
      </v-slider>
    </template>

    <template v-if="has('effect') && effects.length">
      <div class="text-caption text-medium-emphasis mb-1">{{ $t('light.effect') }}</div>
      <v-select :model-value="state.effect ?? 'no_effect'" :items="effects" :disabled="disabled" density="compact"
                variant="outlined" hide-details class="mb-3"
                @update:model-value="(e: string) => emit('command', { type: 'light.set', effect: e })" />
    </template>

    <template v-if="has('color')">
      <div class="text-caption text-medium-emphasis mb-1">{{ $t('light.color') }}</div>
      <v-color-picker :model-value="hex" mode="hsl" :modes="['hsl']" hide-inputs :disabled="disabled" width="100%" elevation="0" class="bg-transparent"
                      @update:model-value="(h: string) => sendColor(h)" />
    </template>
  </div>
</template>

<style scoped>
.light-swatch { width: 28px; height: 28px; border-radius: 50%; border: 2px solid rgb(var(--v-theme-on-surface) / 0.25); transition: box-shadow .3s; }
.ct-slider :deep(.v-slider-track__background) { background: linear-gradient(90deg, #cfe3ff, #fff3d6, #ffb46b) !important; opacity: 1; }
</style>
