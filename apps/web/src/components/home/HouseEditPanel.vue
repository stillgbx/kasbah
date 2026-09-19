<script setup lang="ts">
import { computed } from 'vue'
import { useHouseStore } from '../../stores/house'
import ParkingRows from './ParkingRows.vue'

// Panneau « maison » en MODE ÉDITION : ce qu'on modifie DE LA MAISON entière, à la place des tuiles
// et des pièces qu'on pilote le reste du temps. Même arbitrage que `RoomEditPanel` pour une pièce —
// le mode est armé dans Réglages, donc le geste est déjà décidé : on relève la maison, on ne
// l'allume pas.
//
// Une seule matière ici, les places de stationnement, et c'est justement pourquoi ce panneau existe :
// rangée en bas du panneau de la maison, sous les tuiles, les scènes et vingt pièces, la section
// n'était pas visible sans défiler — on ne pouvait pas deviner où ajouter une place.
//
// Les ouvertures, elles, restent dans le panneau de leur PIÈCE : elles appartiennent à un mur.
const house = useHouseStore()
const parkings = computed(() => house.parkings)
</script>

<template>
  <div class="panel-head">
    <div class="head">
      <div class="min0">
        <div class="title">{{ house.house?.name ?? $t('nav.home') }}</div>
        <div class="muted sub">{{ $t('parking.count', { n: parkings.length }, parkings.length) }}</div>
      </div>
    </div>
  </div>

  <ParkingRows :list="parkings" />

  <p class="muted hint">{{ $t('parking.roomHint') }}</p>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 12px; }
.min0 { flex: 1 1 0; min-width: 0; }
.title { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
.sub { font-size: 13px; margin-top: 2px; }
.hint { font-size: 12px; margin: 0; }
</style>
