<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDescriptor } from '@kasbah/shared'
import { useHouseStore } from '../../stores/house'
import { bodyColorOf, bodyFinishOf, needsCapacity, tunableVehicle } from '../../lib/vehicleTuning'
import { VEHICLE_FINISHES, type VehicleFinish } from '@kasbah/shared'
import { modelsFor, NO_MODEL, resolveModel } from '../../three/models/catalog'

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
 * La carrosserie 3D et sa couleur relèvent de la même règle : le catalogue sait quelles formes sont
 * livrées, mais pas laquelle est garée là — un plugin de marque peut couvrir plusieurs modèles — et
 * AUCUN fabricant ne publie la teinte d'un véhicule. Le select ne propose que les carrosseries du
 * plugin du véhicule — on ne gare pas une Model S dans le garage d'une R5 —, à défaut celles de sa
 * marque, pour la voiture qu'un plugin générique publie (la simulation, par exemple).
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

/** Rien à proposer quand aucune carrosserie ne correspond : les deux lignes disparaissent. */
const models = computed(() => modelsFor(props.descriptor.pluginId, props.descriptor.meta.manufacturer))
/** Ce que la scène dessine AUJOURD'HUI, y compris quand l'utilisateur n'a rien choisi. */
const model3d = computed(() => resolveModel(houseDevice.value?.model3d, props.descriptor.pluginId, props.descriptor.meta.manufacturer)?.id ?? NO_MODEL)
function setModel3d(value: string): void {
  if (value === model3d.value) return
  void house.setDeviceTuning(props.descriptor.id, { model3d: value })
}

/** Le réglage manuel, seul : c'est lui qu'on écrit, et lui seul que la croix efface. */
/**
 * L'aspect de la peinture, dans le vocabulaire de la voiture elle-même (le « Coloriseur » d'une
 * Tesla dit Unie / Métallique / Mate). Le select montre ce qui est PEINT aujourd'hui — le choix
 * manuel, sinon ce que le fabricant dit — et écrire rend ce choix explicite.
 */
const bodyFinish = computed(() => bodyFinishOf(props.descriptor, houseDevice.value))
/** Le choix manuel SEUL — le select, lui, montre ce qui est peint, d'où qu'il vienne. */
const chosenFinish = computed(() => houseDevice.value?.bodyFinish)
function setBodyFinish(value: string): void {
  // `''` efface, comme pour la couleur ; sinon un aspect identique à l'affiché n'écrit rien... SAUF
  // s'il vient du fabricant : le choisir explicitement le FIGE, et c'est un geste utile.
  const finish = value as VehicleFinish | ''
  if (finish && finish === chosenFinish.value) return
  void house.setDeviceTuning(props.descriptor.id, { bodyFinish: finish })
}

const bodyColor = computed(() => houseDevice.value?.bodyColor)
/**
 * Ce que la scène peint AUJOURD'HUI. Sans réglage manuel, c'est la teinte que le plugin a déduite —
 * le sélecteur part donc de la vraie couleur du véhicule, pas d'un gris arbitraire — et à défaut un
 * gris neutre, faute de savoir quoi montrer.
 */
const painted = computed(() => bodyColorOf(props.descriptor, houseDevice.value) ?? '#9aa4b2')
function setBodyColor(value: string): void {
  if (value === bodyColor.value) return
  void house.setDeviceTuning(props.descriptor.id, { bodyColor: value })
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
    <!-- carrosserie : les modèles de CE véhicule (son plugin, à défaut sa marque), plus la silhouette -->
    <label v-if="models.length" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.model3d') }}</span>
      <span class="tune__fields">
        <select :value="model3d" @change="setModel3d(($event.target as HTMLSelectElement).value)">
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
          <option :value="NO_MODEL">{{ $t('vehicle.model3dNone') }}</option>
        </select>
      </span>
    </label>
    <label v-if="models.length" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.bodyFinish') }}</span>
      <span class="tune__fields">
        <!-- même règle que la couleur : la croix n'efface QUE le choix manuel, et rend la main à
             ce que le plugin a déduit — pas à un défaut arbitraire -->
        <button v-if="chosenFinish" type="button" class="tune__reset" :title="$t('vehicle.bodyFinishReset')"
                @click="setBodyFinish('')">×</button>
        <select :value="bodyFinish" @change="setBodyFinish(($event.target as HTMLSelectElement).value)">
          <option v-for="f in VEHICLE_FINISHES" :key="f" :value="f">{{ $t(`vehicle.finish.${f}`) }}</option>
        </select>
      </span>
    </label>
    <label v-if="models.length" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.bodyColor') }}</span>
      <span class="tune__fields">
        <!-- sans couleur choisie, la scène applique la sienne, qui suit le thème : le bouton rend la main -->
        <button v-if="bodyColor" type="button" class="tune__reset" :title="$t('vehicle.bodyColorReset')"
                @click="setBodyColor('')">×</button>
        <input type="color" :value="painted"
               @change="setBodyColor(($event.target as HTMLInputElement).value)" />
      </span>
    </label>
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
.tune select {
  padding: 4px 8px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px;
}
/* même gabarit que les champs nombre : la ligne ne change pas de hauteur d'une section à l'autre */
.tune input[type='color'] { width: 72px; height: 28px; padding: 2px; cursor: pointer; }
.tune__reset {
  width: 22px; height: 22px; padding: 0; line-height: 1;
  border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px; cursor: pointer;
}
</style>
