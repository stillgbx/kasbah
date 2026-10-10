<script setup lang="ts">
// Panneau latéral (340 px) : carte FLOTTANTE posée sur la scène à droite en paysage large (la scène
// prend tout l'espace et se cadre dans la partie libre, cf. `HouseScene.setViewInset`), tiroir
// superposé sinon — feuille qui monte du bas sur un téléphone en portrait.
//
// La feuille se ferme en la glissant vers le bas par sa poignée (la barre en haut) : lâchée après un
// quart de sa hauteur, ou lancée d'un geste vif, elle descend et se ferme ; sinon elle remonte.
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{ open: boolean; docked: boolean }>()
const emit = defineEmits<{ close: [] }>()

/** Vitesse (px/ms) d'un geste lancé, qui ferme même court. */
const FLING = 0.5

const sheet = ref<HTMLElement | null>(null)
/** De combien la feuille est tirée vers le bas ; `'gone'` : elle part, avant la fermeture. */
const offset = ref<number | 'gone'>(0)
const dragging = ref(false)
let startY = 0
let lastY = 0
let lastT = 0
let speed = 0

watch(() => props.open, (open) => { if (open) offset.value = 0 })

const sheetStyle = computed(() => {
  if (offset.value === 'gone') return { transform: 'translateY(100%)' }
  if (!offset.value) return undefined
  return { transform: `translateY(${offset.value}px)`, transition: dragging.value ? 'none' : undefined }
})

function grab(e: PointerEvent) {
  (e.currentTarget as Element).setPointerCapture(e.pointerId)
  dragging.value = true
  startY = lastY = e.clientY
  lastT = e.timeStamp
  speed = 0
}

function drag(e: PointerEvent) {
  if (!dragging.value) return
  const dt = e.timeStamp - lastT
  if (dt > 0) speed = (e.clientY - lastY) / dt
  lastY = e.clientY
  lastT = e.timeStamp
  offset.value = Math.max(0, e.clientY - startY)
}

async function drop() {
  if (!dragging.value) return
  dragging.value = false
  const pulled = typeof offset.value === 'number' ? offset.value : 0
  if (pulled > (sheet.value?.offsetHeight ?? 0) / 4 || (speed > FLING && pulled > 16)) {
    // elle descend d'où le doigt l'a laissée ; la fermeture suit, une fois le style posé
    offset.value = 'gone'
    await nextTick()
    emit('close')
  } else offset.value = 0
}
</script>

<template>
  <aside v-if="docked" class="side-panel side-panel--docked">
    <div class="side-panel__scroll"><slot /></div>
  </aside>
  <template v-else>
    <transition name="fade"><div v-if="open" class="side-panel__scrim" @click="emit('close')" /></transition>
    <transition name="slide">
      <aside v-if="open" ref="sheet" class="side-panel side-panel--overlay" :style="sheetStyle">
        <div class="side-panel__grip" @pointerdown="grab" @pointermove="drag" @pointerup="drop" @pointercancel="drop"><span /></div>
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
/* la poignée n'existe que sur la feuille du téléphone */
.side-panel__grip { display: none; }
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
/* Téléphone en portrait : une feuille qui monte du bas, la scène reste visible au-dessus. */
@media (max-width: 599px) {
  .side-panel--overlay {
    top: auto; left: 0; width: auto; max-width: none; height: 64dvh; padding-top: 0;
    border-left: 0; border-top: 1px solid var(--line); border-radius: 20px 20px 0 0; overflow: hidden;
  }
  .side-panel--overlay .side-panel__scroll { padding-inline: var(--page-x); padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 36px); }
  .slide-enter-from, .slide-leave-to { transform: translateY(100%); }
  /* lâchée, la feuille remonte (ou descend) au même pas que son ouverture */
  .side-panel--overlay { transition: transform .22s ease; }
  /* La poignée : une bande de 28 px posée sur la marge haute du contenu, que celle-ci prend (le
     contenu descend de 8 px). Elle seule se glisse : le reste de la feuille défile. */
  .side-panel__grip {
    display: grid; place-items: center; position: absolute; top: 0; left: 0; right: 0; z-index: 3;
    height: 28px; touch-action: none; cursor: grab;
  }
  .side-panel__grip > span { width: 40px; height: 4px; border-radius: 999px; background: color-mix(in srgb, var(--text) 28%, transparent); }
  .side-panel--overlay .side-panel__scroll { --panel-pad-top: 28px; padding-top: 28px; }
}
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
