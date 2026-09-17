<script setup lang="ts">
import { computed } from 'vue'
import type { CommandInput, DeviceEntry, StateFor } from '@kasbah/shared'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Les commandes d'un appareil de chauffage, sur la ligne de sa pièce (slot `control` de `RoomBands`).
//
// Deux erreurs corrigées ici, toutes deux visibles à l'écran :
//
//  1. CHEVAUCHEMENT. La version précédente posait les boutons dans la colonne du STATUT, en
//     `flex: 0 0 auto` : ils ne rétrécissaient donc jamais et débordaient sur la pastille de liaison
//     et sur l'état dès que la carte se resserrait. Les commandes prennent maintenant leur propre
//     rangée (`grid-column: 1 / -1`), comme le curseur d'une lampe ou les touches d'un ouvrant :
//     rien ne peut plus se marcher dessus, quelle que soit la largeur.
//  2. VOCABULAIRE. Boutons ronds et pastille d'état : deux formes que cette application n'emploie
//     nulle part ailleurs. Les vues Ouvrants et Médias ont des touches CARRÉES à coins arrondis de
//     36 px (`.key`), et leur état est du texte à la suite du statut. C'est repris tel quel.
//
// La consigne est répétée ENTRE les deux touches : ce qu'on règle doit être sous les doigts qui le
// règlent, et la ligne du dessus continue de dire « mesurée → consigne » comme tous les autres
// appareils de la maison.

const props = defineProps<{ entry: DeviceEntry }>()
const emit = defineEmits<{ command: [deviceId: string, cmd: CommandInput] }>()

const state = computed(() => props.entry.state as StateFor<'climate'>)
const caps = computed(() => props.entry.descriptor.capabilities as readonly string[])
const canSetTemp = computed(() => caps.value.includes('target_temp'))
const canSetMode = computed(() => caps.value.includes('hvac_mode'))
const modes = computed(() => props.entry.descriptor.meta.climate?.modes ?? [])
const bounds = computed<[number, number]>(() => props.entry.descriptor.meta.targetTempC ?? [10, 30])
/** Éteint ou injoignable : le geste serait refusé plus bas, autant ne pas le proposer. */
const locked = computed(() => !props.entry.state.available || state.value.mode === 'off')

function step(d: number) {
  const [lo, hi] = bounds.value
  const next = Math.min(hi, Math.max(lo, Math.round((state.value.targetTempC + d) * 2) / 2))
  emit('command', props.entry.descriptor.id, { type: 'climate.set_target_temp', targetTempC: next })
}
const setMode = (mode: string) => emit('command', props.entry.descriptor.id, { type: 'climate.set_mode', mode: mode as StateFor<'climate'>['mode'] })

const target = computed(() => `${state.value.targetTempC.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`)
</script>

<template>
  <!-- rien à régler : pas de rangée vide non plus (les zones de la pompe à chaleur sont lues) -->
  <div v-if="canSetTemp || canSetMode" class="controls">
    <div v-if="canSetTemp" class="keys">
      <button type="button" class="key" :disabled="locked" :title="$t('heating.lower')" :aria-label="$t('heating.lower')" @click="step(-0.5)">
        <StrokeIcon name="minus" :size="18" />
      </button>
      <!-- la consigne entre ses deux touches : on règle un nombre en le regardant -->
      <span class="target">{{ target }}</span>
      <button type="button" class="key" :disabled="locked" :title="$t('heating.raise')" :aria-label="$t('heating.raise')" @click="step(0.5)">
        <StrokeIcon name="plus" :size="18" />
      </button>
    </div>

    <div v-if="canSetMode" class="keys keys--modes">
      <button v-for="m in modes" :key="m" type="button" class="key key--text" :data-on="state.mode === m ? '1' : '0'"
              :disabled="!entry.state.available" @click="setMode(m)">
        {{ $t(`climate.modes.${m}`) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Repris des vues Ouvrants et Médias : une rangée à part, toute la largeur de la ligne. C'est ce qui
   empêche tout chevauchement — les commandes ne partagent plus de colonne avec le statut. */
.controls { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin: 2px 4px 0; }
.keys { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.keys--modes { gap: 6px; }
.key {
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
/* une touche qui porte un mot et non un signe : même hauteur et même coin, largeur libre */
.key--text { width: auto; padding: 0 14px; font: inherit; font-size: 13px; }
.key--text[data-on="1"] { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
/* largeur fixe : passer de 9,5 à 10,0 ne doit pas écarter les deux touches */
.target { min-width: 6.5ch; text-align: center; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; margin: 0 2px; }
</style>
