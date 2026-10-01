<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { HOME_RADIUS_M, geoDistance, type CommandInput, type DeviceDescriptor, type StateFor } from '@kasbah/shared'
import { formatDistance, formatKm, formatPercent, formatPower } from '../../lib/format'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import StrokeIcon from '../ui/StrokeIcon.vue'
import ChargeLimitCard from '../vehicles/ChargeLimitCard.vue'
import VehicleClimate from '../vehicles/VehicleClimate.vue'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'vehicle'>; pending?: boolean; disabled?: boolean }>()
/** Charge demandée, pas encore constatée : la même attente que la vue Véhicules (tenue par le store). */
const devices = useDevicesStore()
const chargeRequested = computed(() => devices.isChargeRequested(props.descriptor.id))
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const house = useHouseStore()

const distance = computed(() => {
  const o = house.house?.origin
  return o && props.state.location ? geoDistance(o, props.state.location) : null
})
const atHome = computed(() => distance.value !== null && distance.value < HOME_RADIUS_M)
const has = (c: string) => props.descriptor.capabilities.includes(c as never)

/** La valeur qu'on TIENT le temps du va-et-vient : sans elle, le curseur reviendrait en arrière. */
const dragged = ref<number | null>(null)
const limit = computed(() => dragged.value ?? props.state.chargeLimit ?? 80)
function setLimit(percent: number): void {
  dragged.value = percent
  emit('command', { type: 'vehicle.set_charge_limit', percent })
}
// la main rendue à l'état dès que la commande a fini : acceptée il porte la cible, refusée il a
// repris l'ancienne
watch(() => [props.state.chargeLimit, props.pending], () => { dragged.value = null })
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-1">
      <div class="text-h4 font-weight-medium">{{ formatPercent(state.soc, $i18n.locale) }}</div>
      <div class="text-right">
        <div class="text-body-1">{{ formatKm(state.rangeKm, $i18n.locale) }}</div>
        <div class="text-caption text-medium-emphasis">{{ $t('vehicle.range') }}</div>
      </div>
    </div>
    <!-- la jauge et ses repères, comme sur la carte de la vue Véhicules : la cible de charge — qui
         suit le curseur d'en dessous pendant qu'on le glisse — et le plancher voulu quand le
         fabricant a cette notion (la R5 ; Tesla ne l'a pas, et un seul repère se dessine alors) -->
    <div class="soc mb-3">
      <v-progress-linear :model-value="state.soc" rounded height="10" :color="state.charging ? 'success' : state.soc < 20 ? 'error' : 'primary'" />
      <span v-if="state.socMin !== undefined" class="soc__tick" :style="{ left: `${state.socMin}%` }"
            :title="$t('vehicle.floorMark', { percent: formatPercent(state.socMin, $i18n.locale) })" />
      <span v-if="state.chargeLimit !== undefined" class="soc__tick" :style="{ left: `${limit}%` }"
            :title="$t('vehicle.targetMark', { percent: formatPercent(limit, $i18n.locale) })" />
    </div>
    <div class="d-flex flex-wrap ga-2 mb-3">
      <v-chip variant="tonal" size="small" :prepend-icon="state.pluggedIn ? 'plug' : 'plugOff'">{{ state.pluggedIn ? $t('vehicle.pluggedIn') : $t('vehicle.unplugged') }}</v-chip>
      <v-chip v-if="state.charging" variant="tonal" size="small" color="success">{{ $t('vehicle.charging') }} · {{ formatPower(state.chargePowerW ?? 0, $i18n.locale) }}</v-chip>
      <v-chip v-if="distance !== null" variant="tonal" size="small" :color="atHome ? 'primary' : undefined">
        {{ atHome ? $t('vehicle.atHome') : $t('vehicle.away', { distance: formatDistance(distance, $i18n.locale) }) }}
      </v-chip>
      <v-chip v-if="state.locked !== undefined" variant="tonal" size="small" :prepend-icon="state.locked ? 'lock' : 'lockOpen'">{{ state.locked ? $t('vehicle.locked') : $t('vehicle.unlocked') }}</v-chip>
    </div>
    <!-- les tuiles de la vue Véhicules : deux colonnes identiques, TOUJOURS là, grisées avec leur raison
         quand le véhicule ne sait pas (règle de l'utilisateur) ou que le câble est débranché -->
    <div class="tiles mb-3">
      <button type="button" class="pill" :disabled="disabled || !has('lock')" :title="has('lock') ? undefined : $t('vehicle.unsupported')"
              @click="emit('command', { type: state.locked ? 'vehicle.unlock' : 'vehicle.lock' })">
        <StrokeIcon :name="state.locked ? 'lockOpen' : 'lock'" :size="16" /><span class="tiles__label">{{ state.locked ? $t('common.unlock') : $t('common.lock') }}</span>
      </button>
      <!-- demandée, la charge tourne jusqu'à ce que la voiture la DISE active (cf. le store) -->
      <button type="button" class="pill" :data-on="state.charging ? '1' : '0'"
              :disabled="disabled || !has('charging') || !state.pluggedIn || pending || chargeRequested" :aria-busy="chargeRequested"
              :title="!has('charging') ? $t('vehicle.unsupported') : state.pluggedIn ? undefined : $t('vehicle.unplugged')"
              @click="emit('command', { type: state.charging ? 'vehicle.stop_charge' : 'vehicle.start_charge' })">
        <v-progress-circular v-if="chargeRequested" indeterminate size="16" width="2" />
        <StrokeIcon v-else :name="state.charging ? 'boltOff' : 'bolt'" :size="16" />
        <span class="tiles__label">{{ state.charging ? $t('vehicle.stopCharge') : $t('vehicle.startCharge') }}</span>
      </button>
    </div>
    <!-- la cible de charge : le bloc de la vue Véhicules, repris tel quel -->
    <ChargeLimitCard v-if="has('charge_limit')" class="mb-3" :value="limit" :disabled="disabled"
                     @preview="dragged = $event" @change="setLimit" />
    <!-- la climatisation : le panneau commun de la vue Véhicules, qui envoie lui-même ses commandes -->
    <VehicleClimate v-if="has('climate_precondition')" class="card card--soft mb-3" :descriptor="descriptor" :state="state" />
    <div v-if="state.odometerKm" class="text-caption text-medium-emphasis">{{ $t('vehicle.odometer') }} · {{ formatKm(state.odometerKm, $i18n.locale) }}</div>
  </div>
</template>

<style scoped>
/* Repères de limites : le trait de la vue Véhicules, posé PAR-DESSUS la jauge (qui n'a pas de pouce
   pour le cacher) — donc pas d'`overflow: hidden` sur l'enveloppe, ils la débordent exprès. */
.soc { position: relative; }
/* mêmes tuiles que la vue Véhicules : icône au-dessus du libellé, « Arrêter la charge » tient sans être coupé */
.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.tiles .pill { min-width: 0; height: 56px; padding: 0 8px; border-radius: 12px; flex-direction: column; justify-content: center; gap: 3px; font-size: 13px; }
.tiles .pill[aria-busy='true']:disabled { opacity: .7; }
.tiles__label { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.soc__tick {
  position: absolute; top: 50%; width: 3px; height: 16px; border-radius: 2px;
  transform: translate(-50%, -50%); background: rgb(var(--v-theme-warning));
}
</style>
