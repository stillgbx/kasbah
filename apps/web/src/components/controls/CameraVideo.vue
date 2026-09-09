<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { getTransport } from '../../api'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Vidéo en direct d'une caméra : le serveur relaie le flux RTSP en MP4 fragmenté sur un WebSocket
// (`core/video/rtsp-relay.ts`), et ce composant le pousse dans un <video> par Media Source
// Extensions. Le premier message est une ligne JSON qui annonce les codecs (MSE l'exige avant le
// premier octet), puis l'entête MP4, puis les fragments — chacun commence par une image clé, donc
// on peut décoder dès le premier reçu. On se tient au bord du direct : si le tampon prend plus de
// quelques secondes d'avance (onglet en arrière-plan), on saute au bout plutôt que de traîner.
const props = defineProps<{ deviceId: string }>()

type Status = 'idle' | 'connecting' | 'playing' | 'unsupported' | 'ended' | 'error'
const status = ref<Status>('idle')
const detail = ref('')
const muted = ref(true)
const video = ref<HTMLVideoElement | null>(null)

let ws: WebSocket | null = null
let mediaSource: MediaSource | null = null
let sourceBuffer: SourceBuffer | null = null
let objectUrl: string | null = null
const queue: ArrayBuffer[] = []

const KEEP_BEHIND_S = 30      // tampon conservé derrière la tête de lecture (au-delà, on libère)
const PRIME_DELAY_MS = 600    // marge avant de lancer la lecture au premier fragment (voir plus bas)
/**
 * Durée du plus long fragment reçu. Le relais coupe aux images clés, donc un fragment = un groupe
 * d'images (4 s sur la sonnette Nest), et il n'arrive qu'une fois complet : la lecture a FORCÉMENT
 * un fragment de retard sur le direct. Se caler plus près ferait geler l'image entre deux fragments
 * — c'est ce qu'un premier réglage à 0,3 s faisait : 0,3 s de vidéo, 3,7 s d'arrêt, en boucle.
 */
let fragmentS = 1
let lastEnd = 0

function flush() {
  const sb = sourceBuffer
  if (!sb || sb.updating || queue.length === 0) return
  try { sb.appendBuffer(queue.shift()!) }
  catch (err) { fail((err as Error).message) }
}

function trimAndCatchUp() {
  const v = video.value, sb = sourceBuffer
  if (!v || !sb || sb.updating || v.buffered.length === 0) return
  const start = v.buffered.start(0), end = v.buffered.end(v.buffered.length - 1)
  // le premier fragment donne déjà la durée d'un groupe d'images ; ensuite chaque ajout la confirme
  fragmentS = Math.max(fragmentS, Math.min(lastEnd > 0 ? end - lastEnd : end - start, 10))
  lastEnd = end
  // en retard de plus de deux fragments (onglet en arrière-plan) : on revient à un fragment du bord
  if (end - v.currentTime > fragmentS * 2 + 2) v.currentTime = end - fragmentS - 0.5
  if (v.currentTime - start > KEEP_BEHIND_S * 2) sb.remove(start, v.currentTime - KEEP_BEHIND_S)
}

function fail(message: string) {
  status.value = 'error'
  detail.value = message
  close()
}

function start() {
  const url = getTransport().cameraStreamUrl(props.deviceId)
  const v = video.value
  if (!url || !v || typeof MediaSource === 'undefined') { status.value = 'unsupported'; return }
  close()
  status.value = 'connecting'
  detail.value = ''
  fragmentS = 1
  lastEnd = 0
  mediaSource = new MediaSource()
  objectUrl = URL.createObjectURL(mediaSource)
  v.src = objectUrl
  const ms = mediaSource
  ms.addEventListener('sourceopen', () => {
    // `start` a pu être rappelé entre-temps (montage PUIS activation, sous `<keep-alive>` les deux
    // arrivent) : une MediaSource périmée n'ouvre pas de second WebSocket
    if (mediaSource !== ms) return
    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data) as { type: string; mime?: string; message?: string; reason?: string }
        if (msg.type === 'init' && msg.mime) {
          if (!MediaSource.isTypeSupported(msg.mime)) { status.value = 'unsupported'; detail.value = msg.mime; close(); return }
          sourceBuffer = ms.addSourceBuffer(msg.mime)
          sourceBuffer.mode = 'segments'
          sourceBuffer.addEventListener('updateend', () => { trimAndCatchUp(); flush() })
          sourceBuffer.addEventListener('error', () => fail('decode error'))
          flush()
        } else if (msg.type === 'ended') {
          status.value = 'ended'; detail.value = msg.reason ?? ''; close()
        } else if (msg.type === 'error') {
          fail(msg.message ?? 'stream error')
        }
        return
      }
      queue.push(ev.data as ArrayBuffer)
      flush()
      if (status.value === 'connecting') {
        status.value = 'playing'
        // Le premier fragment couvre exactement un groupe d'images, et le suivant n'arrive qu'à la
        // fin de ce groupe : démarrer tout de suite, c'est atteindre la fin du tampon au moment
        // même où la suite arrive — la moindre gigue gèle l'image. Une demi-seconde de marge suffit.
        setTimeout(() => { void v.play().catch(() => { /* lecture au geste suivant */ }) }, PRIME_DELAY_MS)
      }
    }
    ws.onerror = () => { if (status.value === 'connecting') fail('connection failed') }
    ws.onclose = () => { if (status.value === 'connecting' || status.value === 'playing') { status.value = 'ended'; detail.value = '' } }
  }, { once: true })
}

function close() {
  ws?.close()
  ws = null
  queue.length = 0
  sourceBuffer = null
  if (mediaSource && mediaSource.readyState === 'open') { try { mediaSource.endOfStream() } catch { /* déjà fermé */ } }
  mediaSource = null
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null }
  if (video.value) video.value.removeAttribute('src')
}

function stop() { close(); status.value = 'idle' }

/**
 * Chrome met en pause une vidéo MUETTE dès que la page passe en arrière-plan (« video-only
 * background media was paused to save power »), et ne la relance pas seul. Une tablette murale
 * qui se réveille doit retrouver l'image : on relance à chaque retour au premier plan, et après
 * toute pause qu'on n'a pas demandée pendant que la page est visible.
 */
function resume() {
  const v = video.value
  if (v && status.value === 'playing' && !document.hidden && v.paused) void v.play().catch(() => { /* geste requis */ })
}
function onPause() { setTimeout(resume, 300) }
function toggleMute() { muted.value = !muted.value; if (video.value) video.value.muted = muted.value }

onMounted(() => {
  document.addEventListener('visibilitychange', resume)
  video.value?.addEventListener('pause', onPause)
  start()
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', resume)
  video.value?.removeEventListener('pause', onPause)
  close()
})
// La vue Maison est gardée en vie (`<keep-alive>` dans App.vue) : quitter l'onglet ne démonte PAS
// ce composant, `onBeforeUnmount` ne vient jamais, et sans ceci le flux continuait dans un
// composant invisible — ffmpeg et la session Google avec lui (relevé sur la sonnette).
onDeactivated(close)
onActivated(start)
// même composant réutilisé pour une autre caméra : on change de flux
watch(() => props.deviceId, start)
</script>

<template>
  <div class="cam">
    <video ref="video" class="cam__video" :muted="muted" autoplay playsinline />
    <div v-if="status !== 'playing'" class="cam__overlay">
      <span v-if="status === 'connecting'" class="cam__msg">{{ $t('camera.video.connecting') }}</span>
      <span v-else-if="status === 'idle'" class="cam__msg">{{ $t('camera.video.stopped') }}</span>
      <span v-else class="cam__msg">{{ $t(`camera.video.${status}`) }}<span v-if="detail" class="cam__detail"> · {{ detail }}</span></span>
    </div>
    <div class="cam__bar">
      <button v-if="status === 'playing' || status === 'connecting'" type="button" class="key" :title="$t('camera.video.stop')" :aria-label="$t('camera.video.stop')" @click="stop">
        <StrokeIcon name="stop" :size="18" />
      </button>
      <button v-else type="button" class="key" :title="$t('camera.video.play')" :aria-label="$t('camera.video.play')" @click="start">
        <StrokeIcon name="play" :size="18" />
      </button>
      <button type="button" class="key" :data-on="muted ? '0' : '1'" :title="$t(muted ? 'camera.video.unmute' : 'camera.video.mute')" :aria-label="$t(muted ? 'camera.video.unmute' : 'camera.video.mute')" @click="toggleMute">
        <StrokeIcon :name="muted ? 'speaker' : 'speakerOn'" :size="18" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.cam { position: relative; border-radius: 12px; overflow: hidden; background: #000; }
.cam__video { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: contain; background: #000; }
.cam__overlay { position: absolute; inset: 0 0 44px 0; display: grid; place-items: center; color: #ddd; font-size: 13px; padding: 12px; text-align: center; }
.cam__msg { background: rgba(0, 0, 0, .55); padding: 6px 10px; border-radius: 8px; }
.cam__detail { opacity: .7; }
.cam__bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; gap: 6px; padding: 6px 8px; background: linear-gradient(transparent, rgba(0, 0, 0, .6)); }
.key {
  display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, .25); background: rgba(0, 0, 0, .35); color: #fff; transition: background .15s;
}
.key:hover { background: rgba(255, 255, 255, .18); }
.key[data-on='1'] { background: var(--accent); border-color: transparent; color: var(--on-accent); }
</style>
