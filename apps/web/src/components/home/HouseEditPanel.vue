<script setup lang="ts">
import { computed, ref } from 'vue'
import { openingLabel } from '@kasbah/shared'
import { useI18n } from 'vue-i18n'
import { useHouseStore } from '../../stores/house'
import { useSettingsStore } from '../../stores/settings'
import ParkingRows from './ParkingRows.vue'
import GardenSection from './GardenSection.vue'
import EditSection from './EditSection.vue'
import FinishPicker from './FinishPicker.vue'
import EditBar from './EditBar.vue'
import { styleById } from '../../three/styles'
import StrokeIcon from '../ui/StrokeIcon.vue'

// "House" panel in EDIT MODE: what one modifies ABOUT THE WHOLE HOUSE, in place of the tiles
// and rooms one commands the rest of the time. Same trade-off as `RoomEditPanel` for a room —
// the mode is armed in Settings, so the gesture is already decided: we survey the house, we do not
// turn it on.
//
// Two subjects here: the parking places (visible without scrolling), and the roof windows —
// they belong to no wall, and the Roof tab opens no room: without this section,
// they could not be placed from the view where the roof is visible.
//
// At the top, the STRUCTURE: add a room (by tap, on the tab's level), a floor or a
// basement, remove the tab's level if it is empty. Everything goes into the session's draft.
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
 * The land outline is adjusted in the land editor, not here: its handles would take the
 * same taps and drags as the garden and the places. So we close whatever is in progress, then
 * open it on its Outline tab; "Done" brings back to the house setting from there.
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
/** A "costume" style keeps its palette: the chosen facade is not visible in it, and we say so. */
const costume = computed(() => !styleById(settings.sceneStyle).assets)
function startRoof() { house.startPlacingOpening('roof-window') }

const levelName = (id: string | null) => (id ? house.index?.levelsById.get(id)?.name ?? '' : '')
const targetLevel = computed(() => levelName(house.roomTargetLevelId))
/** The tab's level, the one we would remove or rename; none on "All". */
const tabLevel = computed(() => house.focusedLevelId)
const tabLevelObj = computed(() => (tabLevel.value ? house.index?.levelsById.get(tabLevel.value) ?? null : null))

/** An empty name is not written: the field takes back the old one. The short name, however, can be emptied. */
function renameProperty(ev: Event) {
  const input = ev.target as HTMLInputElement
  const name = input.value.trim()
  if (!name || name === house.effective?.name) { input.value = house.effective?.name ?? ''; return }
  house.setPropertyName(name)
}
function renameLevel(ev: Event, field: 'name' | 'shortName') {
  const input = ev.target as HTMLInputElement
  const lvl = tabLevelObj.value
  if (!lvl) return
  const v = input.value.trim()
  if (field === 'name' && (!v || v === lvl.name)) { input.value = lvl.name; return }
  if (field === 'shortName' && v === (lvl.shortName ?? '')) return
  house.setLevelIdentity(lvl.id, { [field]: v })
}

// One section open at a time, remembered from one visit to the next (a convenience of this workstation only).
type Section = 'structure' | 'roof' | 'parking' | 'garden' | 'facade'
const STORE_KEY = 'kasbah.houseEdit.section'
function remembered(): Section | null {
  try {
    const v = localStorage.getItem(STORE_KEY)
    return v === 'structure' || v === 'roof' || v === 'parking' || v === 'garden' || v === 'facade' ? v : null
  } catch { return null }
}
const open = ref<Section | null>(remembered())
/** Folding a section disarms the placement it started: its "Cancel" / "Done" disappears with it. */
function toggle(s: Section) {
  if (house.placingOpening) house.cancelPlacingOpening()
  if (house.placingParking) house.cancelPlacingParking()
  if (house.placingGarden) house.cancelPlacingGarden()
  if (house.placingRoom) house.cancelPlacingRoom()
  open.value = open.value === s ? null : s
  try { localStorage.setItem(STORE_KEY, open.value ?? '') } catch { /* storage unavailable: we forget */ }
}
</script>

<template>
  <div class="panel-head">
    <div class="head">
      <div class="min0">
        <div class="title">{{ house.house?.name ?? $t('nav.home') }}</div>
      </div>
      <!-- the same gesture as the Settings switch, without going back there -->
      <button type="button" class="pill done" @click="settings.setHouseEditing(false)">
        <StrokeIcon name="check" :size="16" /> {{ $t('render.houseEditingDone') }}
      </button>
    </div>
  </div>

  <EditSection :title="$t('structure.section')" :meta="String(house.effective?.rooms.length ?? 0)" :open="open === 'structure'" @toggle="toggle('structure')">
    <div class="block">
      <EditBar />
      <!-- the names: the property, then the tab's level (fields grayed out on "All", never removed) -->
      <label class="names">
        <span class="section-label">{{ $t('structure.propertyName') }}</span>
        <input class="field" type="text" maxlength="60" :value="house.effective?.name ?? ''" :disabled="house.savingEdit"
               @change="renameProperty" @keydown.enter="($event.target as HTMLInputElement).blur()">
      </label>
      <div class="names">
        <span class="section-label">{{ $t('structure.levelName') }}</span>
        <div class="names__row">
          <input class="field" type="text" maxlength="60" :value="tabLevelObj?.name ?? ''" :placeholder="tabLevelObj ? '' : $t('structure.levelPick')"
                 :aria-label="$t('structure.levelName')" :disabled="!tabLevelObj || house.savingEdit"
                 @change="renameLevel($event, 'name')" @keydown.enter="($event.target as HTMLInputElement).blur()">
          <input class="field names__short" type="text" maxlength="12" :value="tabLevelObj?.shortName ?? ''" :placeholder="$t('structure.levelShort')"
                 :aria-label="$t('structure.levelShortHint')" :title="$t('structure.levelShortHint')" :disabled="!tabLevelObj || house.savingEdit"
                 @change="renameLevel($event, 'shortName')" @keydown.enter="($event.target as HTMLInputElement).blur()">
        </div>
      </div>
      <!-- same box armed or not ("Cancel"); the instruction has its reserved place -->
      <button v-if="!house.placingRoom" type="button" class="pill add" :disabled="house.savingEdit || !house.roomTargetLevelId" @click="house.startPlacingRoom()">
        <StrokeIcon name="plus" :size="16" /> {{ $t('structure.addRoom') }}
      </button>
      <button v-else type="button" class="pill add add--armed" @click="house.cancelPlacingRoom()">{{ $t('opening.cancel') }}</button>
      <p class="muted hint hint--3">{{ $t(house.placingRoom ? 'structure.placeRoomHint' : tabLevel ? 'structure.addRoomHint' : 'structure.addRoomHintLowest', { level: targetLevel }) }}</p>
      <div class="pair">
        <button type="button" class="pill add" :disabled="house.savingEdit" @click="house.addLevel('above')">{{ $t('structure.addAbove') }}</button>
        <button type="button" class="pill add" :disabled="house.savingEdit" @click="house.addLevel('below')">{{ $t('structure.addBelow') }}</button>
      </div>
      <button type="button" class="pill add" :disabled="house.savingEdit || !tabLevel || !house.levelRemovable(tabLevel)" @click="tabLevel && house.removeLevel(tabLevel)">
        <StrokeIcon name="trash" :size="16" />
        <span class="ellipsis">{{ tabLevel ? $t('structure.removeLevel', { level: levelName(tabLevel) }) : $t('structure.removeLevelNone') }}</span>
      </button>
      <p class="muted hint hint--2">{{ tabLevel ? $t('structure.removeLevelHint') : $t('structure.removeLevelPick') }}</p>
    </div>
  </EditSection>

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

  <EditSection :title="$t('finish.facade')" :meta="house.facadeFinish ? $t(`finish.names.${house.facadeFinish.id}`) : ''" :open="open === 'facade'" @toggle="toggle('facade')">
    <div class="block">
      <p class="muted hint">{{ costume ? $t('finish.costumeHint') : $t('finish.facadeHint') }}</p>
      <EditBar />
      <FinishPicker surface="facade" :value="house.facadeFinish" :disabled="house.savingEdit" @change="house.setFacadeFinish" />
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
/* reserved lines: armed or not, level chosen or not, the instruction keeps its height */
.hint--2, .hint--3 { line-height: 1.5; }
.hint--2 { min-height: 3em; }
.hint--3 { min-height: 4.5em; }
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
.add { width: 100%; min-width: 0; justify-content: center; gap: 8px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.names { display: grid; gap: 6px; }
.names__row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 7em); gap: 8px; }
.field {
  min-width: 0; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface);
  color: var(--text); font: inherit; font-size: 14px;
}
.field:focus { outline: none; border-color: var(--accent); }
.field:disabled { opacity: .55; }
.pair .add { white-space: normal; line-height: 1.2; text-align: center; }
.ellipsis { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.add--armed { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
</style>
