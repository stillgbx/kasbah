<script setup lang="ts">
import { SETTABLE_CHARGE_MODES, type CommandInput, type DeviceDescriptor, type StateFor } from '@kasbah/shared'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Les commandes d'une borne, sans son état, en deux rendus :
//
//  - `panel` (défaut) : le panneau de l'appareil (`EvChargerControl`), grands boutons sous son en-tête ;
//  - `row` : la ligne de la borne dans une carte de pièce (`RoomBands`, vue Énergie), dans le
//    vocabulaire des autres lignes — touches carrées de 36 px (`.key`), modes en mots, sur leur propre
//    rangée comme le chauffage (`HeatingControl`). Les grands boutons du panneau y écrasaient la carte.
//    L'annulation s'y lit sur la ligne d'état (la vue l'écrit) et sur la touche du mode en cours.
withDefaults(defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'ev_charger'>; disabled?: boolean; variant?: 'panel' | 'row' }>(), {
  variant: 'panel',
})
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
</script>

<template>
  <!-- en ligne : modes à gauche, démarrer / arrêter au bout. Pas de touche « Reprendre » : sous
       annulation, c'est la touche du mode en cours qui passe en alerte, et la toucher le rend à la borne
       (`set_mode` du même mode = reprendre). Une touche de plus, même réservée, renvoyait démarrer /
       arrêter sur une seconde rangée (mesuré : 331 px de ligne). -->
  <div v-if="variant === 'row'" class="ctl">
    <div class="keys">
      <button v-for="m in (descriptor.capabilities.includes('charge_mode') ? SETTABLE_CHARGE_MODES : [])" :key="m" type="button"
              class="key key--text" :data-on="state.chargeMode === m ? (state.manualOverride ? 'warn' : '1') : '0'" :disabled="disabled"
              :title="state.chargeMode === m && state.manualOverride ? $t('charger.overrideKeyHint') : $t(`charger.modeHint.${m}`)"
              @click="emit('command', { type: 'ev_charger.set_mode', mode: m })">
        {{ $t(`charger.mode.${m}`) }}
      </button>
    </div>
    <span class="ctl__gap" />
    <div v-if="descriptor.capabilities.includes('charge_control')" class="keys">
      <button type="button" class="key" :disabled="disabled || state.status === 'disconnected'"
              :title="$t('common.start')" :aria-label="$t('common.start')" @click="emit('command', { type: 'ev_charger.start' })">
        <StrokeIcon name="bolt" :size="18" />
      </button>
      <!-- l'aide « arrêter bloque la borne… » du panneau devient l'info-bulle de la touche -->
      <button type="button" class="key" :disabled="disabled || state.status !== 'charging'"
              :title="descriptor.meta.evCharger?.stopUntilUnplug ? `${$t('common.stop')} — ${$t('charger.stopUntilUnplug')}` : $t('common.stop')"
              :aria-label="$t('common.stop')" @click="emit('command', { type: 'ev_charger.stop' })">
        <StrokeIcon name="boltOff" :size="18" />
      </button>
    </div>
    <v-slider v-if="descriptor.capabilities.includes('charge_current')" class="ctl__slider" :model-value="state.maxCurrentA ?? 16"
              :min="6" :max="32" :step="1" :disabled="disabled" density="compact" hide-details thumb-label
              :aria-label="$t('charger.maxCurrent')"
              @end="(v: number) => emit('command', { type: 'ev_charger.set_current', amps: Math.round(v) })" />
  </div>

  <div v-else>
    <!-- le mode de la borne, comme dans l'appli du fabricant : ni programmé ni intelligent, jamais essayés -->
    <div v-if="descriptor.capabilities.includes('charge_mode')" class="d-flex ga-2 mb-3">
      <v-btn v-for="m in SETTABLE_CHARGE_MODES" :key="m" class="flex-grow-1" height="48" variant="tonal"
             :color="state.chargeMode === m ? 'primary' : undefined" :disabled="disabled" :title="$t(`charger.modeHint.${m}`)"
             @click="emit('command', { type: 'ev_charger.set_mode', mode: m })">{{ $t(`charger.mode.${m}`) }}</v-btn>
    </div>
    <div v-if="descriptor.capabilities.includes('charge_control')" class="d-flex ga-2 mb-3">
      <v-btn class="flex-grow-1" height="56" variant="tonal" color="success" prepend-icon="bolt" :disabled="disabled || state.status === 'disconnected'"
             @click="emit('command', { type: 'ev_charger.start' })">{{ $t('common.start') }}</v-btn>
      <v-btn class="flex-grow-1" height="56" variant="tonal" prepend-icon="boltOff" :disabled="disabled || state.status !== 'charging'"
             @click="emit('command', { type: 'ev_charger.stop' })">{{ $t('common.stop') }}</v-btn>
    </div>
    <!-- l'aide et l'annulation dans la MÊME cellule, seule la visibilité change : la carte ne saute pas -->
    <div v-if="descriptor.capabilities.includes('charge_control') && (descriptor.meta.evCharger?.stopUntilUnplug || state.manualOverride !== undefined)"
         class="charger-note mb-3">
      <div v-if="descriptor.meta.evCharger?.stopUntilUnplug" class="text-caption text-medium-emphasis"
           :style="{ visibility: state.manualOverride ? 'hidden' : 'visible' }">{{ $t('charger.stopUntilUnplug') }}</div>
      <div v-if="state.manualOverride !== undefined" class="d-flex align-center ga-2" :title="$t('charger.manualOverrideHint')"
           :style="{ visibility: state.manualOverride ? 'visible' : 'hidden' }">
        <v-icon icon="alert" size="16" color="warning" />
        <span class="text-caption flex-grow-1">{{ $t('charger.manualOverride') }}</span>
        <v-btn size="small" variant="tonal" color="warning" :disabled="disabled || !state.manualOverride"
               @click="emit('command', { type: 'ev_charger.resume_mode' })">{{ $t('charger.resumeMode') }}</v-btn>
      </div>
    </div>
    <template v-if="descriptor.capabilities.includes('charge_current')">
      <div class="text-caption text-medium-emphasis">{{ $t('charger.maxCurrent') }}</div>
      <v-slider :model-value="state.maxCurrentA ?? 16" :min="6" :max="32" :step="1" :disabled="disabled" thumb-label
                @end="(v: number) => emit('command', { type: 'ev_charger.set_current', amps: Math.round(v) })" />
    </template>
  </div>
</template>

<style scoped>
.charger-note { display: grid; }
.charger-note > * { grid-area: 1 / 1; }

/* Rendu `row` : repris de `HeatingControl` (lui-même repris des vues Ouvrants et Médias) — une rangée
   à part, toute la largeur de la ligne, qui passe à la ligne plutôt que de sortir de la carte. */
.ctl { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; margin: 2px 4px 0; }
.ctl__gap { flex: 1 1 auto; }
.ctl__slider { flex: 1 1 100%; }
.keys { display: flex; align-items: center; gap: 6px; flex: 0 1 auto; flex-wrap: wrap; }
.key {
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
/* une touche qui porte un mot et non un signe : même hauteur et même coin, largeur libre */
.key--text { width: auto; padding: 0 14px; font: inherit; font-size: 13px; }
.key--text[data-on="1"] { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
/* le mode en cours sous annulation : la couleur d'alerte du thème, comme l'avertissement du panneau */
.key--text[data-on="warn"] { color: rgb(var(--v-theme-warning)); border-color: rgb(var(--v-theme-warning)); }
</style>
