<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDescriptor } from '@kasbah/shared'
import { useHouseStore } from '../../stores/house'

/**
 * Ce que seul l'utilisateur peut savoir d'un robot tondeuse : le DÉCALAGE de sa place calculée par
 * GPS. Ni le récepteur du robot (sous un débord de toit, contre un mur) ni l'origine de la maison ne
 * sont exacts au mètre, et l'écart se voit d'un coup d'œil sur la photo aérienne : on le corrige ici
 * une fois pour toutes, en mètres dans le repère de la maison. La valeur vit dans la MAISON
 * (`house.devices[].gpsOffset`), comme pour un véhicule, et s'applique à la carte ET à la scène 3D.
 *
 * Même gabarit que `VehicleTuning`, réduit à ce qui a un sens pour une tondeuse : pas de rotation
 * (elle ne dit pas son cap, et son marqueur s'oriente sur son mouvement), pas de batterie à saisir.
 */
const props = defineProps<{ descriptor: DeviceDescriptor }>()
const house = useHouseStore()

const houseDevice = computed(() => house.houseDeviceFor(props.descriptor.id))
const offsetOf = (axis: 0 | 1) => houseDevice.value?.gpsOffset?.[axis] ?? 0

/** Un champ vidé vaut 0, et `[0, 0]` EFFACE le réglage — c'est ce que dit le contrat d'écriture. */
const typed = (raw: string) => (raw.trim() === '' ? 0 : Number(raw.replace(',', '.')))
function setOffset(axis: 0 | 1, raw: string): void {
  const value = typed(raw)
  if (!Number.isFinite(value) || value === offsetOf(axis)) return
  const next: [number, number] = axis === 0 ? [value, offsetOf(1)] : [offsetOf(0), value]
  void house.setDeviceTuning(props.descriptor.id, { gpsOffset: next })
}

/** « Rétablir » : le décalage tel qu'il était à l'OUVERTURE de la section (montée en `v-if`). */
const opened: [number, number] = [offsetOf(0), offsetOf(1)]
const changed = computed(() => offsetOf(0) !== opened[0] || offsetOf(1) !== opened[1])
function revert(): void { void house.setDeviceTuning(props.descriptor.id, { gpsOffset: opened }) }
</script>

<template>
  <div class="card card--soft tune">
    <!-- place RÉSERVÉE : invisible tant qu'il n'y a rien à rétablir, la ligne ne bouge pas -->
    <div class="tune__top">
      <button type="button" class="pill tune__revert" :class="{ 'tune__revert--off': !changed }"
              :disabled="!changed" :tabindex="changed ? 0 : -1" @click="revert">{{ $t('place.revert') }}</button>
    </div>
    <label class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.offset') }}</span>
      <span class="tune__fields">
        <span v-for="(axis, i) in (['x', 'y'] as const)" :key="axis" class="tune__axis">
          <span class="muted">{{ $t(`vehicle.offset${axis.toUpperCase()}`) }}</span>
          <input type="number" step="0.5" inputmode="decimal" :value="offsetOf(i as 0 | 1)"
                 @change="setOffset(i as 0 | 1, ($event.target as HTMLInputElement).value)" />
        </span>
      </span>
    </label>
    <p class="muted tune__hint">{{ $t('mower.offsetHint') }}</p>
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
