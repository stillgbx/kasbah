<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { homePanelRequest, MIN_QUERY, useSearch, type SearchHit } from '../../composables/useSearch'
import { normalize } from '../../lib/search'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Palette Ctrl+K (Cmd+K sur Mac) : la recherche de la vue Maison, ouverte depuis n'importe quelle
// page. Même moteur, même règle — un résultat NAVIGUE, il n'agit jamais. Le champ est posé à une
// hauteur fixe et la liste grandit vers le bas : rien ne bouge quand les résultats changent.

const route = useRoute()
const router = useRouter()

const open = ref(false)
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLDivElement | null>(null)
const { results } = useSearch(query, { withHome: true })
/** Ce qui avait le focus à l'ouverture : on le lui rend en fermant. */
let returnFocus: HTMLElement | null = null

const showList = () => normalize(query.value).length >= MIN_QUERY

watch(results, () => { active.value = 0 })

function show() {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  open.value = true
  void nextTick(() => input.value?.focus())
}

function close() {
  open.value = false
  query.value = ''
  returnFocus?.focus()
  returnFocus = null
}

async function pick(hit: SearchHit) {
  close()
  if (hit.family === 'page') { hit.go(); return }
  // ramener sur la maison AVANT de sélectionner : sinon le watcher qui reflète la sélection dans
  // l'URL la réécrit sur la vue courante et annule la navigation (même course que la sonnette)
  if (route.name !== 'home') await router.push({ name: 'home' }).catch(() => { /* navigation redondante */ })
  hit.go()
  homePanelRequest.value++
}

function move(delta: number) {
  const n = results.value.length
  if (n === 0) return
  active.value = (active.value + delta + n) % n
  void nextTick(() => listEl.value?.children[active.value]?.scrollIntoView({ block: 'nearest' }))
}

/** Échap efface d'abord, ferme ensuite, comme la barre de la vue Maison. */
function onEscape() {
  if (query.value) query.value = ''
  else close()
}

// Écoute en phase de capture : le raccourci passe même quand un champ a le focus, et avant le
// navigateur (Ctrl+K y met le focus sur la barre d'adresse).
function onKey(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== 'k' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
  e.preventDefault()
  if (open.value) close()
  else show()
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="palette" @mousedown.self.prevent="close()">
      <div class="palette__box" role="dialog" aria-modal="true" :aria-label="$t('search.paletteAria')">
        <div class="palette__field">
          <StrokeIcon class="palette__glass" name="search" :size="18" />
          <input ref="input" v-model="query" type="search" class="palette__input"
                 autocomplete="off" autocorrect="off" spellcheck="false"
                 :placeholder="$t('search.palette')" :aria-label="$t('search.aria')"
                 @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)"
                 @keydown.enter.prevent="results[active] && pick(results[active]!)" @keydown.esc.prevent="onEscape()">
        </div>
        <div v-if="showList()" ref="listEl" class="palette__list" role="listbox" @mousedown.prevent>
          <button v-for="(hit, i) in results" :key="hit.key" type="button" class="palette__row" role="option"
                  :data-on="i === active ? '1' : '0'" :aria-selected="i === active" @click="pick(hit)" @mouseenter="active = i">
            <StrokeIcon class="palette__icon" :name="hit.icon" :size="18" />
            <span class="palette__label">{{ hit.label }}</span>
            <span class="palette__sub">{{ hit.sub }}</span>
          </button>
          <div v-if="results.length === 0" class="palette__row palette__row--empty muted">{{ $t('search.empty') }}</div>
        </div>
        <span class="palette__sr" aria-live="polite">{{ showList() ? $t('search.count', { n: results.length }, results.length) : '' }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.palette {
  position: fixed; inset: 0; z-index: 3000; padding: 12vh 16px 0;
  background: rgb(0 0 0 / .32); display: flex; justify-content: center; align-items: flex-start;
}
.palette__box {
  width: min(560px, 100%); border-radius: var(--radius); border: 1px solid var(--line); box-shadow: var(--shadow);
  background: var(--surface); overflow: hidden;
}
.palette__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.palette__field { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 16px; }
.palette__glass { color: var(--muted); flex: none; }
.palette__input {
  flex: 1 1 0; min-width: 0; border: 0; background: transparent; color: var(--text);
  font: inherit; font-size: 15px; outline: none; text-overflow: ellipsis;
}
.palette__input::placeholder { color: var(--muted); }
.palette__input::-webkit-search-cancel-button { display: none; }
/* huit lignes visibles, le reste au défilement : c'est la frappe suivante qui trie */
.palette__list { max-height: calc(8 * 46px); overflow-y: auto; overscroll-behavior: contain; border-top: 1px solid var(--line); }
.palette__row {
  display: flex; align-items: center; gap: 10px; width: 100%; height: 46px; padding: 0 16px;
  border: 0; background: transparent; color: var(--text); text-align: left;
}
.palette__row + .palette__row { border-top: 1px solid var(--line); }
/* même ligne active que la barre de la vue Maison : teinte ET liseré, `outline` pour ne rien décaler */
.palette__row[data-on='1'] { background: color-mix(in srgb, var(--accent) 14%, transparent); outline: 2px solid var(--accent); outline-offset: -2px; }
.palette__row--empty { justify-content: center; }
.palette__icon { color: var(--muted); flex: none; }
.palette__label { flex: 1 1 auto; min-width: 0; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.palette__sub { flex: 0 1 auto; min-width: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
