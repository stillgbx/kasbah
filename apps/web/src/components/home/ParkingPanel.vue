<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MIN_PARKING_DIM, PARKING_SIDES, PARKING_SNAP_MARGIN, isParkingBay, parkingLabel, type ParkingSide } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Panneau « place de stationnement » : ses deux cotes d'encombrement, son cap, et surtout les QUATRE
// cotes qui la situent dans son hôte — ce qui la sépare du contour du garage ou de l'allée devant,
// derrière et de chaque côté. C'est ainsi qu'on pose une place au mètre ruban, et c'est le même
// geste que les deux cotes d'une ouverture, au sol.
//
// Mêmes idiomes que `OpeningPanel` : touches −/+, saisie qui ne commite qu'à la validation, virgule
// décimale acceptée, chiffres à chasse fixe pour que rien ne bouge à la frappe.
//
// Règle commune aux quatre cotes de place : ON GARDE ce qui a été tapé et la place GLISSE de ce qui
// manque (`fitParkingGap`), la cote opposée suivant d'elle-même.
const emit = defineEmits<{ back: [] }>()
const house = useHouseStore()
const devices = useDevicesStore()
const { t } = useI18n()

const parking = computed(() => house.selectedParking)
const gaps = computed(() => house.parkingGapsOf)
const hostName = computed(() => {
  const h = house.parkingHostOf
  return h && h.kind !== 'terrain' ? h.name : ''
})

/** Ce que la place accepte, dit en clair : une place de voiture, ou la base de tel robot. */
const kindLabel = computed(() => {
  const p = parking.value
  if (!p) return ''
  return isParkingBay(p) ? t('parking.bay') : t('parking.dock')
})
/** Partagée, ou réservée à un appareil — c'est `deviceId` qui tranche (une base ne se partage pas). */
const ownerLabel = computed(() => {
  const p = parking.value
  if (!p?.deviceId) return t('parking.shared')
  const name = house.houseDeviceFor(p.deviceId)?.name ?? devices.descriptors[p.deviceId]?.name ?? p.deviceId
  return t('parking.reserved', { name })
})

type Field = 'width' | 'length' | ParkingSide
const STEP = 0.05
const fields = computed(() => (parking.value
  ? [
    { key: 'width' as const, label: t('parking.width') },
    { key: 'length' as const, label: t('parking.length') },
    ...PARKING_SIDES.map((s) => ({ key: s, label: t(`parking.${s}`) })),
  ]
  : []))

/** `null` sur une cote que rien ne mesure (place hors de tout hôte) : le champ affiche « — ». */
function fieldValue(field: Field): number | null {
  const p = parking.value
  if (!p) return null
  if (field === 'width') return p.size[0]
  if (field === 'length') return p.size[1]
  return gaps.value?.[field] ?? null
}
const shownNumber = (field: Field) => {
  const v = fieldValue(field)
  return v === null ? '—' : v.toFixed(2)
}

const editing = ref<Field | null>(null)
const draft = ref('')
function startEdit(field: Field, ev?: FocusEvent) {
  editing.value = field
  draft.value = shownNumber(field)
  const el = ev?.target as HTMLInputElement | undefined
  if (el) void nextTick(() => el.select())
}
function cancelEdit() { editing.value = null }
const shownValue = (field: Field) => (editing.value === field ? draft.value : shownNumber(field))

function apply(field: Field, wanted: number) {
  const p = parking.value
  if (!p) return
  if (field === 'width' || field === 'length') {
    const next = Math.max(MIN_PARKING_DIM, Math.round(wanted * 100) / 100)
    const size: [number, number] = field === 'width' ? [next, p.size[1]] : [p.size[0], next]
    if (size[0] !== p.size[0] || size[1] !== p.size[1]) void house.saveParking({ size })
    return
  }
  void house.setParkingGap(field, Math.max(0, wanted))
}
function bump(field: Field, delta: number) {
  const v = fieldValue(field)
  if (v === null) return
  apply(field, v + delta)
}
function commitEdit(field: Field) {
  if (editing.value !== field) return
  editing.value = null
  const raw = Number(draft.value.replace(',', '.').trim())
  if (Number.isFinite(raw)) apply(field, raw)
}

/**
 * Le cap, par quarts de tour et par pas de 5° : une place se pose dans le sens du garage, et c'est
 * un demi-tour qu'on corrige le plus souvent (l'avant est du mauvais côté). L'angle est ramené dans
 * `[-180, 180[` AVANT l'envoi — le contrat le borne, saisir 200° doit donner -160°, pas un refus.
 */
const wrap = (deg: number) => ((deg + 180) % 360 + 360) % 360 - 180
function turn(delta: number) {
  const p = parking.value
  if (!p) return
  void house.saveParking({ yaw: Math.round(wrap(p.yaw + delta) * 100) / 100 })
}

/** Rayon d'accroche propre à la place. Vide = la marge commune ; `0` l'efface (règle du contrat). */
const margin = computed(() => parking.value?.margin ?? null)
const marginDraft = ref('')
const editingMargin = ref(false)
function startMargin(ev?: FocusEvent) {
  editingMargin.value = true
  marginDraft.value = margin.value === null ? '' : margin.value.toFixed(2)
  const el = ev?.target as HTMLInputElement | undefined
  if (el) void nextTick(() => el.select())
}
function commitMargin() {
  editingMargin.value = false
  const raw = marginDraft.value.replace(',', '.').trim()
  const next = raw === '' ? 0 : Number(raw)
  if (!Number.isFinite(next) || next === (margin.value ?? 0)) return
  void house.saveParking({ margin: Math.max(0, Math.round(next * 100) / 100) })
}

// --- nom : facultatif. Vide = effacer et revenir à l'id, comme pour une ouverture.
const displayName = computed(() => (parking.value ? parkingLabel(parking.value) : ''))
const renamingName = ref(false)
const nameDraft = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
function startRename() {
  renamingName.value = true
  nameDraft.value = parking.value?.name ?? ''
  void nextTick(() => nameInput.value?.select())
}
function commitRename() {
  renamingName.value = false
  const wanted = nameDraft.value.trim()
  if (wanted === (parking.value?.name ?? '')) return
  void house.saveParking({ name: wanted })
}

// --- supprimer : geste en DEUX TEMPS (armer, puis confirmer dans les 4 s), comme une ouverture.
const removeArmed = ref(false)
let disarm: ReturnType<typeof setTimeout> | undefined
function clickRemove() {
  if (!removeArmed.value) { removeArmed.value = true; disarm = setTimeout(() => { removeArmed.value = false }, 4000); return }
  clearTimeout(disarm)
  removeArmed.value = false
  void house.removeParking()
}
onBeforeUnmount(() => clearTimeout(disarm))
</script>

<template>
  <template v-if="parking">
    <div class="panel-head">
      <button type="button" class="crumb" @click="emit('back')"><StrokeIcon name="back" :size="14" /> {{ $t('nav.home') }}</button>
      <div class="head">
        <span class="icon-square icon-square--lg"><StrokeIcon name="parking" :size="22" /></span>
        <div class="head__main">
          <div class="head__name-row">
            <input v-if="renamingName" ref="nameInput" v-model="nameDraft" class="head__name head__name-input"
                   maxlength="60" :aria-label="$t('parking.rename')" :placeholder="parking.id"
                   @keyup.enter="commitRename" @keyup.escape="renamingName = false" @blur="commitRename">
            <template v-else>
              <MarqueeText class="head__name" :text="displayName" />
              <button type="button" class="head__pencil" :title="$t('parking.rename')" :aria-label="$t('parking.rename')" @click="startRename">
                <StrokeIcon name="pencil" :size="14" />
              </button>
            </template>
          </div>
          <div class="muted head__sub">{{ kindLabel }} · {{ ownerLabel }}</div>
        </div>
      </div>
    </div>

    <div class="card card--soft park">
      <div v-for="f in fields" :key="f.key" class="park__row">
        <span class="muted">{{ f.label }}</span>
        <span class="park__turn">
          <button type="button" class="key" :disabled="house.savingParking || fieldValue(f.key) === null"
                  :title="`${$t('parking.smaller')} — ${f.label}`" :aria-label="`${$t('parking.smaller')} — ${f.label}`"
                  @click="bump(f.key, -STEP)">
            <StrokeIcon name="minus" :size="16" />
          </button>
          <input class="park__num" type="text" inputmode="decimal" enterkeyhint="done"
                 :value="shownValue(f.key)" :disabled="house.savingParking || fieldValue(f.key) === null" :aria-label="f.label"
                 @focus="startEdit(f.key, $event)"
                 @mouseup.prevent
                 @input="draft = ($event.target as HTMLInputElement).value"
                 @keydown.enter="($event.target as HTMLInputElement).blur()"
                 @keydown.esc="cancelEdit(); ($event.target as HTMLInputElement).blur()"
                 @blur="commitEdit(f.key)">
          <button type="button" class="key" :disabled="house.savingParking || fieldValue(f.key) === null"
                  :title="`${$t('parking.bigger')} — ${f.label}`" :aria-label="`${$t('parking.bigger')} — ${f.label}`"
                  @click="bump(f.key, STEP)">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </span>
      </div>

      <!-- deux lignes réservées : la carte garde sa hauteur, que la place soit posée sur un hôte ou non -->
      <p class="muted park__hint">{{ gaps ? $t('parking.gaps', { host: hostName || $t('floors.garden') }) : $t('parking.noHost') }}</p>

      <div class="park__row">
        <span class="muted">{{ $t('parking.yaw') }}</span>
        <span class="park__turn">
          <button type="button" class="key" :disabled="house.savingParking"
                  :title="$t('parking.turnLeft')" :aria-label="$t('parking.turnLeft')" @click="turn(5)">−5°</button>
          <span class="park__num park__num--read">{{ Math.round(parking.yaw) }}°</span>
          <button type="button" class="key" :disabled="house.savingParking"
                  :title="$t('parking.turnRight')" :aria-label="$t('parking.turnRight')" @click="turn(-5)">+5°</button>
          <button type="button" class="key key--wide" :disabled="house.savingParking" @click="turn(180)">180°</button>
        </span>
      </div>

      <div class="park__row">
        <span class="muted">{{ $t('parking.margin') }}</span>
        <span class="park__turn">
          <input class="park__num park__num--margin" type="text" inputmode="decimal" enterkeyhint="done"
                 :value="editingMargin ? marginDraft : (margin === null ? '—' : margin.toFixed(2))"
                 :disabled="house.savingParking" :aria-label="$t('parking.margin')"
                 @focus="startMargin($event)"
                 @input="marginDraft = ($event.target as HTMLInputElement).value"
                 @keydown.enter="($event.target as HTMLInputElement).blur()"
                 @keydown.esc="editingMargin = false; ($event.target as HTMLInputElement).blur()"
                 @blur="commitMargin">
        </span>
      </div>
      <p class="muted park__hint park__hint--one">{{ $t('parking.marginHint', { default: PARKING_SNAP_MARGIN }) }}</p>

      <div class="park__row park__bottom">
        <button type="button" class="pill park__remove" :class="{ 'park__remove--armed': removeArmed }"
                :disabled="house.savingParking" @click="clickRemove">
          {{ removeArmed ? $t('parking.removeConfirm') : $t('parking.remove') }}
        </button>
      </div>
      <p class="muted park__hint park__hint--one">{{ $t('parking.whereHint') }}</p>
    </div>
  </template>
</template>

<style scoped>
.crumb { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted); font-size: 13px; padding: 0; align-self: flex-start; }
.crumb:hover { color: var(--text); }
.head { display: flex; align-items: center; gap: 12px; }
.head__main { flex: 1 1 0; min-width: 0; }
.head__name-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
/* `flex: 1 1 0` : `MarqueeText` n'a pas de largeur intrinsèque (voir `OpeningPanel`) */
.head__name { flex: 1 1 0; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; min-width: 0; }
.head__pencil {
  flex: none; display: grid; place-items: center; width: 22px; height: 22px; padding: 0;
  border: 0; border-radius: 6px; background: none; color: var(--muted); cursor: pointer; opacity: .55;
}
.head__pencil:hover, .head__pencil:focus-visible { opacity: 1; background: var(--surface2); color: var(--text); }
.head__name-input {
  flex: 1 1 auto; min-width: 0; padding: 0 6px; margin: 0 -6px;
  border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text);
  font: inherit; font-size: inherit; font-weight: inherit;
}
.head__sub { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-square--lg { width: 44px; height: 44px; border-radius: 12px; flex: none; }

.park { padding: 12px 14px; font-size: 13px; display: grid; gap: 10px; }
.park__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.park__turn { display: inline-flex; align-items: center; gap: 6px; }
/* deux lignes réservées : le texte change (hôte nommé, ou aucun) sans déplacer ce qui suit */
.park__hint { margin: 0; font-size: 12px; min-height: 32px; line-height: 16px; }
.park__hint--one { min-height: 16px; }
.park__bottom { min-height: 34px; }
.park__remove { flex: 0 0 auto; min-width: 175px; justify-content: center; font-size: 12px; }
.park__remove--armed { border-color: var(--error, #e5484d); color: var(--error, #e5484d); }
/* largeur fixe (« 12.34 ») : la valeur change sans déplacer les touches */
.park__num {
  width: 5ch; min-width: 0; height: 30px; padding: 0; border: 0; background: transparent;
  color: inherit; font: inherit; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums;
  box-shadow: inset 0 -1px 0 var(--line); border-radius: 4px;
}
.park__num:focus { outline: none; background: var(--accent-soft); box-shadow: inset 0 -1px 0 var(--accent); }
.park__num:disabled { opacity: .4; box-shadow: none; }
/* le cap se lit, il ne se tape pas : les touches le tournent (même boîte que les champs) */
.park__num--read { display: inline-grid; place-items: center; box-shadow: none; }
.park__num--margin { width: 6ch; }
.key {
  display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
  font: inherit; font-size: 12px;
}
.key--wide { width: 44px; }
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
</style>
