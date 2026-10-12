<script setup lang="ts">
import type { CommandInput, StateFor } from '@kasbah/shared'
import { useI18n } from 'vue-i18n'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { workAreaColor } from '../../lib/siteMap'

// Les zones d'une tondeuse : tondre l'une de ses zones de travail (une heure, comme le bouton de la
// carte : Husqvarna exige une durée), et ouvrir ou fermer ses zones d'exclusion. Les zones se TRACENT
// dans l'appli du fabricant — l'API ne sait ni les créer ni les redessiner —, d'où la ligne qui le dit
// quand il n'y en a aucune.

const props = defineProps<{
  state: StateFor<'mower'>
  workAreas: boolean
  stayOutZones: boolean
  busy: boolean
}>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { t } = useI18n()

type WorkArea = NonNullable<StateFor<'mower'>['workAreas']>[number]
/** La zone `0` sans nom est tout le terrain (Husqvarna la publie ainsi tant qu'on n'en trace pas d'autre). */
const areaName = (a: WorkArea) => a.name || (a.id === 0 ? t('mower.wholeLawn') : t('mower.areaUnnamed', { id: a.id }))
const disabled = () => !props.state.available || props.busy
</script>

<template>
  <div class="card card--soft zones">
    <template v-if="workAreas">
      <div class="muted zones__k">{{ $t('mower.workAreas') }}</div>
      <div v-for="a in state.workAreas ?? []" :key="a.id" class="zones__row">
        <!-- la teinte de la zone sur la carte du terrain : c'est ainsi qu'on la retrouve -->
        <span class="zones__swatch" :style="{ background: workAreaColor(state.workAreas, a.id) }" aria-hidden="true" />
        <span class="zones__name">{{ areaName(a) }}</span>
        <span v-if="!a.enabled" class="muted zones__note">{{ $t('mower.areaDisabled') }}</span>
        <button type="button" class="pill zones__btn" :disabled="disabled() || !a.enabled"
                @click="emit('command', { type: 'mower.start_in_area', workAreaId: a.id, durationMin: 60 })">
          <StrokeIcon name="play" :size="14" />{{ $t('mower.startFor') }}
        </button>
      </div>
    </template>
    <template v-if="stayOutZones">
      <div class="muted zones__k">{{ $t('mower.stayOutZones') }}</div>
      <div v-if="!state.stayOutZones?.length" class="muted zones__note">{{ $t('mower.stayOutNone') }}</div>
      <label v-for="z in state.stayOutZones ?? []" :key="z.id" class="zones__row">
        <span class="zones__name">{{ z.name || z.id }}</span>
        <v-switch :model-value="z.enabled" :disabled="disabled()" color="primary" density="compact" hide-details inset
                  :aria-label="$t('mower.stayOutKeepOut', { name: z.name || z.id })"
                  @update:model-value="(v: boolean | null) => emit('command', { type: 'mower.set_stay_out_zone', zoneId: z.id, enabled: !!v })" />
      </label>
    </template>
  </div>
</template>

<style scoped>
.zones { padding: 10px 12px; display: grid; gap: 6px; }
.zones__k { font-size: 11px; }
.zones__k:not(:first-child) { margin-top: 6px; }
/* une ligne = une zone, même hauteur pour toutes : celle de l'interrupteur compact (40 px) */
.zones__row { display: flex; align-items: center; gap: 10px; min-height: 40px; min-width: 0; }
.zones__name { flex: 1 1 auto; min-width: 0; font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zones__note { font-size: 12px; }
.zones__swatch { flex: none; width: 12px; height: 12px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .25); }
.zones__row .zones__note { flex: none; }
.zones__btn { flex: none; height: 32px; padding: 0 12px; font-size: 13px; gap: 6px; }
.zones__row :deep(.v-switch) { flex: 0 0 auto; }
</style>
