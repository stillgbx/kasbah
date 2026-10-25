<script setup lang="ts">
import { computed, nextTick, ref, watch, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { pluginSettingsOf } from '@kasbah/shared'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { useHouseStore } from '../../stores/house'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { NAV_ITEMS, orderNavItems, visibleNavItems } from '../../lib/navItems'
import { useLocalPluginsStore } from '../../stores/localPlugins'
import { useSettingsStore } from '../../stores/settings'
import { useAlertsStore } from '../../stores/alerts'
import { usePropertiesStore } from '../../stores/properties'
import PropertyList from './PropertyList.vue'

// Navigation rail (72 px): the house's initials, views, then the settings at the very bottom. On a
// phone, it SCROLLS: tightened on the left in landscape, as a horizontal bar at the bottom in portrait.
const route = useRoute()
/** Rail entry to light up: a sub-page (editing an automation) names its view in `meta.nav`. */
const current = computed(() => (route.meta.nav as string | undefined) ?? route.name)
const house = useHouseStore()
// Several properties (demo mode): the initials block becomes the selector, at the same size.
const properties = usePropertiesStore()

const initials = computed(() => {
  const words = (house.house?.name ?? 'Kasbah').split(/\s+/).filter((w) => w.length > 2 || /^[A-Z0-9]/.test(w))
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'K'
})
// Settings stay in NAV_ITEMS — the House view's search uses it to open the
// page — but they leave the views queue: their place is at the bottom of the rail, under the spacer.
const localPlugins = useLocalPluginsStore()
// a feature turned off in Settings (the shopping list) leaves the rail; before the house
// arrives, its default applies (on): no entry popping up at load
const pluginOn = (id: string) => pluginSettingsOf(house.house?.plugins ?? {}, id).enabled
// in the order chosen on this device (Settings → Navigation bar)
const settings = useSettingsStore()
const items = computed(() => orderNavItems(visibleNavItems(localPlugins.isEnabled, pluginOn), settings.navOrder).filter((it) => it.name !== 'settings'))
const settingsItem = NAV_ITEMS.find((it) => it.name === 'settings')!

// A pill on the icon of a view that has a pending alert. Being on the view is enough to see its
// information alerts, including those that arrive while looking at it.
const alerts = useAlertsStore()
watchEffect(() => { if (typeof current.value === 'string') alerts.markViewSeen(current.value) })

// The current view stays in view in the scrolling queue: arrived through search on "Settings",
// we see its button lit instead of a bar that still shows the start. Scrolling of the rail only
// (not `scrollIntoView`, which would also scroll the shell, `overflow: hidden` or not).
const scroller = ref<HTMLElement | null>(null)
watch(current, () => void nextTick(() => {
  const box = scroller.value
  const btn = box?.querySelector<HTMLElement>('.rail__btn[data-on="1"]')
  if (!box || !btn) return
  const horizontal = box.scrollWidth > box.clientWidth
  const [start, size, view, pos] = horizontal
    ? [btn.offsetLeft, btn.offsetWidth, box.clientWidth, box.scrollLeft]
    : [btn.offsetTop, btn.offsetHeight, box.clientHeight, box.scrollTop]
  const PAD = 24
  let to = pos
  if (start - PAD < pos) to = start - PAD
  else if (start + size + PAD > pos + view) to = start + size + PAD - view
  if (to !== pos) box.scrollTo({ [horizontal ? 'left' : 'top']: to, behavior: 'smooth' })
}), { immediate: true })

// Bottom bar (portrait): other views waiting on one side? That side fades out, and a chevron
// sits on it, which scrolls by a good part of the width. The fixed fade at both ends did not say
// that there was more. Nothing vertically: the vertical rail (landscape, desktop) does not overflow in
// width, both sides stay off there.
const more = ref({ start: false, end: false })
const moreStart = ref<HTMLButtonElement | null>(null)
const moreEnd = ref<HTMLButtonElement | null>(null)
function measure() {
  const box = scroller.value
  if (!box) return
  more.value = { start: box.scrollLeft > 2, end: box.scrollLeft + box.clientWidth < box.scrollWidth - 2 }
  // with the keyboard, the chevron that turns off at the end of the queue passes the focus to the other
  const focused = document.activeElement
  if (focused === moreStart.value && !more.value.start) moreEnd.value?.focus()
  else if (focused === moreEnd.value && !more.value.end) moreStart.value?.focus()
}
useEventListener(scroller, 'scroll', measure, { passive: true })
useResizeObserver(scroller, measure)
watch(items, () => void nextTick(measure))

function page(dir: 1 | -1) {
  const box = scroller.value
  box?.scrollBy({ left: dir * box.clientWidth * 0.7, behavior: 'smooth' })
}
</script>

<template>
  <nav class="rail" :aria-label="$t('nav.main')" :data-more-start="more.start ? '1' : '0'" :data-more-end="more.end ? '1' : '0'">
    <div ref="scroller" class="rail__scroll">
      <v-menu v-if="properties.hasMenu" location="end top" :offset="10">
        <template #activator="{ props: menu }">
          <button v-bind="menu" type="button" class="rail__avatar rail__avatar--btn" :title="house.house?.name"
                  :aria-label="$t('properties.switch', { name: house.house?.name ?? '' })">{{ initials }}</button>
        </template>
        <div class="card rail__props">
          <div class="section-label rail__props-title">{{ $t('properties.title') }}</div>
          <PropertyList />
        </div>
      </v-menu>
      <div v-else class="rail__avatar" :title="house.house?.name">{{ initials }}</div>
      <router-link v-for="it in items" :key="it.name" v-slot="{ navigate }" :to="{ name: it.name }" custom>
        <button type="button" class="rail__btn" :data-on="current === it.name ? '1' : '0'" :title="$t(it.label)"
                :aria-label="alerts.viewSeverity(it.name) ? $t('alerts.pending', { view: $t(it.label) }) : $t(it.label)" @click="navigate">
          <StrokeIcon :name="it.icon" :size="24" />
          <span v-if="alerts.viewSeverity(it.name)" class="rail__badge" :data-severity="alerts.viewSeverity(it.name)" />
        </button>
      </router-link>
      <div class="rail__spacer" />
      <router-link v-slot="{ navigate }" :to="{ name: settingsItem.name }" custom>
        <button type="button" class="rail__btn" :data-on="current === settingsItem.name ? '1' : '0'" :title="$t(settingsItem.label)"
                :aria-label="alerts.viewSeverity(settingsItem.name) ? $t('alerts.pending', { view: $t(settingsItem.label) }) : $t(settingsItem.label)" @click="navigate">
          <StrokeIcon :name="settingsItem.icon" :size="24" />
          <span v-if="alerts.viewSeverity(settingsItem.name)" class="rail__badge" :data-severity="alerts.viewSeverity(settingsItem.name)" />
        </button>
      </router-link>
    </div>
    <!-- outside the scrolling queue (and its mask): placed on its ends, they shift nothing.
         `inert` and not `aria-hidden`: the touched chevron that disappears at the end of the queue kept the
         focus under an `aria-hidden` (refused by Chrome). By finger and mouse it does not take
         the focus (`mousedown.prevent`); by keyboard, `measure` passes it to the other chevron. -->
    <button ref="moreStart" type="button" class="rail__more rail__more--start" :inert="!more.start"
            :aria-label="$t('nav.scrollStart')" @mousedown.prevent @click="page(-1)"><span class="rail__morechip"><StrokeIcon name="back" :size="16" /></span></button>
    <button ref="moreEnd" type="button" class="rail__more rail__more--end" :inert="!more.end"
            :aria-label="$t('nav.scrollEnd')" @mousedown.prevent @click="page(1)"><span class="rail__morechip"><StrokeIcon name="chevron" :size="16" /></span></button>
  </nav>
</template>

<style scoped>
/* Laid over the view, with no background or border: the House view's 3D scene passes underneath. */
.rail { position: absolute; top: 0; left: 0; bottom: 0; width: var(--rail-w); z-index: 5; display: flex; }
/* The buttons queue, in its own container: it is THIS that scrolls when the window is too
   low, and the veil (the rail's `::before`) stays wider than it, without being clipped. */
.rail__scroll {
  flex: 1 1 auto; min-width: 0; min-height: 0;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: calc(var(--safe-top) + 18px) 0 calc(var(--safe-bottom) + 14px) var(--safe-left);
  overflow: auto; overscroll-behavior: contain; scrollbar-width: none;
}
.rail__scroll::-webkit-scrollbar { display: none; }
/* The buttons SQUEEZE before scrolling (down to 28 px, barely more than the icon): a slightly
   low desktop window keeps the whole rail in view, as before; scrolling only comes beyond that,
   and on a phone, where the buttons keep their size. */
.rail__avatar { flex: none; }
.rail__btn { flex: 0 1 auto; min-height: 28px; }
/* A veil from the background to transparent, wider than the rail: the icons read over the
   walls and pills of the scene, without an edge cutting the view. On the other views, it has the
   color of their background and is not seen. Behind the buttons (z-index -1 in the rail), above
   the scene. */
.rail::before {
  content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: calc(var(--rail-w) + 150px); z-index: -1; pointer-events: none;
  /* discreet and wide: a darkening that spreads, not a bar — we stay immersed. The ramp
     is softened (opacity 0.8 → 0 by a curve whose slope vanishes at the end): a
     LINEAR ramp leaves a kink in the slope where it reaches zero, and the eye reads it as a
     vertical line on the scene's flat areas. The steps follow a = .8 (1-t)² (1 + .345 t). */
  background: linear-gradient(to right,
    color-mix(in srgb, var(--bg) 80%, transparent) 0,
    color-mix(in srgb, var(--bg) 67%, transparent) 10%,
    color-mix(in srgb, var(--bg) 55%, transparent) 20%,
    color-mix(in srgb, var(--bg) 43%, transparent) 30%,
    color-mix(in srgb, var(--bg) 33%, transparent) 40%,
    color-mix(in srgb, var(--bg) 23%, transparent) 50%,
    color-mix(in srgb, var(--bg) 15%, transparent) 60%,
    color-mix(in srgb, var(--bg) 9%, transparent) 70%,
    color-mix(in srgb, var(--bg) 4%, transparent) 80%,
    color-mix(in srgb, var(--bg) 1%, transparent) 90%,
    transparent 100%);
}
.rail__avatar {
  width: 38px; height: 38px; border-radius: 12px; background: var(--accent); color: var(--on-accent);
  display: grid; place-items: center; font-weight: 700; font-size: 15px; margin-bottom: 14px;
}
.rail__avatar--btn { border: 0; padding: 0; font: inherit; font-weight: 700; font-size: 15px; cursor: pointer; }
.rail__avatar--btn:hover { filter: brightness(1.08); }
.rail__props { padding: 8px; min-width: 260px; max-width: min(320px, 85vw); }
.rail__props-title { padding: 2px 10px 6px; }
.rail__btn {
  width: 52px; height: 52px; border-radius: 16px; border: 0; background: transparent; color: var(--muted);
  display: grid; place-items: center; transition: background .15s, color .15s;
}
.rail__btn:hover { color: var(--text); background: color-mix(in srgb, var(--surface) 55%, transparent); }
.rail__btn[data-on='1'] { background: var(--accent-soft); color: var(--accent); }
/* placed on the icon's corner, out of the flow: nothing moves when it appears. A background rim
   sets it apart from the icon's stroke. */
.rail__btn { position: relative; }
.rail__badge {
  position: absolute; top: 9px; right: 9px; width: 9px; height: 9px; border-radius: 50%; pointer-events: none;
  background: var(--accent); box-shadow: 0 0 0 2px var(--bg);
}
.rail__badge[data-severity='problem'] { background: rgb(var(--v-theme-warning)); }
.rail__badge[data-severity='critical'] { background: rgb(var(--v-theme-error)); }
.rail__spacer { flex: 1 1 0; }

/* Phone in landscape: 44 px buttons, and the queue scrolls with a fade at both ends. */
@media (min-width: 600px) and (max-height: 500px) {
  .rail__scroll {
    gap: 4px; padding-top: calc(var(--safe-top) + 10px); padding-bottom: calc(var(--safe-bottom) + 10px);
    mask-image: linear-gradient(to bottom, transparent, #000 14px, #000 calc(100% - 14px), transparent);
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 14px, #000 calc(100% - 14px), transparent);
  }
  .rail__avatar { width: 32px; height: 32px; border-radius: 10px; font-size: 13px; margin-bottom: 6px; }
  .rail__btn { flex: none; width: 44px; height: 44px; border-radius: 14px; }
  .rail__spacer { flex: 0 0 4px; }
}

/* the chevrons only exist on the bottom bar */
.rail__more { display: none; }

/* Phone in portrait: a bar at the bottom, which scrolls sideways; the settings close the queue.
   The veil rises from the bottom instead of coming from the left. The buttons sit 14 px above the edge
   (notch included): away from the system gestures zone. The side that has more fades over
   44 px, and its chevron sits there; the other end stays crisp. */
@media (max-width: 599px) {
  .rail { top: auto; right: 0; width: auto; height: var(--dock-h); }
  .rail::before { top: auto; bottom: 0; right: 0; width: auto; height: calc(var(--dock-h) + 48px); }
  .rail::before { background: linear-gradient(to top,
    color-mix(in srgb, var(--bg) 92%, transparent) 0,
    color-mix(in srgb, var(--bg) 80%, transparent) 55%,
    color-mix(in srgb, var(--bg) 30%, transparent) 80%,
    transparent 100%); }
  .rail { --fade-start: 0px; --fade-end: 0px; }
  .rail[data-more-start='1'] { --fade-start: 44px; }
  .rail[data-more-end='1'] { --fade-end: 44px; }
  .rail__scroll {
    flex-direction: row; gap: 2px;
    padding: 0 calc(var(--safe-right) + 10px) calc(var(--safe-bottom) + 14px) calc(var(--safe-left) + 10px);
    mask-image: linear-gradient(to right, transparent, #000 var(--fade-start), #000 calc(100% - var(--fade-end)), transparent);
    -webkit-mask-image: linear-gradient(to right, transparent, #000 var(--fade-start), #000 calc(100% - var(--fade-end)), transparent);
  }
  .rail__avatar { display: none; }
  .rail__btn { flex: none; width: 52px; height: 52px; border-radius: 16px; }
  .rail__spacer { flex: 0 0 6px; }
  .rail__more {
    /* same band as the queue (above its 14 px of bottom) and centered in it, like the buttons */
    display: grid; place-items: center; position: absolute; top: 0; bottom: calc(var(--safe-bottom) + 14px); width: 32px;
    border: 0; padding: 0; background: transparent; color: var(--text); opacity: 0; pointer-events: none; transition: opacity .2s;
  }
  .rail__more--start { left: var(--safe-left); }
  .rail__more--end { right: var(--safe-right); }
  .rail[data-more-start='1'] .rail__more--start, .rail[data-more-end='1'] .rail__more--end { opacity: 1; pointer-events: auto; }
  /* a pill of the app's glass: the chevron reads over the half-faded icon it covers */
  .rail__morechip {
    width: 26px; height: 26px; border-radius: 999px; display: grid; place-items: center;
    border: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 92%, transparent); box-shadow: var(--shadow);
  }
}
</style>
