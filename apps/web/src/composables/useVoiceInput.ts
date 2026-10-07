import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import { ApiRequestError } from '../api/transport'
import { encodeWav, STT_RATE, toBase64, toMono16k } from '../lib/wav'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { useNotificationsStore } from '../stores/notifications'
import { useScenesStore } from '../stores/scenes'

// Le micro de la recherche : appuyer pour parler, appuyer pour finir (arrêt seul au bout de 15 s),
// et le texte entendu part tout de suite (`onText`). L'enregistrement est converti ici en WAV 16 kHz
// mono, puis transcrit par le plugin `transcription` du serveur, avec les noms de la maison comme
// vocabulaire (« Spots cuisine », « Robby » : des mots qu'un modèle ne devine pas).
//
// Le micro n'existe qu'en contexte sûr (HTTPS, ou localhost) : sur le réseau local en `http://`, le
// navigateur le refuse — on le dit au toucher, avec où trouver la manipulation (drapeau Chrome).

export type VoicePhase = 'idle' | 'recording' | 'transcribing'

/** Au plus 15 s : une instruction, pas une dictée (et 480 Ko de WAV). */
export const MAX_RECORDING_MS = 15_000
/** En dessous, c'est un toucher sans parole : rien à transcrire. */
const MIN_SECONDS = 0.3

/** Le plugin tourne-t-il ? Demandé une fois par chargement de page, partagé par la palette et la barre. */
const ready = ref<boolean | null>(null)
let asked = false

export function useVoiceInput(onText: (text: string) => void) {
  const { t } = useI18n()
  const notifications = useNotificationsStore()
  const house = useHouseStore()
  const devices = useDevicesStore()
  const scenes = useScenesStore()

  if (!asked) {
    asked = true
    getTransport().transcriptionStatus().then((s) => { ready.value = s.ready }, () => { ready.value = false })
  }

  const phase = ref<VoicePhase>('idle')
  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let chunks: Blob[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Démonté pendant l'enregistrement : on coupe le micro et on jette ce qui a été dit. */
  let discarded = false

  /** Pièces, zones, niveaux, ambiances, puis appareils : le serveur en garde ce que le fournisseur accepte. */
  function hints(): string[] {
    const names = [
      ...[...(house.index?.roomsById.values() ?? [])].map((r) => r.name),
      ...house.zones.map((z) => z.name),
      ...house.levels.map((l) => l.name),
      ...scenes.list.map((e) => e.scene.name),
      ...Object.values(devices.descriptors).map((d) => d.name),
    ]
    return [...new Set(names.map((n) => n.trim()).filter((n) => n && n.length <= 80))].slice(0, 400)
  }

  function release() {
    if (timer) { clearTimeout(timer); timer = null }
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
  }

  async function start() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      notifications.error(t('voice.errors.insecure'))
      return
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    } catch {
      notifications.error(t('voice.errors.denied'))
      return
    }
    chunks = []
    discarded = false
    recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    recorder.onstop = () => { void finish(recorder?.mimeType ?? '') }
    recorder.start()
    phase.value = 'recording'
    timer = setTimeout(stop, MAX_RECORDING_MS)
  }

  function stop() {
    if (recorder?.state === 'recording') recorder.stop()
  }

  async function finish(type: string) {
    release()
    if (discarded) { phase.value = 'idle'; return }
    phase.value = 'transcribing'
    try {
      const samples = await toMono16k(new Blob(chunks, { type }))
      if (samples.length < STT_RATE * MIN_SECONDS) { notifications.notify(t('voice.errors.empty')); return }
      const { text } = await getTransport().transcribe(toBase64(encodeWav(samples)), hints())
      if (!text) notifications.notify(t('voice.errors.empty'))
      else onText(text)
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : (err as Error).message
      notifications.error(t('voice.errors.failed', { message }))
    } finally {
      phase.value = 'idle'
    }
  }

  function toggle() {
    if (phase.value === 'idle') void start()
    else if (phase.value === 'recording') stop()
  }

  onBeforeUnmount(() => {
    discarded = true
    stop()
    release()
  })

  return { ready, phase, toggle }
}
