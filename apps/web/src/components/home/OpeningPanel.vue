<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MIN_OPENING_DIM, OPENING_TYPES, fitGap, fitHeight, fitWidth, openingGaps, openingLabel, openingSill, resolveDefaults, type OpeningType, type Room } from '@kasbah/shared'
import { canTakeOpening } from '../../lib/cover'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Panneau « ouverture » : nature, cotes (largeur, hauteur, hauteur d'allège, position sur le mur) et
// lien vers un ouvrant. La place se lisait seule au début ; elle se règle maintenant ici aussi, au
// mètre ruban depuis les coins — le glissement au doigt ne pose pas une fenêtre à 3,56 m d'un coin.
//
// Mêmes idiomes que `PlacementControl` : touches −/+, saisie directe qui ne commite qu'à la
// validation, virgule décimale acceptée, chiffres à chasse fixe pour que rien ne bouge à la frappe.
//
// Règle commune aux cinq cotes (largeur, hauteur, allège, gauche, droite) : ON GARDE ce que
// l'utilisateur a tapé et on déplace ce qui peut l'être, plutôt que de rogner en silence. Taper 3 m
// de large dans un vide de 3 m qui n'a qu'1 m à droite fait GLISSER l'ouverture (`fitWidth`) ; une
// hauteur qui ne tient plus fait DESCENDRE l'allège (`fitHeight`) ; une des deux cotes de position
// déplace l'ouverture le long de son mur et l'autre cote suit (`fitGap`). Chaque geste est une seule
// écriture : les deux valeurs qui changent ensemble partent dans la même requête.
const emit = defineEmits<{ back: [] }>()
const house = useHouseStore()
const devices = useDevicesStore()
const { t } = useI18n()

const sel = computed(() => house.selectedOpening)
const opening = computed(() => sel.value?.opening ?? null)
const room = computed(() => sel.value?.room ?? null)
/** Les pièces du même niveau : `fitWidth`/`fitGap` en ont besoin pour voir les murs mitoyens. */
const roomsOnLevel = computed<Room[]>(() => {
  const r = room.value
  return r ? house.index?.roomsByLevel.get(r.levelId) ?? [r] : []
})

const typeOptions = computed(() => OPENING_TYPES.map((v) => ({ value: v, label: t(`opening.types.${v}`) })))
/**
 * Changer de nature écrit aussi l'allège, DANS LA MÊME requête, pour tout ce qui touche le sol
 * (porte, passage, porte de garage, baie vitrée, porte vitrée) : `openingSill` ne rend 0 par défaut
 * que si `sill` est ABSENT du JSON, donc une fenêtre retypée en baie sans ce geste gardait son muret
 * (mesuré : 20 cm). Un seul geste pour l'utilisateur (choisir « Baie vitrée »), une seule écriture.
 * `window`, seule à prendre une allège par défaut, ne devine rien : la valeur existante reste,
 * l'utilisateur la règle lui-même.
 */
function setType(v: OpeningType) {
  if (v === opening.value?.type) return
  void house.saveOpening(v === 'window' ? { type: v } : { type: v, sill: 0 })
}

/** Hauteur d'allège EFFECTIVE (le défaut de la maison si le JSON n'en donne pas). */
const sill = computed(() => {
  const o = opening.value
  return o && house.house ? openingSill(o, resolveDefaults(house.house.defaults)) : 0
})
/** Les deux cotes de position, au mètre ruban depuis chaque coin du mur (`openingGaps`). */
const gaps = computed(() => (opening.value && room.value ? openingGaps(room.value, opening.value) : { left: 0, right: 0 }))

type Field = 'width' | 'height' | 'sill' | 'left' | 'right'
const STEP = 0.05
const fields = computed(() => {
  const o = opening.value
  if (!o) return []
  return [
    { key: 'width' as const, label: t('opening.width') },
    { key: 'height' as const, label: t('opening.height') },
    { key: 'sill' as const, label: t('opening.sill') },
    // lues de gauche à droite comme on les lirait dans la pièce, même si c'est la cote de DROITE
    // qui porte `offset` dans le fichier
    { key: 'left' as const, label: t('opening.gapLeft') },
    { key: 'right' as const, label: t('opening.gapRight') },
  ]
})
function fieldValue(field: Field): number {
  const o = opening.value
  if (!o) return 0
  switch (field) {
    case 'width': return o.width
    case 'height': return o.height
    case 'sill': return sill.value
    case 'right': return gaps.value.right
    case 'left': return gaps.value.left
  }
}

const editing = ref<Field | null>(null)
const draft = ref('')
function startEdit(field: Field, shown: string, ev?: FocusEvent) {
  editing.value = field
  draft.value = shown
  const el = ev?.target as HTMLInputElement | undefined
  if (el) void nextTick(() => el.select())
}
function cancelEdit() { editing.value = null }
const shownValue = (field: Field, value: string) => (editing.value === field ? draft.value : value)

/**
 * Applique une cote VOULUE : garde ce qui a été tapé, déplace ce qui peut l'être, une seule écriture.
 * `width`/`height` peuvent faire bouger une seconde valeur (`offset`/`sill`) — les deux partent dans
 * le même `saveOpening`, sinon la carte montrerait un instant deux nombres incohérents.
 */
function apply(field: Field, wanted: number) {
  const o = opening.value
  if (!o || !house.house) return
  const defaults = resolveDefaults(house.house.defaults)
  if (field === 'width') {
    if (!room.value) return
    const r = fitWidth(room.value, roomsOnLevel.value, defaults, o, wanted)
    if (r && (r.width !== o.width || r.offset !== o.offset)) void house.saveOpening({ width: r.width, offset: r.offset })
    return
  }
  if (field === 'height') {
    const r = fitHeight(sill.value, o.height, house.openingCeiling, wanted)
    if (r.height !== o.height || r.sill !== sill.value) void house.saveOpening({ height: r.height, sill: r.sill })
    return
  }
  if (field === 'sill') {
    const max = house.openingBounds?.maxSill ?? wanted
    const next = Math.min(max, Math.max(0, Math.round(wanted * 100) / 100))
    if (next !== sill.value) void house.saveOpening({ sill: next })
    return
  }
  // 'right' / 'left' : les deux cotes de position, vues DE L'INTÉRIEUR de la pièce (c'est de là
  // qu'on relève au mètre ruban, cf. `openingGaps`). L'une déplace l'ouverture et l'AUTRE SUIT —
  // c'est ce qui les rend compréhensibles en paire (voir `fitGap`).
  if (!room.value) return
  const next = fitGap(room.value, roomsOnLevel.value, defaults, o, field, wanted)
  if (next !== null && next !== o.offset) void house.saveOpening({ offset: next })
}
function bump(field: Field, delta: number) { apply(field, fieldValue(field) + delta) }
function commitEdit(field: Field) {
  if (editing.value !== field) return
  editing.value = null
  const raw = Number(draft.value.replace(',', '.').trim())
  if (!Number.isFinite(raw)) return
  // plancher de saisie : `width`/`height` ne descendent jamais sous `MIN_OPENING_DIM` (une ouverture
  // de 0 disparaîtrait) ; `sill`/`left`/`right` peuvent valoir 0 (une porte, un coin du mur)
  apply(field, Math.max(field === 'width' || field === 'height' ? MIN_OPENING_DIM : 0, raw))
}

/** Lecture seule : le mur qui porte l'ouverture — sa place, elle, se règle juste en dessous. */
const wallLabel = computed(() => (opening.value ? t('opening.wall', { segment: opening.value.segment + 1 }) : ''))

// --- nom : facultatif, saisi ici. Vide = effacer et revenir à l'id du relevé (même convention que
// `house.renameDevice`). `openingLabel` est LA règle d'affichage, partagée avec la liste de la pièce
// et l'étiquette 3D : jamais une fenêtre nommée de trois façons différentes.
const displayName = computed(() => (opening.value ? openingLabel(opening.value) : ''))
const renamingName = ref(false)
const nameDraft = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
function startRename() {
  renamingName.value = true
  nameDraft.value = opening.value?.name ?? ''
  void nextTick(() => nameInput.value?.select())
}
function commitRename() {
  renamingName.value = false
  const wanted = nameDraft.value.trim()
  if (wanted === (opening.value?.name ?? '')) return
  void house.saveOpening({ name: wanted })
}

/** Le libellé d'une ouverture, retrouvée par son id à travers les pièces (pour dire à qui appartient
 * l'ouverture qui occupe déjà un ouvrant candidat). */
function openingLabelById(id: string): string {
  for (const r of house.effective?.rooms ?? []) {
    const o = r.openings.find((x) => x.id === id)
    if (o) return openingLabel(o)
  }
  return id
}

/** Ouvrants candidats : les appareils qu'on a le DROIT d'affecter à une ouverture (`canTakeOpening` —
 * tout sauf portail et porte de garage, une seule règle avec la vue Ouvrants).
 *
 * `d.kind` seul ne suffit pas : un appareil du JSON brut (relié par `deviceId` seulement, jamais
 * auto-placé) ne le porte pas — c'est le descripteur du plugin qui tranche, comme partout ailleurs
 * dans l'app (`RoomPanel#row`, `DevicePanel`). Sans ce détour, la liste restait vide et le sélecteur
 * retombait sur l'id brut de l'ouvrant déjà lié, faute d'options où le retrouver.
 * Le NOM, lui, suit la même règle que partout : celui de la maison s'il y en a un, sinon celui que
 * le fabricant déclare — jamais l'id. Un ouvrant déjà posé sur une AUTRE ouverture se distingue
 * (« déjà posé sur… ») sans disparaître : le reprendre est un geste voulu, `setOpeningDevice` libère
 * l'ancien lien tout seul. */
const deviceOptions = computed(() => {
  const list = (house.effective?.devices ?? [])
    .map((d) => ({ d, descriptor: d.deviceId ? devices.descriptors[d.deviceId] : undefined }))
    .filter(({ d, descriptor }) => (descriptor?.kind ?? d.kind) === 'cover' && canTakeOpening(descriptor))
    .map(({ d, descriptor }) => {
      const name = d.name ?? descriptor?.name ?? d.id
      const takenElsewhere = d.openingId && d.openingId !== opening.value?.id
      return { value: d.id, title: takenElsewhere ? t('opening.deviceTaken', { name, opening: openingLabelById(d.openingId!) }) : name }
    })
  return [{ value: '', title: t('opening.deviceNone') }, ...list]
})
const linkedDeviceId = computed(() => house.openingDevices[0]?.id ?? '')
function setDevice(id: string) { void house.setOpeningDevice(id || null) }
</script>

<template>
  <template v-if="opening && room">
    <div class="panel-head">
      <button type="button" class="crumb" @click="emit('back')"><StrokeIcon name="back" :size="14" /> {{ room.name }}</button>
      <div class="head">
        <span class="icon-square icon-square--lg"><StrokeIcon name="room" :size="22" /></span>
        <div class="head__main">
          <!-- nom, ou saisie : le champ occupe la MÊME ligne que le titre, comme le renommage d'un
               véhicule (`VehiclesView`) — vide efface et rend la main à `openingLabel` (l'id du relevé) -->
          <div class="head__name-row">
            <input v-if="renamingName" ref="nameInput" v-model="nameDraft" class="head__name head__name-input"
                   maxlength="60" :aria-label="$t('opening.rename')" :placeholder="opening.id"
                   @keyup.enter="commitRename" @keyup.escape="renamingName = false" @blur="commitRename">
            <template v-else>
              <MarqueeText class="head__name" :text="displayName" />
              <button type="button" class="head__pencil" :title="$t('opening.rename')" :aria-label="$t('opening.rename')" @click="startRename">
                <StrokeIcon name="pencil" :size="14" />
              </button>
            </template>
          </div>
          <div class="muted head__sub">{{ wallLabel }}</div>
        </div>
      </div>
    </div>

    <div class="card card--soft opening">
      <!-- `Segmented` a été essayé ici : ses quatre libellés (« Porte de garage » compris) imposent
           393 px de min-content, largeur que le panneau (294 px utiles) ne peut pas offrir — toute la
           carte débordait. Un `v-select`, comme le niveau de `PlacementControl`, se serre à sa place. -->
      <div class="opening__row">
        <span class="muted">{{ $t('opening.type') }}</span>
        <v-select class="opening__select" :model-value="opening.type" :items="typeOptions" item-title="label" item-value="value"
                  density="compact" variant="outlined" hide-details :disabled="house.savingOpening"
                  :aria-label="$t('opening.type')" @update:model-value="setType" />
      </div>

      <div v-for="f in fields" :key="f.key" class="opening__row">
        <span class="muted">{{ f.label }}</span>
        <span class="opening__turn">
          <button type="button" class="key" :disabled="house.savingOpening"
                  :title="`${$t('opening.smaller')} — ${f.label}`" :aria-label="`${$t('opening.smaller')} — ${f.label}`"
                  @click="bump(f.key, -STEP)">
            <StrokeIcon name="minus" :size="16" />
          </button>
          <input class="opening__num" type="text" inputmode="decimal" enterkeyhint="done"
                 :value="shownValue(f.key, fieldValue(f.key).toFixed(2))" :disabled="house.savingOpening" :aria-label="f.label"
                 @focus="startEdit(f.key, fieldValue(f.key).toFixed(2), $event)"
                 @mouseup.prevent
                 @input="draft = ($event.target as HTMLInputElement).value"
                 @keydown.enter="($event.target as HTMLInputElement).blur()"
                 @keydown.esc="cancelEdit(); ($event.target as HTMLInputElement).blur()"
                 @blur="commitEdit(f.key)">
          <button type="button" class="key" :disabled="house.savingOpening"
                  :title="`${$t('opening.bigger')} — ${f.label}`" :aria-label="`${$t('opening.bigger')} — ${f.label}`"
                  @click="bump(f.key, STEP)">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </span>
      </div>

      <p class="muted opening__hint">{{ $t('opening.whereHint') }}</p>

      <div class="opening__row">
        <span class="muted">{{ $t('opening.device') }}</span>
        <v-select class="opening__device" :model-value="linkedDeviceId" :items="deviceOptions" item-title="title" item-value="value"
                  density="compact" variant="outlined" hide-details :disabled="house.savingOpening"
                  :aria-label="$t('opening.device')" @update:model-value="setDevice" />
      </div>

      <div class="opening__row opening__bottom">
        <span />
        <!-- place réservée : invisible tant qu'il n'y a rien à rétablir, la ligne ne bouge pas -->
        <button type="button" class="pill opening__revert" :class="{ 'opening__revert--off': !house.canRevertOpening }"
                :disabled="house.savingOpening || !house.canRevertOpening" :tabindex="house.canRevertOpening ? 0 : -1"
                @click="house.revertOpening()">
          {{ $t('opening.revert') }}
        </button>
      </div>
    </div>
  </template>
</template>

<style scoped>
.crumb { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted); font-size: 13px; padding: 0; align-self: flex-start; }
.crumb:hover { color: var(--text); }
.head { display: flex; align-items: center; gap: 12px; }
.head__main { flex: 1 1 0; min-width: 0; }
.head__name-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
/* `flex: 1 1 0` et non `1 1 auto` : `MarqueeText` porte `contain: inline-size` (voir son commentaire),
   qui annule sa largeur intrinsèque — dans un conteneur FLEX, un `flex-basis: auto` se rabat alors
   sur cette largeur nulle et le nom n'a plus aucune place (mesuré : 0 px). Un flex-basis à 0 lui
   donne toute la place restante quel que soit son contenu, comme `.head__main` (bloc) le fait déjà
   pour `DevicePanel`. */
.head__name { flex: 1 1 0; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; min-width: 0; }
/* le crayon ne prend pas de place tant qu'on ne le survole pas : toujours au même point, discret */
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
/* une seule ligne, toujours : filet de sécurité si la fonte ou la traduction dépasse quand même le
   pire cas prévu (voir `whereLabel`) — l'ellipse coupe plutôt que de pousser la carte de 17 px */
.head__sub { font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-square--lg { width: 44px; height: 44px; border-radius: 12px; flex: none; }

.opening { padding: 12px 14px; font-size: 13px; display: grid; gap: 10px; }
.opening__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.opening__turn { display: inline-flex; align-items: center; gap: 6px; }
.opening__hint { margin: 0; font-size: 12px; }
/* largeur FIXE, au bout de la ligne : même patron que le sélecteur de niveau de `PlacementControl`
   (`place__level`, 150 px) — un segmenté imposait 393 px de min-content (« Porte de garage » compris)
   et faisait déborder toute la carte, un `v-select` se serre à la largeur qu'on lui donne */
.opening__select, .opening__device { flex: 0 0 auto; width: 150px; }
.opening__bottom { min-height: 34px; }
/* place réservée pour « Rétablir » : rien ne bouge quand elle apparaît */
.opening__revert--off { visibility: hidden; }
/* largeur fixe (« 1.20 ») : la valeur change sans déplacer les touches */
.opening__num {
  width: 5ch; min-width: 0; height: 30px; padding: 0; border: 0; background: transparent;
  color: inherit; font: inherit; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums;
  box-shadow: inset 0 -1px 0 var(--line); border-radius: 4px;
}
.opening__num:focus { outline: none; background: var(--accent-soft); box-shadow: inset 0 -1px 0 var(--accent); }
.opening__num:disabled { opacity: .4; box-shadow: none; }
.key {
  display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
</style>
