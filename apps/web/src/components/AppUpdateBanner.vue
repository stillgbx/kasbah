<script setup lang="ts">
import { computed } from 'vue'
import { useAppUpdateStore } from '../stores/appUpdate'
import { useDevicesStore } from '../stores/devices'

// Pastille en bas : une nouvelle version est servie. Pas en haut comme celle de la connexion : elle
// est cliquable et y masquerait le sélecteur d'étage tant qu'on ne recharge pas ; et au-dessus de la
// barre de recherche de l'accueil (16 px du bas, 44 de haut). Montrée seulement en ligne (recharger
// hors ligne ne mènerait nulle part). En superposition : rien ne bouge dessous.
const update = useAppUpdateStore()
const devices = useDevicesStore()
const visible = computed(() => update.available && devices.connection === 'online')
</script>

<template>
  <v-slide-y-reverse-transition>
    <div v-if="visible" class="update-banner bg-primary" role="status">
      <v-icon icon="rotateRight" size="18" class="mr-2" />
      <span class="update-banner__text">{{ $t('appUpdate.available') }}</span>
      <v-btn variant="tonal" size="small" class="ml-3" @click="update.reload()">{{ $t('appUpdate.reload') }}</v-btn>
    </div>
  </v-slide-y-reverse-transition>
</template>

<style scoped>
.update-banner {
  position: absolute; bottom: calc(max(var(--dock-h), var(--safe-bottom)) + 72px); left: 50%; transform: translateX(-50%);
  display: inline-flex; align-items: center; padding: 4px 6px 4px 14px; border-radius: 999px; white-space: nowrap;
  max-width: calc(100vw - 32px);
  font-size: 13px; font-weight: 500; z-index: 2000; box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
}
/* écran étroit ou zoomé : le texte s'abrège, le bouton reste entier */
.update-banner__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.update-banner :deep(.v-btn) { flex-shrink: 0; }
</style>
