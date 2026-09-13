<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PANEL_PEAK_W, PANEL_SIZE, panelDeviceId, type PanelArray, type Vec3 } from '@kasbah/shared'
import { shortInverterId } from '../../lib/energy'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Champs de panneaux d'une installation solaire : la liste, puis le réglage de l'un d'eux. Un champ
// est une GRILLE (`house.arrays`) — rangées, colonnes, orientation du module, du champ, inclinaison —
// et ses modules se dérivent d'elle : deux champs de dix panneaux tiennent en deux objets du JSON.
// Se déplace en glissant n'importe lequel de ses modules dans la 3D, comme un appareil.
//
// La carte vit au fond du panneau de l'installation (« Installation solaire »), au-dessus
// d'« Emplacement » : c'est là qu'on vient quand on déclare son installation.
const props = defineProps<{ siteDeviceId: string }>()
const house = useHouseStore()
const devices = useDevicesStore()
const { t } = useI18n()

/** Les champs de CETTE installation (voir `arraysOf` : ceux qui la nomment, plus les anonymes). */
const fields = computed(() => house.arraysOf(props.siteDeviceId))
const editing = computed(() => house.editingArray)
/** Nom affiché : celui du JSON, sinon « Champ n » — un champ créé ici n'en porte pas. */
const arrayName = (a: PanelArray, i: number) => a.name ?? t('arrays.field', { n: i + 1 })
const boundCount = (a: PanelArray) => a.panels.filter(Boolean).length

// --- réglages numériques : mêmes touches que le mode « Déplacer », valeur saisissable au clavier.
const LIMITS = { rows: { min: 1, max: 20 }, cols: { min: 1, max: 20 }, slope: { min: 0, max: 90 }, tilt: { min: -90, max: 90 }, z: { min: 0, max: 5 }, peak: { min: 50, max: 1000 }, out: { min: 0, max: 1000 } } as const
type Field = keyof typeof LIMITS | 'yaw'
const STEP: Record<Field, number> = { rows: 1, cols: 1, slope: 5, tilt: 5, z: 0.05, yaw: 45, peak: 10, out: 10 }

/**
 * Hauteur du champ au-dessus du sol du niveau. Elle existe parce qu'un toit est ÉPAIS : posé à 0 sur
 * un toit plat, un champ est noyé dans la dalle. Un champ créé ici naît déjà sur le dessus du toit
 * (`panelBaseZ`) ; cette ligne sert aux châssis inclinés et aux fichiers écrits à la main.
 */
const z = computed(() => editing.value?.origin[2] ?? 0)
function setZ(next: number) {
  const a = editing.value
  if (!a) return
  const v = Math.min(LIMITS.z.max, Math.max(LIMITS.z.min, Math.round(next * 100) / 100))
  if (v !== a.origin[2]) void house.saveArray({ origin: [a.origin[0], a.origin[1], v] })
}

/**
 * Puissance crête d'un module (Wc), celle inscrite au dos du panneau. Elle ne mesure rien : elle sert
 * d'ÉCHELLE à la couleur — la dalle du module dans la 3D, la jauge de sa ligne dans la vue Énergie.
 * Un micro-onduleur écrête souvent en deçà, si bien qu'un champ de 500 Wc ne remplit jamais tout à
 * fait ses jauges : c'est justement pour ça que la valeur se règle ici, champ par champ.
 */
const peak = computed(() => editing.value?.panel.peakW ?? PANEL_PEAK_W)
function setPeak(next: number) {
  const a = editing.value
  if (!a) return
  const v = Math.min(LIMITS.peak.max, Math.max(LIMITS.peak.min, Math.round(next)))
  // patch PARTIEL du module : sa taille reste celle qu'elle était (voir `putArrayInJson`)
  if (v !== a.panel.peakW) void house.saveArray({ panel: { peakW: v } })
}

/**
 * Puissance de sortie MAX des onduleurs du champ, le terme des fiches techniques : ce qu'un
 * micro-onduleur sait sortir au mieux (480 W pour un IQ8P), quelle que soit la crête du verre
 * au-dessus. Elle se saisit parce que la passerelle ne la publie pas : elle ne donne que le maximum
 * jamais RAPPORTÉ par chaque onduleur, qui raconte la météo passée et non l'appareil. 0 = inconnue,
 * et la vue Énergie ne marque alors aucun plafond.
 */
const maxOut = computed(() => editing.value?.maxOutputW ?? 0)
function setMaxOut(next: number) {
  const a = editing.value
  if (!a) return
  const v = Math.min(LIMITS.out.max, Math.max(LIMITS.out.min, Math.round(next)))
  if (v !== a.maxOutputW) void house.saveArray({ maxOutputW: v })
}

const steppers = computed(() => {
  const a = editing.value
  if (!a) return []
  return [
    { key: 'rows' as const, label: t('arrays.rows'), value: a.rows, text: String(a.rows), hint: '' },
    { key: 'cols' as const, label: t('arrays.cols'), value: a.cols, text: String(a.cols), hint: '' },
    { key: 'z' as const, label: t('arrays.height'), value: z.value, text: `${z.value.toFixed(2)} m`, hint: t('arrays.heightHint') },
    // deux angles, et l'ordre les explique : le support d'abord (le toit), le châssis ensuite
    { key: 'slope' as const, label: t('arrays.slope'), value: a.slope, text: `${a.slope}°`, hint: t('arrays.slopeHint') },
    { key: 'tilt' as const, label: t('arrays.tilt'), value: a.tilt, text: `${a.tilt}°`, hint: t('arrays.tiltHint') },
  ]
})

/**
 * Rétrécir la grille LIBÈRE les onduleurs qui n'ont plus d'emplacement (le serveur les coupe), et
 * l'agrandir laisse les nouveaux emplacements vides : c'est à l'utilisateur de dire qui va où.
 */
function bump(field: 'rows' | 'cols' | 'slope' | 'tilt' | 'z' | 'peak' | 'out', delta: number) {
  const a = editing.value
  if (!a) return
  if (field === 'z') { setZ(z.value + delta); return }
  if (field === 'peak') { setPeak(peak.value + delta); return }
  if (field === 'out') { setMaxOut(maxOut.value + delta); return }
  const { min, max } = LIMITS[field]
  const next = Math.min(max, Math.max(min, a[field] + delta))
  if (next !== a[field]) void house.saveArray({ [field]: next })
}
function rotate(delta: number) {
  const a = editing.value
  if (!a) return
  void house.saveArray({ yaw: (((a.yaw + delta) % 360) + 360) % 360 })
}

// Saisie directe, comme pour la taille d'un ouvrant : le champ ne commite qu'à la validation, et
// tant qu'on tape c'est le brouillon qui s'affiche (sinon la maison relue écraserait la frappe).
const editingField = ref<Field | null>(null)
const draft = ref('')
/**
 * Le contenu se SÉLECTIONNE à la prise de focus : sans ça, taper 500 dans un champ à 450 donnait
 * « 450500 » — le curseur se posait là où on avait cliqué et la frappe s'ajoutait à la valeur. Le
 * `@mouseup.prevent` des champs va avec : le RELÂCHEMENT de la souris replace le curseur et défait
 * la sélection faite au focus, si bien que `select()` seul ne tient pas sur un clic.
 */
function startEdit(field: Field, shown: string, ev?: FocusEvent) {
  editingField.value = field
  draft.value = shown
  // APRÈS le rendu : poser le brouillon change la valeur liée du champ, et Vue en réécrivant
  // `value` efface toute sélection — sélectionner avant ne tenait donc pas une image.
  const el = ev?.target as HTMLInputElement | undefined
  if (el) void nextTick(() => el.select())
}
const shownValue = (field: Field, value: string) => (editingField.value === field ? draft.value : value)
function commitEdit(field: Field) {
  const a = editing.value
  if (editingField.value !== field || !a) return
  editingField.value = null
  const raw = Number(draft.value.replace(',', '.').trim())
  if (!Number.isFinite(raw)) return
  if (field === 'yaw') {
    const next = (((Math.round(raw) % 360) + 360) % 360)
    if (next !== a.yaw) void house.saveArray({ yaw: next })
    return
  }
  if (field === 'z') { setZ(raw); return }
  if (field === 'peak') { setPeak(raw); return }
  if (field === 'out') { setMaxOut(raw); return }
  const { min, max } = LIMITS[field]
  const next = Math.min(max, Math.max(min, Math.round(raw)))
  if (next !== a[field]) void house.saveArray({ [field]: next })
}

// --- orientation du MODULE : portrait (debout) ou paysage (couché). C'est le même module, tourné
// d'un quart de tour : ses deux dimensions s'échangent.
const layout = computed<'portrait' | 'landscape'>(() => (editing.value && editing.value.panel.width > editing.value.panel.height ? 'landscape' : 'portrait'))
const layoutOptions = computed(() => [
  { value: 'portrait' as const, label: t('arrays.portrait') },
  { value: 'landscape' as const, label: t('arrays.landscape') },
])
function setLayout(next: 'portrait' | 'landscape') {
  const a = editing.value
  if (!a || next === layout.value) return
  void house.saveArray({ panel: { width: a.panel.height, height: a.panel.width } })
}

// --- onduleurs : un par emplacement, rangée par rangée. Le remplissage à la création suit l'ordre
// des numéros de série ; ici on corrige l'emplacement qui ne correspond pas au toit réel.
const free = computed(() => house.freeInverters(props.siteDeviceId))
const slots = computed(() => {
  const a = editing.value
  if (!a) return []
  return Array.from({ length: a.rows * a.cols }, (_, i) => {
    const deviceId = a.panels[i] ?? null
    const row = Math.floor(i / a.cols), col = i % a.cols
    // Une case vide porte sa place — les mêmes chiffres que la pilule du module dans la 3D
    // (« Emplacement 2-5 ») : c'est ce qui relie la grille du panneau à ce qu'on voit sur le toit.
    return {
      i, deviceId, key: panelDeviceId(a.id, row, col),
      label: deviceId ? shortInverterId(deviceId) : `${row + 1}-${col + 1}`,
      name: deviceId ? devices.descriptors[deviceId]?.name ?? deviceId : t('arrays.cell', { r: row + 1, c: col + 1 }),
    }
  })
})
function setSlot(i: number, deviceId: string | null) {
  const a = editing.value
  if (!a) return
  const panels: (string | null)[] = Array.from({ length: a.rows * a.cols }, (_, k) => a.panels[k] ?? null)
  panels[i] = deviceId
  void house.saveArray({ panels })
}
/** L'appareil de la maison derrière un emplacement : le sélectionner ouvre le panneau de ce module. */
function selectSlot(i: number) {
  const a = editing.value
  if (!a) return
  house.selectDevice(panelDeviceId(a.id, Math.floor(i / a.cols), i % a.cols))
}

// Retrait en deux temps, comme « Retirer de la maison » : un champ emporte tous ses modules.
const removeArmed = ref(false)
let disarm: ReturnType<typeof setTimeout> | undefined
function removeClick() {
  const a = editing.value
  if (!a) return
  if (!removeArmed.value) { removeArmed.value = true; disarm = setTimeout(() => { removeArmed.value = false }, 4000); return }
  clearTimeout(disarm)
  removeArmed.value = false
  void house.removeArray(a.id)
}
onBeforeUnmount(() => clearTimeout(disarm))

const origin = computed<Vec3>(() => house.arrayDraft ?? editing.value?.origin ?? [0, 0, 0])
const levelName = computed(() => {
  const id = editing.value?.levelId
  const level = id ? house.index?.levelsById.get(id) : undefined
  return level?.shortName ?? level?.name ?? ''
})
/** Un module portrait mesure 1,13 × 1,76 m : la taille écrite se lit en clair sous la grille. */
const moduleSize = computed(() => {
  const p = editing.value?.panel ?? PANEL_SIZE
  return `${p.width.toFixed(2)} × ${p.height.toFixed(2)} m`
})
</script>

<template>
  <div class="card card--soft arrays">
    <div class="arrays__row arrays__head">
      <span class="muted">{{ $t('arrays.title') }}</span>
      <button v-if="!editing" type="button" class="pill arrays__cta" :disabled="house.saving" :title="$t('arrays.addHint')" @click="house.addArray(props.siteDeviceId)">
        <StrokeIcon name="plus" :size="16" /> {{ $t('arrays.add') }}
      </button>
      <button v-else type="button" class="pill arrays__cta" data-on="1" @click="house.stopEditingArray()">{{ $t('arrays.done') }}</button>
    </div>

    <p v-if="fields.length === 0" class="muted arrays__hint">{{ $t('arrays.none') }}</p>

    <!-- la liste reste visible pendant le réglage : on passe d'un champ à l'autre sans refermer -->
    <button v-for="(a, i) in fields" :key="a.id" type="button" class="arrays__item" :data-on="a.id === house.editingArrayId ? '1' : '0'"
            @click="a.id === house.editingArrayId ? house.stopEditingArray() : house.startEditingArray(a.id, props.siteDeviceId)">
      <span class="icon-square"><StrokeIcon name="solar" :size="16" /></span>
      <span class="min0 arrays__item-main">
        <span class="arrays__item-name">{{ arrayName(a, i) }}</span>
        <span class="muted arrays__item-sub">{{ $t('arrays.count', { rows: a.rows, cols: a.cols, n: boundCount(a) }) }}</span>
      </span>
      <span class="arrays__item-cta">
        <StrokeIcon :name="a.id === house.editingArrayId ? 'check' : 'move'" :size="13" />
        {{ a.id === house.editingArrayId ? $t('arrays.done') : $t('arrays.edit') }}
      </span>
    </button>

    <template v-if="editing">
      <p class="muted arrays__hint">{{ $t('arrays.hint') }}</p>
      <div v-for="s in steppers" :key="s.key" class="arrays__row">
        <span class="muted" :title="s.hint">{{ s.label }}</span>
        <span class="arrays__turn">
          <button type="button" class="key" :disabled="house.saving" :title="`${$t('place.smaller')} — ${s.label}`" :aria-label="`${$t('place.smaller')} — ${s.label}`" @click="bump(s.key, -STEP[s.key])">
            <StrokeIcon name="minus" :size="16" />
          </button>
          <input class="arrays__num" type="text" :inputmode="s.key === 'z' ? 'decimal' : 'numeric'" enterkeyhint="done"
                 :value="shownValue(s.key, s.text)" :disabled="house.saving" :aria-label="s.label"
                 @focus="startEdit(s.key, String(s.value), $event)"
                 @mouseup.prevent
                 @input="draft = ($event.target as HTMLInputElement).value"
                 @keydown.enter="($event.target as HTMLInputElement).blur()"
                 @keydown.esc="editingField = null; ($event.target as HTMLInputElement).blur()"
                 @blur="commitEdit(s.key)">
          <button type="button" class="key" :disabled="house.saving" :title="`${$t('place.bigger')} — ${s.label}`" :aria-label="`${$t('place.bigger')} — ${s.label}`" @click="bump(s.key, STEP[s.key])">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </span>
      </div>
      <!-- orientation du champ : mêmes touches et même sens que le mode « Déplacer » -->
      <div class="arrays__row">
        <span class="muted" :title="$t('arrays.azimuthHint')">{{ $t('place.orientation') }}</span>
        <span class="arrays__turn">
          <button type="button" class="key" :disabled="house.saving" :title="$t('place.rotateLeft')" :aria-label="$t('place.rotateLeft')" @click="rotate(STEP.yaw)">
            <StrokeIcon name="rotateLeft" :size="16" />
          </button>
          <input class="arrays__num" type="text" inputmode="numeric" enterkeyhint="done"
                 :value="shownValue('yaw', `${editing.yaw}°`)" :disabled="house.saving" :aria-label="$t('place.orientation')"
                 @focus="startEdit('yaw', String(editing!.yaw), $event)"
                 @mouseup.prevent
                 @input="draft = ($event.target as HTMLInputElement).value"
                 @keydown.enter="($event.target as HTMLInputElement).blur()"
                 @keydown.esc="editingField = null; ($event.target as HTMLInputElement).blur()"
                 @blur="commitEdit('yaw')">
          <button type="button" class="key" :disabled="house.saving" :title="$t('place.rotateRight')" :aria-label="$t('place.rotateRight')" @click="rotate(-STEP.yaw)">
            <StrokeIcon name="rotateRight" :size="16" />
          </button>
        </span>
      </div>
      <div class="arrays__row">
        <span class="muted">{{ $t('arrays.module') }}<span class="arrays__size"> · {{ moduleSize }}</span></span>
        <Segmented dense class="arrays__layout" :model-value="layout" :options="layoutOptions" @update:model-value="setLayout" />
      </div>
      <!-- Sous le module, parce que c'est une propriété du module : ce qu'il donne au mieux ; puis
           ce que l'onduleur sous lui sait en sortir, qui est souvent plus bas. -->
      <div class="arrays__row">
        <span class="muted" :title="$t('arrays.peakHint')">{{ $t('arrays.peak') }}</span>
        <span class="arrays__turn">
          <button type="button" class="key" :disabled="house.saving" :title="`${$t('place.smaller')} — ${$t('arrays.peak')}`" :aria-label="`${$t('place.smaller')} — ${$t('arrays.peak')}`" @click="bump('peak', -STEP.peak)">
            <StrokeIcon name="minus" :size="16" />
          </button>
          <input class="arrays__num" type="text" inputmode="numeric" enterkeyhint="done"
                 :value="shownValue('peak', `${peak} Wc`)" :disabled="house.saving" :aria-label="$t('arrays.peak')"
                 @focus="startEdit('peak', String(peak), $event)"
                 @mouseup.prevent
                 @input="draft = ($event.target as HTMLInputElement).value"
                 @keydown.enter="($event.target as HTMLInputElement).blur()"
                 @keydown.esc="editingField = null; ($event.target as HTMLInputElement).blur()"
                 @blur="commitEdit('peak')">
          <button type="button" class="key" :disabled="house.saving" :title="`${$t('place.bigger')} — ${$t('arrays.peak')}`" :aria-label="`${$t('place.bigger')} — ${$t('arrays.peak')}`" @click="bump('peak', STEP.peak)">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </span>
      </div>

      <div class="arrays__row">
        <span class="muted" :title="$t('arrays.maxOutputHint')">{{ $t('arrays.maxOutput') }}</span>
        <span class="arrays__turn">
          <button type="button" class="key" :disabled="house.saving" :title="`${$t('place.smaller')} — ${$t('arrays.maxOutput')}`" :aria-label="`${$t('place.smaller')} — ${$t('arrays.maxOutput')}`" @click="bump('out', -STEP.out)">
            <StrokeIcon name="minus" :size="16" />
          </button>
          <!-- 0 = inconnue, et ça se dit par un tiret : « 0 W » affirmerait qu'aucun onduleur ne sort rien -->
          <input class="arrays__num" type="text" inputmode="numeric" enterkeyhint="done"
                 :value="shownValue('out', maxOut > 0 ? `${maxOut} W` : '—')" :disabled="house.saving" :aria-label="$t('arrays.maxOutput')"
                 @focus="startEdit('out', maxOut > 0 ? String(maxOut) : '', $event)"
                 @mouseup.prevent
                 @input="draft = ($event.target as HTMLInputElement).value"
                 @keydown.enter="($event.target as HTMLInputElement).blur()"
                 @keydown.esc="editingField = null; ($event.target as HTMLInputElement).blur()"
                 @blur="commitEdit('out')">
          <button type="button" class="key" :disabled="house.saving" :title="`${$t('place.bigger')} — ${$t('arrays.maxOutput')}`" :aria-label="`${$t('place.bigger')} — ${$t('arrays.maxOutput')}`" @click="bump('out', STEP.out)">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </span>
      </div>

      <!-- la grille des emplacements, rangée par rangée : c'est le calepinage du champ. Une case porte
           les quatre derniers caractères de l'onduleur ; on la touche pour en changer. -->
      <div class="arrays__row arrays__slots-head">
        <span class="muted">{{ $t('arrays.inverters') }}</span>
        <span class="muted arrays__free">{{ $t('arrays.freeCount', { n: free.length }) }}</span>
      </div>
      <div class="arrays__grid" :style="{ '--cols': editing.cols }">
        <v-menu v-for="s in slots" :key="s.i" location="bottom start"
                @update:model-value="(open: boolean) => house.hoverSlot(open ? s.key : null)">
          <template #activator="{ props: menu }">
            <!-- survoler une case allume son module dans la 3D : sans ce lien, on garnit la grille
                 sans savoir à quel panneau du toit chaque case correspond -->
            <button v-bind="menu" type="button" class="slot" :data-on="s.deviceId ? '1' : '0'" :disabled="house.saving" :title="s.name"
                    @mouseenter="house.hoverSlot(s.key)" @mouseleave="house.hoverSlot(null)"
                    @focus="house.hoverSlot(s.key)" @blur="house.hoverSlot(null)">{{ s.label }}</button>
          </template>
          <div class="card slot-list">
            <div class="section-label">{{ $t('arrays.inverters') }}</div>
            <button v-if="s.deviceId" type="button" class="slot-item" @click="selectSlot(s.i)">
              <StrokeIcon name="solar" :size="14" /> <span class="min0">{{ s.name }}</span>
            </button>
            <button type="button" class="slot-item" @click="setSlot(s.i, null)">{{ $t('arrays.slotNone') }}</button>
            <button v-for="d in free" :key="d.id" type="button" class="slot-item" @click="setSlot(s.i, d.id)">
              <span class="min0">{{ d.name }}</span>
            </button>
          </div>
        </v-menu>
      </div>

      <div class="arrays__row arrays__bottom">
        <div class="muted arrays__coords">x {{ origin[0].toFixed(2) }} · y {{ origin[1].toFixed(2) }} · {{ levelName }}</div>
        <button type="button" class="pill arrays__remove" :class="{ 'arrays__remove--armed': removeArmed }" :disabled="house.saving"
                :title="$t('arrays.removeHint')" @click="removeClick">
          {{ removeArmed ? $t('arrays.removeConfirm') : $t('arrays.remove') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.arrays { padding: 12px 14px; font-size: 13px; display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
.arrays__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.arrays__head { min-height: 34px; }
/* même largeur dans les deux états : le bouton ne change ni de place ni de taille. 104 px, pas
   davantage : au-delà, le titre de la carte ne tient plus sur une ligne dans les 295 px du panneau */
.arrays__cta { flex: 0 0 auto; min-width: 104px; justify-content: center; font-size: 12px; }
.arrays__head > .muted { white-space: nowrap; }
.arrays__hint { margin: 0; font-size: 12px; }
.arrays__item {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 8px 10px;
  border-radius: 12px; border: 1px solid var(--line); background: transparent; color: var(--text);
  transition: background .15s, border-color .15s;
}
.arrays__item:hover { background: var(--accent-soft); }
.arrays__item[data-on='1'] { border-color: var(--accent); background: var(--accent-soft); }
.arrays__item-main { display: grid; }
.arrays__item-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.arrays__item-sub { font-size: 12px; }
/* une pilule, pas une étiquette : « Régler » est ce qui ouvre le champ (et son glissement dans la 3D) */
.arrays__item-cta {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; font-size: 12px;
  padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted);
}
.arrays__item:hover .arrays__item-cta, .arrays__item[data-on='1'] .arrays__item-cta { border-color: var(--accent); color: var(--accent); }
.arrays__turn { display: inline-flex; align-items: center; gap: 6px; }
/* largeur fixe (« 180° », « 20 ») : la valeur change sans déplacer les touches */
.arrays__num {
  width: 5.5ch; min-width: 0; height: 30px; padding: 0; border: 0; background: transparent;
  color: inherit; font: inherit; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums;
  box-shadow: inset 0 -1px 0 var(--line); border-radius: 4px;
}
.arrays__num:focus { outline: none; background: var(--accent-soft); box-shadow: inset 0 -1px 0 var(--accent); }
.arrays__num:disabled { opacity: .4; box-shadow: none; }
.arrays__layout { flex: 0 0 auto; }
.arrays__size { font-variant-numeric: tabular-nums; }
.arrays__slots-head { margin-top: 2px; }
.arrays__free { font-size: 12px; }
.arrays__grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 4px; }
.slot {
  height: 26px; min-width: 0; border-radius: 7px; border: 1px solid var(--line); background: transparent;
  color: var(--muted); font: 600 11px/1 var(--font); font-variant-numeric: tabular-nums;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 2px;
}
.slot[data-on='1'] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.slot:disabled { opacity: .4; }
.slot-list { padding: 8px; display: grid; gap: 2px; max-height: 320px; overflow-y: auto; min-width: 200px; }
/* Police à CHASSE FIXE pour la liste : on y cherche un numéro de série relevé sur un plan, et des
   chiffres qui s'alignent en colonnes se comparent d'un coup d'œil. Les cases de la grille, elles,
   sont déjà en chiffres tabulaires — les deux se lisent ensemble. */
.slot-item {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 0; border-radius: 9px;
  background: transparent; color: var(--text); text-align: left; width: 100%;
  font: 13px/1.35 ui-monospace, 'SFMono-Regular', 'Menlo', 'Consolas', monospace;
  letter-spacing: -0.01em;
}
.slot-item:hover { background: var(--accent-soft); }
.arrays__coords { font-size: 12px; font-variant-numeric: tabular-nums; min-width: 0; }
/* largeur fixe pour les deux libellés (« Retirer le champ » / « Confirmer le retrait ») : rien ne bouge */
.arrays__remove { flex: 0 0 auto; min-width: 150px; justify-content: center; font-size: 12px; }
.arrays__remove--armed { border-color: var(--error, #e5484d); color: var(--error, #e5484d); }
.key {
  display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
</style>
