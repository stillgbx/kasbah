<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceEntry, StateFor } from '@kasbah/shared'
import { coverAtRest, isFlatCover, isPassageCover } from '../../lib/cover'
import { useDevicesStore } from '../../stores/devices'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Interrupteur maître des ouvrants de la vue. Comme celui des lampes (`RoomLightsToggle`), le
// protocole n'a rien de tel — c'est un LOT de commandes (`runScene`).
//
// Il ne dit pas « fermer / ouvrir » mais **sécuriser / ouvrir les volets**, et les deux sens ne sont
// volontairement pas symétriques :
//
// - **coché = tout est AU REPOS** : volets et portail fermés, stores REMONTÉS. Un store déployé
//   n'est pas une maison sécurisée, c'est de la toile au vent — « tout fermer » ne doit donc jamais
//   le baisser, alors que la commande `cover.close` le ferait (`lib/cover.ts`, `coverAtRest`).
// - **décoché → on ouvre les VOLETS seulement**. Ni le portail ni les stores ne bougent : un geste
//   d'ensemble n'ouvre pas sur la rue, et ne déploie pas une toile. Ce qu'on ouvre par erreur ici
//   coûte plus cher que ce qu'on oublie d'ouvrir.
//
// Une position inconnue est supposée au repos pour l'ÉTAT de l'interrupteur (sans ça, un portail
// muet suffisait à le décocher en permanence) mais reçoit quand même la commande quand on sécurise :
// on ne sait pas où il en est, et fermer ce qui est déjà fermé ne coûte rien.
const props = defineProps<{ entries: DeviceEntry[]; label: string }>()
const devices = useDevicesStore()

const covers = computed(() => props.entries.filter((e) => e.state.kind === 'cover'))
const reachable = computed(() => covers.value.filter((e) => e.state.available))
const position = (e: DeviceEntry) => (e.state as StateFor<'cover'>).position
const atRest = (e: DeviceEntry) => coverAtRest(e.descriptor, position(e))

const checked = computed(() => reachable.value.length > 0 && reachable.value.every(atRest))
/** Ce que le geste « ouvrir » touche : volets, rideaux, fenêtres — jamais un passage ni un store. */
const openable = computed(() => reachable.value.filter((e) => !isFlatCover(e.descriptor) && !isPassageCover(e.descriptor)))
/** Rien à ouvrir (une terrasse de stores et un portail) : l'interrupteur ne promet pas un geste qu'il ne ferait pas. */
const disabled = computed(() => reachable.value.length === 0 || (checked.value && openable.value.length === 0))

function toggle() {
  if (checked.value) {
    // ouvrir : les volets qu'on ne sait pas déjà grands ouverts
    const targets = openable.value.filter((e) => (position(e) ?? 0) < 100)
    void devices.runScene(targets.map((e) => ({ deviceId: e.descriptor.id, command: { type: 'cover.open' as const } })))
    return
  }
  // sécuriser : chacun vers son repos — fermer ce qui se tient debout, remonter les stores
  const targets = reachable.value.filter((e) => position(e) === undefined || !atRest(e))
  void devices.runScene(targets.map((e) => ({
    deviceId: e.descriptor.id,
    command: { type: isFlatCover(e.descriptor) ? ('cover.open' as const) : ('cover.close' as const) },
  })))
}
</script>

<template>
  <div v-if="covers.length" class="master">
    <v-switch :model-value="checked" :disabled="disabled" density="compact"
              :aria-label="label" :title="label"
              @click.stop @update:model-value="toggle">
      <!-- même idée que l'ampoule des lampes : l'interrupteur n'a pas d'appareil nommé à côté de
           lui, c'est le glyphe qui dit sur quoi il agit -->
      <template #thumb><StrokeIcon name="shutter" :size="12" /></template>
    </v-switch>
  </div>
</template>

<style scoped>
.master { display: flex; align-items: center; flex: 0 0 auto; }
/* le glyphe prend la couleur du pouce qui le porte : gris ouvert, accent une fois la maison au repos */
.master :deep(.v-switch__thumb) { color: var(--muted); }
.master :deep(.v-selection-control--dirty .v-switch__thumb) { color: var(--accent); }
</style>
