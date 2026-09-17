<script setup lang="ts">
import { CLIMATE_MODES, type CommandInput, type DeviceDescriptor, type StateFor } from '@kasbah/shared'
import { formatPercent, formatTemp } from '../../lib/format'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'climate'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const [tMin, tMax] = props.descriptor.meta.targetTempC ?? [10, 30]
// seuls les modes que l'appareil déclare : proposer « Refroidir » à un thermostat qui ne chauffe
// que promettrait une commande que le fabricant refuserait
const modes = props.descriptor.meta.climate?.modes ?? CLIMATE_MODES
const has = (c: string) => props.descriptor.capabilities.includes(c as never)
// Ce contrôle était le seul à ne pas consulter les capacités : la simulation les déclarait toutes,
// et aucun vrai appareil `climate` n'existait. Une pompe à chaleur lue en SEULE LECTURE (MELCloud)
// en publie l'état sans accepter de commande — afficher les boutons ferait promettre à l'UI ce que
// le plugin refuserait. La VALEUR reste montrée dans tous les cas : c'est le geste qui manque.
const canSetTemp = has('target_temp')
const canSetMode = has('hvac_mode')
/**
 * Une zone de pompe à chaleur air-eau peut se régler sur l'eau de DÉPART plutôt que sur l'air de la
 * pièce (`meta.climate.control`). Les deux chiffres sont aux mêmes places, mais 45 °C de départ
 * n'est pas 45 °C de salon : seul le vocabulaire les distingue.
 */
const flow = props.descriptor.meta.climate?.control === 'flow'
const step = (d: number) => emit('command', { type: 'climate.set_target_temp', targetTempC: Math.min(tMax, Math.max(tMin, Math.round((props.state.targetTempC + d) * 2) / 2)) })
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-3">
      <div>
        <div class="text-caption text-medium-emphasis">{{ flow ? $t('climate.flowCurrent') : $t('climate.current') }}</div>
        <div class="text-h4 font-weight-medium">{{ formatTemp(state.currentTempC, $i18n.locale) }}</div>
        <div v-if="state.humidity !== undefined" class="text-caption text-medium-emphasis">{{ $t('climate.humidity') }} {{ formatPercent(state.humidity, $i18n.locale) }}</div>
      </div>
      <v-chip variant="tonal" :color="state.action === 'heating' ? 'error' : state.action === 'cooling' ? 'info' : undefined">
        {{ $t(`climate.actions.${state.action ?? 'idle'}`) }}
      </v-chip>
    </div>
    <div class="text-caption text-medium-emphasis">{{ flow ? $t('climate.flowTarget') : $t('climate.target') }}</div>
    <!-- centrée entre ses deux boutons quand il y en a ; sinon alignée sur son libellé, à gauche,
         plutôt que flottant seule au milieu de la carte -->
    <div class="d-flex align-center ga-4 my-2" :class="canSetTemp ? 'justify-center' : 'justify-start'">
      <v-btn v-if="canSetTemp" icon="minus" variant="tonal" size="large" :disabled="disabled || state.mode === 'off'" @click="step(-0.5)" />
      <span class="text-h3 font-weight-medium target">{{ formatTemp(state.targetTempC, $i18n.locale) }}</span>
      <v-btn v-if="canSetTemp" icon="plus" variant="tonal" size="large" :disabled="disabled || state.mode === 'off'" @click="step(0.5)" />
    </div>
    <div class="text-caption text-medium-emphasis mb-1">{{ $t('climate.mode') }}</div>
    <v-chip-group v-if="canSetMode" :model-value="state.mode" mandatory selected-class="text-primary" column
                  @update:model-value="(m: unknown) => m && emit('command', { type: 'climate.set_mode', mode: m as typeof state.mode })">
      <v-chip v-for="m in modes" :key="m" :value="m" size="large" variant="tonal" :disabled="disabled">{{ $t(`climate.modes.${m}`) }}</v-chip>
    </v-chip-group>
    <!-- lecture seule : le mode se lit, il ne se choisit pas -->
    <v-chip v-else size="large" variant="tonal" class="mode-readonly">{{ $t(`climate.modes.${state.mode}`) }}</v-chip>
  </div>
</template>

<style scoped>
.target { min-width: 6ch; font-variant-numeric: tabular-nums; }
.justify-center .target { text-align: center; }
.mode-readonly { margin-top: 2px; }
</style>
