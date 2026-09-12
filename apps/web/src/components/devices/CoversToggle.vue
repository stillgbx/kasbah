<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceEntry, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Interrupteur maître des ouvrants de la vue : tout fermer, ou tout ouvrir, d'un geste. Comme celui
// des lampes (`RoomLightsToggle`), le protocole n'a rien de tel — c'est un LOT de commandes.
//
// FERMÉ = coché, la convention du contrat et des interrupteurs de ligne (voir `lib/cover.ts`). Elle
// ne se confond pas avec la mise en valeur des lignes, qui est inversée pour un store (`coverActivity`
// : un store se remarque DÉPLOYÉ) : ici on parle de ce qu'on COMMANDE, pas de ce qui se remarque.
// `cover.close` ferme un volet et BAISSE un store — c'est le plugin qui traduit, le geste est le même.
const props = defineProps<{ entries: DeviceEntry[]; label: string }>()
const devices = useDevicesStore()

const covers = computed(() => props.entries.filter((e) => e.state.kind === 'cover'))
const reachable = computed(() => covers.value.filter((e) => e.state.available))
const position = (e: DeviceEntry) => (e.state as StateFor<'cover'>).position
/** Seuls les ouvrants qui DISENT où ils en sont votent : un RTS muet ne décide pas de l'état affiché. */
const known = computed(() => reachable.value.filter((e) => position(e) !== undefined))
/**
 * Coché quand TOUT ce qu'on sait est fermé — et non « dès qu'un est fermé » comme l'interrupteur des
 * lampes. Une maison a presque toujours un volet baissé quelque part (une salle de bain, un store
 * déployé l'été) : la règle des lampes mettrait l'interrupteur coché en permanence, et « tout fermer »
 * le soir demanderait deux appuis. Le geste fréquent reste à un appui.
 */
const checked = computed(() => known.value.length > 0 && known.value.every((e) => position(e)! <= 0))

function toggle() {
  const close = !checked.value
  // n'écrire que sur ce qui doit bouger ; position inconnue = on envoie (on ne sait pas où il en est)
  const targets = reachable.value.filter((e) => {
    const p = position(e)
    return p === undefined || (close ? p > 0 : p < 100)
  })
  void devices.runScene(targets.map((e) => ({ deviceId: e.descriptor.id, command: { type: close ? 'cover.close' : 'cover.open' } })))
}
</script>

<template>
  <div v-if="covers.length" class="master">
    <v-switch :model-value="checked" :disabled="reachable.length === 0" density="compact"
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
/* le glyphe prend la couleur du pouce qui le porte : gris ouvert, accent fermé */
.master :deep(.v-switch__thumb) { color: var(--muted); }
.master :deep(.v-selection-control--dirty .v-switch__thumb) { color: var(--accent); }
</style>
