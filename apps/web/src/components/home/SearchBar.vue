<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAssistant } from '../../composables/useAssistant'
import { useVoiceInput } from '../../composables/useVoiceInput'
import { MIN_QUERY, useSearch, type SearchHit } from '../../composables/useSearch'
import { normalize } from '../../lib/search'
import AssistantReply from '../layout/AssistantReply.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Search bar of the House view, anchored at the bottom between the weather card and the view buttons.
// The list opens ABOVE the field: the field therefore never moves, whatever the number of
// results, and nothing else on screen shifts. Validating a result does nothing more than
// move the selection (see `useSearch`) — the 3D framing and the panel follow by themselves.
//
// The last row passes the input to the assistant, which ACTS. Its answer opens in place of the
// list and stays there without focus (on a phone, the keyboard closes) until the cross or Escape,
// which also clear the instruction from the field.
//
// The mic (`transcription` plugin enabled): press to speak, press to finish; the text
// heard goes straight to the assistant, without passing through the field, which stays empty with the mic at the end:
// one chains another voice command without clearing anything. Touching the mic gives focus back:
// on a phone, the keyboard does not come up (nor at the end of listening, when the field becomes editable again).

const emit = defineEmits<{ picked: [hit: SearchHit] }>()

const query = ref('')
const focused = ref(false)
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLDivElement | null>(null)
const { results } = useSearch(query)
const assistant = useAssistant()
const { phase } = assistant
const { t } = useI18n()
const { ready: voiceReady, speech, phase: voicePhase, heardNothing, toggle: toggleVoice, replay, forgetSpoken } = useVoiceInput(async (text) => {
  // the field stays empty (the instruction is at the top of the answer): the mic stays there, ready for the next one
  await assistant.ask(text)
  // the answer, to be spoken aloud if spoken answers are on
  return assistant.phase.value === 'done' ? assistant.answer.value : null
})
/** The slot at the end of the field: the mic while listening, or when the field is empty (the answer has its own cross). */
const micSlot = computed(() => voiceReady.value === true && (voicePhase.value !== 'idle' || !query.value))
/** Speak, end listening, or stop the answer spoken aloud. */
const micLabel = computed(() => t(voicePhase.value === 'recording' ? 'voice.stop' : voicePhase.value === 'speaking' ? 'voice.stopSpeaking' : 'voice.start'))
/** The results, plus the assistant's row. */
const total = computed(() => results.value.length + 1)

/** The list opens as soon as the query is long enough, even empty: "No result" is an answer. */
const isOpen = () => phase.value === 'idle' && focused.value && normalize(query.value).length >= MIN_QUERY

// Typing reshuffles the cards: the cursor goes back to the top, otherwise Enter would validate the 4th row
// of a list that has nothing to do with the one one was looking at.
watch(results, () => { active.value = 0 })
// the answer closed (or replaced by another question), its audio kept for replay goes away with it
watch(phase, (p) => { if (p === 'idle') forgetSpoken() })
// Editing the instruction after the answer goes back to search.
watch(query, (q) => {
  if ((phase.value === 'done' || phase.value === 'error') && q.trim() !== assistant.asked.value) assistant.reset()
})

/** Going back to the field after an answer selects the instruction: the next keystroke replaces it. */
function onFocus() {
  focused.value = true
  if (phase.value === 'done' || phase.value === 'error') input.value?.select()
}

function pick(hit: SearchHit) {
  hit.go()
  emit('picked', hit)
  query.value = ''
  input.value?.blur()
}

function askNow() {
  void assistant.ask(query.value)
  input.value?.blur()
}

function onEnter() {
  if (!isOpen()) return
  const hit = results.value[active.value]
  if (hit) pick(hit)
  else askNow()
}

/** The mic: the input clears to let "Listening…" be read, the previous answer with it. */
function talk() {
  // over `http://` the mic will be refused: we keep the input
  if (voicePhase.value === 'idle' && window.isSecureContext) { assistant.reset(); query.value = '' }
  input.value?.blur()
  toggleVoice()
}

/** Close the answer: it goes quiet, and the instruction leaves the field. */
function closeReply() {
  if (voicePhase.value === 'speaking') toggleVoice()
  assistant.reset()
  query.value = ''
}

/** The cross: stops or clears the answer, and the input. */
function clear() {
  closeReply()
  input.value?.focus()
}

function move(delta: number) {
  const n = total.value
  active.value = (active.value + delta + n) % n
  void nextTick(() => listEl.value?.children[active.value]?.scrollIntoView({ block: 'nearest' }))
}

/** Escape stops or clears the answer (and the instruction), then the input, then hands back control: one corrects without losing the field. */
function onEscape() {
  if (phase.value !== 'idle') closeReply()
  else if (query.value) query.value = ''
  else input.value?.blur()
}
</script>

<template>
  <div class="search">
    <!-- `mousedown.prevent`: without it, the field loses focus BEFORE the click, the list closes and
         the result is never chosen (a finger goes through the same sequence as the mouse). -->
    <div v-if="isOpen()" ref="listEl" class="search__list" role="listbox" @mousedown.prevent>
      <button v-for="(hit, i) in results" :key="hit.key" type="button" class="search__row" role="option"
              :data-on="i === active ? '1' : '0'" :aria-selected="i === active" @click="pick(hit)" @mouseenter="active = i">
        <StrokeIcon class="search__icon" :name="hit.icon" :size="18" />
        <span class="search__label">{{ hit.label }}</span>
        <span class="search__sub">{{ hit.sub }}</span>
      </button>
      <div v-if="results.length === 0" class="search__row search__row--empty muted">{{ $t('search.empty') }}</div>
      <button type="button" class="search__row search__row--ask" role="option" :data-on="active === results.length ? '1' : '0'"
              :aria-selected="active === results.length" @click="askNow()" @mouseenter="active = results.length">
        <StrokeIcon class="search__icon search__icon--ask" name="sparkle" :size="18" />
        <span class="search__label search__label--ask">{{ $t('assistant.ask') }}</span>
        <span class="search__sub search__sub--ask">{{ query.trim() }}</span>
      </button>
    </div>
    <AssistantReply v-else-if="phase !== 'idle'" class="search__reply" :phase="phase" :asked="assistant.asked.value"
                    :actions="assistant.actions.value" :answer="assistant.answer.value" :error="assistant.error.value"
                    :can-replay="speech" :speaking="voicePhase === 'speaking'" closable
                    @replay="replay(assistant.answer.value)" @close="closeReply()" />
    <div class="search__field">
      <StrokeIcon class="search__glass" name="search" :size="18" />
      <input ref="input" v-model="query" type="search" class="search__input" enterkeyhint="go"
             autocomplete="off" autocorrect="off" spellcheck="false"
             :placeholder="voicePhase === 'recording' ? $t('voice.listening') : voicePhase === 'transcribing' ? $t('voice.transcribing') : heardNothing ? $t('voice.heardNothing') : $t('search.placeholder')"
             :aria-label="$t('search.aria')" :readonly="phase === 'running' || voicePhase === 'recording' || voicePhase === 'transcribing'"
             @focus="onFocus()" @blur="focused = false"
             @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)"
             @keydown.enter.prevent="onEnter()" @keydown.esc.prevent="onEscape()">
      <!-- ONE place, ALWAYS reserved, for the mic and the cross: a button that appears would shrink
           the field under the fingers, and two left only 31 px of input on a phone. The mic
           when there is nothing to clear (or while listening), the cross otherwise. -->
      <button v-if="micSlot" type="button" class="search__mic" :data-phase="voicePhase"
              :aria-label="micLabel" :title="micLabel"
              :disabled="voicePhase === 'transcribing'" @mousedown.prevent @click="talk()">
        <StrokeIcon :name="voicePhase === 'recording' || voicePhase === 'speaking' ? 'stop' : 'mic'" :size="16" />
      </button>
      <button v-else type="button" class="search__clear" :data-show="query || phase !== 'idle' ? '1' : '0'" :tabindex="query || phase !== 'idle' ? 0 : -1"
              :aria-label="$t('search.clear')" @mousedown.prevent @click="clear()">
        <StrokeIcon name="close" :size="16" />
      </button>
    </div>
    <span class="search__sr" aria-live="polite">{{ isOpen() ? $t('search.count', { n: results.length }, results.length) : '' }}</span>
  </div>
</template>

<style scoped>
.search { position: relative; width: min(380px, 100%); }
/* announcement of the number of results to screen readers, invisible to the eye */
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
  /* in a narrow window the placeholder text no longer fits: ellipsis rather than a cut
     mid-word ("Search a room, a de") — the property is set on the field, not on
     `::placeholder`, which does not accept it */
  text-overflow: ellipsis;
}
.search__input::placeholder { color: var(--muted); }
/* the native cross of `type=search` would duplicate ours, and it does not exist everywhere */
.search__input::-webkit-search-cancel-button { display: none; }
.search__clear {
  flex: none; width: 32px; height: 32px; border: 0; border-radius: 999px; background: transparent;
  color: var(--muted); display: grid; place-items: center;
}
.search__clear[data-show='0'] { visibility: hidden; }
.search__clear:hover { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
/* same layout as the cross; red while listening, pulsing during transcription */
.search__mic {
  flex: none; width: 32px; height: 32px; border: 0; border-radius: 999px; background: transparent;
  color: var(--muted); display: grid; place-items: center;
}
.search__mic:hover { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
.search__mic[data-phase='recording'] { color: #fff; background: #d24a43; }
.search__mic[data-phase='speaking'] { color: var(--accent); }
.search__mic[data-phase='transcribing'] { color: var(--accent); animation: mic-wait 1.1s ease-in-out infinite; }
@keyframes mic-wait { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .search__mic { animation: none; } }

/* Above the field, and upward: the list grows into the emptiness of the scene, never toward the
   bottom edge where the field sits. Five visible rows, the rest scrolls. */
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
/* Active row: the app's outline (same gesture as the selected room in RoomRows), not
   just the tint — measured at 1.26:1, it did not say enough where the keyboard is.
   `outline` and not `border`: it sits ON the row without changing its height. */
.search__row[data-on='1'] { background: color-mix(in srgb, var(--accent) 14%, transparent); outline: 2px solid var(--accent); outline-offset: -2px; }
/* gray alone falls to 4.07:1 on the active row's tint (light theme): a quarter of text
   lifts it above 4.5:1, in the direction of the text, hence in all themes */
.search__row[data-on='1'] .search__sub { color: color-mix(in srgb, var(--muted) 75%, var(--text)); }
.search__row--empty { justify-content: center; }
.search__icon--ask { color: var(--accent); }
/* the input counts as an instruction: it takes the place of the location, the label does not stretch */
.search__label--ask { flex: none; }
.search__sub--ask { flex: 1 1 0; text-align: right; }
/* the answer, in the same place as the list and with the same glass, grows upward; beyond the
   height, its header stays and the underneath scrolls (AssistantReply) */
.search__reply {
  position: absolute; left: 0; right: 0; bottom: calc(100% + 8px);
  max-height: min(50vh, 360px); overflow: hidden;
  border-radius: var(--radius); border: 1px solid var(--line); box-shadow: var(--shadow);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.search__icon { color: var(--muted); flex: none; }
/* one line each, cut with ellipsis: all rows have the same height */
.search__label { flex: 1 1 auto; min-width: 0; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.search__sub { flex: 0 1 auto; min-width: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
