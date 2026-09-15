<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useDevicesStore } from './stores/devices'
import { useHouseStore } from './stores/house'
import { useNotificationsStore } from './stores/notifications'
import ConnectionBanner from './components/ConnectionBanner.vue'
import NavRail from './components/layout/NavRail.vue'

// Coquille : rail de navigation à gauche, POSÉ sur la vue courante (il n'a ni fond ni bord : la vue
// Maison étend sa scène 3D dessous, les autres vues se décalent de sa largeur). Charge la maison et
// ouvre le push.
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
.app-shell .v-application__wrap { position: relative; height: 100dvh; overflow: hidden; }
.app-main { position: relative; height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; padding-left: var(--rail-w); background: var(--bg); }
</style>
