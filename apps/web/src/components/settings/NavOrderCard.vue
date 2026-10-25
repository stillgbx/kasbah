<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { pluginSettingsOf } from '@kasbah/shared'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { FIXED_NAV, NAV_ITEMS, orderNavItems, visibleNavItems, type NavItem } from '../../lib/navItems'
import { useHouseStore } from '../../stores/house'
import { useLocalPluginsStore } from '../../stores/localPlugins'
import { useSettingsStore } from '../../stores/settings'

// The rail's order on THIS device (localStorage): the views are dragged by their handle, House and
// Settings keep their place. Only the views the rail shows are listed; a hidden one (a local plugin
// turned off, a feature turned off in the house) keeps its place in the saved order, ready for its return.
const settings = useSettingsStore()
const house = useHouseStore()
const localPlugins = useLocalPluginsStore()
const pluginOn = (id: string) => pluginSettingsOf(house.house?.plugins ?? {}, id).enabled
const movable = (items: NavItem[]) => orderNavItems(items, settings.navOrder).filter((it) => !FIXED_NAV.includes(it.name))
const shown = computed(() => movable(visibleNavItems(localPlugins.isEnabled, pluginOn)))
const isDefault = computed(() => movable(NAV_ITEMS).map((it) => it.name).join() === NAV_ITEMS.map((it) => it.name).filter((n) => !FIXED_NAV.includes(n)).join())

// Same gesture as the automations list: the list reorders under the finger, the order is saved
// on release. Only the listed views swap their places: the hidden ones keep theirs.
const drag = ref<{ name: string; names: string[]; from: string[] } | null>(null)
const rows = computed(() => {
  const names = drag.value?.names
  return names ? [...shown.value].sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name)) : shown.value
})

function startDrag(ev: PointerEvent, name: string) {
  ev.preventDefault()
  const names = shown.value.map((it) => it.name)
  drag.value = { name, names, from: names }
  // on the WINDOW: Vue moves the row (hence the handle) on each swap, which releases the capture
  window.addEventListener('pointermove', moveDrag)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
}
function moveDrag(ev: PointerEvent) {
  const d = drag.value
  if (!d) return
  const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-nav]')?.dataset.nav
  const from = d.names.indexOf(d.name)
  const to = over ? d.names.indexOf(over) : -1
  if (to < 0 || to === from) return
  const names = [...d.names]
  names.splice(from, 1)
  names.splice(to, 0, d.name)
  drag.value = { ...d, names }
}
function endDrag() {
  window.removeEventListener('pointermove', moveDrag)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
  const d = drag.value
  drag.value = null
  if (!d || d.names.join() === d.from.join()) return
  const moved = new Set(d.names)
  let k = 0
  settings.setNavOrder(movable(NAV_ITEMS).map((it) => (moved.has(it.name) ? d.names[k++]! : it.name)))
}
onBeforeUnmount(endDrag)   // leaving the view mid-drag must not leave listeners behind
</script>

<template>
  <div class="nav-order">
    <div v-for="it in rows" :key="it.name" class="nav-order__row" :data-nav="it.name" :data-dragged="drag?.name === it.name ? '1' : '0'">
      <button type="button" class="nav-order__grip" :title="$t('settings.navOrderMove')" :aria-label="$t('settings.navOrderMove')"
              @pointerdown="startDrag($event, it.name)">
        <StrokeIcon name="grip" :size="16" />
      </button>
      <StrokeIcon :name="it.icon" :size="20" class="nav-order__icon" />
      <span class="nav-order__label">{{ $t(it.label) }}</span>
    </div>
  </div>
  <!-- always there, greyed out on the default order: nothing shifts when the order changes -->
  <button type="button" class="pill nav-order__reset" :disabled="isDefault" @click="settings.setNavOrder([])">{{ $t('settings.navOrderReset') }}</button>
</template>

<style scoped>
.nav-order { display: grid; gap: 2px; }
.nav-order__row { display: flex; align-items: center; gap: 10px; min-height: 40px; padding-right: 8px; border-radius: 10px; }
.nav-order__row[data-dragged='1'] { outline: 2px solid var(--accent); opacity: .65; }
.nav-order__grip {
  flex: none; width: 32px; height: 32px; display: grid; place-items: center;
  border: 0; background: none; color: var(--muted); border-radius: 8px; cursor: grab; touch-action: none;
}
.nav-order__grip:hover { background: var(--accent-soft); color: var(--accent); }
.nav-order__grip:active { cursor: grabbing; }
.nav-order__icon { flex: none; color: var(--muted); }
.nav-order__label { min-width: 0; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-order__reset { justify-self: start; height: 32px; padding: 0 12px; font-size: 13px; }
</style>
