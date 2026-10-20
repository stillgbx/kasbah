<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AssistantAction, AssistantPhase } from '../../composables/useAssistant'
import { useDevicesStore } from '../../stores/devices'
import { useScenesStore } from '../../stores/scenes'
import type { IconName } from '../../lib/strokeIcons'
import PulseDot from '../ui/PulseDot.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// What the assistant did and answered, under the palette's field or above the House view's
// bar. One line per tool called, the device or light scene named as in the app; then the
// answer, or the error stated plainly. With `canReplay` (spoken replies on), "Replay" at the
// bottom right of the answer has it said aloud; its row exists as soon as the text arrives
// (hidden until the end): it does not enlarge the panel after the fact. With `closable`, a cross at the
// top right closes the answer, like the search field's.
//
// Height bounded by the caller (`max-height`): the header (the instruction, the cross) stays in place and
// only the part below scrolls, with a fade on the side where there is more. While the answer is arriving, the view
// follows the end (the answer is written at the bottom), unless the user has scrolled up to read it.

const props = defineProps<{
  phase: AssistantPhase
  asked: string
  actions: AssistantAction[]
  answer: string
  error: { code: string; message: string } | null
  canReplay?: boolean
  closable?: boolean
  /** The answer is being spoken: the button stops it. */
  speaking?: boolean
}>()
const emit = defineEmits<{ replay: []; close: [] }>()

const { t, te } = useI18n()
const devices = useDevicesStore()
const scenes = useScenesStore()

const TOOL_ICONS: Record<string, IconName> = {
  list_devices: 'devices', get_device: 'devices', send_command: 'bolt', list_scenes: 'sparkle', recall_scene: 'sparkle',
  get_health: 'pulse', search_music: 'search', play_music: 'music', play_radio: 'sourceRadio', get_school: 'school',
}

/** What the tool acted on, said with the app's names: device, light scene, search, title. */
function target(a: AssistantAction): string {
  const input = (a.input ?? {}) as { deviceId?: string; id?: string; sceneId?: string; query?: string; tracks?: { title?: string }[] }
  const deviceId = input.deviceId ?? (a.name === 'get_device' ? input.id : undefined)
  const parts: string[] = []
  if (a.name === 'play_music' && input.tracks?.[0]?.title) parts.push(input.tracks[0].title)
  if (deviceId) parts.push(devices.descriptors[deviceId]?.name ?? deviceId)
  if (input.sceneId) parts.push(scenes.list.find((e) => e.scene.id === input.sceneId)?.scene.name ?? input.sceneId)
  if (a.name === 'search_music' && input.query) parts.push(`« ${input.query} »`)
  return parts.join(' · ')
}

const rows = computed(() => props.actions.map((a) => ({
  id: a.id,
  icon: TOOL_ICONS[a.name] ?? 'gear',
  label: te(`assistant.tools.${a.name}`) ? t(`assistant.tools.${a.name}`) : a.name,
  target: target(a),
  ok: a.ok,
})))

/** The part below that scrolls, and on which side it has more (fade). */
const body = ref<HTMLElement | null>(null)
const fade = ref({ start: false, end: false })
/** Stuck to the bottom (within 4 px): the view follows what arrives. */
let atEnd = true

function measure() {
  const el = body.value
  if (!el) return
  atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
  fade.value = { start: el.scrollTop > 1, end: !atEnd }
}

let resize: ResizeObserver | null = null
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && body.value) { resize = new ResizeObserver(measure); resize.observe(body.value) }
})
onBeforeUnmount(() => resize?.disconnect())
// a tool line, the answer, the error: the content grows without the frame changing size
watch(() => [props.actions.length, props.actions.map((a) => a.ok), props.answer, props.phase, props.canReplay], async () => {
  const follow = atEnd
  await nextTick()
  if (follow && body.value) body.value.scrollTop = body.value.scrollHeight
  measure()
})

const errorText = computed(() => {
  const e = props.error
  if (!e) return ''
  return te(`assistant.errors.${e.code}`) ? t(`assistant.errors.${e.code}`) : t('assistant.errors.other', { message: e.message })
})
</script>

<template>
  <div class="reply" aria-live="polite">
    <div class="reply__asked">
      <StrokeIcon name="sparkle" :size="16" />
      <span class="reply__askedtext">{{ asked }}</span>
      <button v-if="closable" type="button" class="reply__close" :aria-label="$t('assistant.close')" :title="$t('assistant.close')"
              @mousedown.prevent @click="emit('close')">
        <StrokeIcon name="close" :size="16" />
      </button>
    </div>
    <div ref="body" class="reply__body" :data-fade-start="fade.start ? '1' : '0'" :data-fade-end="fade.end ? '1' : '0'" @scroll.passive="measure">
      <div v-for="r in rows" :key="r.id" class="reply__action">
        <StrokeIcon class="reply__icon" :name="r.icon" :size="16" />
        <span class="reply__label">{{ r.label }}</span>
        <span class="reply__target">{{ r.target }}</span>
        <!-- reserved place: the tool's state (running, done, refused) shifts nothing -->
        <span class="reply__state">
          <PulseDot v-if="r.ok === undefined" :on="phase === 'running'" />
          <StrokeIcon v-else-if="r.ok" class="reply__ok" name="check" :size="14" />
          <StrokeIcon v-else class="reply__ko" name="alert" :size="14" />
        </span>
      </div>
      <div v-if="answer" class="reply__answer">{{ answer }}</div>
      <div v-if="answer && canReplay" class="reply__foot">
        <button type="button" class="reply__replay" :data-show="phase === 'done' ? '1' : '0'"
                :tabindex="phase === 'done' ? 0 : -1" :data-speaking="speaking ? '1' : '0'"
                :aria-label="$t(speaking ? 'voice.stopSpeaking' : 'voice.replay')" @mousedown.prevent @click="emit('replay')">
          <StrokeIcon :name="speaking ? 'stop' : 'volume'" :size="16" />
          <!-- both labels in the same cell: the button keeps the width of the longer one -->
          <span class="reply__replaylabel">
            <span :data-on="speaking ? '0' : '1'">{{ $t('voice.replayShort') }}</span>
            <span :data-on="speaking ? '1' : '0'">{{ $t('voice.stopShort') }}</span>
          </span>
        </button>
      </div>
      <div v-else-if="phase === 'running'" class="reply__wait muted"><PulseDot :on="true" />{{ $t('assistant.thinking') }}</div>
      <div v-if="phase === 'error'" class="reply__error">{{ errorText }}</div>
    </div>
  </div>
</template>

<style scoped>
.reply { display: flex; flex-direction: column; gap: 6px; padding: 12px 16px 14px; min-height: 0; }
/* the part below scrolls in the height left by the caller; fade on the side where it continues. 4 px of
   margin on each side, rendered by a negative margin: "Replay" (offset by -4 px) creates no
   horizontal scroll there */
.reply__body { display: grid; gap: 6px; min-height: 0; overflow: hidden auto; overscroll-behavior: contain; padding: 0 4px; margin: 0 -4px; }
.reply__body[data-fade-start='1'] { --fade-t: 24px; }
.reply__body[data-fade-end='1'] { --fade-b: 24px; }
.reply__body[data-fade-start='1'], .reply__body[data-fade-end='1'] {
  mask-image: linear-gradient(180deg, transparent 0, #000 var(--fade-t, 0px), #000 calc(100% - var(--fade-b, 0px)), transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 var(--fade-t, 0px), #000 calc(100% - var(--fade-b, 0px)), transparent 100%);
}
.reply__asked { flex: none; display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; min-width: 0; }
.reply__asked > :first-child { flex: none; color: var(--accent); }
.reply__askedtext { flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* the cross, in the line's height (negative margins): it enlarges nothing */
.reply__close {
  flex: none; width: 32px; height: 32px; margin: -8px -10px -8px 0; border: 0; border-radius: 999px; background: transparent;
  color: var(--muted); display: grid; place-items: center;
}
.reply__close:hover { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
/* "Replay": a labelled pill, at the bottom right of the answer (the icon alone was ambiguous) */
.reply__foot { display: flex; justify-content: flex-end; margin-top: 2px; }
.reply__replay {
  display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px 0 10px; margin-right: -4px;
  border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--text); font: inherit; font-size: 13px;
}
.reply__replay[data-show='0'] { visibility: hidden; }
.reply__replay:hover { background: color-mix(in srgb, var(--text) 8%, transparent); }
.reply__replay > :first-child { color: var(--accent); }
.reply__replaylabel { display: grid; }
.reply__replaylabel > span { grid-area: 1 / 1; white-space: nowrap; }
.reply__replaylabel > span[data-on='0'] { visibility: hidden; }
.reply__action { display: flex; align-items: center; gap: 8px; min-height: 24px; font-size: 13px; min-width: 0; }
.reply__icon { flex: none; color: var(--muted); }
/* the label goes before the target (basis 0), and gets cut rather than pushing the state out of the panel */
.reply__label { flex: 0 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.reply__target { flex: 1 1 0; min-width: 0; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.reply__state { flex: none; width: 14px; display: grid; place-items: center; }
.reply__ok { color: var(--accent); }
.reply__ko, .reply__error { color: #d24a43; }
.reply__answer { font-size: 14px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; padding-top: 2px; }
.reply__wait { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.reply__error { font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
</style>
