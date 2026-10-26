<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { parseDeviceId } from '@kasbah/shared'
import { getTransport } from '../../api'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Live video of a camera: the server relays the RTSP stream as fragmented MP4 over a WebSocket
// (`core/video/rtsp-relay.ts`), and this component pushes it into a <video> through Media Source
// Extensions. The first message is a JSON line announcing the codecs (MSE requires it before the
// first byte), then the MP4 header, then the fragments — each starts with a key frame, so
// we can decode from the first one received. We stay at the live edge: if the buffer gets more than
// a few seconds ahead (background tab), we jump to the end rather than lag behind.
// `autoplay`: the live stream starts on its own (detail card). Otherwise (Cameras view) the tile shows the
// last JPEG thumbnail the server keeps up to date, with its age; there, the stop button stops the
// thumbnail (`paused`, emitted to the view which tells the server) and a play button starts the live stream.
// While the live stream connects, the last thumbnail stays on screen with its age, until the video
// really plays: the detail card asks the server for its date itself, the Cameras view passes it.
const props = withDefaults(defineProps<{ deviceId: string; autoplay?: boolean; snapshotAt?: number | null; inactive?: boolean; paused?: boolean; liveAllowed?: boolean }>(), { autoplay: true, snapshotAt: null, inactive: false, paused: false, liveAllowed: true })
const emit = defineEmits<{ snapshots: [enabled: boolean]; live: [active: boolean] }>()

type Status = 'idle' | 'connecting' | 'playing' | 'unsupported' | 'ended' | 'error'
const status = ref<Status>('idle')
const detail = ref('')
const muted = ref(true)
const video = ref<HTMLVideoElement | null>(null)
const now = ref(Date.now())
let ageTimer: ReturnType<typeof setInterval> | null = null
/** Thumbnail date read by the detail card itself (the Cameras view passes `snapshotAt`), for the camera it was read for. */
const ownSnapshot = ref<{ deviceId: string; at: number } | null>(null)
const shownAt = computed(() => props.snapshotAt ?? (ownSnapshot.value?.deviceId === props.deviceId ? ownSnapshot.value.at : null))
const snapshotUrl = computed(() => (shownAt.value ? getTransport().cameraSnapshotUrl(props.deviceId, shownAt.value) : null))
const snapshotAgeS = computed(() => (shownAt.value ? Math.max(0, Math.round((now.value - shownAt.value) / 1000)) : 0))
/** The video has really started: until then, the thumbnail covers the black of the player. */
const frameShown = ref(false)
const showSnapshot = computed(() => !!snapshotUrl.value && (status.value === 'idle' || status.value === 'connecting' || (status.value === 'playing' && !frameShown.value)))

async function loadOwnSnapshot() {
  const deviceId = props.deviceId
  const { pluginId, externalId } = parseDeviceId(deviceId)
  try {
    const at = (await getTransport().cameraSnapshots(pluginId, false))[externalId]?.at
    if (at !== undefined && deviceId === props.deviceId) ownSnapshot.value = { deviceId, at }
  } catch { /* no thumbnail: the player stays black while it connects, as before */ }
}

let ws: WebSocket | null = null
let mediaSource: MediaSource | null = null
let sourceBuffer: SourceBuffer | null = null
let objectUrl: string | null = null
/** Fragments waiting to be appended; `init` marks a header (new source on the server side). */
const queue: { data: ArrayBuffer; init?: boolean }[] = []

const KEEP_BEHIND_S = 30      // buffer kept behind the playhead (beyond that, we free it)
const PRIME_DELAY_MS = 600    // margin before starting playback at the first fragment (see below)
/**
 * Duration of the longest fragment received. The relay cuts at key frames, so a fragment = a group
 * of frames (4 s on the Nest doorbell), and it only arrives once complete: playback is NECESSARILY
 * one fragment behind the live stream. Settling closer would freeze the image between two fragments
 * — which is what a first setting of 0.3 s did: 0.3 s of video, 3.7 s of stall, in a loop.
 */
let fragmentS = 1
let lastEnd = 0

function flush() {
  const sb = sourceBuffer, v = video.value
  if (!sb || sb.updating || queue.length === 0) return
  const item = queue.shift()!
  try {
    // New header during playback: the server changed source (at Google, a session
    // reopens every five minutes) and its timestamps restart from zero. We shift them to
    // follow what is already buffered, otherwise playback would go backward and stay stuck.
    if (item.init && v && v.buffered.length) sb.timestampOffset = v.buffered.end(v.buffered.length - 1)
    sb.appendBuffer(item.data)
  } catch (err) { fail((err as Error).message) }
}

function trimAndCatchUp() {
  const v = video.value, sb = sourceBuffer
  if (!v || !sb || sb.updating || v.buffered.length === 0) return
  const start = v.buffered.start(0), end = v.buffered.end(v.buffered.length - 1)
  // the first fragment already gives the duration of a group of frames; then each append confirms it
  fragmentS = Math.max(fragmentS, Math.min(lastEnd > 0 ? end - lastEnd : end - start, 10))
  lastEnd = end
  // more than two fragments behind (background tab): we come back to one fragment from the edge
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
  if (props.autoplay) void loadOwnSnapshot()
  fragmentS = 1
  lastEnd = 0
  mediaSource = new MediaSource()
  objectUrl = URL.createObjectURL(mediaSource)
  v.src = objectUrl
  const ms = mediaSource
  let nextIsInit = false
  ms.addEventListener('sourceopen', () => {
    // `start` may have been called again in the meantime (mount THEN activation, under `<keep-alive>` both
    // happen): a stale MediaSource does not open a second WebSocket
    if (mediaSource !== ms) return
    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data) as { type: string; mime?: string; message?: string; reason?: string }
        if (msg.type === 'init' && msg.mime) {
          if (sourceBuffer) { nextIsInit = true; return }   // source change: the binary header that follows is shifted
          if (!MediaSource.isTypeSupported(msg.mime)) { status.value = 'unsupported'; detail.value = msg.mime; close(); return }
          sourceBuffer = ms.addSourceBuffer(msg.mime)
          sourceBuffer.mode = 'segments'
          sourceBuffer.addEventListener('updateend', () => { trimAndCatchUp(); flush() })
          sourceBuffer.addEventListener('error', () => fail('decode error'))
          nextIsInit = true
          flush()
        } else if (msg.type === 'ended') {
          status.value = 'ended'; detail.value = msg.reason ?? ''; close()
        } else if (msg.type === 'error') {
          fail(msg.message ?? 'stream error')
        }
        return
      }
      queue.push({ data: ev.data as ArrayBuffer, ...(nextIsInit ? { init: true } : {}) })
      nextIsInit = false
      flush()
      if (status.value === 'connecting') {
        status.value = 'playing'
        // The first fragment covers exactly one group of frames, and the next only arrives at the
        // end of that group: starting right away means reaching the end of the buffer at the very
        // moment the next one arrives — the slightest jitter freezes the image. Half a second of margin is enough.
        setTimeout(() => { void v.play().catch(() => { /* playback on the next gesture */ }) }, PRIME_DELAY_MS)
      }
    }
    ws.onerror = () => { if (status.value === 'connecting') fail('connection failed') }
    ws.onclose = () => { if (status.value === 'connecting' || status.value === 'playing') { status.value = 'ended'; detail.value = '' } }
  }, { once: true })
}

function close() {
  frameShown.value = false
  ws?.close()
  ws = null
  queue.length = 0
  sourceBuffer = null
  if (mediaSource && mediaSource.readyState === 'open') { try { mediaSource.endOfStream() } catch { /* already closed */ } }
  mediaSource = null
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null }
  if (video.value) video.value.removeAttribute('src')
}

function stop() { close(); status.value = 'idle' }

// Three states of a tile (Cameras view): stopped (no stream, last image frozen), preview (image
// refreshed every ~10 s on the server side), live (continuous video). The current state is deduced from
// the current playback and from `paused` (kept by the server); the three-button bar changes it.
type Mode = 'off' | 'preview' | 'live'
const mode = computed<Mode>(() => (status.value === 'playing' || status.value === 'connecting' ? 'live' : props.paused ? 'off' : 'preview'))
function setMode(m: Mode) {
  if (m === mode.value) return
  if (m === 'live') { if (!props.liveAllowed) return; start(); return }   // preview/stop: we cut the live stream if it was running
  stop()
  emit('snapshots', m === 'preview')
}

/**
 * Chrome pauses a MUTED video as soon as the page goes to the background ("video-only
 * background media was paused to save power"), and does not restart it on its own. A wall tablet
 * that wakes up must find the image again: we restart at every return to the foreground, and after
 * any pause we did not ask for while the page is visible.
 */
function resume() {
  const v = video.value
  if (v && status.value === 'playing' && !document.hidden && v.paused) void v.play().catch(() => { /* gesture required */ })
}
function onPause() { setTimeout(resume, 300) }
function onPlaying() { if (status.value === 'playing') frameShown.value = true }
function toggleMute() { muted.value = !muted.value; if (video.value) video.value.muted = muted.value }

onMounted(() => {
  document.addEventListener('visibilitychange', resume)
  video.value?.addEventListener('pause', onPause)
  video.value?.addEventListener('playing', onPlaying)
  ageTimer = setInterval(() => { now.value = Date.now() }, 1000)
  if (props.autoplay) start()
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', resume)
  video.value?.removeEventListener('pause', onPause)
  video.value?.removeEventListener('playing', onPlaying)
  if (ageTimer) clearInterval(ageTimer)
  close()
})
// The House view is kept alive (`<keep-alive>` in App.vue): leaving the tab does NOT unmount
// this component, `onBeforeUnmount` never comes, and without this the stream kept going in an
// invisible component — ffmpeg and the Google session with it (observed on the doorbell).
onDeactivated(close)
onActivated(() => { if (props.autoplay) start() })
// same component reused for another camera: we change stream, or go back to the thumbnail
watch(() => props.deviceId, () => { if (props.autoplay || status.value === 'playing' || status.value === 'connecting') start(); else stop() })
// the Cameras view counts the live streams to allow only three: we warn it at each switch
watch(() => mode.value === 'live', (live) => emit('live', live))
</script>

<template>
  <div class="cam" :class="{ 'cam--tile': !autoplay }">
    <video ref="video" class="cam__video" :muted="muted" autoplay playsinline />
    <img v-if="showSnapshot" :src="snapshotUrl!" class="cam__snapshot" alt="" />
    <!-- state badge, always visible on a tile: live, preview or stopped -->
    <div v-if="!autoplay" class="cam__badge" :data-mode="mode">
      <span v-if="mode === 'live'" class="cam__dot" />{{ $t(`camera.video.mode.${mode}`) }}
    </div>
    <div v-if="status !== 'playing'" class="cam__overlay">
      <span v-if="showSnapshot" class="cam__msg cam__msg--age">{{ snapshotAgeS >= 90 ? $t('camera.video.agoMin', { m: Math.round(snapshotAgeS / 60) }) : $t('camera.video.ago', { s: snapshotAgeS }) }}</span>
      <span v-if="status === 'connecting'" class="cam__msg">{{ $t('camera.video.connecting') }}</span>
      <span v-else-if="status === 'idle' && !showSnapshot" class="cam__msg">{{ $t(inactive ? 'camera.video.inactive' : autoplay ? 'camera.video.stopped' : 'camera.video.noSnapshot') }}</span>
      <span v-else-if="status !== 'idle'" class="cam__msg">{{ $t(`camera.video.${status}`) }}<span v-if="detail" class="cam__detail"> · {{ detail }}</span></span>
    </div>
    <div class="cam__bar">
      <!-- detail card: live playback / stop -->
      <template v-if="autoplay">
        <button v-if="status === 'playing' || status === 'connecting'" type="button" class="key" :title="$t('camera.video.stop')" :aria-label="$t('camera.video.stop')" @click="stop">
          <StrokeIcon name="stop" :size="18" />
        </button>
        <button v-else type="button" class="key" :title="$t('camera.video.play')" :aria-label="$t('camera.video.play')" @click="start">
          <StrokeIcon name="play" :size="18" />
        </button>
      </template>
      <!-- tile: the three states always displayed, the active one highlighted -->
      <div v-else class="seg" role="group" :aria-label="$t('camera.video.mode.label')">
        <button type="button" class="seg__btn" :data-active="mode === 'off'" @click="setMode('off')">{{ $t('camera.video.mode.off') }}</button>
        <button type="button" class="seg__btn" :data-active="mode === 'preview'" @click="setMode('preview')">{{ $t('camera.video.mode.preview') }}</button>
        <button type="button" class="seg__btn" :data-active="mode === 'live'" :disabled="!liveAllowed && mode !== 'live'"
                :title="!liveAllowed && mode !== 'live' ? $t('camera.video.liveFull') : ''" @click="setMode('live')">{{ $t('camera.video.mode.live') }}</button>
      </div>
      <button v-if="autoplay || mode === 'live'" type="button" class="key" :data-on="muted ? '0' : '1'" :title="$t(muted ? 'camera.video.unmute' : 'camera.video.mute')" :aria-label="$t(muted ? 'camera.video.unmute' : 'camera.video.mute')" @click="toggleMute">
        <StrokeIcon :name="muted ? 'speaker' : 'speakerOn'" :size="18" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.cam { position: relative; border-radius: 12px; overflow: hidden; background: #000; }
.cam__video { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: contain; background: #000; }
.cam__snapshot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.cam__msg--age { position: absolute; top: 8px; right: 8px; font-size: 11px; padding: 3px 7px; }
.cam__overlay { position: absolute; inset: 0 0 44px 0; display: grid; place-items: center; color: #ddd; font-size: 13px; padding: 12px; text-align: center; pointer-events: none; }
.cam__msg { background: rgba(0, 0, 0, .55); padding: 6px 10px; border-radius: 8px; }
.cam__detail { opacity: .7; }
.cam__bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; gap: 6px; padding: 6px 8px; background: linear-gradient(transparent, rgba(0, 0, 0, .6)); }
.key {
  display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, .25); background: rgba(0, 0, 0, .35); color: #fff; transition: background .15s;
}
.key:hover { background: rgba(255, 255, 255, .18); }
.key[data-on='1'] { background: var(--accent); border-color: transparent; color: var(--on-accent); }
.key:disabled { opacity: .4; cursor: not-allowed; }
.cam__badge {
  position: absolute; top: 8px; left: 8px; display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 600; letter-spacing: .02em; padding: 3px 8px; border-radius: 999px;
  background: rgba(0, 0, 0, .55); color: #eee; text-transform: uppercase;
}
.cam__badge[data-mode='live'] { background: var(--accent); color: var(--on-accent); }
.cam__dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: cam-pulse 1.6s ease-in-out infinite; }
@keyframes cam-pulse { 50% { opacity: .35; } }
.seg { display: inline-flex; border-radius: 9px; overflow: hidden; border: 1px solid rgba(255, 255, 255, .25); }
.seg__btn {
  border: 0; padding: 0 12px; height: 32px; font-size: 12px; font-weight: 600; cursor: pointer;
  background: rgba(0, 0, 0, .35); color: #fff; transition: background .15s;
  border-right: 1px solid rgba(255, 255, 255, .18);
}
.seg__btn:last-child { border-right: 0; }
.seg__btn:hover:not(:disabled):not([data-active='true']) { background: rgba(255, 255, 255, .18); }
.seg__btn[data-active='true'] { background: var(--accent); color: var(--on-accent); }
.seg__btn:disabled { opacity: .4; cursor: not-allowed; }
</style>
