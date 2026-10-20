<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import { useNotificationsStore } from '../stores/notifications'
import StrokeIcon from './ui/StrokeIcon.vue'

// Transcription plugin card (Settings → Plugins): the voice of the spoken replies of the current
// account, its own once connected (public address), the house's on the local network. The list
// comes from the provider (the voices created in VoiceStudio); without a choice, an account takes
// the house voice, the house `TTS_VOICE`. The choice is kept by the server and applies from the
// next reply.

const notifications = useNotificationsStore()
const { t } = useI18n()

const voices = ref<{ id: string; name: string; language?: string }[]>([])
const voice = ref<string | null>(null)
const defaultVoice = ref<string | null>(null)
/**
 * The connected account (`null`: the house, on the local network) and the house voice, which it
 * uses when no choice is made.
 */
const user = ref<string | null>(null)
const houseVoice = ref<string | null>(null)
/** `null`: loaded; otherwise the reason (provider without a voice list, unreachable…). */
const listError = ref<string | null>(null)
const loaded = ref(false)
const busy = ref(false)

/** A selected voice that the provider no longer offers (deleted in VoiceStudio) stays displayed. */
const options = computed(() => {
  const list = voices.value.map((v) => ({ id: v.id, label: v.language ? `${v.name} (${v.language})` : v.name }))
  if (voice.value && !list.some((o) => o.id === voice.value)) list.push({ id: voice.value, label: t('voice.card.missing', { id: voice.value }) })
  return list
})

/**
 * The first option: what is used without a choice, the house voice for an account, `TTS_VOICE`
 * for the house.
 */
const fallbackLabel = computed(() => {
  if (user.value === null) return t('voice.card.default', { voice: defaultVoice.value ?? '—' })
  const house = houseVoice.value
  return t('voice.card.house', { voice: house === null ? (defaultVoice.value ?? '—') : (voices.value.find((v) => v.id === house)?.name ?? house) })
})

onMounted(async () => {
  try {
    const s = await getTransport().transcriptionSettings()
    voice.value = s.voice
    defaultVoice.value = s.defaultVoice
    user.value = s.user
    houseVoice.value = s.houseVoice
  } catch (err) { notifications.error(t('errors.UNKNOWN', { name: 'Transcription', message: (err as Error).message })) }
  try { voices.value = (await getTransport().transcriptionVoices()).voices }
  catch (err) { listError.value = (err as Error).message }
  loaded.value = true
})

async function choose(id: string) {
  const next = id === '' ? null : id
  busy.value = true
  try {
    voice.value = (await getTransport().setTranscriptionVoice(next)).voice
    notifications.success(t('voice.card.saved'))
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'Transcription', message: (err as Error).message }))
  } finally { busy.value = false }
}
</script>

<template>
  <div class="tl">
    <label class="tl__field">
      <span class="tl__label"><StrokeIcon name="speaker" :size="16" class="muted" />{{ $t('voice.card.voice') }}</span>
      <select class="tl__select" :value="voice ?? ''" :disabled="busy || !loaded" @change="choose(($event.target as HTMLSelectElement).value)">
        <option value="">{{ fallbackLabel }}</option>
        <option v-for="o in options" :key="o.id" :value="o.id">{{ o.label }}</option>
      </select>
    </label>
    <!-- reserved space: the explanation or the error takes the same line -->
    <p class="muted small tl__hint">{{ listError ? $t('voice.card.noList', { message: listError }) : user === null ? $t('voice.card.hint') : $t('voice.card.hintUser', { user }) }}</p>
  </div>
</template>

<style scoped>
.tl { display: grid; gap: 6px; }
.tl__field { display: grid; gap: 6px; min-width: 0; }
.tl__label { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; }
.tl__select {
  width: 100%; max-width: 420px; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px; box-sizing: border-box;
}
.tl__select:disabled { opacity: .5; }
.tl__hint { margin: 0; line-height: 1.5; min-height: 1.5em; overflow-wrap: anywhere; }
.small { font-size: 12px; }
</style>
