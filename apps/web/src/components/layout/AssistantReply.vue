<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AssistantAction, AssistantPhase } from '../../composables/useAssistant'
import { useDevicesStore } from '../../stores/devices'
import { useScenesStore } from '../../stores/scenes'
import type { IconName } from '../../lib/strokeIcons'
import PulseDot from '../ui/PulseDot.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Ce que l'assistant a fait et répondu, sous le champ de la palette ou au-dessus de la barre de la
// vue Maison. Une ligne par outil appelé, l'appareil ou l'ambiance nommés comme dans l'app ; puis la
// réponse, ou l'erreur dite en clair. Avec `canReplay` (réponses parlées allumées), « Réécouter » en
// bas à droite de la réponse la fait dire à voix haute ; sa rangée existe dès que le texte arrive
// (cachée jusqu'à la fin) : elle n'agrandit pas le panneau après coup. Avec `closable`, une croix en
// haut à droite ferme la réponse, comme celle du champ de recherche.

const props = defineProps<{
  phase: AssistantPhase
  asked: string
  actions: AssistantAction[]
  answer: string
  error: { code: string; message: string } | null
  canReplay?: boolean
  closable?: boolean
  /** La réponse est en train d'être dite : le bouton l'arrête. */
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

/** Sur quoi l'outil a porté, dit avec les noms de l'app : appareil, ambiance, recherche, titre. */
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
    <div v-for="r in rows" :key="r.id" class="reply__action">
      <StrokeIcon class="reply__icon" :name="r.icon" :size="16" />
      <span class="reply__label">{{ r.label }}</span>
      <span class="reply__target">{{ r.target }}</span>
      <!-- place réservée : l'état de l'outil (en cours, fait, refusé) ne décale rien -->
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
        <!-- les deux libellés dans la même case : le bouton garde la largeur du plus long -->
        <span class="reply__replaylabel">
          <span :data-on="speaking ? '0' : '1'">{{ $t('voice.replayShort') }}</span>
          <span :data-on="speaking ? '1' : '0'">{{ $t('voice.stopShort') }}</span>
        </span>
      </button>
    </div>
    <div v-else-if="phase === 'running'" class="reply__wait muted"><PulseDot :on="true" />{{ $t('assistant.thinking') }}</div>
    <div v-if="phase === 'error'" class="reply__error">{{ errorText }}</div>
  </div>
</template>

<style scoped>
.reply { display: grid; gap: 6px; padding: 12px 16px 14px; }
.reply__asked { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; min-width: 0; }
.reply__asked > :first-child { flex: none; color: var(--accent); }
.reply__askedtext { flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* la croix, dans la hauteur de la ligne (marges négatives) : elle n'agrandit rien */
.reply__close {
  flex: none; width: 32px; height: 32px; margin: -8px -10px -8px 0; border: 0; border-radius: 999px; background: transparent;
  color: var(--muted); display: grid; place-items: center;
}
.reply__close:hover { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
/* « Réécouter » : une pastille libellée, en bas à droite de la réponse (l'icône seule était ambiguë) */
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
/* le libellé passe avant la cible (base 0), et se coupe plutôt que de pousser l'état hors du panneau */
.reply__label { flex: 0 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.reply__target { flex: 1 1 0; min-width: 0; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.reply__state { flex: none; width: 14px; display: grid; place-items: center; }
.reply__ok { color: var(--accent); }
.reply__ko, .reply__error { color: #d24a43; }
.reply__answer { font-size: 14px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; padding-top: 2px; }
.reply__wait { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.reply__error { font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
</style>
