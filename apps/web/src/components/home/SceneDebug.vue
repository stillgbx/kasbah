<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import Stats from 'three/addons/libs/stats.module.js'
import type { HouseScene, SceneDebugStats } from '../../three/HouseScene'

// Debug overlay of the 3D rendering (Settings → 3D rendering → Debug). Two tiers:
//
//  - the `stats.js` graphs (FPS, ms, memory) — three's own, as they are. They are
//    wired as a PROBE around each rendered frame (`HouseScene.setProbe`) and not on a separate
//    loop: rendering is on demand, an independent loop would count frames that do not
//    exist. The three panels are shown together rather than one at a time on click;
//  - a numeric readout that the scene already keeps while it draws, reread twice a second.
//    A panel that redraws on every frame would skew what it claims to measure.
//
// What you need to know how to read:
//  - "img/s" (and the FPS graph) at 0 at rest is NORMAL: rendering is on demand
//    (`three/core/renderLoop.ts`). The figure that matters is read while orbiting the house.
//  - "hors rendu" is what separates two frames WITHOUT having gone through drawing: style, layout,
//    paint, compositing, presentation. If it swells while orbiting whereas "rendu" stays
//    stable, the delay does not come from our drawing — that is where to look.
//  - "rendu" is the time spent INSIDE `render()`. It is not pure CPU: when the GPU's command
//    queue is full, the driver blocks on submission and that wait shows up there. To be read
//    with "img/s": at 60 Hz, a frame that exceeds 16.7 ms mechanically falls to 30 — in other
//    words, between 28 and 30 frames per second, only two or three milliseconds are often missing.
//  - "appels" and "triangles" are FRAME totals, all renders included.
//  - "animations": as long as there is one (a player's wave, a battery's breath), the
//    loop runs WITHOUT anyone touching anything. It is then throttled to 20 frames per second: the
//    "img/s" at rest is therefore neither 0 nor 60, and that is intended.
//  - "ombres ✓" means the shadow map has just been redone. During an orbit, it must
//    stay at ✗: nothing that casts a shadow has moved.

const props = defineProps<{ scene: () => HouseScene | null }>()

const stats = ref<SceneDebugStats | null>(null)
const graphs = useTemplateRef<HTMLDivElement>('graphs')
let timer: ReturnType<typeof setInterval> | null = null
let probe: InstanceType<typeof Stats> | null = null
let attached = false

onMounted(() => {
  // `stats.module.js` is a factory that returns its object; `new` satisfies it as well as its bare call,
  // and it is the form its types declare.
  probe = new Stats()
  probe.dom.style.cssText = 'position:static;display:flex;gap:2px;cursor:default'
  for (const child of probe.dom.children) (child as HTMLElement).style.display = 'block'
  graphs.value?.append(probe.dom)
  // The probe is attached at the FIRST readout where the scene exists, not at mount: Vue mounts the children
  // before running the parent's `onMounted`, and that is where `useHouseScene` builds the scene.
  // Attached at mount, it was attached to `null` — the graphs stayed frozen while the
  // figures, for their part, updated (they reread the scene each time).
  timer = setInterval(() => {
    const scene = props.scene()
    if (scene && !attached) { scene.setProbe(probe); attached = true }
    stats.value = scene?.debugStats() ?? null
    moving.value = labels.value ? countMoving() : 0
  }, 500)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  if (attached) props.scene()?.setProbe(null)
  probe?.dom.remove()
})

const n = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : String(v))

// The pills switch off on a click: their cost is paid partly outside `render()`, in style
// and the compositor, where no counter goes. Cutting them and watching "img/s" is the only way
// to quantify it — on the machine that has the problem, not on another one.
const labels = ref(true)
function toggleLabels() { labels.value = !labels.value; props.scene()?.setLabelsVisible(labels.value) }

// How many labels actually MOVE. It is not the number of devices: the `CSS2DRenderer`
// skips the hidden ones (unfocused level, out of view) and only touches the style of the
// others. It is that number, not the total, that decides the cost.
const moving = ref(0)
function countMoving(): number {
  const layer = document.querySelector('.scene-labels')
  if (!layer) return 0
  let n = 0
  for (const el of layer.children) if ((el as HTMLElement).style.display !== 'none') n++
  return n
}
</script>

<template>
  <div class="dbg" aria-hidden="true">
    <div ref="graphs" class="dbg__graphs" />
    <template v-if="stats">
      <div class="dbg__row"><span>img/s</span><b>{{ stats.fps }}</b></div>
      <div class="dbg__row"><span>rendu</span><b>{{ stats.cpuMs }} ms</b></div>
      <div class="dbg__row"><span>hors rendu</span><b>{{ stats.outsideMs }} ms</b></div>
      <div class="dbg__row"><span>appels</span><b>{{ n(stats.calls) }}</b></div>
      <div class="dbg__row"><span>triangles</span><b>{{ n(stats.triangles) }}</b></div>
      <div class="dbg__row"><span>animations</span><b>{{ stats.animations }}</b></div>
      <div class="dbg__row"><span>ombres</span><b>{{ stats.shadowsRebuilt ? '✓' : '✗' }} · {{ stats.pointShadows }} pt</b></div>
      <button type="button" class="dbg__row dbg__row--tap" title="Couper les étiquettes des appareils, pour mesurer ce qu’elles coûtent" @click="toggleLabels">
        <span>pilules ⏻</span><b :data-on="labels ? '1' : '0'">{{ labels ? 'on' : 'off' }} · {{ moving }}/{{ stats.markers }}</b>
      </button>
      <div class="dbg__row"><span>qualité</span><b>{{ stats.quality }} · ×{{ stats.pixelRatio }}</b></div>
      <div class="dbg__row dbg__row--dim"><span>mémoire</span><b>{{ stats.geometries }}g · {{ stats.textures }}t · {{ stats.programs }}p</b></div>
    </template>
  </div>
</template>

<style scoped>
.dbg {
  /* above the weather widget, which holds the bottom left corner (`HomeView.vue`) */
  position: absolute; left: calc(var(--rail-w) + 12px); bottom: calc(var(--safe-bottom) + var(--panel-gap) + 148px); z-index: 3;
  display: grid; gap: 1px; padding: 8px 10px; border-radius: var(--radius-sm);
  /* Opaque and without backdrop filter: a measuring instrument must cost nothing to what it measures. */
  background: var(--surface); border: 1px solid var(--line);
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text);
  pointer-events: none; min-width: 168px;
}
.dbg__graphs { margin-bottom: 6px; }
.dbg__row { display: flex; justify-content: space-between; gap: 12px; }
.dbg__row span { color: var(--muted); }
.dbg__row--dim { opacity: .7; }
/* the only clickable row: cut the pills to quantify what they cost outside rendering */
.dbg__row--tap {
  pointer-events: auto; cursor: pointer; border: 0; padding: 2px 4px; margin: 2px -4px;
  color: inherit; font: inherit; width: calc(100% + 8px); border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.dbg__row--tap:hover { background: color-mix(in srgb, var(--accent) 24%, transparent); }
.dbg__row--tap span { color: var(--text); }
.dbg__row--tap b[data-on='0'] { color: var(--accent); }
</style>
