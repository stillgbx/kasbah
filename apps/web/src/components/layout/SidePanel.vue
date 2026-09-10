<script setup lang="ts">
// Panneau latéral (340 px) : colonne fixe à droite en paysage large, tiroir superposé sinon.
defineProps<{ open: boolean; docked: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <aside v-if="docked" class="side-panel side-panel--docked">
    <div class="side-panel__scroll"><slot /></div>
  </aside>
  <template v-else>
    <transition name="fade"><div v-if="open" class="side-panel__scrim" @click="emit('close')" /></transition>
    <transition name="slide">
      <aside v-if="open" class="side-panel side-panel--overlay">
        <div class="side-panel__scroll"><slot /></div>
      </aside>
    </transition>
  </template>
</template>

<style scoped>
.side-panel { width: var(--aside-w); border-left: 1px solid var(--line); background: var(--surface); display: flex; flex-direction: column; min-height: 0; }
.side-panel--docked { height: 100%; }
.side-panel--overlay { position: absolute; top: 0; right: 0; bottom: 0; z-index: 30; box-shadow: var(--shadow); max-width: 92vw; padding-top: var(--safe-top); }
.side-panel__scrim { position: absolute; inset: 0; z-index: 29; background: rgba(0, 0, 0, .25); }
/* colonne flex (et non grille) : un enfant peut se caler au FOND avec margin-top: auto, comme la section
   « Emplacement » du panneau appareil ; les enfants s'étirent en largeur comme avant */
/* `overflow-x: hidden` : garde-fou. Chaque contenu se charge de tenir dans la largeur (points de
   suspension, MarqueeText, coupure d'un id) ; si l'un d'eux oublie, il est découpé ici plutôt que
   de sortir du panneau et de passer par-dessus la vue 3D. */
.side-panel__scroll { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: calc(var(--safe-top) + 20px) 22px calc(var(--safe-bottom) + 20px); display: flex; flex-direction: column; gap: 20px; position: relative; isolation: isolate; }
.side-panel--overlay .side-panel__scroll { padding-top: 20px; }
.slide-enter-active, .slide-leave-active { transition: transform .22s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
