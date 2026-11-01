<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { navAllowed, navItemOf } from './lib/navItems'
import { useDevicesStore } from './stores/devices'
import { useHouseStore } from './stores/house'
import { useNotificationsStore } from './stores/notifications'
import { usePropertiesStore } from './stores/properties'
import { useSessionStore } from './stores/session'
import AppUpdateBanner from './components/AppUpdateBanner.vue'
import ConnectionBanner from './components/ConnectionBanner.vue'
import NavRail from './components/layout/NavRail.vue'
import SearchPalette from './components/layout/SearchPalette.vue'
import NewPropertyDialog from './components/property/NewPropertyDialog.vue'
import NoRightView from './views/NoRightView.vue'

// Shell: navigation rail on the left (bar at the bottom on a portrait phone), LAID OVER the current view (it has no background or border: the
// House view extends its 3D scene underneath, the other views shift by its width). Loads the house and
// opens the push.
const house = useHouseStore()
const devices = useDevicesStore()
const notifications = useNotificationsStore()
const properties = usePropertiesStore()
const session = useSessionStore()
/** A view the account may not use, opened by its address: a page that says so takes its place. */
function forbidden(r: RouteLocationNormalizedLoaded) {
  const item = navItemOf(r)
  return !!item && !navAllowed(item, session.rights)
}

// the plugins' health is not pushed: read every minute, for the alerts of the rail (`stores/alerts`)
let healthTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void house.load(); void properties.load(); devices.start()
  void devices.refreshHealth()
  healthTimer = setInterval(() => void devices.refreshHealth(), 60_000)
})
onBeforeUnmount(() => { devices.stop(); clearInterval(healthTimer) })
</script>

<template>
  <v-app class="app-shell">
    <NavRail />
    <main class="app-main">
      <router-view v-slot="{ Component, route: r }">
        <keep-alive include="HomeView">
          <component :is="forbidden(r) ? NoRightView : Component" />
        </keep-alive>
      </router-view>
    </main>
    <ConnectionBanner />
    <AppUpdateBanner />
    <SearchPalette />
    <!-- "Create a property": opened from the rail selector or the Settings card -->
    <NewPropertyDialog />
    <v-snackbar-queue
      :model-value="notifications.queue.map((n) => ({ text: n.text, color: n.color, timeout: n.timeout }))"
      location="bottom" closable :close-text="$t('common.close')"
      @update:model-value="(v: unknown[]) => { if (v.length < notifications.queue.length) notifications.dismiss(notifications.queue[0]!.id) }"
    />
  </v-app>
</template>

<style>
.app-shell .v-application__wrap { position: relative; height: 100dvh; overflow: hidden; }
.app-main { position: relative; height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; padding-left: var(--rail-w); padding-bottom: var(--dock-h); background: var(--bg); }
/* In portrait, the bottom bar carries the bottom notch: views no longer need to reserve it. */
@media (max-width: 599px) { .app-main { --safe-bottom: 0px; } }
</style>
