<script setup lang="ts">
import { computed } from 'vue'
import { useRoomLights } from '../../composables/useRoomLights'
import { useDevicesStore } from '../../stores/devices'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Interrupteur maître des lampes d'une pièce : tout allumer ou tout éteindre d'un geste, sans
// parcourir la liste. Côté protocole il n'existe rien de tel — les plugins ne connaissent que des
// appareils — c'est donc un LOT de commandes (`runScene`), avec sa mise à jour optimiste et son
// retour arrière par lampe.
//
// Volontairement limité aux lampes : « éteindre la pièce » ne doit ni fermer les volets ni couper
// le chauffage. Les ambiances du fabricant (`SceneChips.vue`) éteignent déjà la pièce en re-tapant
// celle qui tourne, mais seulement là où il y en a ; cet interrupteur marche partout.
// Pas de libellé à côté : l'ampoule du pouce le dit déjà, et le mot « Lumières » répétait la vue.
// Il ne commande jamais qu'une PIÈCE : en haut de la vue Lumières, toute la maison se commande par
// deux gestes nommés (`LightsMaster`), parce qu'un parc entier est rarement d'un seul état.
const props = defineProps<{ deviceIds: (string | undefined)[] }>()
const devices = useDevicesStore()

// Lampes de la pièce : lecture partagée avec le curseur de luminosité (`useRoomLights`), pour que
// les deux contrôles d'ensemble voient toujours la même pièce.
const { lights, reachable, on } = useRoomLights(() => props.deviceIds)
/**
 * Coché dès qu'UNE lampe est allumée : l'interrupteur répond alors à « éteindre la pièce », le
 * geste qu'on vient chercher ici. Rallumer une pièce à moitié allumée demande donc deux appuis —
 * assumé, c'est le cas rare.
 */
const checked = computed(() => on.value.length > 0)

function toggle() {
  const next = !checked.value
  // n'écrire que sur les lampes qui doivent changer : le pont limite le débit des commandes
  const targets = next ? reachable.value : on.value
  void devices.runScene(targets.map((l) => ({ deviceId: l.id, command: { type: 'light.set', on: next } })))
}
</script>

<template>
  <div v-if="lights.length" class="master">
    <v-switch :model-value="checked" :disabled="reachable.length === 0" density="compact"
              :aria-label="$t('rooms.allLights')" :title="$t('rooms.allLights')"
              @click.stop @update:model-value="toggle">
      <!-- ampoule DANS le pouce : c'est le seul interrupteur de l'app qui n'a pas d'appareil
           nommé à côté de lui, le glyphe dit sur quoi il agit. Pas soleil/lune, déjà le
           vocabulaire de l'apparence claire/sombre dans le rail. -->
      <template #thumb><StrokeIcon name="light" :size="12" /></template>
    </v-switch>
  </div>
</template>

<style scoped>
.master { display: flex; align-items: center; flex: 0 0 auto; }
/* l'ampoule prend la couleur du pouce qui la porte : gris sur le pouce éteint, accent sur l'allumé */
.master :deep(.v-switch__thumb) { color: var(--muted); }
.master :deep(.v-selection-control--dirty .v-switch__thumb) { color: var(--accent); }
</style>
