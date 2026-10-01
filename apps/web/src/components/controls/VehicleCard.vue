<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { geoDistance, type CommandInput, type DeviceDescriptor, type StateFor } from '@kasbah/shared'
import { formatDistance, formatKm, formatPercent, formatPower } from '../../lib/format'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import ChargeLimitCard from '../vehicles/ChargeLimitCard.vue'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'vehicle'>; pending?: boolean; disabled?: boolean }>()
/** Charge demandée, pas encore constatée : la même attente que la vue Véhicules (tenue par le store). */
const devices = useDevicesStore()
const chargeRequested = computed(() => devices.isChargeRequested(props.descriptor.id))
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const house = useHouseStore()
const HOME_RADIUS_M = 120

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
    <div class="d-flex ga-2 mb-3">
      <v-btn v-if="has('lock')" class="flex-grow-1" height="56" variant="tonal" :prepend-icon="state.locked ? 'lockOpen' : 'lock'" :disabled="disabled"
             @click="emit('command', { type: state.locked ? 'vehicle.unlock' : 'vehicle.lock' })">{{ state.locked ? $t('common.unlock') : $t('common.lock') }}</v-btn>
      <v-btn v-if="has('charging')" class="flex-grow-1" height="56" variant="tonal" color="success"
             :disabled="disabled || !state.pluggedIn || pending || chargeRequested" :loading="chargeRequested"
             @click="emit('command', { type: state.charging ? 'vehicle.stop_charge' : 'vehicle.start_charge' })">
        {{ state.charging ? $t('vehicle.stopCharge') : $t('vehicle.startCharge') }}
      </v-btn>
    </div>
    <!-- la cible de charge : le bloc de la vue Véhicules, repris tel quel -->
    <ChargeLimitCard v-if="has('charge_limit')" class="mb-3" :value="limit" :disabled="disabled"
                     @preview="dragged = $event" @change="setLimit" />
    <div v-if="state.odometerKm" class="text-caption text-medium-emphasis">{{ $t('vehicle.odometer') }} · {{ formatKm(state.odometerKm, $i18n.locale) }}</div>
  </div>
</template>

<style scoped>
/* Repères de limites : le trait de la vue Véhicules, posé PAR-DESSUS la jauge (qui n'a pas de pouce
   pour le cacher) — donc pas d'`overflow: hidden` sur l'enveloppe, ils la débordent exprès. */
.soc { position: relative; }
.soc__tick {
  position: absolute; top: 50%; width: 3px; height: 16px; border-radius: 2px;
  transform: translate(-50%, -50%); background: rgb(var(--v-theme-warning));
}
</style>
