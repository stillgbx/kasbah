<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useHouseStore } from '../../stores/house'
import { useSettingsStore } from '../../stores/settings'
import StrokeIcon from '../ui/StrokeIcon.vue'
import type { IconName } from '../../lib/strokeIcons'

// Rail de navigation (72 px) : initiales de la maison, 8 vues, puis apparence et langue en bas.
const route = useRoute()
const house = useHouseStore()
const settings = useSettingsStore()

const initials = computed(() => {
  const words = (house.house?.name ?? 'Kasbah').split(/\s+/).filter((w) => w.length > 2 || /^[A-Z0-9]/.test(w))
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'K'
})
const items: { name: string; icon: IconName; label: string }[] = [
  { name: 'home', icon: 'home', label: 'nav.home' },
  // la météo juste après la maison : ce qu'on regarde en arrivant, avant de piloter quoi que ce soit
  { name: 'weather', icon: 'cloudSun', label: 'nav.weather' },
  { name: 'lights', icon: 'light', label: 'nav.lights' },
  { name: 'covers', icon: 'shutter', label: 'nav.covers' },
  { name: 'media', icon: 'cast', label: 'nav.media' },
  { name: 'cameras', icon: 'camera', label: 'nav.cameras' },
  { name: 'energy', icon: 'bolt', label: 'nav.energy' },
  { name: 'vehicles', icon: 'vehicle', label: 'nav.vehicles' },
  { name: 'robots', icon: 'mower', label: 'nav.robots' },
  { name: 'settings', icon: 'gear', label: 'nav.settings' },
]
const APPEARANCE_ICON: Record<string, IconName> = { light: 'sun', dark: 'moon', system: 'auto', auto: 'sunHorizon' }
const themeIcon = computed<IconName>(() => APPEARANCE_ICON[settings.appearance] ?? 'auto')
</script>

<template>
  <nav class="rail" :aria-label="$t('nav.main')">
    <div class="rail__avatar" :title="house.house?.name">{{ initials }}</div>
    <router-link v-for="it in items" :key="it.name" :to="{ name: it.name }" custom v-slot="{ navigate }">
      <button type="button" class="rail__btn" :data-on="route.name === it.name ? '1' : '0'" :title="$t(it.label)" :aria-label="$t(it.label)" @click="navigate">
        <StrokeIcon :name="it.icon" :size="24" />
      </button>
    </router-link>
    <div class="rail__spacer" />
    <button type="button" class="rail__btn" :title="$t('settings.appearance')" :aria-label="$t('settings.appearance')" @click="settings.cycleAppearance()">
      <StrokeIcon :name="themeIcon" :size="22" />
    </button>
    <button type="button" class="rail__lang" :title="$t('settings.language')" @click="settings.toggleLocale()">{{ settings.resolvedLocale.toUpperCase() }}</button>
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
.rail__lang {
  width: 52px; height: 40px; border-radius: 12px; border: 1px solid var(--line); background: transparent; color: var(--muted);
  font-weight: 600; font-size: 12px; letter-spacing: .06em;
}
</style>
