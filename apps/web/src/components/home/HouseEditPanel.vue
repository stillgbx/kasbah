<script setup lang="ts">
import { computed, ref } from 'vue'
import { openingLabel } from '@kasbah/shared'
import { useI18n } from 'vue-i18n'
import { useHouseStore } from '../../stores/house'
import { useSettingsStore } from '../../stores/settings'
import ParkingRows from './ParkingRows.vue'
import GardenSection from './GardenSection.vue'
import EditSection from './EditSection.vue'
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
const settings = useSettingsStore()
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

/**
 * Le contour du terrain se règle dans l'éditeur du terrain, pas ici : ses poignées prendraient les
 * mêmes taps et glissements que le jardin et les places. On ferme donc ce qui est en cours, puis on
 * l'ouvre sur son onglet Contour ; « Terminer » y ramène au réglage de la maison.
 */
function openOutline() {
  if (house.placingOpening) house.cancelPlacingOpening()
  if (house.placingParking) house.cancelPlacingParking()
  if (house.placingGarden) house.cancelPlacingGarden()
  if (house.selectedParkingId) house.selectParking(null)
  if (house.selectedGardenId) house.selectGardenItem(null)
  if (house.selectedOpeningId) house.selectOpening(null)
  settings.setSceneTuningOpen(false)
  settings.setReliefEditing(true, 'outline')
}
function startRoof() { house.startPlacingOpening('roof-window') }

// Une section ouverte à la fois, retenue d'une visite à l'autre (confort de ce poste seulement).
type Section = 'roof' | 'parking' | 'garden'
const STORE_KEY = 'kasbah.houseEdit.section'
function remembered(): Section | null {
  try {
    const v = localStorage.getItem(STORE_KEY)
    return v === 'roof' || v === 'parking' || v === 'garden' ? v : null
  } catch { return null }
}
const open = ref<Section | null>(remembered())
/** Replier une section désarme la pose qu'elle a lancée : son « Annuler » / « Terminé » disparaît avec elle. */
function toggle(s: Section) {
  if (house.placingOpening) house.cancelPlacingOpening()
  if (house.placingParking) house.cancelPlacingParking()
  if (house.placingGarden) house.cancelPlacingGarden()
  open.value = open.value === s ? null : s
  try { localStorage.setItem(STORE_KEY, open.value ?? '') } catch { /* stockage indisponible : on oublie */ }
}
</script>

<template>
  <div class="panel-head">
    <div class="head">
      <div class="min0">
        <div class="title">{{ house.house?.name ?? $t('nav.home') }}</div>
      </div>
      <!-- le même geste que l'interrupteur des Réglages, sans y retourner -->
      <button type="button" class="pill done" @click="settings.setHouseEditing(false)">
        <StrokeIcon name="check" :size="16" /> {{ $t('render.houseEditingDone') }}
      </button>
    </div>
  </div>

  <EditSection :title="$t('opening.roofList')" :meta="String(roofWindows.length)" :open="open === 'roof'" @toggle="toggle('roof')">
    <div class="block">
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
    </div>
  </EditSection>

  <EditSection :title="$t('parking.list')" :meta="String(parkings.length)" :open="open === 'parking'" @toggle="toggle('parking')">
    <ParkingRows :list="parkings" hide-label />
  </EditSection>

  <EditSection :title="$t('garden.list')" :meta="String(house.gardenItems.length)" :open="open === 'garden'" @toggle="toggle('garden')">
    <GardenSection />
  </EditSection>

  <div class="block outline">
    <button type="button" class="pill add" :disabled="settings.reliefEditing && settings.terrainTab === 'outline'" @click="openOutline()">
      <StrokeIcon name="pencil" :size="16" /> {{ $t('relief.outline.open') }}
    </button>
    <p class="muted hint">{{ $t('relief.outline.openHint') }}</p>
  </div>

  <p class="muted hint foot">{{ $t('parking.roomHint') }}</p>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 12px; }
.min0 { flex: 1 1 0; min-width: 0; }
.done { flex: none; gap: 6px; }
.title { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
.hint { font-size: 12px; margin: 0; min-height: 32px; }
.block { display: grid; gap: 8px; }
.foot { margin-top: 12px; }
.outline { margin-top: 12px; }
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
