<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAssistant } from '../../composables/useAssistant'
import { useVoiceInput } from '../../composables/useVoiceInput'
import { homePanelRequest, MIN_QUERY, useSearch, type SearchHit } from '../../composables/useSearch'
import { normalize } from '../../lib/search'
import StrokeIcon from '../ui/StrokeIcon.vue'
import AssistantReply from './AssistantReply.vue'

// Palette Ctrl+K (Cmd+K sur Mac) : la recherche de la vue Maison, ouverte depuis n'importe quelle
// page. Même moteur, même règle — un résultat NAVIGUE, il n'agit jamais. Le champ est posé à une
// hauteur fixe et la liste grandit vers le bas : rien ne bouge quand les résultats changent.
//
// La dernière ligne passe la saisie à l'assistant (« Demander à Kasbah ») : lui AGIT, et sa réponse
// prend la place de la liste. Fermer la palette ne l'arrête pas ; la rouvrir la montre.
// Le micro (plugin `transcription` allumé) dicte l'instruction, qui part aussitôt ; au doigt, il ne
// rend pas le focus au champ (le clavier monterait).

const route = useRoute()
const router = useRouter()

const open = ref(false)
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLDivElement | null>(null)
const { results } = useSearch(query, { withHome: true })
const assistant = useAssistant()
const { phase } = assistant
const { t } = useI18n()
const { ready: voiceReady, speech, phase: voicePhase, heardNothing, toggle: toggleVoice, replay, forgetSpoken } = useVoiceInput(async (text) => {
  query.value = text
  await assistant.ask(text)
  // la réponse, à dire à voix haute si les réponses parlées sont allumées
  return assistant.phase.value === 'done' ? assistant.answer.value : null
})
/** Parler, terminer l'écoute, ou arrêter la réponse dite à voix haute. */
const micLabel = computed(() => t(voicePhase.value === 'recording' ? 'voice.stop' : voicePhase.value === 'speaking' ? 'voice.stopSpeaking' : 'voice.start'))
/** Les résultats, plus la ligne de l'assistant. */
const total = computed(() => results.value.length + 1)
/** Ce qui avait le focus à l'ouverture : on le lui rend en fermant. */
let returnFocus: HTMLElement | null = null

const showList = () => phase.value === 'idle' && normalize(query.value).length >= MIN_QUERY

watch(results, () => { active.value = 0 })
// la réponse fermée (ou remplacée par une autre question), son audio gardé pour la réécoute part avec elle
watch(phase, (p) => { if (p === 'idle') forgetSpoken() })
// Retoucher l'instruction après la réponse revient à la recherche (pas la fermeture, qui vide le champ).
watch(query, (q) => {
  if (open.value && (phase.value === 'done' || phase.value === 'error') && q.trim() !== assistant.asked.value) assistant.reset()
})

function show() {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  open.value = true
  // la réponse en cours ou la dernière, l'instruction sélectionnée : la frappe suivante la remplace
  if (phase.value !== 'idle') query.value = assistant.asked.value
  void nextTick(() => { input.value?.focus(); if (phase.value !== 'idle') input.value?.select() })
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

/** Le micro : la saisie s'efface pour laisser lire « J'écoute… » (sauf en `http://`, où il sera refusé). */
function talk() {
  if (voicePhase.value === 'idle' && window.isSecureContext) { assistant.reset(); query.value = '' }
  toggleVoice()
  if (matchMedia('(pointer: coarse)').matches) input.value?.blur()
  else input.value?.focus()
}

function askNow() {
  void assistant.ask(query.value)
}

function onEnter() {
  if (phase.value !== 'idle' || !showList()) return
  const hit = results.value[active.value]
  if (hit) void pick(hit)
  else askNow()
}

function move(delta: number) {
  const n = total.value
  active.value = (active.value + delta + n) % n
  void nextTick(() => listEl.value?.children[active.value]?.scrollIntoView({ block: 'nearest' }))
}

/** Fermer la réponse (Échap ou sa croix) : elle se tait, et l'instruction quitte le champ. */
function closeReply() {
  if (voicePhase.value === 'speaking') toggleVoice()
  assistant.reset()
  query.value = ''
}

/** Échap arrête ou efface la réponse, puis efface la saisie, puis ferme, comme la barre de la vue Maison. */
function onEscape() {
  if (phase.value !== 'idle') closeReply()
  else if (query.value) query.value = ''
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
                 :placeholder="voicePhase === 'recording' ? $t('voice.listening') : voicePhase === 'transcribing' ? $t('voice.transcribing') : heardNothing ? $t('voice.heardNothing') : $t('search.palette')"
                 :aria-label="$t('search.aria')" :readonly="phase === 'running' || voicePhase === 'recording' || voicePhase === 'transcribing'"
                 @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)"
                 @keydown.enter.prevent="onEnter()" @keydown.esc.prevent="onEscape()">
          <button v-if="voiceReady" type="button" class="palette__mic" :data-phase="voicePhase"
                  :aria-label="micLabel" :title="micLabel"
                  :disabled="voicePhase === 'transcribing'" @mousedown.prevent @click="talk()">
            <StrokeIcon :name="voicePhase === 'recording' || voicePhase === 'speaking' ? 'stop' : 'mic'" :size="16" />
          </button>
        </div>
        <div v-if="showList()" ref="listEl" class="palette__list" role="listbox" @mousedown.prevent>
          <button v-for="(hit, i) in results" :key="hit.key" type="button" class="palette__row" role="option"
                  :data-on="i === active ? '1' : '0'" :aria-selected="i === active" @click="pick(hit)" @mouseenter="active = i">
            <StrokeIcon class="palette__icon" :name="hit.icon" :size="18" />
            <span class="palette__label">{{ hit.label }}</span>
            <span class="palette__sub">{{ hit.sub }}</span>
          </button>
          <div v-if="results.length === 0" class="palette__row palette__row--empty muted">{{ $t('search.empty') }}</div>
          <button type="button" class="palette__row palette__row--ask" role="option" :data-on="active === results.length ? '1' : '0'"
                  :aria-selected="active === results.length" @click="askNow()" @mouseenter="active = results.length">
            <StrokeIcon class="palette__icon palette__icon--ask" name="sparkle" :size="18" />
            <span class="palette__label palette__label--ask">{{ $t('assistant.ask') }}</span>
            <span class="palette__sub palette__sub--ask">{{ query.trim() }}</span>
          </button>
        </div>
        <AssistantReply v-else-if="phase !== 'idle'" class="palette__reply" :phase="phase" :asked="assistant.asked.value"
                        :actions="assistant.actions.value" :answer="assistant.answer.value" :error="assistant.error.value"
                        :can-replay="speech" :speaking="voicePhase === 'speaking'" closable
                        @replay="replay(assistant.answer.value)" @close="closeReply(); input?.focus()" />
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
/* rouge pendant l'écoute, qui pulse pendant la transcription (comme la barre de la vue Maison) */
.palette__mic {
  flex: none; width: 32px; height: 32px; margin-right: -6px; border: 0; border-radius: 999px; background: transparent;
  color: var(--muted); display: grid; place-items: center;
}
.palette__mic:hover { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
.palette__mic[data-phase='recording'] { color: #fff; background: #d24a43; }
.palette__mic[data-phase='speaking'] { color: var(--accent); }
.palette__mic[data-phase='transcribing'] { color: var(--accent); animation: mic-wait 1.1s ease-in-out infinite; }
@keyframes mic-wait { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .palette__mic { animation: none; } }
/* huit lignes visibles, le reste au défilement : c'est la frappe suivante qui trie */
.palette__list { max-height: calc(8 * 46px); overflow-y: auto; overscroll-behavior: contain; border-top: 1px solid var(--line); }
.palette__row {
  display: flex; align-items: center; gap: 10px; width: 100%; height: 46px; padding: 0 16px;
  border: 0; background: transparent; color: var(--text); text-align: left;
}
.palette__row + .palette__row { border-top: 1px solid var(--line); }
/* même ligne active que la barre de la vue Maison : teinte ET liseré, `outline` pour ne rien décaler */
.palette__row[data-on='1'] { background: color-mix(in srgb, var(--accent) 14%, transparent); outline: 2px solid var(--accent); outline-offset: -2px; }
/* le gris seul tombe à 4,07:1 sur la teinte de la ligne active (thème clair) : un quart de texte
   le remonte au-dessus de 4,5:1, dans le sens du texte, donc dans tous les thèmes */
.palette__row[data-on='1'] .palette__sub { color: color-mix(in srgb, var(--muted) 75%, var(--text)); }
.palette__row--empty { justify-content: center; }
.palette__icon { color: var(--muted); flex: none; }
.palette__icon--ask { color: var(--accent); }
/* la saisie vaut instruction : elle prend la place du lieu, le libellé ne s'étire pas */
.palette__label--ask { flex: none; }
.palette__sub--ask { flex: 1 1 0; text-align: right; }
.palette__reply { border-top: 1px solid var(--line); max-height: 60vh; overflow-y: auto; overscroll-behavior: contain; }
.palette__label { flex: 1 1 auto; min-width: 0; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.palette__sub { flex: 0 1 auto; min-width: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* téléphone : le texte indicatif français (283 px) ne tenait pas dans le champ (281 px) à 16 px
   de marge ; 12 px lui rendent la place sans toucher à la boîte */
@media (max-width: 599px) {
  .palette__field, .palette__row { padding: 0 12px; }
}
</style>
