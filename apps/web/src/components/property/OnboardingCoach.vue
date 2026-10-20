<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePropertiesStore } from '../../stores/properties'
import { useSettingsStore } from '../../stores/settings'
import { useHouseStore } from '../../stores/house'
import { readOnboarding, writeOnboarding, type Onboarding } from '../../lib/onboarding'

// The guide that follows the creation of a property, placed over the House view: first the land
// outline (its editor opens by itself), then the first room, opened in edit mode to
// type in its real measurements. "Done" of the land moves on to the room; "Done" or
// "Skip" put the guide away. An apartment starts directly at the room.
/** Side panel anchored to the right (wide window): the guide stops before it. */
defineProps<{ wide: boolean }>()
/** The room is open: on a narrow screen, the panel (a drawer) must open so that it can be seen. */
const emit = defineEmits<{ room: [] }>()
const properties = usePropertiesStore()
const settings = useSettingsStore()
const house = useHouseStore()

const guide = ref<Onboarding | null>(readOnboarding())
/** The guide only applies to ITS property, once we know which one is shown. */
const here = computed(() => !!guide.value && properties.active?.id === guide.value.propertyId && !!house.house)

function set(o: Onboarding | null) { guide.value = o; writeOnboarding(o) }
function startRoom() {
  settings.setHouseEditing(true)
  house.selectRoom(house.house?.rooms[0]?.id ?? null)
  emit('room')
}

// the list loaded without the guide's property (deleted, other server): we forget it
watch(() => properties.info, (info) => {
  if (info && guide.value && !info.properties.some((p) => p.id === guide.value!.propertyId)) set(null)
}, { immediate: true })

// arrival on the new house: the current step opens by itself
watch(here, (on) => {
  if (!on || !guide.value) return
  if (guide.value.step === 'terrain') settings.setReliefEditing(true, 'outline')
  else startRoom()
}, { immediate: true })

// "Done" in the land editor: make way for the first room
watch(() => settings.reliefEditing, (on, was) => {
  if (!here.value || guide.value?.step !== 'terrain' || on || !was) return
  set({ ...guide.value, step: 'room' })
  startRoom()
})
</script>

<template>
  <!-- the free band between the land panel (on the left, if open) and the side panel -->
  <div v-if="here && guide" class="coach-band" :data-relief="settings.reliefEditing ? '1' : '0'" :data-wide="wide ? '1' : '0'">
    <div class="card coach" role="status">
      <div class="section-label">{{ $t('property.coach.step', { n: guide.step === 'terrain' ? 1 : 2 }) }}</div>
      <div class="coach__title">{{ $t(`property.coach.${guide.step}.title`) }}</div>
      <p class="coach__text">{{ $t(`property.coach.${guide.step}.text`) }}</p>
      <div class="coach__actions">
        <button type="button" class="pill pill--sm" @click="set(null)">{{ $t('property.coach.skip') }}</button>
        <button v-if="guide.step === 'room'" type="button" class="pill pill--sm coach__done" @click="set(null)">{{ $t('property.coach.done') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* at the top of the scene, centered in the free band: to the right of the land panel (300 px, see
   ReliefPanel), to the left of the side panel when it is anchored */
.coach-band {
  position: absolute; z-index: 5; top: 96px; left: calc(var(--rail-w) + 12px); right: 12px;
  display: flex; justify-content: center; pointer-events: none;
}
.coach-band[data-relief='1'] { left: calc(var(--rail-w) + 12px + 300px + 12px); }
.coach-band[data-wide='1'] { right: calc(var(--safe-right, 0px) + var(--aside-w) + 2 * var(--panel-gap, 12px)); }
.coach { width: 100%; max-width: 420px; padding: 12px 14px; display: grid; gap: 6px; box-shadow: var(--shadow); pointer-events: auto; }
.coach__title { font-size: 15px; font-weight: 600; }
.coach__text { margin: 0; font-size: 13px; line-height: 1.45; }
.coach__actions { display: flex; justify-content: flex-end; gap: 8px; }
.coach__done { border-color: var(--accent); color: var(--accent); }
</style>
