import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import { ApiRequestError } from '../api/transport'
import { createEndpointer, rms } from '../lib/vad'
import { encodeWav, STT_RATE, toBase64, toMono16k } from '../lib/wav'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { useNotificationsStore } from '../stores/notifications'
import { useScenesStore } from '../stores/scenes'

// Le micro de la recherche : appuyer pour parler, appuyer pour finir (arrêt seul au bout de 15 s),
// et le texte entendu part tout de suite (`onText`). Sous-item `autoSend` allumé (défaut), l'écoute
// s'arrête aussi seule à la fin de la phrase (`lib/vad.ts`) ; sans parole au bout de 5 s, rien n'est
// envoyé (un modèle de transcription invente du texte sur un silence). L'enregistrement est converti
// ici en WAV 16 kHz mono, puis transcrit par le plugin `transcription` du serveur, avec les noms de la
// maison comme vocabulaire (« Spots cuisine », « Robby » : des mots qu'un modèle ne devine pas).
//
// Le micro n'existe qu'en contexte sûr (HTTPS, ou localhost) : sur le réseau local en `http://`, le
// navigateur le refuse — on le dit au toucher, avec où trouver la manipulation (drapeau Chrome).
//
// Réponses parlées (sous-item `speech` du plugin) : quand `onText` rend la réponse de l'assistant, elle
// est dite à voix haute ICI, sur l'appareil qui a parlé. Seules les instructions dictées parlent ; un
// toucher du micro pendant la lecture l'arrête. Une réponse tapée se réécoute à la demande (`replay`).
// L'audio de la dernière réponse dite est gardé : la réécouter ne refait pas la synthèse. L'appelant
// l'oublie (`forgetSpoken`) quand la réponse se ferme ; une autre réponse le remplace.
//
// Rien entendu : pas de bandeau d'erreur, le champ le dit à la place de son texte indicatif
// (`heardNothing`, quelques secondes), là où l'on regardait déjà.

export type VoicePhase = 'idle' | 'recording' | 'transcribing' | 'speaking'

/** Au plus 15 s : une instruction, pas une dictée (et 480 Ko de WAV). */
export const MAX_RECORDING_MS = 15_000
/** En dessous, c'est un toucher sans parole : rien à transcrire. */
const MIN_SECONDS = 0.3
/** Le temps que « rien entendu » reste dans le champ. */
export const HEARD_NOTHING_MS = 4000
/** Une mesure du niveau du micro toutes les 50 ms (`setInterval` : un onglet masqué ne rend pas `requestAnimationFrame`). */
const VAD_FRAME_MS = 50

/** Le plugin tourne-t-il ? Demandé une fois par chargement de page, partagé par la palette et la barre. */
const ready = ref<boolean | null>(null)
/** Sous-item `speech` allumé : dire les réponses aux instructions dictées. */
const speech = ref(false)
/** Sous-item `autoSend` allumé : l'écoute s'arrête seule à la fin de la phrase. */
const autoSend = ref(false)
let asked = false

/**
 * `onText` reçoit le texte entendu ; s'il rend (ou promet) la réponse de l'assistant, elle est dite à
 * voix haute quand les réponses parlées sont allumées.
 */
export function useVoiceInput(onText: (text: string) => void | Promise<string | null | undefined>) {
  const { t } = useI18n()
  const notifications = useNotificationsStore()
  const house = useHouseStore()
  const devices = useDevicesStore()
  const scenes = useScenesStore()

  if (!asked) {
    asked = true
    getTransport().transcriptionStatus().then((s) => { ready.value = s.ready; speech.value = s.speech; autoSend.value = s.autoSend === true }, () => { ready.value = false })
  }

  const phase = ref<VoicePhase>('idle')
  const heardNothing = ref(false)
  let heardNothingTimer: ReturnType<typeof setTimeout> | null = null
  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let chunks: Blob[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Démonté pendant l'enregistrement : on coupe le micro et on jette ce qui a été dit. */
  let discarded = false
  /** Personne n'a parlé (détection) : rien à transcrire. */
  let silent = false
  /** L'écoute du niveau sonore, le temps d'un enregistrement. */
  let listener: { audio: AudioContext; poll: ReturnType<typeof setInterval> } | null = null
  /** La réponse en train d'être dite (une seule à la fois). */
  let player: HTMLAudioElement | null = null
  let playerUrl: string | null = null
  /** La dernière réponse synthétisée, et son audio. */
  let spoken: { text: string; audio: Blob } | null = null

  function stopSpeaking() {
    player?.pause()
    player = null
    if (playerUrl) { URL.revokeObjectURL(playerUrl); playerUrl = null }
    if (phase.value === 'speaking') phase.value = 'idle'
  }

  async function say(answer: string) {
    phase.value = 'speaking'
    try {
      const audio = spoken?.text === answer ? spoken.audio : await getTransport().speak(answer)
      spoken = { text: answer, audio }
      if (phase.value !== 'speaking') return              // arrêté pendant la synthèse
      playerUrl = URL.createObjectURL(audio)
      player = new Audio(playerUrl)
      player.onended = stopSpeaking
      player.onerror = stopSpeaking
      await player.play()
    } catch (err) {
      stopSpeaking()
      const message = err instanceof ApiRequestError ? err.message : (err as Error).message
      notifications.error(t('voice.errors.speakFailed', { message }))
    }
  }

  function setHeardNothing(on: boolean) {
    if (heardNothingTimer) { clearTimeout(heardNothingTimer); heardNothingTimer = null }
    heardNothing.value = on
    if (on) heardNothingTimer = setTimeout(() => setHeardNothing(false), HEARD_NOTHING_MS)
  }

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

  /** Écoute le niveau du micro et arrête l'enregistrement à la fin de la phrase (ou sans parole). */
  function watchSilence(source: MediaStream) {
    const audio = new AudioContext()
    void audio.resume()
    const analyser = audio.createAnalyser()
    analyser.fftSize = 1024
    audio.createMediaStreamSource(source).connect(analyser)
    const frame = new Float32Array(analyser.fftSize)
    const vad = createEndpointer()
    const t0 = performance.now()
    const poll = setInterval(() => {
      analyser.getFloatTimeDomainData(frame)
      const event = vad.push(rms(frame), performance.now() - t0)
      if (event === 'nothing') silent = true
      if (event) stop()
    }, VAD_FRAME_MS)
    listener = { audio, poll }
  }

  function release() {
    if (timer) { clearTimeout(timer); timer = null }
    if (listener) { clearInterval(listener.poll); void listener.audio.close(); listener = null }
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
  }

  async function start() {
    setHeardNothing(false)
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
    silent = false
    recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    recorder.onstop = () => { void finish(recorder?.mimeType ?? '') }
    recorder.start()
    phase.value = 'recording'
    timer = setTimeout(stop, MAX_RECORDING_MS)
    if (autoSend.value) try { watchSilence(stream) } catch { /* pas d'analyse audio : le bouton reste */ }
  }

  function stop() {
    if (recorder?.state === 'recording') recorder.stop()
  }

  async function finish(type: string) {
    release()
    if (discarded) { phase.value = 'idle'; return }
    if (silent) { phase.value = 'idle'; setHeardNothing(true); return }
    phase.value = 'transcribing'
    try {
      const samples = await toMono16k(new Blob(chunks, { type }))
      if (samples.length < STT_RATE * MIN_SECONDS) { setHeardNothing(true); return }
      const { text } = await getTransport().transcribe(toBase64(encodeWav(samples)), hints())
      if (!text) { setHeardNothing(true); return }
      phase.value = 'idle'
      const answer = await onText(text)
      if (answer && speech.value && !discarded && phase.value === 'idle') await say(answer)
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : (err as Error).message
      notifications.error(t('voice.errors.failed', { message }))
    } finally {
      if (phase.value === 'transcribing') phase.value = 'idle'
    }
  }

  function toggle() {
    if (phase.value === 'idle') void start()
    else if (phase.value === 'recording') stop()
    else if (phase.value === 'speaking') stopSpeaking()
  }

  /** Réécouter une réponse (réponses parlées allumées), ou arrêter celle qui se dit. */
  function replay(answer: string) {
    if (phase.value === 'speaking') stopSpeaking()
    else if (phase.value === 'idle' && speech.value && answer) void say(answer)
  }

  function forgetSpoken() {
    spoken = null
  }

  onBeforeUnmount(() => {
    setHeardNothing(false)
    discarded = true
    stop()
    release()
    stopSpeaking()
  })

  return { ready, speech, phase, heardNothing, toggle, replay, forgetSpoken }
}
