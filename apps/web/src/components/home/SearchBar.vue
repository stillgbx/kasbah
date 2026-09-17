<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { MIN_QUERY, useSearch, type SearchHit } from '../../composables/useSearch'
import { normalize } from '../../lib/search'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Barre de recherche de la vue Maison, ancrée en bas entre la carte météo et les boutons de vue.
// La liste s'ouvre AU-DESSUS du champ : le champ ne bouge donc jamais, quel que soit le nombre de
// résultats, et rien d'autre à l'écran ne se décale. Valider un résultat ne fait rien d'autre que
// déplacer la sélection (voir `useSearch`) — le cadrage 3D et le panneau suivent tout seuls.

const emit = defineEmits<{ picked: [hit: SearchHit] }>()

const query = ref('')
const focused = ref(false)
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLDivElement | null>(null)
const { results } = useSearch(query)

/** La liste s'ouvre dès que la requête est assez longue, même vide : « Aucun résultat » est une réponse. */
const isOpen = () => focused.value && normalize(query.value).length >= MIN_QUERY

// La frappe rebat les cartes : le curseur revient en tête, sinon Entrée validerait la 4e ligne
// d'une liste qui n'a plus rien à voir avec celle qu'on regardait.
watch(results, () => { active.value = 0 })

function pick(hit: SearchHit) {
  hit.go()
  emit('picked', hit)
  query.value = ''
  input.value?.blur()
}

function move(delta: number) {
  const n = results.value.length
  if (n === 0) return
  active.value = (active.value + delta + n) % n
  void nextTick(() => listEl.value?.children[active.value]?.scrollIntoView({ block: 'nearest' }))
}

/** Échap efface d'abord, rend la main ensuite : on corrige une frappe sans perdre le champ. */
function onEscape() {
  if (query.value) query.value = ''
  else input.value?.blur()
}
</script>

<template>
  <div class="search">
    <!-- `mousedown.prevent` : sans lui, le champ perd le focus AVANT le clic, la liste se ferme et
         le résultat n'est jamais choisi (le doigt passe par la même séquence que la souris). -->
    <div v-if="isOpen()" ref="listEl" class="search__list" role="listbox" @mousedown.prevent>
      <button v-for="(hit, i) in results" :key="hit.key" type="button" class="search__row" role="option"
              :data-on="i === active ? '1' : '0'" :aria-selected="i === active" @click="pick(hit)" @mouseenter="active = i">
        <StrokeIcon class="search__icon" :name="hit.icon" :size="18" />
        <span class="search__label">{{ hit.label }}</span>
        <span class="search__sub">{{ hit.sub }}</span>
      </button>
      <div v-if="results.length === 0" class="search__row search__row--empty muted">{{ $t('search.empty') }}</div>
    </div>
    <div class="search__field">
      <StrokeIcon class="search__glass" name="search" :size="18" />
      <input ref="input" v-model="query" type="search" class="search__input" enterkeyhint="go"
             autocomplete="off" autocorrect="off" spellcheck="false"
             :placeholder="$t('search.placeholder')" :aria-label="$t('search.aria')"
             @focus="focused = true" @blur="focused = false"
             @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)"
             @keydown.enter.prevent="results[active] && pick(results[active]!)" @keydown.esc.prevent="onEscape()">
      <!-- place TOUJOURS réservée : un bouton qui apparaît rétrécirait le champ sous les doigts -->
      <button type="button" class="search__clear" :data-show="query ? '1' : '0'" :tabindex="query ? 0 : -1"
              :aria-label="$t('search.clear')" @mousedown.prevent @click="query = ''; input?.focus()">
        <StrokeIcon name="close" :size="16" />
      </button>
    </div>
    <span class="search__sr" aria-live="polite">{{ isOpen() ? $t('search.count', { n: results.length }, results.length) : '' }}</span>
  </div>
</template>

<style scoped>
.search { position: relative; width: min(380px, 100%); }
/* annonce du nombre de résultats aux lecteurs d'écran, invisible à l'œil */
.search__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.search__field {
  display: flex; align-items: center; gap: 8px; height: var(--ctl-w); padding: 0 6px 0 14px;
  border-radius: 999px; border: 1px solid var(--line); box-shadow: var(--shadow);
  background: color-mix(in srgb, var(--surface) 86%, transparent);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.search__glass { color: var(--muted); flex: none; }
.search__input {
  flex: 1 1 0; min-width: 0; border: 0; background: transparent; color: var(--text);
  font: inherit; font-size: 14px; outline: none;
  /* en fenêtre étroite le texte indicatif ne tient plus : points de suspension plutôt qu'une coupe
     en plein mot (« Rechercher une pièce, un a ») — la propriété se pose sur le champ, pas sur
     `::placeholder`, qui ne l'accepte pas */
  text-overflow: ellipsis;
}
.search__input::placeholder { color: var(--muted); }
/* la croix native de `type=search` ferait doublon avec la nôtre, et elle n'existe pas partout */
.search__input::-webkit-search-cancel-button { display: none; }
.search__clear {
  flex: none; width: 32px; height: 32px; border: 0; border-radius: 999px; background: transparent;
  color: var(--muted); display: grid; place-items: center;
}
.search__clear[data-show='0'] { visibility: hidden; }
.search__clear:hover { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }

/* Au-dessus du champ, et vers le haut : la liste grandit dans le vide de la scène, jamais vers le
   bord bas où le champ est posé. Cinq lignes visibles, le reste au défilement. */
.search__list {
  position: absolute; left: 0; right: 0; bottom: calc(100% + 8px);
  max-height: calc(5 * 46px); overflow-y: auto; overscroll-behavior: contain;
  border-radius: var(--radius); border: 1px solid var(--line); box-shadow: var(--shadow);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.search__row {
  display: flex; align-items: center; gap: 10px; width: 100%; height: 46px; padding: 0 12px;
  border: 0; background: transparent; color: var(--text); text-align: left;
}
.search__row + .search__row { border-top: 1px solid var(--line); }
/* Ligne active : le liseré de l'app (même geste que la pièce sélectionnée dans RoomRows), pas
   seulement la teinte — mesurée à 1,26:1, elle ne disait pas assez où le clavier se trouve.
   `outline` et non `border` : il se pose SUR la ligne sans en changer la hauteur. */
.search__row[data-on='1'] { background: color-mix(in srgb, var(--accent) 14%, transparent); outline: 2px solid var(--accent); outline-offset: -2px; }
.search__row--empty { justify-content: center; }
.search__icon { color: var(--muted); flex: none; }
/* une ligne chacun, coupés aux points de suspension : toutes les lignes ont la même hauteur */
.search__label { flex: 1 1 auto; min-width: 0; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.search__sub { flex: 0 1 auto; min-width: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
