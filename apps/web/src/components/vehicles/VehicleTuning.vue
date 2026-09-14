<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDescriptor } from '@kasbah/shared'
import { useHouseStore } from '../../stores/house'
import { needsCapacity, tunableVehicle } from '../../lib/vehicleTuning'

/**
 * Ce que seul l'utilisateur peut savoir d'un véhicule : le décalage de sa place calculée, la
 * correction de son cap, la capacité de sa batterie. Ces valeurs vivent dans la MAISON
 * (`house.devices[]`) et non dans l'état, qui est la vérité du fabricant, réécrite à chaque lecture.
 *
 * Le décalage (m, repère maison) : ni le GPS de la voiture ni l'origine de la maison ne sont exacts
 * au mètre, et l'écart qu'on mesure à l'œil dans la scène se saisit ici une fois pour toutes.
 * La rotation (°) : elle s'AJOUTE au cap que la scène déduit (celui du fabricant, ou l'axe de la
 * pièce) — aucun des deux ne dit de quel côté la voiture s'est garée ; un demi-tour se saisit ici.
 * La capacité (kWh) : AUCUN fabricant ne la donne — ni Tesla, ni Renault — et sans elle on ne peut
 * pas estimer la puissance de charge d'un véhicule qui ne la dit pas.
 *
 * Deux surfaces l'affichent : la carte de la vue Véhicules (repliée derrière « Régler ») et le
 * panneau de l'appareil sélectionné, où l'on voit la voiture BOUGER dans la scène en la réglant.
 */
const props = defineProps<{ descriptor: DeviceDescriptor }>()
const house = useHouseStore()

const houseDevice = computed(() => house.houseDeviceFor(props.descriptor.id))
const tunable = computed(() => tunableVehicle(props.descriptor, houseDevice.value))
/** Rien à corriger pour un véhicule qu'on a PLACÉ à la main dans la maison : son entrée fait déjà foi. */
const gpsPlaced = computed(() => houseDevice.value?.position === undefined)
const capacityNeeded = computed(() => needsCapacity(props.descriptor))
const rotation = computed(() => houseDevice.value?.yawOffset ?? 0)
const capacity = computed(() => houseDevice.value?.batteryKwh ?? 0)
const offsetOf = (axis: 0 | 1) => houseDevice.value?.gpsOffset?.[axis] ?? 0

/** Un champ vidé vaut 0, et 0 EFFACE le réglage — c'est ce que dit le contrat d'écriture. */
const typed = (raw: string) => (raw.trim() === '' ? 0 : Number(raw.replace(',', '.')))
function setOffset(axis: 0 | 1, raw: string): void {
  const value = typed(raw)
  if (!Number.isFinite(value) || value === offsetOf(axis)) return
  const next: [number, number] = axis === 0 ? [value, offsetOf(1)] : [offsetOf(0), value]
  void house.setDeviceTuning(props.descriptor.id, { gpsOffset: next })
}
/** Ramené dans [-180, 180[ : 200° et -160° sont la même rotation, et le contrat refuse le premier. */
function setRotation(raw: string): void {
  const typedValue = typed(raw)
  if (!Number.isFinite(typedValue)) return
  const value = ((((typedValue + 180) % 360) + 360) % 360) - 180
  if (value === rotation.value) return
  void house.setDeviceTuning(props.descriptor.id, { yawOffset: value })
}
function setCapacity(raw: string): void {
  const value = typed(raw)
  if (!Number.isFinite(value) || value < 0 || value === capacity.value) return
  void house.setDeviceTuning(props.descriptor.id, { batteryKwh: value })
}
</script>

<template>
  <div v-if="tunable" class="card card--soft tune">
    <!-- décalage et rotation ne concernent qu'une voiture posée par son GPS : celle qu'on a placée à
         la main dans la maison tient déjà sa place et son cap du JSON -->
    <label v-if="gpsPlaced" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.offset') }}</span>
      <span class="tune__fields">
        <span v-for="(axis, i) in (['x', 'y'] as const)" :key="axis" class="tune__axis">
          <span class="muted">{{ $t(`vehicle.offset${axis.toUpperCase()}`) }}</span>
          <input type="number" step="0.5" inputmode="decimal" :value="offsetOf(i as 0 | 1)"
                 @change="setOffset(i as 0 | 1, ($event.target as HTMLInputElement).value)" />
        </span>
      </span>
    </label>
    <label v-if="gpsPlaced" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.rotation') }}</span>
      <span class="tune__fields">
        <input type="number" step="15" inputmode="decimal" :value="rotation"
               @change="setRotation(($event.target as HTMLInputElement).value)" />
      </span>
    </label>
    <label v-if="capacityNeeded" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.capacity') }}</span>
      <span class="tune__fields">
        <input type="number" step="1" min="0" inputmode="decimal" :value="capacity || ''"
               placeholder="—" @change="setCapacity(($event.target as HTMLInputElement).value)" />
      </span>
    </label>
    <p v-if="capacityNeeded" class="muted tune__hint">{{ $t('vehicle.capacityHint') }}</p>
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
</style>
