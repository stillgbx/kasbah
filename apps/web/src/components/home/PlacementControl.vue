<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveDefaults, roomHeight, type HouseDevice } from '@kasbah/shared'
import { useHouseStore } from '../../stores/house'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Emplacement d'un appareil : « Déplacer » ouvre le mode placement — x;y en glissant l'appareil dans
// la 3D, hauteur par préréglage (plafond, applique, table, sol) ou curseur fin. Chaque réglage est
// écrit dans house.json (store `house`) ; « Rétablir » renvoie au placement d'entrée dans le mode.
const props = defineProps<{ device: HouseDevice }>()
const house = useHouseStore()
const { t } = useI18n()

type Mount = NonNullable<HouseDevice['mount']>
type Preset = 'ceiling' | 'wall' | 'table' | 'floor' | ''
const PRESETS: { value: Exclude<Preset, ''>; mount: Mount; z: (ceiling: number) => number }[] = [
  { value: 'ceiling', mount: 'ceiling', z: (c) => c - 0.15 },
  { value: 'wall', mount: 'wall', z: () => 1.8 },
  { value: 'table', mount: 'free', z: () => 0.75 },
  { value: 'floor', mount: 'floor', z: () => 0.1 },
]
const presetOptions = computed(() => PRESETS.map((p) => ({ value: p.value as Preset, label: t(`place.presets.${p.value}`) })))
const preset = computed<Preset>(() => (props.device.mount === 'free' ? 'table' : props.device.mount ?? ''))

/** Hauteur sous plafond de la pièce d'ancrage (borne du curseur) ; 4 m hors pièce. */
const ceiling = computed(() => {
  const room = props.device.roomId ? house.index?.roomsById.get(props.device.roomId) : undefined
  const level = room ? house.index?.levelsById.get(room.levelId) : undefined
  return house.house && room && level ? roomHeight(room, level, resolveDefaults(house.house.defaults)) : 4
})
const position = computed(() => house.draft?.position ?? props.device.position)
const roomName = computed(() => {
  const id = house.draft?.roomId ?? props.device.roomId
  return id ? house.index?.roomsById.get(id)?.name ?? id : t('place.outside')
})

function applyPreset(p: Preset) {
  const def = PRESETS.find((x) => x.value === p)
  if (!def) return
  const [x, y] = position.value
  void house.savePlacement({ position: [x, y, Math.round(def.z(ceiling.value) * 20) / 20], mount: def.mount })
}
</script>

<template>
  <div class="card card--soft place">
    <div class="place__head">
      <span class="muted">{{ $t('place.title') }}</span>
      <button v-if="!house.placing" type="button" class="pill" @click="house.startPlacing()">
        <StrokeIcon name="move" :size="16" /> {{ $t('place.move') }}
      </button>
      <button v-else type="button" class="pill" data-on="1" @click="house.stopPlacing()">{{ $t('place.done') }}</button>
    </div>
    <template v-if="house.placing">
      <p class="muted place__hint">{{ $t('place.hint') }}</p>
      <Segmented dense :model-value="preset" :options="presetOptions" @update:model-value="applyPreset" />
      <div class="place__row">
        <span class="muted">{{ $t('place.height') }}</span>
        <span class="place__value">{{ position[2].toFixed(2) }} m</span>
      </div>
      <v-slider :model-value="position[2]" :min="0" :max="ceiling" :step="0.05" :disabled="house.saving" hide-details
                @update:model-value="(v: number) => house.previewHeight(v)" @end="() => house.savePlacement()" />
      <div class="place__row muted place__coords">
        <span>x {{ position[0].toFixed(2) }} · y {{ position[1].toFixed(2) }} · {{ roomName }}</span>
        <button v-if="house.canRevert" type="button" class="pill" :disabled="house.saving" @click="house.revertPlacement()">{{ $t('place.revert') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.place { padding: 12px 14px; display: grid; gap: 10px; font-size: 13px; }
.place__head, .place__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.place__hint { margin: 0; font-size: 12px; }
.place__value { font-variant-numeric: tabular-nums; font-weight: 600; }
.place__coords { font-size: 12px; font-variant-numeric: tabular-nums; }
</style>
