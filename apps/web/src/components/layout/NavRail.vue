<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useHouseStore } from '../../stores/house'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { NAV_ITEMS } from '../../lib/navItems'

// Rail de navigation (72 px) : initiales de la maison, vues, puis les réglages tout en bas.
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
const items = NAV_ITEMS.filter((it) => it.name !== 'settings')
const settingsItem = NAV_ITEMS.find((it) => it.name === 'settings')!
</script>

<template>
  <nav class="rail" :aria-label="$t('nav.main')">
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
  </nav>
</template>

<style scoped>
/* Posé sur la vue, sans fond ni bord : la scène 3D de la vue Maison passe dessous. */
.rail {
  position: absolute; top: 0; left: 0; bottom: 0; width: var(--rail-w); z-index: 5;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: calc(var(--safe-top) + 18px) 0 calc(var(--safe-bottom) + 14px) var(--safe-left);
}
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
</style>
