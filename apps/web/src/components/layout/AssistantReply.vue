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
// réponse, ou l'erreur dite en clair.

const props = defineProps<{
  phase: AssistantPhase
  asked: string
  actions: AssistantAction[]
  answer: string
  error: { code: string; message: string } | null
}>()

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
    <div v-else-if="phase === 'running'" class="reply__wait muted"><PulseDot :on="true" />{{ $t('assistant.thinking') }}</div>
    <div v-if="phase === 'error'" class="reply__error">{{ errorText }}</div>
  </div>
</template>

<style scoped>
.reply { display: grid; gap: 6px; padding: 12px 16px 14px; }
.reply__asked { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; min-width: 0; }
.reply__asked > :first-child { flex: none; color: var(--accent); }
.reply__askedtext { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
