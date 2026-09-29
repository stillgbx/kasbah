<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useHouseStore } from '../../stores/house'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { NAV_ITEMS, visibleNavItems } from '../../lib/navItems'
import { useLocalPluginsStore } from '../../stores/localPlugins'

// Rail de navigation (72 px) : initiales de la maison, vues, puis les réglages tout en bas. Sur un
// téléphone, il DÉFILE : resserré à gauche en paysage, en barre horizontale en bas en portrait.
const route = useRoute()
/** Entrée du rail à allumer : une sous-page (l'édition d'une automatisation) nomme sa vue dans `meta.nav`. */
const current = computed(() => (route.meta.nav as string | undefined) ?? route.name)
const house = useHouseStore()

const initials = computed(() => {
  const words = (house.house?.name ?? 'Kasbah').split(/\s+/).filter((w) => w.length > 2 || /^[A-Z0-9]/.test(w))
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'K'
})
// Les réglages restent dans NAV_ITEMS — la recherche de la vue Maison s'en sert pour ouvrir la
// page — mais ils quittent la file des vues : leur place est en bas du rail, sous le spacer.
const localPlugins = useLocalPluginsStore()
const items = computed(() => visibleNavItems(localPlugins.isEnabled).filter((it) => it.name !== 'settings'))
const settingsItem = NAV_ITEMS.find((it) => it.name === 'settings')!

// La vue courante reste en vue dans la file qui défile : arrivé par la recherche sur « Réglages »,
// on voit son bouton allumé au lieu d'une barre qui montre encore le début. Défilement du seul rail
// (pas `scrollIntoView`, qui ferait aussi défiler la coquille, `overflow: hidden` ou non).
const scroller = ref<HTMLElement | null>(null)
watch(current, () => void nextTick(() => {
  const box = scroller.value
  const btn = box?.querySelector<HTMLElement>('.rail__btn[data-on="1"]')
  if (!box || !btn) return
  const horizontal = box.scrollWidth > box.clientWidth
  const [start, size, view, pos] = horizontal
    ? [btn.offsetLeft, btn.offsetWidth, box.clientWidth, box.scrollLeft]
    : [btn.offsetTop, btn.offsetHeight, box.clientHeight, box.scrollTop]
  const PAD = 24
  let to = pos
  if (start - PAD < pos) to = start - PAD
  else if (start + size + PAD > pos + view) to = start + size + PAD - view
  if (to !== pos) box.scrollTo({ [horizontal ? 'left' : 'top']: to, behavior: 'smooth' })
}), { immediate: true })
</script>

<template>
  <nav class="rail" :aria-label="$t('nav.main')">
    <div ref="scroller" class="rail__scroll">
      <div class="rail__avatar" :title="house.house?.name">{{ initials }}</div>
      <router-link v-for="it in items" :key="it.name" v-slot="{ navigate }" :to="{ name: it.name }" custom>
        <button type="button" class="rail__btn" :data-on="current === it.name ? '1' : '0'" :title="$t(it.label)" :aria-label="$t(it.label)" @click="navigate">
          <StrokeIcon :name="it.icon" :size="24" />
        </button>
      </router-link>
      <div class="rail__spacer" />
      <router-link v-slot="{ navigate }" :to="{ name: settingsItem.name }" custom>
        <button type="button" class="rail__btn" :data-on="current === settingsItem.name ? '1' : '0'" :title="$t(settingsItem.label)" :aria-label="$t(settingsItem.label)" @click="navigate">
          <StrokeIcon :name="settingsItem.icon" :size="24" />
        </button>
      </router-link>
    </div>
  </nav>
</template>

<style scoped>
/* Posé sur la vue, sans fond ni bord : la scène 3D de la vue Maison passe dessous. */
.rail { position: absolute; top: 0; left: 0; bottom: 0; width: var(--rail-w); z-index: 5; display: flex; }
/* La file des boutons, dans son propre conteneur : c'est LUI qui défile quand la fenêtre est trop
   basse, et le voile (`::before` du rail) reste plus large que lui, sans être rogné. */
.rail__scroll {
  flex: 1 1 auto; min-width: 0; min-height: 0;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: calc(var(--safe-top) + 18px) 0 calc(var(--safe-bottom) + 14px) var(--safe-left);
  overflow: auto; overscroll-behavior: contain; scrollbar-width: none;
}
.rail__scroll::-webkit-scrollbar { display: none; }
/* Les boutons se TASSENT avant de défiler (jusqu'à 28 px, à peine plus que l'icône) : une fenêtre
   de bureau un peu basse garde tout le rail en vue, comme avant ; le défilement n'arrive qu'au-delà,
   et sur un téléphone, où les boutons gardent leur taille. */
.rail__avatar { flex: none; }
.rail__btn { flex: 0 1 auto; min-height: 28px; }
/* Un voile du fond vers le transparent, plus large que le rail : les icônes se lisent par-dessus les
   murs et les pilules de la scène, sans qu'un bord ne coupe la vue. Sur les autres vues, il a la
   couleur de leur fond et ne se voit pas. Derrière les boutons (z-index -1 dans le rail), au-dessus
   de la scène. */
.rail::before {
  content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: calc(var(--rail-w) + 150px); z-index: -1; pointer-events: none;
  /* discret et large : un assombrissement qui s'étale, pas une barre — on reste immergé. La rampe
     est adoucie (opacité 0,8 → 0 par une courbe dont la pente s'annule à la fin) : une rampe
     LINÉAIRE laisse une cassure de pente là où elle atteint zéro, et l'œil la lit comme un trait
     vertical sur les aplats de la scène. Les paliers suivent a = .8 (1-t)² (1 + .345 t). */
  background: linear-gradient(to right,
    color-mix(in srgb, var(--bg) 80%, transparent) 0,
    color-mix(in srgb, var(--bg) 67%, transparent) 10%,
    color-mix(in srgb, var(--bg) 55%, transparent) 20%,
    color-mix(in srgb, var(--bg) 43%, transparent) 30%,
    color-mix(in srgb, var(--bg) 33%, transparent) 40%,
    color-mix(in srgb, var(--bg) 23%, transparent) 50%,
    color-mix(in srgb, var(--bg) 15%, transparent) 60%,
    color-mix(in srgb, var(--bg) 9%, transparent) 70%,
    color-mix(in srgb, var(--bg) 4%, transparent) 80%,
    color-mix(in srgb, var(--bg) 1%, transparent) 90%,
    transparent 100%);
}
.rail__avatar {
  width: 38px; height: 38px; border-radius: 12px; background: var(--accent); color: var(--on-accent);
  display: grid; place-items: center; font-weight: 700; font-size: 15px; margin-bottom: 14px;
}
.rail__btn {
  width: 52px; height: 52px; border-radius: 16px; border: 0; background: transparent; color: var(--muted);
  display: grid; place-items: center; transition: background .15s, color .15s;
}
.rail__btn:hover { color: var(--text); background: color-mix(in srgb, var(--surface) 55%, transparent); }
.rail__btn[data-on='1'] { background: var(--accent-soft); color: var(--accent); }
.rail__spacer { flex: 1 1 0; }

/* Téléphone en paysage : boutons de 44 px, et la file défile avec un fondu aux deux bouts. */
@media (min-width: 600px) and (max-height: 500px) {
  .rail__scroll {
    gap: 4px; padding-top: calc(var(--safe-top) + 10px); padding-bottom: calc(var(--safe-bottom) + 10px);
    mask-image: linear-gradient(to bottom, transparent, #000 14px, #000 calc(100% - 14px), transparent);
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 14px, #000 calc(100% - 14px), transparent);
  }
  .rail__avatar { width: 32px; height: 32px; border-radius: 10px; font-size: 13px; margin-bottom: 6px; }
  .rail__btn { flex: none; width: 44px; height: 44px; border-radius: 14px; }
  .rail__spacer { flex: 0 0 4px; }
}

/* Téléphone en portrait : une barre en bas, qui défile de côté ; les réglages ferment la file.
   Le voile monte du bas au lieu de venir de la gauche. */
@media (max-width: 599px) {
  .rail { top: auto; right: 0; width: auto; height: var(--dock-h); }
  .rail::before { top: auto; bottom: 0; right: 0; width: auto; height: calc(var(--dock-h) + 48px); }
  .rail::before { background: linear-gradient(to top,
    color-mix(in srgb, var(--bg) 92%, transparent) 0,
    color-mix(in srgb, var(--bg) 80%, transparent) 55%,
    color-mix(in srgb, var(--bg) 30%, transparent) 80%,
    transparent 100%); }
  .rail__scroll {
    flex-direction: row; gap: 2px;
    padding: 0 calc(var(--safe-right) + 10px) var(--safe-bottom) calc(var(--safe-left) + 10px);
    mask-image: linear-gradient(to right, transparent, #000 12px, #000 calc(100% - 12px), transparent);
    -webkit-mask-image: linear-gradient(to right, transparent, #000 12px, #000 calc(100% - 12px), transparent);
  }
  .rail__avatar { display: none; }
  .rail__btn { flex: none; width: 48px; height: 48px; border-radius: 14px; }
  .rail__spacer { flex: 0 0 6px; }
}
</style>
