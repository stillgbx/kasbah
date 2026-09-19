<script setup lang="ts">
import { computed } from 'vue'
import { openingLabel } from '@kasbah/shared'
import { useI18n } from 'vue-i18n'
import { useHouseStore } from '../../stores/house'
import ParkingRows from './ParkingRows.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Panneau « maison » en MODE ÉDITION : ce qu'on modifie DE LA MAISON entière, à la place des tuiles
// et des pièces qu'on pilote le reste du temps. Même arbitrage que `RoomEditPanel` pour une pièce —
// le mode est armé dans Réglages, donc le geste est déjà décidé : on relève la maison, on ne
// l'allume pas.
//
// Deux matières ici : les places de stationnement (visibles sans défiler), et les fenêtres de toit —
// elles n'appartiennent à aucun mur, et l'onglet Toit n'ouvre aucune pièce : sans cette section,
// on ne pouvait pas les poser depuis la vue où le toit est visible.
const house = useHouseStore()
const { t } = useI18n()
const parkings = computed(() => house.parkings)

const roofWindows = computed(() => {
  const list: { id: string; label: string; sub: string }[] = []
  for (const r of house.house?.rooms ?? []) {
    for (const o of r.openings) {
      if (o.type !== 'roof-window') continue
      list.push({
        id: o.id,
        label: openingLabel(o),
        sub: `${t('opening.types.roof-window')} · ${o.height.toFixed(2)} × ${o.width.toFixed(2)} m`,
      })
    }
  }
  return list
})

const armedRoof = computed(() => house.placingOpening?.type === 'roof-window')

function selectRoof(id: string) { house.selectOpening(id) }
function startRoof() { house.startPlacingOpening('roof-window') }
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

  <section class="block">
    <div class="section-label">{{ $t('opening.roofList') }}</div>
    <div v-if="roofWindows.length" class="rows">
      <button v-for="o in roofWindows" :key="o.id" type="button" class="op-row" @click="selectRoof(o.id)">
        <span class="icon-square"><StrokeIcon name="room" :size="18" /></span>
        <div class="op-row__main">
          <div class="op-row__name">{{ o.label }}</div>
          <div class="muted op-row__sub">{{ o.sub }}</div>
        </div>
        <StrokeIcon name="chevron" :size="18" class="muted" />
      </button>
    </div>
    <p v-else class="muted empty">{{ $t('opening.roofNone') }}</p>

    <button
      v-if="!armedRoof"
      type="button"
      class="pill add"
      :disabled="house.savingOpening"
      @click="startRoof()"
    >
      <StrokeIcon name="plus" :size="16" /> {{ $t('opening.addRoof') }}
    </button>
    <button v-else type="button" class="pill add add--armed" @click="house.cancelPlacingOpening()">
      {{ $t('opening.cancel') }}
    </button>
    <p class="muted hint">{{ armedRoof ? $t('opening.placeHintRoof') : $t('opening.roofHint') }}</p>
  </section>

  <ParkingRows :list="parkings" />

  <p class="muted hint">{{ $t('parking.roomHint') }}</p>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 12px; }
.min0 { flex: 1 1 0; min-width: 0; }
.title { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
.sub { font-size: 13px; margin-top: 2px; }
.hint { font-size: 12px; margin: 0; min-height: 32px; }
.block { display: grid; gap: 8px; margin-bottom: 16px; }
.rows { display: grid; gap: 8px; }
.op-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius);
  background: var(--surface2); border: 0; width: 100%; text-align: left; font: inherit; color: inherit;
  cursor: pointer; transition: filter .15s;
}
.op-row:hover { filter: brightness(1.03); }
.op-row__main { flex: 1 1 0; min-width: 0; }
.op-row__name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.op-row__sub { font-size: 12px; font-variant-numeric: tabular-nums; }
.empty { font-size: 13px; margin: 0; }
.add { width: 100%; justify-content: center; gap: 8px; }
.add--armed { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
</style>
