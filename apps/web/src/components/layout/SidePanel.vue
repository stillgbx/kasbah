<script setup lang="ts">
// Side panel (340 px): FLOATING card laid on the scene on the right in wide landscape (the scene
// takes all the space and frames itself in the free part, cf. `HouseScene.setViewInset`), overlaid
// drawer otherwise — a sheet that rises from the bottom on a portrait phone.
//
// The sheet closes by dragging it down by its handle (the bar at the top): released after a
// quarter of its height, or thrown with a quick gesture, it goes down and closes; otherwise it comes back up.
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{ open: boolean; docked: boolean }>()
const emit = defineEmits<{ close: [] }>()

/** Speed (px/ms) of a thrown gesture, which closes even when short. */
const FLING = 0.5

const sheet = ref<HTMLElement | null>(null)
/** How far the sheet is pulled down; `'gone'`: it leaves, before closing. */
const offset = ref<number | 'gone'>(0)
const dragging = ref(false)
let startY = 0
let lastY = 0
let lastT = 0
let speed = 0

watch(() => props.open, (open) => { if (open) offset.value = 0 })

const sheetStyle = computed(() => {
  if (offset.value === 'gone') return { transform: 'translateY(100%)' }
  if (!offset.value) return undefined
  return { transform: `translateY(${offset.value}px)`, transition: dragging.value ? 'none' : undefined }
})

function grab(e: PointerEvent) {
  (e.currentTarget as Element).setPointerCapture(e.pointerId)
  dragging.value = true
  startY = lastY = e.clientY
  lastT = e.timeStamp
  speed = 0
}

function drag(e: PointerEvent) {
  if (!dragging.value) return
  const dt = e.timeStamp - lastT
  if (dt > 0) speed = (e.clientY - lastY) / dt
  lastY = e.clientY
  lastT = e.timeStamp
  offset.value = Math.max(0, e.clientY - startY)
}

async function drop() {
  if (!dragging.value) return
  dragging.value = false
  const pulled = typeof offset.value === 'number' ? offset.value : 0
  if (pulled > (sheet.value?.offsetHeight ?? 0) / 4 || (speed > FLING && pulled > 16)) {
    // it goes down from where the finger left it; the closing follows, once the style is set
    offset.value = 'gone'
    await nextTick()
    emit('close')
  } else offset.value = 0
}
</script>

<template>
  <aside v-if="docked" class="side-panel side-panel--docked">
    <div class="side-panel__scroll"><slot /></div>
  </aside>
  <template v-else>
    <transition name="fade"><div v-if="open" class="side-panel__scrim" @click="emit('close')" /></transition>
    <transition name="slide">
      <aside v-if="open" ref="sheet" class="side-panel side-panel--overlay" :style="sheetStyle">
        <div class="side-panel__grip" @pointerdown="grab" @pointermove="drag" @pointerup="drop" @pointercancel="drop"><span /></div>
        <div class="side-panel__scroll"><slot /></div>
      </aside>
    </transition>
  </template>
</template>

<style scoped>
.side-panel { width: var(--aside-w); background: var(--surface); display: flex; flex-direction: column; min-height: 0; }
.side-panel--docked {
  position: absolute; top: calc(var(--safe-top) + var(--panel-gap)); right: calc(var(--safe-right) + var(--panel-gap)); bottom: calc(var(--safe-bottom) + var(--panel-gap)); z-index: 3;
  border-radius: 20px; border: 1px solid var(--line); box-shadow: var(--shadow); overflow: hidden;   /* the scrollbar follows the rounding */
  background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
}
.side-panel--docked .side-panel__scroll { --panel-pad-top: 20px; }
/* The content fades out at the bottom rather than being cut by the edge: the mask melts the last 36
   pixels (scrollbar included). At the top, it is the sticky header that carries its own fade
   (`.panel-head`, styles/app.css) — a mask at the top would make it disappear too. */
.side-panel__scroll { mask-image: linear-gradient(to bottom, #000 calc(100% - 36px), transparent); -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 36px), transparent); }
/* thin bar, without arrows (they stuck out of the rounding), only seen on hover */
.side-panel__scroll::-webkit-scrollbar { width: 6px; }
.side-panel__scroll::-webkit-scrollbar-button { display: none; height: 0; }
.side-panel__scroll::-webkit-scrollbar-track { background: transparent; }
.side-panel__scroll::-webkit-scrollbar-thumb { background: var(--line); border-radius: 999px; }
.side-panel__scroll { scrollbar-width: thin; scrollbar-color: transparent transparent; }
.side-panel__scroll:hover { scrollbar-color: var(--line) transparent; }
.side-panel--overlay { position: absolute; top: 0; right: 0; bottom: 0; z-index: 30; border-left: 1px solid var(--line); box-shadow: var(--shadow); max-width: 92vw; padding-top: var(--safe-top); }
.side-panel__scrim { position: absolute; inset: 0; z-index: 29; background: rgba(0, 0, 0, .25); }
/* the handle only exists on the phone's sheet */
.side-panel__grip { display: none; }
/* flex column (not grid): a child can pin itself to the BOTTOM with margin-top: auto, like the
   "Location" section of the device panel; the children stretch in width as before */
/* `overflow-x: hidden`: safeguard. Each content takes care of fitting in the width (ellipsis,
   MarqueeText, cutting an id); if one of them forgets, it is clipped here rather than
   leaving the panel and passing over the 3D view. */
/* `--panel-pad-top`: the content's top margin, which the sticky header (`.panel-head`) takes back to
   cover it and pin itself there (see styles/app.css) — a single value, declared here, read there. */
.side-panel__scroll { --panel-pad-top: calc(var(--safe-top) + 20px); flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: var(--panel-pad-top) 22px calc(var(--safe-bottom) + 36px); display: flex; flex-direction: column; gap: 20px; position: relative; isolation: isolate; }
.side-panel--overlay .side-panel__scroll { padding-top: 20px; }
.slide-enter-active, .slide-leave-active { transition: transform .22s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
/* Phone in portrait: a sheet that rises from the bottom, the scene stays visible above. */
@media (max-width: 599px) {
  .side-panel--overlay {
    top: auto; left: 0; width: auto; max-width: none; height: 64dvh; padding-top: 0;
    border-left: 0; border-top: 1px solid var(--line); border-radius: 20px 20px 0 0; overflow: hidden;
  }
  .side-panel--overlay .side-panel__scroll { padding-inline: var(--page-x); padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 36px); }
  .slide-enter-from, .slide-leave-to { transform: translateY(100%); }
  /* released, the sheet goes back up (or down) at the same pace as its opening */
  .side-panel--overlay { transition: transform .22s ease; }
  /* The handle: a 28 px band placed on the content's top margin, which takes it (the
     content goes down by 8 px). Only it slides: the rest of the sheet scrolls. */
  .side-panel__grip {
    display: grid; place-items: center; position: absolute; top: 0; left: 0; right: 0; z-index: 3;
    height: 28px; touch-action: none; cursor: grab;
  }
  .side-panel__grip > span { width: 40px; height: 4px; border-radius: 999px; background: color-mix(in srgb, var(--text) 28%, transparent); }
  .side-panel--overlay .side-panel__scroll { --panel-pad-top: 28px; padding-top: 28px; }
}
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
