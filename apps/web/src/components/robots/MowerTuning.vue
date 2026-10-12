<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDescriptor } from '@kasbah/shared'
import { useI18n } from 'vue-i18n'
import { useHouseStore } from '../../stores/house'

/**
 * Ce que seul l'utilisateur peut savoir d'un robot tondeuse : le DÉCALAGE de sa place calculée par
 * GPS. Ni le récepteur du robot (sous un débord de toit, contre un mur) ni l'origine de la maison ne
 * sont exacts au mètre, et l'écart se voit d'un coup d'œil sur la photo aérienne : on le corrige ici
 * une fois pour toutes, en mètres dans le repère de la maison. La valeur vit dans la MAISON
 * (`house.devices[].gpsOffset`), comme pour un véhicule, et s'applique à la carte ET à la scène 3D.
 *
 * Un robot qui publie la carte de son terrain (capacité `site_map`) a une seconde ligne : le décalage
 * de cette CARTE (`mapOffset`), posée par sa station sur la base du robot et qu'on recale à part sur
 * la photo — déplacer le robot ne la déplace pas, et inversement.
 *
 * Même gabarit que `VehicleTuning`, réduit à ce qui a un sens pour une tondeuse : pas de rotation
 * (elle ne dit pas son cap, et son marqueur s'oriente sur son mouvement), pas de batterie à saisir.
 */
const props = defineProps<{ descriptor: DeviceDescriptor }>()
const house = useHouseStore()
const { t } = useI18n()

type Field = 'gpsOffset' | 'mapOffset'
const houseDevice = computed(() => house.houseDeviceFor(props.descriptor.id))
const hasMap = computed(() => props.descriptor.capabilities.includes('site_map'))
const offsetOf = (field: Field, axis: 0 | 1) => houseDevice.value?.[field]?.[axis] ?? 0

/** Un champ vidé vaut 0, et `[0, 0]` EFFACE le réglage — c'est ce que dit le contrat d'écriture. */
const typed = (raw: string) => (raw.trim() === '' ? 0 : Number(raw.replace(',', '.')))
function setOffset(field: Field, axis: 0 | 1, raw: string): void {
  const value = typed(raw)
  if (!Number.isFinite(value) || value === offsetOf(field, axis)) return
  const next: [number, number] = axis === 0 ? [value, offsetOf(field, 1)] : [offsetOf(field, 0), value]
  void house.setDeviceTuning(props.descriptor.id, { [field]: next })
}

/** « Rétablir » : les décalages tels qu'ils étaient à l'OUVERTURE de la section (montée en `v-if`). */
const opened = {
  gpsOffset: [offsetOf('gpsOffset', 0), offsetOf('gpsOffset', 1)] as [number, number],
  mapOffset: [offsetOf('mapOffset', 0), offsetOf('mapOffset', 1)] as [number, number],
}
const changedField = (f: Field) => offsetOf(f, 0) !== opened[f][0] || offsetOf(f, 1) !== opened[f][1]
const changed = computed(() => changedField('gpsOffset') || changedField('mapOffset'))
function revert(): void {
  const back = (['gpsOffset', 'mapOffset'] as const).filter(changedField)
  void house.setDeviceTuning(props.descriptor.id, Object.fromEntries(back.map((f) => [f, opened[f]])))
}

const hint = computed(() => [t('mower.offsetHint'), ...(hasMap.value ? [t('mower.mapOffsetHint')] : [])].join(' '))
const rows = computed(() => [
  { field: 'gpsOffset' as const, label: 'vehicle.offset' },
  ...(hasMap.value ? [{ field: 'mapOffset' as const, label: 'mower.mapOffset' }] : []),
])
</script>

<template>
  <div class="card card--soft tune">
    <!-- place RÉSERVÉE : invisible tant qu'il n'y a rien à rétablir, la ligne ne bouge pas -->
    <div class="tune__top">
      <button type="button" class="pill tune__revert" :class="{ 'tune__revert--off': !changed }"
              :disabled="!changed" :tabindex="changed ? 0 : -1" @click="revert">{{ $t('place.revert') }}</button>
    </div>
    <label v-for="row in rows" :key="row.field" class="tune__row">
      <span class="muted tune__k">{{ $t(row.label) }}</span>
      <span class="tune__fields">
        <span v-for="(axis, i) in (['x', 'y'] as const)" :key="axis" class="tune__axis">
          <span class="muted">{{ $t(`vehicle.offset${axis.toUpperCase()}`) }}</span>
          <input type="number" step="0.5" inputmode="decimal" :value="offsetOf(row.field, i as 0 | 1)"
                 @change="setOffset(row.field, i as 0 | 1, ($event.target as HTMLInputElement).value)" />
        </span>
      </span>
    </label>
    <p class="muted tune__hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.tune { padding: 10px 12px; display: grid; gap: 10px; }
.tune__row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.tune__k { flex: 1 1 auto; min-width: 0; }
.tune__fields { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
.tune__axis { display: flex; align-items: center; gap: 6px; }
.tune input {
  width: 72px; padding: 4px 8px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px; font-variant-numeric: tabular-nums;
}
.tune__hint { margin: 0; font-size: 11px; }
.tune__top { display: flex; justify-content: flex-end; }
.tune__revert { height: 28px; padding: 0 12px; font-size: 12px; }
.tune__revert--off { visibility: hidden; }
</style>
