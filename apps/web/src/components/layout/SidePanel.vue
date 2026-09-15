<script setup lang="ts">
// Panneau latéral (340 px) : carte FLOTTANTE posée sur la scène à droite en paysage large (la scène
// prend tout l'espace et se cadre dans la partie libre, cf. `HouseScene.setViewInset`), tiroir
// superposé sinon.
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
.side-panel { width: var(--aside-w); background: var(--surface); display: flex; flex-direction: column; min-height: 0; }
.side-panel--docked {
  position: absolute; top: calc(var(--safe-top) + var(--panel-gap)); right: calc(var(--safe-right) + var(--panel-gap)); bottom: calc(var(--safe-bottom) + var(--panel-gap)); z-index: 3;
  border-radius: 20px; border: 1px solid var(--line); box-shadow: var(--shadow); overflow: hidden;   /* la barre de défilement suit l'arrondi */
  background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
}
.side-panel--docked .side-panel__scroll { --panel-pad-top: 20px; }
/* Le contenu s'évanouit en bas plutôt que d'être tranché par le bord : le masque fond les 36 derniers
   pixels (barre de défilement comprise). En haut, c'est l'en-tête collant qui porte son propre fondu
   (`.panel-head`, styles/app.css) — un masque en haut le ferait disparaître lui aussi. */
.side-panel__scroll { mask-image: linear-gradient(to bottom, #000 calc(100% - 36px), transparent); -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 36px), transparent); }
/* barre fine, sans flèches (elles dépassaient de l'arrondi), qui ne se voit qu'au survol */
.side-panel__scroll::-webkit-scrollbar { width: 6px; }
.side-panel__scroll::-webkit-scrollbar-button { display: none; height: 0; }
.side-panel__scroll::-webkit-scrollbar-track { background: transparent; }
.side-panel__scroll::-webkit-scrollbar-thumb { background: var(--line); border-radius: 999px; }
.side-panel__scroll { scrollbar-width: thin; scrollbar-color: transparent transparent; }
.side-panel__scroll:hover { scrollbar-color: var(--line) transparent; }
.side-panel--overlay { position: absolute; top: 0; right: 0; bottom: 0; z-index: 30; border-left: 1px solid var(--line); box-shadow: var(--shadow); max-width: 92vw; padding-top: var(--safe-top); }
.side-panel__scrim { position: absolute; inset: 0; z-index: 29; background: rgba(0, 0, 0, .25); }
/* colonne flex (et non grille) : un enfant peut se caler au FOND avec margin-top: auto, comme la section
   « Emplacement » du panneau appareil ; les enfants s'étirent en largeur comme avant */
/* `overflow-x: hidden` : garde-fou. Chaque contenu se charge de tenir dans la largeur (points de
   suspension, MarqueeText, coupure d'un id) ; si l'un d'eux oublie, il est découpé ici plutôt que
   de sortir du panneau et de passer par-dessus la vue 3D. */
/* `--panel-pad-top` : la marge haute du contenu, que l'en-tête collant (`.panel-head`) reprend pour la
   couvrir et s'y caler (voir styles/app.css) — une seule valeur, déclarée ici, lue là. */
.side-panel__scroll { --panel-pad-top: calc(var(--safe-top) + 20px); flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: var(--panel-pad-top) 22px calc(var(--safe-bottom) + 36px); display: flex; flex-direction: column; gap: 20px; position: relative; isolation: isolate; }
.side-panel--overlay .side-panel__scroll { padding-top: 20px; }
.slide-enter-active, .slide-leave-active { transition: transform .22s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
