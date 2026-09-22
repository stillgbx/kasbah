<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveDefaults, roomHeight, SPEAKER_SHAPES, type HouseDevice, type PlacedHouseDevice, type SpeakerShape } from '@kasbah/shared'
import { isFlatCover } from '../../lib/cover'
import { coverLeaves, coverSize, hasLeaves, isOrientable, isSizable, isTv, tvInchesFromSize, tvSizeFromInches } from '../../lib/orientation'
import type { IconName } from '../../lib/strokeIcons'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Réglages d'un appareil posé : « Modifier » ouvre le mode édition — x;y en glissant dans la 3D,
// hauteur, orientation, taille TV / forme d'enceinte, battants… Chaque réglage est écrit dans
// house.json (store `house`) ; « Rétablir » renvoie au placement d'entrée dans le mode.
//
// La section vit au FOND du panneau : sa ligne de titre est en bas, et le corps s'ouvre AU-DESSUS
// d'elle, en douceur (transition de `max-height`). Le bouton « Modifier » et le bouton
// « Terminé » occupent exactement la même place (même largeur, même coin) : on referme là où on a
// ouvert. « Rétablir » a une place réservée dans le corps, invisible tant qu'il n'y a rien à rétablir —
// rien ne se décale quand il apparaît.
const props = defineProps<{ device: PlacedHouseDevice }>()
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
//
// Le `yaw` du JSON tourne dans le sens TRIGONOMÉTRIQUE (l'axe Z monte), donc l'AUGMENTER fait pivoter
// l'objet vers la gauche vu de dessus. C'est la touche de gauche qui l'augmente, et celle de droite
// qui le diminue : ce qu'on voit tourner suit la touche qu'on appuie, pas la convention du fichier.
const YAW_STEP = 45
const descriptor = computed(() => (props.device.deviceId ? devices.descriptors[props.device.deviceId] : undefined))
const orientable = computed(() => isOrientable(props.device, descriptor.value))
const yaw = computed(() => props.device.yaw ?? 0)
function rotate(delta: number) {
  void house.savePlacement({ yaw: (((yaw.value + delta) % 360) + 360) % 360 })
}

// Taille de ce qui est DESSINÉ : ouvrants libres (largeur × hauteur ou avancée, en mètres) et
// téléviseurs (une seule diagonale en pouces — c'est le chiffre sur le carton, converti en dalle
// 16:9 pour la scène). Voir `lib/orientation.ts`. Bornes larges mais finies.
const SIZE_STEP = 0.25
const SIZE_LIMITS = { width: { min: 0.25, max: 12 }, height: { min: 0.25, max: 4 } } as const
/** Pas et bornes de la diagonale TV (pouces) : les tailles commerciales vont par pouce entier. */
const DIAGONAL_STEP = 1
const DIAGONAL_LIMITS = { min: 20, max: 100 } as const
const sizable = computed(() => isSizable(props.device, descriptor.value))
const tv = computed(() => isTv(descriptor.value))
const size = computed(() => coverSize(props.device, descriptor.value))
const inches = computed(() => tvInchesFromSize(size.value))
// La seconde dimension n'est pas la même chose selon la nature : la HAUTEUR d'un portail debout,
// l'AVANCÉE d'un store déployé à plat. Même champ dans le JSON, deux mots à l'écran.
const dimLabel = (dim: 'width' | 'height') =>
  t(dim === 'width' ? 'place.size.width' : isFlatCover(descriptor.value) ? 'place.size.projection' : 'place.size.height')
function resize(dim: 'width' | 'height', delta: number) {
  const { min, max } = SIZE_LIMITS[dim]
  const next = Math.min(max, Math.max(min, Math.round((size.value[dim] + delta) * 100) / 100))
  if (next === size.value[dim]) return
  void house.savePlacement({ size: { ...size.value, [dim]: next } })
}
function resizeDiagonal(delta: number) {
  const next = Math.min(DIAGONAL_LIMITS.max, Math.max(DIAGONAL_LIMITS.min, inches.value + delta))
  if (next === inches.value) return
  void house.savePlacement({ size: tvSizeFromInches(next) })
}

// Battants d'un portail : ce qui s'écarte quand il s'ouvre, donc ce que la scène anime. Un store se
// déploie d'une pièce, la question ne se pose que pour ce qui se tient debout.
const leavesShown = computed(() => hasLeaves(props.device, descriptor.value))
// `Segmented` parle en chaînes (sa clé de segment) ; le JSON, lui, compte des battants.
const leaves = computed(() => String(coverLeaves(props.device, descriptor.value)))
const leavesOptions = [{ value: '1', label: '1' }, { value: '2', label: '2' }]

/** Enceinte : silhouette 3D (cylindre / galet / barre / bloc), indépendante du mode glisser. */
const isSpeaker = computed(() =>
  descriptor.value?.kind === 'media_player'
  && (descriptor.value.meta.mediaPlayer?.deviceClass ?? 'speaker') === 'speaker')
const speakerShape = computed(() => props.device.speakerShape ?? 'default')
/** Glyphe par silhouette : le Segmented n'affiche que l'icône, le libellé reste en title / aria. */
const SPEAKER_SHAPE_ICONS: Record<SpeakerShape, IconName> = {
  default: 'speakerTube',
  pebble: 'speakerPebble',
  bar: 'speakerBar',
  block: 'speakerBlock',
}
const speakerShapeOptions = computed(() =>
  SPEAKER_SHAPES.map((s) => ({ value: s, label: t(`place.speakerShape.${s}`), icon: SPEAKER_SHAPE_ICONS[s] })))
function setSpeakerShape(raw: string): void {
  const next = (SPEAKER_SHAPES.find((s) => s === raw) ?? 'default') as SpeakerShape
  if (next === speakerShape.value) return
  const id = props.device.deviceId
  if (!id) return
  // `''` efface → cylindre par défaut ; les autres valeurs s'écrivent telles quelles
  void house.setDeviceTuning(id, { speakerShape: next === 'default' ? '' : next })
}

// Saisie DIRECTE d'une valeur, à côté des touches −/+ : régler un portail de 4,10 m au quart de
// mètre demandait seize appuis. Le champ ne commite qu'à la validation (Entrée ou perte du focus) —
// écrire house.json à chaque frappe enverrait une maison par caractère. Tant qu'on tape, c'est le
// brouillon qui s'affiche : sinon la valeur relue du serveur écraserait la saisie en cours.
type Field = 'yaw' | 'width' | 'height' | 'diagonal'
const editing = ref<Field | null>(null)
const draft = ref('')

/** Le contenu se SÉLECTIONNE à la prise de focus : taper remplace la valeur au lieu de s'y ajouter. */
function startEdit(field: Field, shown: string, ev?: FocusEvent) {
  editing.value = field
  draft.value = shown
  // APRÈS le rendu : Vue réécrit `value` quand le brouillon se pose, ce qui efface la sélection
  const el = ev?.target as HTMLInputElement | undefined
  if (el) void nextTick(() => el.select())
}
function cancelEdit() { editing.value = null }
/** Valeur affichée par un champ : le brouillon s'il est en cours d'édition, sinon l'état. */
const shownValue = (field: Field, value: string) => (editing.value === field ? draft.value : value)

function commitEdit(field: Field) {
  if (editing.value !== field) return          // sortie par Échap : rien à écrire
  editing.value = null
  // virgule décimale acceptée : c'est ce que tape un clavier français
  const raw = Number(draft.value.replace(',', '.').trim())
  if (!Number.isFinite(raw)) return            // saisie illisible : on garde ce qui était là
  if (field === 'yaw') {
    const next = (((Math.round(raw) % 360) + 360) % 360)
    if (next !== yaw.value) void house.savePlacement({ yaw: next })
    return
  }
  if (field === 'diagonal') {
    const next = Math.min(DIAGONAL_LIMITS.max, Math.max(DIAGONAL_LIMITS.min, Math.round(raw)))
    if (next !== inches.value) void house.savePlacement({ size: tvSizeFromInches(next) })
    return
  }
  const { min, max } = SIZE_LIMITS[field]
  const next = Math.min(max, Math.max(min, Math.round(raw * 100) / 100))
  if (next !== size.value[field]) void house.savePlacement({ size: { ...size.value, [field]: next } })
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
// Changer de niveau se fait ICI, par un sélecteur, jamais par les onglets de niveau (un clic pour aller
// regarder ailleurs ré-ancrait l'appareil sans le dire). Du haut vers le bas, comme les listes de l'app.
const levelOptions = computed(() => house.levels.map((l) => ({ value: l.id, title: l.shortName ?? l.name })))
// Ce qui ancre l'appareil : sa pièce, ou à défaut son niveau — un niveau sans pièce (le toit) ancre seul.
const anchorName = computed(() => {
  const id = house.draft?.roomId ?? props.device.roomId
  if (id) return house.index?.roomsById.get(id)?.name ?? id
  const level = props.device.levelId ? house.index?.levelsById.get(props.device.levelId) : undefined
  return level ? level.shortName ?? level.name : t('place.outside')
})

// Retirer de la maison : geste en deux temps (armer, puis confirmer dans les 4 s) pour ne pas sortir un
// appareil d'un doigt qui glisse ; l'emplacement est réservé, le libellé seul change.
//
// Une installation solaire emporte ses CHAMPS DE PANNEAUX (`siteId`, voir `house/place.ts`) : la
// confirmation le dit, parce que c'est le moment où l'on décide — vingt modules disparaissent avec elle.
const removeArmed = ref(false)
const ownedArrays = computed(() => (props.device.deviceId
  ? house.arrays.filter((a) => a.siteId === props.device.deviceId).length
  : 0))
const removeLabel = computed(() => (!removeArmed.value ? t('place.remove')
  : ownedArrays.value > 0 ? t('place.removeWithArrays', { n: ownedArrays.value }, ownedArrays.value)
  : t('place.removeConfirm')))
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
        <div class="place__row">
          <span class="muted">{{ $t('place.level') }}</span>
          <v-select class="place__level" :model-value="house.placementLevelId" :items="levelOptions" item-title="title" item-value="value"
                    density="compact" variant="outlined" hide-details :disabled="house.saving || !house.placing"
                    :aria-label="$t('place.level')" @update:model-value="(id: string) => house.setPlacementLevel(id)" />
        </div>
        <Segmented dense class="place__presets" :model-value="preset" :options="presetOptions" @update:model-value="applyPreset" />
        <div class="place__row">
          <span class="muted">{{ $t('place.height') }}</span>
          <span class="place__value">{{ position[2].toFixed(2) }} m</span>
        </div>
        <v-slider :model-value="position[2]" :min="0" :max="ceiling" :step="0.05" :disabled="house.saving || !house.placing" hide-details
                  @update:model-value="(v: number) => house.previewHeight(v)" @end="() => house.savePlacement()" />
        <div v-if="orientable" class="place__row">
          <span class="muted">{{ $t('place.orientation') }}</span>
          <span class="place__turn">
            <button type="button" class="key" :disabled="house.saving || !house.placing" :title="$t('place.rotateLeft')" :aria-label="$t('place.rotateLeft')" @click="rotate(YAW_STEP)">
              <StrokeIcon name="rotateLeft" :size="16" />
            </button>
            <span class="place__deg">
              <input class="place__value place__num" type="text" inputmode="numeric" enterkeyhint="done"
                     :value="shownValue('yaw', String(yaw))" :disabled="house.saving || !house.placing"
                     :aria-label="$t('place.orientation')"
                     @focus="startEdit('yaw', String(yaw), $event)"
                     @mouseup.prevent
                     @input="draft = ($event.target as HTMLInputElement).value"
                     @keydown.enter="($event.target as HTMLInputElement).blur()"
                     @keydown.esc="cancelEdit(); ($event.target as HTMLInputElement).blur()"
                     @blur="commitEdit('yaw')">
              <span class="place__unit">°</span>
            </span>
            <button type="button" class="key" :disabled="house.saving || !house.placing" :title="$t('place.rotateRight')" :aria-label="$t('place.rotateRight')" @click="rotate(-YAW_STEP)">
              <StrokeIcon name="rotateRight" :size="16" />
            </button>
          </span>
        </div>
        <!-- TV : une diagonale en pouces (le chiffre du carton). Ouvrant : largeur × hauteur/avancée. -->
        <div v-if="sizable && tv" class="place__row">
          <span class="muted">{{ $t('place.size.diagonal') }}</span>
          <span class="place__turn">
            <button type="button" class="key" :disabled="house.saving || !house.placing"
                    :title="`${$t('place.smaller')} — ${$t('place.size.diagonal')}`"
                    :aria-label="`${$t('place.smaller')} — ${$t('place.size.diagonal')}`"
                    @click="resizeDiagonal(-DIAGONAL_STEP)">
              <StrokeIcon name="minus" :size="16" />
            </button>
            <span class="place__deg">
              <input class="place__value place__num" type="text" inputmode="numeric" enterkeyhint="done"
                     :value="shownValue('diagonal', String(inches))" :disabled="house.saving || !house.placing"
                     :aria-label="$t('place.size.diagonal')"
                     @focus="startEdit('diagonal', String(inches), $event)"
                     @mouseup.prevent
                     @input="draft = ($event.target as HTMLInputElement).value"
                     @keydown.enter="($event.target as HTMLInputElement).blur()"
                     @keydown.esc="cancelEdit(); ($event.target as HTMLInputElement).blur()"
                     @blur="commitEdit('diagonal')">
              <span class="place__unit">″</span>
            </span>
            <button type="button" class="key" :disabled="house.saving || !house.placing"
                    :title="`${$t('place.bigger')} — ${$t('place.size.diagonal')}`"
                    :aria-label="`${$t('place.bigger')} — ${$t('place.size.diagonal')}`"
                    @click="resizeDiagonal(DIAGONAL_STEP)">
              <StrokeIcon name="plus" :size="16" />
            </button>
          </span>
        </div>
        <template v-else-if="sizable">
          <div v-for="dim in (['width', 'height'] as const)" :key="dim" class="place__row">
            <span class="muted">{{ dimLabel(dim) }}</span>
            <span class="place__turn">
              <button type="button" class="key" :disabled="house.saving || !house.placing"
                      :title="`${$t('place.smaller')} — ${dimLabel(dim)}`" :aria-label="`${$t('place.smaller')} — ${dimLabel(dim)}`"
                      @click="resize(dim, -SIZE_STEP)">
                <StrokeIcon name="minus" :size="16" />
              </button>
              <input class="place__value place__num place__num--size" type="text" inputmode="decimal" enterkeyhint="done"
                     :value="shownValue(dim, size[dim].toFixed(2))" :disabled="house.saving || !house.placing"
                     :aria-label="dimLabel(dim)"
                     @focus="startEdit(dim, size[dim].toFixed(2), $event)"
                     @mouseup.prevent
                     @input="draft = ($event.target as HTMLInputElement).value"
                     @keydown.enter="($event.target as HTMLInputElement).blur()"
                     @keydown.esc="cancelEdit(); ($event.target as HTMLInputElement).blur()"
                     @blur="commitEdit(dim)">
              <button type="button" class="key" :disabled="house.saving || !house.placing"
                      :title="`${$t('place.bigger')} — ${dimLabel(dim)}`" :aria-label="`${$t('place.bigger')} — ${dimLabel(dim)}`"
                      @click="resize(dim, SIZE_STEP)">
                <StrokeIcon name="plus" :size="16" />
              </button>
            </span>
          </div>
        </template>
        <div v-if="leavesShown" class="place__row">
          <span class="muted">{{ $t('place.leaves') }}</span>
          <Segmented dense class="place__leaves" :model-value="leaves" :options="leavesOptions"
                     @update:model-value="(v: string) => house.savePlacement({ leaves: v === '2' ? 2 : 1 })" />
        </div>
        <div v-if="isSpeaker" class="place__row">
          <span class="muted">{{ $t('place.speakerShape.label') }}</span>
          <Segmented dense class="place__leaves" :model-value="speakerShape" :options="speakerShapeOptions"
                     @update:model-value="setSpeakerShape" />
        </div>
        <div class="place__row place__bottom">
          <div class="muted place__coords">x {{ position[0].toFixed(2) }} · y {{ position[1].toFixed(2) }} · {{ anchorName }}</div>
          <!-- place réservée : invisible pour un provisoire (« Annuler » suffit), sinon retrait en deux temps -->
          <button type="button" class="pill place__remove" :class="{ 'place__remove--off': house.isProvisional, 'place__remove--armed': removeArmed }"
                  :disabled="house.saving || house.isProvisional" :tabindex="house.isProvisional ? -1 : 0"
                  :title="$t('place.removeHint')" @click="removeClick">
            {{ removeLabel }}
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
/* L'espace entre le corps et le pied fait partie du corps : il se replie avec lui.
   `minmax(0, 1fr)` et non la colonne `auto` par défaut : une colonne auto ne descend jamais sous le
   min-content de ses lignes (les quatre préréglages de hauteur, la pilule « Retirer de la maison »),
   et le corps, en `overflow: hidden`, coupait alors les 3 px qui dépassaient — le « m » de la hauteur
   de pose y passait. Les lignes se serrent maintenant à la largeur du panneau. */
.place__inner { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; align-content: start; padding-bottom: 12px; }
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
/* le sélecteur de niveau reste au bout de sa ligne, à largeur fixe : changer de niveau ne déplace rien */
.place__level { flex: 0 0 auto; width: 150px; }
/* deux choix seulement : le segmenté reste au bout de sa ligne plutôt que d'en prendre la largeur */
.place__leaves { flex: 0 0 auto; }
/* Les quatre préréglages de hauteur demandaient 264 px pour 257 : dès que le panneau prend sa barre
   de défilement, la dernière pilule débordait de la carte. Un segmenté ne se serre pas tout seul (ses
   mots ne se coupent pas), on lui reprend donc quelques pixels sur les côtés de chaque segment. */
.place__presets { max-width: 100%; }
.place__presets :deep(.segmented__item) { padding: 0 8px; }
/* largeur fixe (« 315° », « 10.25 ») : la valeur change sans déplacer les touches */
.place__deg { width: 5ch; display: inline-flex; align-items: center; justify-content: center; }
.place__unit { flex: 0 0 auto; }
/* Le champ de saisie occupe exactement la place qu'occupait le texte : même police, même graisse,
   même largeur, chiffres à chasse fixe — passer en édition ne déplace donc rien. Le soulignement est
   posé en `box-shadow` et non en bordure, pour la même raison. */
.place__num {
  width: 3.5ch; min-width: 0; height: 30px; padding: 0; border: 0; background: transparent;
  color: inherit; font: inherit; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums;
  box-shadow: inset 0 -1px 0 var(--line); border-radius: 4px;
}
.place__num--size { width: 5ch; }
.place__num:focus { outline: none; background: var(--accent-soft); box-shadow: inset 0 -1px 0 var(--accent); }
.place__num:disabled { opacity: .4; box-shadow: none; }
.key {
  display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
@media (prefers-reduced-motion: reduce) { .place__body { transition: none; } }
</style>
