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

// Ctrl+K palette (Cmd+K on Mac): the House view's search, opened from any
// page. Same engine, same rule — a result NAVIGATES, it never acts. The field is placed at a
// fixed height and the list grows downward: nothing moves when the results change.
//
// The last line passes the input to the assistant ("Ask Kasbah"): it ACTS, and its answer
// takes the list's place. Closing the palette does not stop it; reopening it shows it.
// The microphone (`transcription` plugin on) dictates the instruction, which is sent right away; by finger, it does not
// give focus back to the field (the keyboard would come up).

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
  // the field stays empty (the instruction is at the top of the answer): the microphone stays there, ready for the next one
  await assistant.ask(text)
  // the answer, to be spoken aloud if spoken replies are on
  return assistant.phase.value === 'done' ? assistant.answer.value : null
})
/** Speak, finish listening, or stop the answer spoken aloud. */
const micLabel = computed(() => t(voicePhase.value === 'recording' ? 'voice.stop' : voicePhase.value === 'speaking' ? 'voice.stopSpeaking' : 'voice.start'))
/** The results, plus the assistant's line. */
const total = computed(() => results.value.length + 1)
/** What had focus on opening: it is given back on closing. */
let returnFocus: HTMLElement | null = null

const showList = () => phase.value === 'idle' && normalize(query.value).length >= MIN_QUERY

watch(results, () => { active.value = 0 })
// the answer closed (or replaced by another question), its audio kept for replay goes with it
watch(phase, (p) => { if (p === 'idle') forgetSpoken() })
// Touching up the instruction after the answer goes back to search (not closing, which empties the field).
watch(query, (q) => {
  if (open.value && (phase.value === 'done' || phase.value === 'error') && q.trim() !== assistant.asked.value) assistant.reset()
})

function show() {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  open.value = true
  // the current or last answer, the instruction selected: the next keystroke replaces it
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
  // go back to the house BEFORE selecting: otherwise the watcher that reflects the selection in
  // the URL rewrites it onto the current view and cancels the navigation (same race as the doorbell)
  if (route.name !== 'home') await router.push({ name: 'home' }).catch(() => { /* redundant navigation */ })
  hit.go()
  homePanelRequest.value++
}

/** The microphone: the input clears to let "Listening…" be read (except on `http://`, where it will be refused). */
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

/** Close the answer (Escape or its cross): it falls silent, and the instruction leaves the field. */
function closeReply() {
  if (voicePhase.value === 'speaking') toggleVoice()
  assistant.reset()
  query.value = ''
}

/** Escape stops or clears the answer, then clears the input, then closes, like the House view's bar. */
function onEscape() {
  if (phase.value !== 'idle') closeReply()
  else if (query.value) query.value = ''
  else close()
}

// Listening in capture phase: the shortcut works even when a field has focus, and before the
// browser (Ctrl+K puts the focus on the address bar there). Chrome's autofill
// emits `keydown`s WITHOUT `key` (`undefined`, despite the type): we ignore them.
function onKey(e: KeyboardEvent) {
  if (typeof e.key !== 'string' || e.key.toLowerCase() !== 'k' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
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
/* red while listening, which pulses during transcription (like the House view's bar) */
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
/* eight visible lines, the rest scrolls: it is the next keystroke that sorts */
.palette__list { max-height: calc(8 * 46px); overflow-y: auto; overscroll-behavior: contain; border-top: 1px solid var(--line); }
.palette__row {
  display: flex; align-items: center; gap: 10px; width: 100%; height: 46px; padding: 0 16px;
  border: 0; background: transparent; color: var(--text); text-align: left;
}
.palette__row + .palette__row { border-top: 1px solid var(--line); }
/* same active line as the House view's bar: tint AND rim, `outline` so as to shift nothing */
.palette__row[data-on='1'] { background: color-mix(in srgb, var(--accent) 14%, transparent); outline: 2px solid var(--accent); outline-offset: -2px; }
/* the gray alone falls to 4.07:1 on the active line's tint (light theme): a quarter of text
   raises it above 4.5:1, in the direction of the text, hence in all themes */
.palette__row[data-on='1'] .palette__sub { color: color-mix(in srgb, var(--muted) 75%, var(--text)); }
.palette__row--empty { justify-content: center; }
.palette__icon { color: var(--muted); flex: none; }
.palette__icon--ask { color: var(--accent); }
/* the input counts as an instruction: it takes the place's slot, the label does not stretch */
.palette__label--ask { flex: none; }
.palette__sub--ask { flex: 1 1 0; text-align: right; }
.palette__reply { border-top: 1px solid var(--line); max-height: 60vh; overflow: hidden; }
.palette__label { flex: 1 1 auto; min-width: 0; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.palette__sub { flex: 0 1 auto; min-width: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* phone: the French placeholder text (283 px) did not fit in the field (281 px) at 16 px
   of margin; 12 px give it back the room without touching the box */
@media (max-width: 599px) {
  .palette__field, .palette__row { padding: 0 12px; }
}
</style>
