<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../../api'
import { ApiRequestError, type AssistantLogEntry } from '../../api/transport'
import { useNotificationsStore } from '../../stores/notifications'
import AssistantReply from '../layout/AssistantReply.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Le journal des instructions de l'assistant, de TOUS les comptes : sur le réseau local seulement (le
// serveur le refuse sous l'adresse publique, et on ne l'y demande pas). Le moteur et son compte se
// règlent dans la section de son plugin (Claude), plus bas.

const notifications = useNotificationsStore()
const { t, d, n } = useI18n()

/** `null` : pas (encore) lu, ou adresse publique. */
const log = ref<AssistantLogEntry[] | null>(null)
const loading = ref(false)

const fail = (err: unknown) => notifications.error(t('errors.UNKNOWN', { name: 'Assistant', message: (err as Error).message }))

async function load() {
  loading.value = true
  try { log.value = (await getTransport().assistantLog()).entries }
  catch (err) { if (!(err instanceof ApiRequestError && err.code === 'LAN_ONLY')) fail(err) }
  finally { loading.value = false }
}

const when = (at: number) => `${d(new Date(at), 'date')} ${d(new Date(at), 'time')}`
const seconds = (ms: number) => n(ms / 1000, { maximumFractionDigits: 1 })

onMounted(async () => {
  try { if ((await getTransport().session()).user === null) await load() } catch (err) { fail(err) }
})
</script>

<template>
  <div v-if="log" class="ac">
    <div class="ac__head">
      <div class="min0">
        <div class="ac__title">{{ $t('assistant.logTitle') }}</div>
        <div class="muted small">{{ $t('assistant.logHint') }}</div>
      </div>
      <button type="button" class="pill ac__refresh" :disabled="loading" @click="load">
        <StrokeIcon name="rotateRight" :size="16" />{{ $t('assistant.refresh') }}
      </button>
    </div>
    <div v-if="!log.length" class="muted small">{{ $t('assistant.logEmpty') }}</div>
    <div v-else class="ac__entries">
      <div v-for="e in log" :key="e.at + (e.user ?? '')" class="ac__entry">
        <div class="ac__meta muted small">{{ $t('assistant.logMeta', { when: when(e.at), who: e.user ?? $t('claude.house'), s: seconds(e.ms) }) }}</div>
        <AssistantReply :phase="e.error ? 'error' : 'done'" :asked="e.text" :actions="e.tools" :answer="e.answer" :error="e.error" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ac { display: grid; gap: 8px; }
.ac__head { display: flex; align-items: flex-start; gap: 10px; }
.ac__title { font-size: 14px; font-weight: 600; }
.ac__refresh { flex: none; height: 34px; font-size: 13px; }
/* deux cents entrées au plus : la liste défile dans la carte au lieu d'allonger la page */
.ac__entries { max-height: 480px; overflow-y: auto; overscroll-behavior: contain; border: 1px solid var(--line); border-radius: var(--radius); }
.ac__entry + .ac__entry { border-top: 1px solid var(--line); }
.ac__meta { padding: 10px 16px 0; }
.ac__entry :deep(.reply) { padding-top: 4px; }
.min0 { min-width: 0; }
.small { font-size: 12px; }
</style>
