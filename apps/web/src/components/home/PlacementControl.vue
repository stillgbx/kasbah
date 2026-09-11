<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveDefaults, roomHeight, type HouseDevice } from '@kasbah/shared'
import { isOrientable } from '../../lib/orientation'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Emplacement d'un appareil : « Déplacer » ouvre le mode placement — x;y en glissant l'appareil dans
// la 3D, hauteur par préréglage (plafond, applique, table, sol) ou curseur fin, orientation par pas
// de 45° pour ce qui regarde quelque part. Chaque réglage est écrit dans house.json (store `house`) ;
// « Rétablir » renvoie au placement d'entrée dans le mode.
//
// La section vit au FOND du panneau : sa ligne de titre est en bas, et le corps s'ouvre AU-DESSUS
// d'elle, en douceur (transition de `grid-template-rows`). Le bouton « Déplacer » et le bouton
// « Terminé » occupent exactement la même place (même largeur, même coin) : on referme là où on a
// ouvert. « Rétablir » a une place réservée dans le corps, invisible tant qu'il n'y a rien à rétablir —
// rien ne se décale quand il apparaît.
const props = defineProps<{ device: HouseDevice }>()
const house = useHouseStore()
const devices = useDevicesStore()
const { t } = useI18n()

// Hauteur naturelle du corps, mesurée (ResizeObserver) : la transition anime `max-height` de 0 vers
// cette valeur — une hauteur en pixels s'anime partout, là où `grid-template-rows: 0fr → 1fr` sautait.
const inner = ref<HTMLElement | null>(null)
const innerHeight = ref(0)
let observer: ResizeObserver | null = null
onMounted(() => {
  if (!inner.value) return
  innerHeight.value = inner.value.scrollHeight
  observer = new ResizeObserver(() => { if (inner.value) innerHeight.value = inner.value.scrollHeight })
  observer.observe(inner.value)
})
onBeforeUnmount(() => observer?.disconnect())

// Orientation (`yaw`, 0 = face à +y) : proposée aux appareils qui REGARDENT quelque part (règle
// partagée avec la scène 3D : `lib/orientation.ts`). Deux touches, pas de 45°, écrit à chaque pression.
const YAW_STEP = 45
const orientable = computed(() => isOrientable(props.device, props.device.deviceId ? devices.descriptors[props.device.deviceId] : undefined))
const yaw = computed(() => props.device.yaw ?? 0)
function rotate(delta: number) {
  void house.savePlacement({ yaw: (((yaw.value + delta) % 360) + 360) % 360 })
}

type Mount = NonNullable<HouseDevice['mount']>
type Preset = 'ceiling' | 'wall' | 'table' | 'floor' | ''
const PRESETS: { value: Exclude<Preset, ''>; mount: Mount; z: (ceiling: number) => number }[] = [
  { value: 'ceiling', mount: 'ceiling', z: (c) => c - 0.15 },
  { value: 'wall', mount: 'wall', z: () => 1.8 },
  { value: 'table', mount: 'free', z: () => 0.75 },
  { value: 'floor', mount: 'floor', z: () => 0.1 },
]
const presetOptions = computed(() => PRESETS.map((p) => ({ value: p.value as Preset, label: t(`place.presets.${p.value}`) })))
const preset = computed<Preset>(() => (props.device.mount === 'free' ? 'table' : props.device.mount ?? ''))

/** Hauteur sous plafond de la pièce d'ancrage (borne du curseur) ; 4 m hors pièce. */
const ceiling = computed(() => {
  const room = props.device.roomId ? house.index?.roomsById.get(props.device.roomId) : undefined
  const level = room ? house.index?.levelsById.get(room.levelId) : undefined
  return house.house && room && level ? roomHeight(room, level, resolveDefaults(house.house.defaults)) : 4
})
const position = computed(() => house.draft?.position ?? props.device.position)
// Ce qui ancre l'appareil : sa pièce, ou à défaut son niveau — un niveau sans pièce (le toit) ancre seul,
// et c'est ce qui confirme à l'écran qu'un changement d'onglet a bien emmené l'appareil.
const anchorName = computed(() => {
  const id = house.draft?.roomId ?? props.device.roomId
  if (id) return house.index?.roomsById.get(id)?.name ?? id
  const level = props.device.levelId ? house.index?.levelsById.get(props.device.levelId) : undefined
  return level ? level.shortName ?? level.name : t('place.outside')
})

// Retirer de la maison : geste en deux temps (armer, puis confirmer dans les 4 s) pour ne pas sortir un
// appareil d'un doigt qui glisse ; l'emplacement est réservé, le libellé seul change.
const removeArmed = ref(false)
let disarm: ReturnType<typeof setTimeout> | undefined
function removeClick() {
  if (!removeArmed.value) { removeArmed.value = true; disarm = setTimeout(() => { removeArmed.value = false }, 4000); return }
  clearTimeout(disarm)
  removeArmed.value = false
  void house.removePlacement()
}
onBeforeUnmount(() => clearTimeout(disarm))

function applyPreset(p: Preset) {
  const def = PRESETS.find((x) => x.value === p)
  if (!def) return
  const [x, y] = position.value
  void house.savePlacement({ position: [x, y, Math.round(def.z(ceiling.value) * 20) / 20], mount: def.mount })
}
</script>

<template>
  <div class="card card--soft place" :data-open="house.placing ? '1' : '0'">
    <!-- corps repliable, AU-DESSUS du pied : hauteur animée de 0 à son contenu -->
    <div class="place__body" :style="{ '--place-h': `${innerHeight}px` }" :aria-hidden="house.placing ? 'false' : 'true'">
      <div ref="inner" class="place__inner">
        <div class="place__row place__top">
          <p class="muted place__hint">{{ $t('place.hint') }}</p>
          <!-- place réservée : invisible tant qu'il n'y a rien à rétablir, la ligne ne bouge pas -->
          <button type="button" class="pill place__revert" :class="{ 'place__revert--off': !house.canRevert }"
                  :disabled="house.saving || !house.canRevert" :tabindex="house.canRevert ? 0 : -1" @click="house.revertPlacement()">
            {{ $t('place.revert') }}
          </button>
        </div>
        <Segmented dense :model-value="preset" :options="presetOptions" @update:model-value="applyPreset" />
        <div class="place__row">
          <span class="muted">{{ $t('place.height') }}</span>
          <span class="place__value">{{ position[2].toFixed(2) }} m</span>
        </div>
        <v-slider :model-value="position[2]" :min="0" :max="ceiling" :step="0.05" :disabled="house.saving || !house.placing" hide-details
                  @update:model-value="(v: number) => house.previewHeight(v)" @end="() => house.savePlacement()" />
        <div v-if="orientable" class="place__row">
          <span class="muted">{{ $t('place.orientation') }}</span>
          <span class="place__turn">
            <button type="button" class="key" :disabled="house.saving || !house.placing" :title="$t('place.rotateLeft')" :aria-label="$t('place.rotateLeft')" @click="rotate(-YAW_STEP)">
              <StrokeIcon name="rotateLeft" :size="16" />
            </button>
            <span class="place__value place__deg">{{ yaw }}°</span>
            <button type="button" class="key" :disabled="house.saving || !house.placing" :title="$t('place.rotateRight')" :aria-label="$t('place.rotateRight')" @click="rotate(YAW_STEP)">
              <StrokeIcon name="rotateRight" :size="16" />
            </button>
          </span>
        </div>
        <div class="place__row place__bottom">
          <div class="muted place__coords">x {{ position[0].toFixed(2) }} · y {{ position[1].toFixed(2) }} · {{ anchorName }}</div>
          <!-- place réservée : invisible pour un provisoire (« Annuler » suffit), sinon retrait en deux temps -->
          <button type="button" class="pill place__remove" :class="{ 'place__remove--off': house.isProvisional, 'place__remove--armed': removeArmed }"
                  :disabled="house.saving || house.isProvisional" :tabindex="house.isProvisional ? -1 : 0"
                  :title="$t('place.removeHint')" @click="removeClick">
            {{ removeArmed ? $t('place.removeConfirm') : $t('place.remove') }}
          </button>
        </div>
      </div>
    </div>
    <!-- pied : titre à gauche, UN bouton à droite qui garde sa place et sa largeur dans les deux états -->
    <div class="place__foot">
      <span class="muted">{{ $t('place.title') }}</span>
      <button v-if="!house.placing" type="button" class="pill place__cta" @click="house.startPlacing()">
        <StrokeIcon name="move" :size="16" /> {{ $t('place.move') }}
      </button>
      <!-- un provisoire jamais déposé s'abandonne : le bouton le dit -->
      <button v-else type="button" class="pill place__cta" data-on="1" @click="house.stopPlacing()">{{ house.isProvisional ? $t('place.cancel') : $t('place.done') }}</button>
    </div>
  </div>
</template>

<style scoped>
.place { padding: 12px 14px; font-size: 13px; }
/* le corps s'ouvre par sa hauteur (0 → hauteur mesurée) et s'éclaire ; fermé, il n'occupe rien */
.place__body {
  overflow: hidden; max-height: 0; opacity: 0; visibility: hidden;
  transition: max-height .3s ease, opacity .25s ease, visibility 0s linear .3s;   /* invisible seulement une fois replié */
}
.place[data-open="1"] .place__body { max-height: var(--place-h, 400px); opacity: 1; visibility: visible; transition: max-height .3s ease, opacity .25s ease, visibility 0s; }
/* l'espace entre le corps et le pied fait partie du corps : il se replie avec lui */
.place__inner { display: grid; gap: 10px; align-content: start; padding-bottom: 12px; }
.place__foot, .place__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.place__top { align-items: flex-start; }
.place__hint { margin: 0; font-size: 12px; flex: 1 1 auto; }
.place__revert { flex: 0 0 auto; }
.place__revert--off { visibility: hidden; }
/* même largeur pour « Déplacer » et « Terminé » : le bouton ne change ni de place ni de taille */
.place__cta { min-width: 124px; justify-content: center; }
.place__value { font-variant-numeric: tabular-nums; font-weight: 600; }
.place__coords { font-size: 12px; font-variant-numeric: tabular-nums; min-width: 0; }
.place__bottom { align-items: center; }
/* largeur fixe pour les deux libellés (« Retirer de la maison » / « Confirmer le retrait ») : rien ne bouge */
.place__remove { flex: 0 0 auto; min-width: 150px; justify-content: center; font-size: 12px; }
.place__remove--off { visibility: hidden; }
.place__remove--armed { border-color: var(--error, #e5484d); color: var(--error, #e5484d); }
.place__turn { display: inline-flex; align-items: center; gap: 6px; }
/* largeur fixe (« 315° ») : la valeur change sans déplacer les touches */
.place__deg { width: 4ch; text-align: center; }
.key {
  display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
@media (prefers-reduced-motion: reduce) { .place__body { transition: none; } }
</style>
