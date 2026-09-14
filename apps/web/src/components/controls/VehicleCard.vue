<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { geoDistance, type CommandInput, type DeviceDescriptor, type StateFor } from '@kasbah/shared'
import { formatDistance, formatKm, formatPercent, formatPower } from '../../lib/format'
import { useHouseStore } from '../../stores/house'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'vehicle'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const house = useHouseStore()
const HOME_RADIUS_M = 120

const distance = computed(() => {
  const o = house.house?.origin
  return o && props.state.location ? geoDistance(o, props.state.location) : null
})
const atHome = computed(() => distance.value !== null && distance.value < HOME_RADIUS_M)
const has = (c: string) => props.descriptor.capabilities.includes(c as never)

/**
 * La limite de charge, comme sur la vue Véhicules : des paliers qui se touchent sans viser, et un
 * curseur au pour cent près pour qui veut 73. Jamais moins de 50 % — aucun constructeur n'accepte
 * plus bas (Tesla annonce `charge_limit_soc_min` à 50).
 */
const LIMIT_STEPS = [50, 60, 70, 80, 90, 100] as const
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
      <v-btn v-if="has('charging')" class="flex-grow-1" height="56" variant="tonal" color="success" :disabled="disabled || !state.pluggedIn"
             @click="emit('command', { type: state.charging ? 'vehicle.stop_charge' : 'vehicle.start_charge' })">
        {{ state.charging ? $t('vehicle.stopCharge') : $t('vehicle.startCharge') }}
      </v-btn>
    </div>
    <template v-if="has('charge_limit')">
      <div class="text-caption text-medium-emphasis">{{ $t('vehicle.chargeLimit') }} · {{ limit }} %</div>
      <div class="d-flex ga-1 my-1">
        <!-- `px-0` : sans lui, les 32 px de marge intérieure d'un bouton Vuetify débordent le panneau à six -->
        <v-btn v-for="p in LIMIT_STEPS" :key="p" class="flex-grow-1 px-0" height="40" min-width="0"
               :variant="limit === p ? 'flat' : 'tonal'" :color="limit === p ? 'primary' : undefined"
               :disabled="disabled" @click="setLimit(p)">{{ p }}</v-btn>
      </div>
      <v-slider :model-value="limit" :min="50" :max="100" :step="1" :disabled="disabled" hide-details
                @update:model-value="(v: number) => (dragged = Math.round(v))"
                @end="(v: number) => setLimit(Math.round(v))" />
    </template>
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
