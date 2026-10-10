<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePropertiesStore } from '../../stores/properties'
import { useSettingsStore } from '../../stores/settings'
import { useHouseStore } from '../../stores/house'
import { readOnboarding, writeOnboarding, type Onboarding } from '../../lib/onboarding'

// Le guide qui suit la création d'une propriété, posé sur la vue Maison : d'abord le contour du
// terrain (son éditeur s'ouvre tout seul), puis la première pièce, ouverte dans le mode édition pour
// en taper les vraies cotes. « Terminer » du terrain fait passer à la pièce ; « C'est fait » ou
// « Passer » rangent le guide. Un appartement commence directement à la pièce.
/** Panneau latéral ancré à droite (fenêtre large) : le guide s'arrête avant lui. */
defineProps<{ wide: boolean }>()
/** La pièce est ouverte : sur un écran étroit, le panneau (un tiroir) doit s'ouvrir pour qu'on la voie. */
const emit = defineEmits<{ room: [] }>()
const properties = usePropertiesStore()
const settings = useSettingsStore()
const house = useHouseStore()

const guide = ref<Onboarding | null>(readOnboarding())
/** Le guide ne vaut que sur SA propriété, une fois qu'on sait laquelle est montrée. */
const here = computed(() => !!guide.value && properties.active?.id === guide.value.propertyId && !!house.house)

function set(o: Onboarding | null) { guide.value = o; writeOnboarding(o) }
function startRoom() {
  settings.setHouseEditing(true)
  house.selectRoom(house.house?.rooms[0]?.id ?? null)
  emit('room')
}

// la liste chargée sans la propriété du guide (supprimée, autre serveur) : on l'oublie
watch(() => properties.info, (info) => {
  if (info && guide.value && !info.properties.some((p) => p.id === guide.value!.propertyId)) set(null)
}, { immediate: true })

// arrivée sur la maison neuve : l'étape en cours s'ouvre d'elle-même
watch(here, (on) => {
  if (!on || !guide.value) return
  if (guide.value.step === 'terrain') settings.setReliefEditing(true, 'outline')
  else startRoom()
}, { immediate: true })

// « Terminer » dans l'éditeur du terrain : place à la première pièce
watch(() => settings.reliefEditing, (on, was) => {
  if (!here.value || guide.value?.step !== 'terrain' || on || !was) return
  set({ ...guide.value, step: 'room' })
  startRoom()
})
</script>

<template>
  <!-- la bande libre entre le panneau du terrain (à gauche, s'il est ouvert) et le panneau latéral -->
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
/* en haut de la scène, centré dans la bande libre : à droite du panneau du terrain (300 px, cf.
   ReliefPanel), à gauche du panneau latéral quand il est ancré */
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
