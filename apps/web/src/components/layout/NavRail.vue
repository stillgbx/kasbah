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
  { name: 'lights', icon: 'light', label: 'nav.lights' },
  { name: 'covers', icon: 'shutter', label: 'nav.covers' },
  { name: 'cameras', icon: 'camera', label: 'nav.cameras' },
  { name: 'media', icon: 'speaker', label: 'nav.media' },
  { name: 'energy', icon: 'bolt', label: 'nav.energy' },
  { name: 'vehicles', icon: 'vehicle', label: 'nav.vehicles' },
  { name: 'settings', icon: 'gear', label: 'nav.settings' },
]
const themeIcon = computed<IconName>(() => (settings.appearance === 'light' ? 'sun' : settings.appearance === 'dark' ? 'moon' : 'auto'))
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
.rail {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: calc(var(--safe-top) + 18px) 0 calc(var(--safe-bottom) + 14px) var(--safe-left);
  border-right: 1px solid var(--line); background: var(--surface); height: 100%;
}
.rail__avatar {
  width: 38px; height: 38px; border-radius: 12px; background: var(--accent); color: var(--on-accent);
  display: grid; place-items: center; font-weight: 700; font-size: 15px; margin-bottom: 14px;
}
.rail__btn {
  width: 52px; height: 52px; border-radius: 16px; border: 0; background: transparent; color: var(--muted);
  display: grid; place-items: center; transition: background .15s, color .15s;
}
.rail__btn:hover { color: var(--text); }
.rail__btn[data-on='1'] { background: var(--accent-soft); color: var(--accent); }
.rail__spacer { flex: 1 1 0; }
.rail__lang {
  width: 52px; height: 40px; border-radius: 12px; border: 1px solid var(--line); background: transparent; color: var(--muted);
  font-weight: 600; font-size: 12px; letter-spacing: .06em;
}
</style>
