<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDebounceFn } from '@vueuse/core'
import { getTransport } from '../../api'
import type { WeatherPlace } from '../../api/transport'
import { useWeatherPlaces } from '../../composables/useWeather'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Barre de lieux de la vue Météo, dans l'en-tête : la maison, les favoris, et le lieu affiché s'il
// n'est pas favori (pastille en pointillés, étoile pour le garder) ; la pastille allumée dit TOUJOURS
// ce qu'on regarde. À droite, la recherche : ses résultats s'ouvrent PAR-DESSUS la page, rien ne bouge.
const { t, locale } = useI18n()
const places = useWeatherPlaces()
const selected = places.selected
/** Le lieu affiché hors favoris : sa pastille provisoire, en fin de rangée. */
const transient = computed(() => (selected.value && !places.isFavorite(selected.value) ? selected.value : null))
const isOn = (p: WeatherPlace | null) => (p ? selected.value?.id === p.id : !selected.value)
const titleOf = (p: WeatherPlace) => (p.region ? `${p.name} — ${p.region}` : p.name)

const query = ref('')
const results = ref<WeatherPlace[]>([])
const status = ref<'idle' | 'loading' | 'done' | 'error'>('idle')
const open = ref(false)
const active = ref(0)
let asked = 0

const search = useDebounceFn(async (q: string) => {
  const ticket = ++asked
  try {
    const r = await getTransport().searchPlaces(q, locale.value.slice(0, 2))
    if (ticket === asked) { results.value = r; status.value = 'done'; active.value = 0 }
  } catch { if (ticket === asked) { results.value = []; status.value = 'error' } }
}, 300)

watch(query, (q) => {
  const trimmed = q.trim()
  if (trimmed.length < 2) { asked++; results.value = []; status.value = 'idle'; return }
  status.value = 'loading'
  open.value = true
  void search(trimmed)
})

function pick(p: WeatherPlace): void {
  places.select(p)
  query.value = ''
  open.value = false
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') { open.value = false; return }
  if (!results.value.length) return
  if (e.key === 'ArrowDown') { e.preventDefault(); open.value = true; active.value = (active.value + 1) % results.value.length }
  else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = (active.value - 1 + results.value.length) % results.value.length }
  else if (e.key === 'Enter') { e.preventDefault(); pick(results.value[active.value]!) }
}
</script>

<template>
  <div class="wxp">
    <div class="wxp__pills" role="group" :aria-label="t('weather.places')">
      <button type="button" class="wxp-pill" :data-on="isOn(null) ? '1' : '0'" @click="places.select(null)">
        <StrokeIcon name="home" :size="15" /><span class="wxp-pill__name">{{ t('weather.home') }}</span>
      </button>
      <div v-for="f in places.favorites.value" :key="f.id" class="wxp-pill" :data-on="isOn(f) ? '1' : '0'" :title="titleOf(f)">
        <button type="button" class="wxp-pill__go" @click="places.select(f)"><StrokeIcon name="pin" :size="14" /><span class="wxp-pill__name">{{ f.name }}</span></button>
        <button type="button" class="wxp-pill__x" :aria-label="t('weather.removeFavorite')" :title="t('weather.removeFavorite')" @click="places.toggleFavorite(f)">
          <StrokeIcon name="close" :size="12" />
        </button>
      </div>
      <div v-if="transient" class="wxp-pill wxp-pill--transient" data-on="1" :title="titleOf(transient)">
        <span class="wxp-pill__go"><StrokeIcon name="pin" :size="14" /><span class="wxp-pill__name">{{ transient.name }}</span></span>
        <button type="button" class="wxp-pill__x" :aria-label="t('weather.addFavorite')" :title="t('weather.addFavorite')" @click="places.toggleFavorite(transient)">
          <StrokeIcon name="star" :size="13" />
        </button>
      </div>
    </div>

    <div class="wxp__search">
      <div class="wxp__field">
        <StrokeIcon name="search" :size="16" class="wxp__icon" />
        <input v-model="query" type="search" class="wxp__input" :placeholder="t('weather.searchPlace')" :aria-label="t('weather.searchPlace')"
               autocomplete="off" @focus="open = query.trim().length >= 2" @blur="open = false" @keydown="onKey" />
        <button type="button" class="wxp__clear" :class="{ 'is-hidden': !query }" :tabindex="query ? 0 : -1" :aria-label="t('music.clear')" @mousedown.prevent @click="query = ''">
          <StrokeIcon name="close" :size="12" />
        </button>
      </div>
      <!-- par-dessus la page : `mousedown.prevent` garde le champ actif, le clic choisit avant que le flou ne ferme -->
      <div v-if="open && status !== 'idle'" class="wxp__menu card" role="listbox">
        <div v-if="status === 'loading' && !results.length" class="wxp__note muted">{{ t('weather.searching') }}</div>
        <div v-else-if="status === 'error'" class="wxp__note muted">{{ t('weather.searchFailed') }}</div>
        <div v-else-if="!results.length" class="wxp__note muted">{{ t('weather.noPlace') }}</div>
        <button v-for="(p, i) in results" :key="p.id" type="button" role="option" class="wxp__row" :data-on="i === active ? '1' : '0'" :aria-selected="i === active"
                @mousedown.prevent @mouseenter="active = i" @click="pick(p)">
          <StrokeIcon :name="places.isFavorite(p) ? 'star' : 'pin'" :size="15" class="wxp__row-icon" />
          <span class="wxp__row-name">{{ p.name }}</span>
          <span class="wxp__row-region muted">{{ p.region ?? '' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wxp { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 0 1 auto; }
/* une seule rangée qui défile de côté : ajouter un favori n'agrandit jamais l'en-tête */
.wxp__pills { display: flex; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: none; padding: 2px; }
.wxp__pills::-webkit-scrollbar { display: none; }
.wxp-pill {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; height: 36px; max-width: 200px; padding: 0 12px;
  border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--text); font: inherit; font-size: 13px; font-weight: 500;
  overflow: hidden; transition: background .15s, color .15s, border-color .15s;
}
button.wxp-pill { cursor: pointer; }
.wxp-pill:has(.wxp-pill__x) { padding: 0; }
.wxp-pill[data-on='1'] { background: var(--accent); color: var(--on-accent); border-color: transparent; }
.wxp-pill--transient[data-on='1'] { background: var(--accent-soft); color: var(--text); border: 1px dashed var(--accent); }
.wxp-pill__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wxp-pill__go {
  display: inline-flex; align-items: center; gap: 6px; min-width: 0; height: 100%; padding: 0 6px 0 12px;
  border: 0; background: transparent; color: inherit; font: inherit;
}
.wxp-pill__x {
  flex: 0 0 auto; display: grid; place-items: center; width: 30px; height: 100%; padding: 0; border: 0;
  border-left: 1px solid color-mix(in srgb, currentColor 22%, transparent); background: transparent; color: inherit; opacity: .75;
}
.wxp-pill__x:hover, .wxp-pill__go:hover { background: color-mix(in srgb, currentColor 10%, transparent); opacity: 1; }
.wxp-pill--transient .wxp-pill__x { color: var(--accent); opacity: 1; }

.wxp__search { position: relative; flex: 0 0 240px; }
.wxp__field {
  display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 4px 0 12px;
  border: 1px solid var(--line); border-radius: 999px; background: var(--surface);
}
.wxp__field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.wxp__icon { color: var(--muted); flex: 0 0 auto; }
.wxp__input { flex: 1 1 auto; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: 14px; }
.wxp__input::-webkit-search-cancel-button { display: none; }
.wxp__clear { display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 999px; background: var(--surface2); color: var(--muted); flex: 0 0 auto; }
.wxp__clear.is-hidden { visibility: hidden; }
.wxp__menu {
  position: absolute; top: calc(100% + 6px); right: 0; width: 340px; max-width: calc(100vw - 32px); z-index: 30;
  padding: 6px; display: grid; gap: 2px; box-shadow: 0 10px 30px rgb(0 0 0 / .18);
}
.wxp__note { padding: 10px 12px; font-size: 13px; }
.wxp__row {
  display: grid; grid-template-columns: 18px auto 1fr; align-items: center; gap: 8px; height: 40px; padding: 0 10px;
  border: 0; border-radius: 8px; background: transparent; color: var(--text); font: inherit; text-align: left; min-width: 0;
}
.wxp__row[data-on='1'] { background: var(--surface2); }
.wxp__row-icon { color: var(--muted); }
.wxp__row-name { font-size: 14px; font-weight: 500; white-space: nowrap; }
.wxp__row-region { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }

/* étroit : la recherche garde sa place, les pastilles se serrent et défilent */
@media (max-width: 760px) { .wxp__search { flex-basis: 180px; } }
/* téléphone : les pastilles au-dessus, la recherche dessous, chacune sur toute la largeur */
@media (max-width: 560px) { .wxp { flex-wrap: wrap; row-gap: 8px; } .wxp__pills, .wxp__search { flex: 1 1 100%; } }
</style>
