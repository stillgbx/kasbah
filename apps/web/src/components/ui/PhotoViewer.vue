<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { onKeyStroke } from '@vueuse/core'
import StrokeIcon from './StrokeIcon.vue'

// Visionneuse plein écran : une photo à la fois, flèches (boutons, clavier, glissé du doigt), zoom
// (boutons, molette, pincement, double-clic) avec déplacement de la photo agrandie, et
// téléchargement. Fond toujours noir, quel que soit le thème : c'est la photo qu'on regarde.
//
// `index` à null = fermée. Le téléchargement passe par fetch → blob : un <a download> vers une autre
// origine est ignoré par le navigateur, qui ouvrirait la photo au lieu de l'enregistrer.

export interface Photo { url: string }

const props = defineProps<{ photos: Photo[]; title?: string | null }>()
const index = defineModel<number | null>('index', { required: true })

const { t } = useI18n()

const MAX = 6
const STEPS = [1, 1.5, 2, 3, 4, MAX]

const open = computed(() => index.value !== null && index.value >= 0 && index.value < props.photos.length)
const photo = computed(() => (open.value ? props.photos[index.value!] : null))
const hasPrev = computed(() => open.value && index.value! > 0)
const hasNext = computed(() => open.value && index.value! < props.photos.length - 1)

const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const stage = ref<HTMLElement | null>(null)
const img = ref<HTMLImageElement | null>(null)
const loaded = ref(false)

function reset() { scale.value = 1; tx.value = 0; ty.value = 0 }
watch(index, () => { reset(); loaded.value = false })

// les voisines se chargent pendant qu'on regarde : la flèche ne fait pas attendre
watch(index, (i) => {
  if (i === null) return
  for (const j of [i - 1, i + 1]) { const p = props.photos[j]; if (p) new Image().src = p.url }
}, { immediate: true })

function go(step: number) {
  if (index.value === null) return
  const i = index.value + step
  if (i >= 0 && i < props.photos.length) index.value = i
}
function close() { index.value = null }

/** Garde la photo agrandie dans le cadre : on ne la pousse pas hors de l'écran. */
function clamp() {
  const el = img.value
  if (!el || scale.value <= 1) { tx.value = 0; ty.value = 0; return }
  const mx = (el.offsetWidth * (scale.value - 1)) / 2
  const my = (el.offsetHeight * (scale.value - 1)) / 2
  tx.value = Math.min(mx, Math.max(-mx, tx.value))
  ty.value = Math.min(my, Math.max(-my, ty.value))
}

/** Zoome en gardant immobile le point de l'écran (px, py) : celui sous le curseur ou les doigts. */
function zoomAt(next: number, px?: number, py?: number) {
  const s = Math.min(MAX, Math.max(1, next))
  const box = stage.value?.getBoundingClientRect()
  if (box && px !== undefined && py !== undefined) {
    const cx = px - (box.left + box.width / 2)
    const cy = py - (box.top + box.height / 2)
    tx.value = cx - ((cx - tx.value) * s) / scale.value
    ty.value = cy - ((cy - ty.value) * s) / scale.value
  }
  scale.value = s
  clamp()
}
const zoomIn = () => zoomAt(STEPS.find((s) => s > scale.value + 0.01) ?? MAX)
const zoomOut = () => zoomAt([...STEPS].reverse().find((s) => s < scale.value - 0.01) ?? 1)

function onWheel(e: WheelEvent) {
  zoomAt(scale.value * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)
}
function onDblClick(e: MouseEvent) {
  if (scale.value > 1) reset()
  else zoomAt(2.5, e.clientX, e.clientY)
}

// ---- Gestes : un doigt déplace (agrandie) ou fait défiler (taille normale), deux doigts pincent ----
const pointers = new Map<number, { x: number; y: number }>()
let start: { x: number; y: number; tx: number; ty: number; dist: number; scale: number } | null = null
let moved = false

function snapshot() {
  const [a, b] = [...pointers.values()]
  if (!a) return
  const x = b ? (a.x + b.x) / 2 : a.x
  const y = b ? (a.y + b.y) / 2 : a.y
  start = { x, y, tx: tx.value, ty: ty.value, dist: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, scale: scale.value }
}
function onPointerDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 1) moved = false
  snapshot()
}
function onPointerMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId) || !start) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  const [a, b] = [...pointers.values()]
  if (!a) return
  if (b && start.dist) {
    moved = true
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    zoomAt((start.scale * dist) / start.dist, (a.x + b.x) / 2, (a.y + b.y) / 2)
    return
  }
  const dx = a.x - start.x
  const dy = a.y - start.y
  if (Math.hypot(dx, dy) > 6) moved = true
  if (scale.value > 1) { tx.value = start.tx + dx; ty.value = start.ty + dy; clamp() }
}
function onPointerUp(e: PointerEvent) {
  const p = pointers.get(e.pointerId)
  pointers.delete(e.pointerId)
  if (p && start && pointers.size === 0 && scale.value === 1) {
    const dx = p.x - start.x
    const dy = p.y - start.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1)
  }
  if (pointers.size) snapshot()
  else start = null
}
/** Un clic sur le fond noir ferme ; pas la fin d'un glissé, ni un clic sur la photo. */
function onStageClick(e: MouseEvent) {
  if (!moved && e.target === stage.value) close()
}

onKeyStroke((e) => {
  if (!open.value) return
  const actions: Record<string, () => void> = {
    Escape: close, ArrowLeft: () => go(-1), ArrowRight: () => go(1),
    '+': zoomIn, '=': zoomIn, '-': zoomOut,
  }
  const run = actions[e.key]
  if (run) { e.preventDefault(); run() }
})

// ---- Téléchargement ---------------------------------------------------------------------------
const downloading = ref(false)
function fileName(p: Photo, i: number): string {
  const ext = /\.(\w{2,5})(?:\?|$)/.exec(new URL(p.url).pathname)?.[1] ?? 'jpg'
  const base = (props.title ?? t('photoViewer.photo')).replace(/[\\/:*?"<>|]+/g, ' ').trim()
  return props.photos.length > 1 ? `${base} (${i + 1}).${ext}` : `${base}.${ext}`
}
async function download() {
  if (!photo.value || index.value === null) return
  const p = photo.value
  downloading.value = true
  try {
    const res = await fetch(p.url, { referrerPolicy: 'no-referrer' })
    if (!res.ok) throw new Error(String(res.status))
    const href = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = href
    a.download = fileName(p, index.value)
    a.click()
    setTimeout(() => URL.revokeObjectURL(href), 10_000)
  } catch {
    // l'hébergeur refuse la lecture depuis l'app : on laisse le navigateur l'ouvrir
    window.open(p.url, '_blank', 'noopener,noreferrer')
  } finally {
    downloading.value = false
  }
}

onBeforeUnmount(() => pointers.clear())
</script>

<template>
  <Teleport to="body">
    <div v-if="open && photo" class="viewer" role="dialog" aria-modal="true" :aria-label="title ?? $t('photoViewer.photo')">
      <div class="viewer__bar">
        <span class="viewer__title">{{ title }}</span>
        <span class="viewer__count">{{ $t('photoViewer.count', { n: index! + 1, total: photos.length }) }}</span>
        <div class="viewer__tools">
          <button type="button" class="viewer__btn" :disabled="scale <= 1" :title="$t('photoViewer.zoomOut')" :aria-label="$t('photoViewer.zoomOut')" @click="zoomOut">
            <StrokeIcon name="zoomOut" :size="20" />
          </button>
          <button type="button" class="viewer__btn" :disabled="scale >= MAX" :title="$t('photoViewer.zoomIn')" :aria-label="$t('photoViewer.zoomIn')" @click="zoomIn">
            <StrokeIcon name="zoomIn" :size="20" />
          </button>
          <button type="button" class="viewer__btn" :disabled="downloading" :title="$t('photoViewer.download')" :aria-label="$t('photoViewer.download')" @click="download">
            <StrokeIcon name="download" :size="20" />
          </button>
          <button type="button" class="viewer__btn" :title="$t('common.close')" :aria-label="$t('common.close')" @click="close">
            <StrokeIcon name="close" :size="20" />
          </button>
        </div>
      </div>

      <div ref="stage" class="viewer__stage" @wheel.prevent="onWheel" @dblclick="onDblClick" @click="onStageClick"
           @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp">
        <img ref="img" :key="photo.url" :src="photo.url" :alt="title ?? ''" class="viewer__img" :data-zoomed="scale > 1 ? '1' : '0'"
             :style="{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, opacity: loaded ? 1 : 0 }"
             referrerpolicy="no-referrer" draggable="false" @load="loaded = true" />
      </div>

      <!-- les deux flèches gardent leur place aux extrémités : grisées, elles ne disparaissent pas -->
      <button type="button" class="viewer__nav viewer__nav--prev" :disabled="!hasPrev" :aria-label="$t('photoViewer.prev')" @click="go(-1)">
        <StrokeIcon name="back" :size="28" />
      </button>
      <button type="button" class="viewer__nav viewer__nav--next" :disabled="!hasNext" :aria-label="$t('photoViewer.next')" @click="go(1)">
        <StrokeIcon name="chevron" :size="28" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.viewer {
  position: fixed; inset: 0; z-index: 3000; background: rgba(0, 0, 0, .94); color: #fff;
  display: flex; flex-direction: column; font-family: var(--font);
}
.viewer__bar {
  flex: 0 0 auto; display: flex; align-items: center; gap: 12px; min-width: 0;
  padding: calc(var(--safe-top, 0px) + 10px) calc(var(--safe-right, 0px) + 12px) 10px calc(var(--safe-left, 0px) + 16px);
}
.viewer__title { flex: 1 1 auto; min-width: 0; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.viewer__count { flex: 0 0 auto; font-size: 13px; opacity: .7; font-variant-numeric: tabular-nums; }
.viewer__tools { flex: 0 0 auto; display: flex; gap: 4px; }
.viewer__btn, .viewer__nav {
  border: 0; background: rgba(255, 255, 255, .1); color: #fff; cursor: pointer; padding: 0;
  display: inline-flex; align-items: center; justify-content: center; transition: background .15s, opacity .15s;
}
.viewer__btn { width: 40px; height: 40px; border-radius: 999px; }
.viewer__btn:hover:not(:disabled), .viewer__nav:hover:not(:disabled) { background: rgba(255, 255, 255, .2); }
.viewer__btn:disabled, .viewer__nav:disabled { opacity: .3; cursor: default; }

.viewer__stage {
  flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; touch-action: none;
  display: flex; align-items: center; justify-content: center;
  padding: 0 72px calc(var(--safe-bottom, 0px) + 16px);
}
.viewer__img {
  max-width: 100%; max-height: 100%; object-fit: contain; user-select: none; -webkit-user-drag: none;
  transform-origin: center; transition: opacity .15s; cursor: zoom-in;
}
.viewer__img[data-zoomed='1'] { cursor: grab; }

.viewer__nav { position: absolute; top: 50%; width: 52px; height: 52px; margin-top: -26px; border-radius: 999px; }
.viewer__nav--prev { left: calc(var(--safe-left, 0px) + 10px); }
.viewer__nav--next { right: calc(var(--safe-right, 0px) + 10px); }
/* téléphone : la photo prend toute la largeur, les flèches se posent dessus */
@media (max-width: 600px) {
  .viewer__stage { padding-left: 0; padding-right: 0; }
  .viewer__nav { background: rgba(0, 0, 0, .45); }
}
</style>
