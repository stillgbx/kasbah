<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useDevicesStore } from './stores/devices'
import { useHouseStore } from './stores/house'
import { useNotificationsStore } from './stores/notifications'
import ConnectionBanner from './components/ConnectionBanner.vue'
import NavRail from './components/layout/NavRail.vue'

// Coquille : rail de navigation à gauche, vue courante à droite. Charge la maison et ouvre le push.
const house = useHouseStore()
const devices = useDevicesStore()
const notifications = useNotificationsStore()

onMounted(() => { void house.load(); devices.start() })
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
    <v-snackbar-queue
      :model-value="notifications.queue.map((n) => ({ text: n.text, color: n.color, timeout: n.timeout }))"
      location="bottom" closable :close-text="$t('common.close')"
      @update:model-value="(v: unknown[]) => { if (v.length < notifications.queue.length) notifications.dismiss(notifications.queue[0]!.id) }"
    />
  </v-app>
</template>

<style>
.app-shell .v-application__wrap { display: grid !important; grid-template-columns: var(--rail-w) 1fr; height: 100dvh; overflow: hidden; }
.app-main { position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--bg); }
</style>
