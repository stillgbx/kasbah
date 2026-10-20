<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useDevicesStore } from './stores/devices'
import { useHouseStore } from './stores/house'
import { useNotificationsStore } from './stores/notifications'
import { usePropertiesStore } from './stores/properties'
import AppUpdateBanner from './components/AppUpdateBanner.vue'
import ConnectionBanner from './components/ConnectionBanner.vue'
import NavRail from './components/layout/NavRail.vue'
import SearchPalette from './components/layout/SearchPalette.vue'
import NewPropertyDialog from './components/property/NewPropertyDialog.vue'

// Shell: navigation rail on the left (bar at the bottom on a portrait phone), LAID OVER the current view (it has no background or border: the
// House view extends its 3D scene underneath, the other views shift by its width). Loads the house and
// opens the push.
const house = useHouseStore()
const devices = useDevicesStore()
const notifications = useNotificationsStore()
const properties = usePropertiesStore()

onMounted(() => { void house.load(); void properties.load(); devices.start() })
onBeforeUnmount(() => devices.stop())
</script>

<template>
  <v-app class="app-shell">
    <NavRail />
    <main class="app-main">
      <router-view v-slot="{ Component }">
        <keep-alive include="HomeView">
          <component :is="Component" />
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
