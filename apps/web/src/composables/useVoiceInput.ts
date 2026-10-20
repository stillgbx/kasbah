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

// The search microphone: press to speak, press to finish (stops by itself after 15 s),
// and the heard text goes out right away (`onText`). With the `autoSend` sub-item on (default), listening
// also stops by itself at the end of the sentence (`lib/vad.ts`); with no speech after 5 s, nothing is
// sent (a transcription model invents text over silence). The recording is converted
// here to a 16 kHz mono WAV, then transcribed by the server's `transcription` plugin, with the house's
// names as vocabulary ("Kitchen spots", "Robby": words a model cannot guess).
//
// The microphone only exists in a secure context (HTTPS, or localhost): on the local network over `http://`, the
// browser refuses it — we say so on touch, with where to find the workaround (Chrome flag).
//
// Spoken replies (`speech` sub-item of the plugin): when `onText` returns the assistant's reply, it
// is said aloud HERE, on the device that spoke. Only dictated instructions speak; a
// touch of the microphone during playback stops it. A typed reply can be replayed on demand (`replay`).
// The audio of the last reply said is kept: replaying it does not redo the synthesis. The caller
// forgets it (`forgetSpoken`) when the reply closes; another reply replaces it.
//
// Heard nothing: no error banner, the field says it in place of its placeholder text
// (`heardNothing`, a few seconds), where one was already looking.

export type VoicePhase = 'idle' | 'recording' | 'transcribing' | 'speaking'

/** At most 15 s: an instruction, not a dictation (and 480 KB of WAV). */
export const MAX_RECORDING_MS = 15_000
/** Below that, it is a touch without speech: nothing to transcribe. */
const MIN_SECONDS = 0.3
/** How long "heard nothing" stays in the field. */
export const HEARD_NOTHING_MS = 4000
/** A microphone level measurement every 50 ms (`setInterval`: a hidden tab does not render `requestAnimationFrame`). */
const VAD_FRAME_MS = 50

/** Is the plugin running? Requested once per page load, shared by the palette and the bar. */
const ready = ref<boolean | null>(null)
/** `speech` sub-item on: say the replies to dictated instructions. */
const speech = ref(false)
/** `autoSend` sub-item on: listening stops by itself at the end of the sentence. */
const autoSend = ref(false)
let asked = false

/**
 * `onText` receives the heard text; if it returns (or promises) the assistant's reply, it is said
 * aloud when spoken replies are on.
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
  /** Unmounted during recording: we cut the microphone and throw away what was said. */
  let discarded = false
  /** Nobody spoke (detection): nothing to transcribe. */
  let silent = false
  /** Listening to the sound level, for the duration of a recording. */
  let listener: { audio: AudioContext; poll: ReturnType<typeof setInterval> } | null = null
  /** The reply being said (only one at a time). */
  let player: HTMLAudioElement | null = null
  let playerUrl: string | null = null
  /** The last synthesized reply, and its audio. */
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
      const audio = spoken?.text === answer ? spoken.audio : await getTransport().speak(answer, spokenWords())
      spoken = { text: answer, audio }
      if (phase.value !== 'speaking') return              // stopped during the synthesis
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

  /** Rooms, zones, levels, light scenes, then devices: the server keeps what the provider accepts. */
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

  /** Each level's abbreviation → its name ("GF" → "Ground floor"): the synthesis says the name. */
  function spokenWords(): Record<string, string> {
    return Object.fromEntries(house.levels.filter((l) => l.shortName && l.shortName !== l.name).map((l) => [l.shortName!, l.name]))
  }

  /** Listens to the microphone level and stops the recording at the end of the sentence (or without speech). */
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
    if (autoSend.value) try { watchSilence(stream) } catch { /* no audio analysis: the button stays */ }
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

  /** Replay a reply (spoken replies on), or stop the one being said. */
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
