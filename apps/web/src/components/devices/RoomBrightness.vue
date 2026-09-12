<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoomLights } from '../../composables/useRoomLights'
import { useDevicesStore } from '../../stores/devices'

// Luminosité de TOUTE la pièce, à côté de son interrupteur maître (`RoomLightsToggle`) : baisser le
// salon d'un geste, sans parcourir ses cinq lampes. Comme l'interrupteur, le protocole n'a rien de
// tel — c'est un LOT de commandes (`runScene`), une par lampe.
//
// Valeur ABSOLUE : toutes les lampes allumées reçoivent le même pourcentage, donc les écarts qu'on
// aurait réglés lampe par lampe sont écrasés. C'est le geste qu'on vient chercher ici (« mets le
// salon à 30 % ») et ce que font les applis du marché pour un groupe ; le réglage fin reste à la
// ligne de chaque lampe.
//
// N'écrit QUE sur les lampes déjà allumées : poser une luminosité sur une lampe éteinte l'allumerait
// chez la plupart des fabricants, et le curseur deviendrait un second interrupteur.
const props = defineProps<{ deviceIds: (string | undefined)[] }>()
const devices = useDevicesStore()
const { lights, on } = useRoomLights(() => props.deviceIds)

const dimmable = computed(() => lights.value.filter((l) => l.descriptor?.capabilities.includes('brightness')))
const lit = computed(() => on.value.filter((l) => l.descriptor?.capabilities.includes('brightness')))

/** Valeur locale pendant le glissement, effacée dès que la commande est partie (l'état reprend la main). */
const draft = ref<number | null>(null)
/** Moyenne des lampes allumées : une valeur unique pour un curseur unique. 100 % par défaut (une lampe qui ne dit pas sa luminosité est à fond). */
const average = computed(() => {
  if (!lit.value.length) return 100
  return Math.round(lit.value.reduce((sum, l) => sum + (l.state.brightness ?? 100), 0) / lit.value.length)
})
const shown = computed(() => draft.value ?? average.value)

function commit(v: number) {
  const brightness = Math.round(v)
  void devices.runScene(lit.value.map((l) => ({ deviceId: l.id, command: { type: 'light.set', brightness } })))
  draft.value = null
}
</script>

<template>
  <!-- Place RÉSERVÉE : pièce éteinte, le curseur reste là, invisible et inactif — allumer une pièce
       ne doit pas faire descendre ce qui la suit (règle « rien ne doit bouger »), exactement comme
       le curseur de gradation d'une ligne de la vue Lumières. -->
  <v-slider v-if="dimmable.length" :model-value="shown" :min="1" :max="100" :step="1"
            :disabled="lit.length === 0" :class="{ 'room-bright--off': lit.length === 0 }"
            :aria-hidden="lit.length === 0 ? 'true' : 'false'" :aria-label="$t('rooms.brightness')"
            density="compact" hide-details class="room-bright"
            @update:model-value="(v: number) => { draft = v }" @end="commit" />
</template>

<style scoped>
.room-bright { margin: 0 4px; transition: opacity .2s ease; }
.room-bright--off { visibility: hidden; }
</style>
