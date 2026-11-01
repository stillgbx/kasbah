<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AssistantReply from '../components/layout/AssistantReply.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { useAssistant } from '../composables/useAssistant'
import { canListenAlone, useVoiceInput } from '../composables/useVoiceInput'

// "Ask Kasbah", the page the installed app's shortcut opens (`manifest.webmanifest`): no 3D scene, so it
// shows at once; the rail stays, for the other views. Listening takes the screen; a quieter field under it
// takes a typed instruction; below, the room for what the assistant does and answers, and "Replay".
// It listens on arrival when the microphone can start without a touch (permission already given),
// otherwise the microphone waits for a touch. Every slot is fixed: nothing moves as the phases change.

const { t } = useI18n()
const assistant = useAssistant()
const { phase } = assistant
const { ready: voiceReady, speech, phase: voicePhase, heardNothing, toggle: toggleVoice, replay, forgetSpoken } = useVoiceInput(async (text) => {
  await assistant.ask(text)
  // the answer, to be spoken aloud if spoken replies are on
  return assistant.phase.value === 'done' ? assistant.answer.value : null
})
const query = ref('')
const input = ref<HTMLInputElement | null>(null)

/** One line under the microphone: what it does now, or what a touch would do. */
const status = computed(() => {
  if (voiceReady.value === null) return ''
  if (!voiceReady.value) return t('askPage.noVoice')
  if (voicePhase.value === 'recording') return t('voice.listening')
  if (voicePhase.value === 'transcribing') return t('voice.transcribing')
  if (voicePhase.value === 'speaking') return t('askPage.speaking')
  return heardNothing.value ? t('voice.heardNothing') : t('askPage.tap')
})
const micLabel = computed(() => t(voicePhase.value === 'recording' ? 'voice.stop' : voicePhase.value === 'speaking' ? 'voice.stopSpeaking' : 'voice.start'))

// the answer closed (or replaced by another question), its audio kept for replay goes with it
watch(phase, (p) => { if (p === 'idle') forgetSpoken() })

onMounted(() => {
  void canListenAlone().then((listen) => {
    if (voicePhase.value !== 'idle' || phase.value !== 'idle') return
    if (listen) talk()
    else if (!matchMedia('(pointer: coarse)').matches) void nextTick(() => input.value?.focus())
  })
})

/** The microphone: a new instruction replaces the answer shown. By finger, the keyboard stays down. */
function talk() {
  if (voicePhase.value === 'idle' && window.isSecureContext) assistant.reset()
  toggleVoice()
  if (matchMedia('(pointer: coarse)').matches) input.value?.blur()
}

/** A typed instruction: it leaves the field, the answer shows it at its top. */
function send() {
  if (!query.value.trim() || phase.value === 'running') return
  if (voicePhase.value === 'speaking') toggleVoice()
  void assistant.ask(query.value)
  query.value = ''
}

function closeReply() {
  if (voicePhase.value === 'speaking') toggleVoice()
  assistant.reset()
}
</script>

<template>
  <div class="ask">
    <header class="ask__top">
      <h1 class="ask__title">{{ $t('assistant.ask') }}</h1>
    </header>
    <section class="ask__listen">
      <button type="button" class="ask__mic" :data-phase="voicePhase" :aria-label="micLabel" :title="micLabel"
              :disabled="!voiceReady || voicePhase === 'transcribing'" @mousedown.prevent @click="talk()">
        <StrokeIcon :name="voicePhase === 'recording' || voicePhase === 'speaking' ? 'stop' : 'mic'" :size="40" />
      </button>
      <p class="ask__status" aria-live="polite">{{ status }}</p>
    </section>
    <div class="ask__field">
      <StrokeIcon class="ask__sparkle" name="sparkle" :size="16" />
      <input ref="input" v-model="query" type="text" class="ask__input" enterkeyhint="send"
             autocomplete="off" spellcheck="false" :placeholder="$t('askPage.placeholder')" :aria-label="$t('assistant.ask')"
             :readonly="phase === 'running' || voicePhase === 'recording' || voicePhase === 'transcribing'"
             @keydown.enter.prevent="send()">
    </div>
    <div class="ask__slot">
      <AssistantReply v-if="phase !== 'idle'" class="ask__reply" :phase="phase" :asked="assistant.asked.value"
                      :actions="assistant.actions.value" :answer="assistant.answer.value" :error="assistant.error.value"
                      :can-replay="speech" :speaking="voicePhase === 'speaking'" closable
                      @replay="replay(assistant.answer.value)" @close="closeReply()" />
    </div>
  </div>
</template>

<style scoped>
/* four rows, three of them fixed: the answer only ever fills the last one, and scrolls inside it */
.ask {
  flex: 1 1 auto; min-height: 0; width: min(560px, 100%); margin: 0 auto;
  display: grid; grid-template-rows: 48px 240px 44px minmax(0, 1fr);
  padding: calc(var(--safe-top) + 8px) var(--page-x) calc(var(--safe-bottom) + 16px);
}
.ask__top { display: flex; align-items: center; min-width: 0; }
.ask__title { margin: 0; font-size: 14px; font-weight: 600; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ask__listen { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; min-height: 0; }
/* the ring while listening is a shadow: it grows around the button without moving anything */
.ask__mic {
  position: relative; width: 120px; height: 120px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); display: grid; place-items: center;
  transition: background-color .2s, color .2s;
}
.ask__mic:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 22%, transparent); }
.ask__mic:disabled { opacity: .45; }
.ask__mic[data-phase='recording'] { color: #fff; background: #d24a43; border-color: #d24a43; animation: ask-ring 1.6s ease-out infinite; }
.ask__mic[data-phase='transcribing'] { opacity: 1; animation: ask-wait 1.1s ease-in-out infinite; }
@keyframes ask-ring { 0% { box-shadow: 0 0 0 0 rgb(210 74 67 / .45); } 100% { box-shadow: 0 0 0 28px rgb(210 74 67 / 0); } }
@keyframes ask-wait { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
@media (prefers-reduced-motion: reduce) { .ask__mic { animation: none !important; } }
/* one line, always there (empty while the plugin's status is unknown): its text changes, not its height */
.ask__status { margin: 0; height: 20px; font-size: 15px; line-height: 20px; color: var(--muted); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
/* the quieter way: a thin field, no button (Enter, or the keyboard's send key) */
.ask__field {
  display: flex; align-items: center; gap: 10px; padding: 0 16px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--surface);
}
.ask__sparkle { flex: none; color: var(--muted); }
.ask__input {
  flex: 1 1 0; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 15px; outline: none;
  text-overflow: ellipsis;
}
.ask__input::placeholder { color: var(--muted); }
.ask__field:focus-within { border-color: var(--accent); }
.ask__slot { min-height: 0; display: flex; flex-direction: column; padding-top: 16px; }
.ask__reply {
  max-height: 100%; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface);
}
/* short screen (phone in landscape, desktop zoomed in): the listening row tightens, the answer keeps room */
@media (max-height: 560px) {
  .ask { grid-template-rows: 40px 128px 44px minmax(0, 1fr); }
  .ask__listen { gap: 12px; }
  .ask__mic { width: 80px; height: 80px; }
}
</style>
