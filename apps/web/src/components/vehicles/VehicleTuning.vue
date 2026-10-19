<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { vehicleLeaseSchema, type DeviceDescriptor, type VehicleLease } from '@kasbah/shared'
import { getTransport } from '../../api'
import type { RenaultContract } from '../../api/transport'
import { useHouseStore } from '../../stores/house'
import { bodyColorOf, bodyFinishOf, needsCapacity, tunableVehicle } from '../../lib/vehicleTuning'
import { VEHICLE_FINISHES, type VehicleFinish } from '@kasbah/shared'
import { modelsFor, NO_MODEL, resolveModel } from '../../three/models/catalog'

/**
 * Ce que seul l'utilisateur peut savoir d'un véhicule : le décalage de sa place calculée, la
 * correction de son cap, la capacité de sa batterie. Ces valeurs vivent dans la MAISON
 * (`house.devices[]`) et non dans l'état, qui est la vérité du fabricant, réécrite à chaque lecture.
 *
 * Le décalage (m, repère maison) : ni le GPS de la voiture ni l'origine de la maison ne sont exacts
 * au mètre, et l'écart qu'on mesure à l'œil dans la scène se saisit ici une fois pour toutes.
 * La rotation (°) : elle s'AJOUTE au cap que la scène déduit (celui du fabricant, ou l'axe de la
 * pièce) — aucun des deux ne dit de quel côté la voiture s'est garée ; un demi-tour se saisit ici.
 * La capacité (kWh) : AUCUN fabricant ne la donne — ni Tesla, ni Renault — et sans elle on ne peut
 * pas estimer la puissance de charge d'un véhicule qui ne la dit pas.
 *
 * La carrosserie 3D et sa couleur relèvent de la même règle : le catalogue sait quelles formes sont
 * livrées, mais pas laquelle est garée là — un plugin de marque peut couvrir plusieurs modèles — et
 * AUCUN fabricant ne publie la teinte d'un véhicule. Le select ne propose que les carrosseries du
 * plugin du véhicule — on ne gare pas une Model S dans le garage d'une R5 —, à défaut celles de sa
 * marque, pour la voiture qu'un plugin générique publie (la simulation, par exemple).
 *
 * Deux surfaces l'affichent : la carte de la vue Véhicules (repliée derrière « Régler ») et le
 * panneau de l'appareil sélectionné, où l'on voit la voiture BOUGER dans la scène en la réglant.
 */
const props = defineProps<{ descriptor: DeviceDescriptor }>()
const house = useHouseStore()
const { locale } = useI18n()

const houseDevice = computed(() => house.houseDeviceFor(props.descriptor.id))
const tunable = computed(() => tunableVehicle(props.descriptor, houseDevice.value))
/** Rien à corriger pour un véhicule qu'on a PLACÉ à la main dans la maison : son entrée fait déjà foi. */
const gpsPlaced = computed(() => houseDevice.value?.position === undefined)
const capacityNeeded = computed(() => needsCapacity(props.descriptor))
const rotation = computed(() => houseDevice.value?.yawOffset ?? 0)
const capacity = computed(() => houseDevice.value?.batteryKwh ?? 0)
const offsetOf = (axis: 0 | 1) => houseDevice.value?.gpsOffset?.[axis] ?? 0

/** Un champ vidé vaut 0, et 0 EFFACE le réglage — c'est ce que dit le contrat d'écriture. */
const typed = (raw: string) => (raw.trim() === '' ? 0 : Number(raw.replace(',', '.')))
function setOffset(axis: 0 | 1, raw: string): void {
  const value = typed(raw)
  if (!Number.isFinite(value) || value === offsetOf(axis)) return
  const next: [number, number] = axis === 0 ? [value, offsetOf(1)] : [offsetOf(0), value]
  void house.setDeviceTuning(props.descriptor.id, { gpsOffset: next })
}
/** Ramené dans [-180, 180[ : 200° et -160° sont la même rotation, et le contrat refuse le premier. */
function setRotation(raw: string): void {
  const typedValue = typed(raw)
  if (!Number.isFinite(typedValue)) return
  const value = ((((typedValue + 180) % 360) + 360) % 360) - 180
  if (value === rotation.value) return
  void house.setDeviceTuning(props.descriptor.id, { yawOffset: value })
}
function setCapacity(raw: string): void {
  const value = typed(raw)
  if (!Number.isFinite(value) || value < 0 || value === capacity.value) return
  void house.setDeviceTuning(props.descriptor.id, { batteryKwh: value })
}

/**
 * La LOA se saisit en BROUILLON : début, fin et forfait n'ont de sens qu'ensemble, et le contrat
 * d'écriture la prend d'un bloc. Chaque champ modifié écrit dès que le tout est valable ; tout vider
 * l'efface. Le brouillon suit la maison (« Rétablir », l'autre surface) tant qu'on n'y touche pas.
 */
const lease = computed(() => houseDevice.value?.lease)
const draft = reactive({ start: '', end: '', km: '', startKm: '' })
function syncDraft(l: VehicleLease | undefined): void {
  draft.start = l?.start ?? ''
  draft.end = l?.end ?? ''
  draft.km = l ? String(l.km) : ''
  draft.startKm = l?.startKm ? String(l.startKm) : ''
}
watch(lease, syncDraft, { immediate: true })
function writeLease(): void {
  if (!draft.start && !draft.end && !draft.km && !draft.startKm) {
    if (lease.value) void house.setDeviceTuning(props.descriptor.id, { lease: '' })
    return
  }
  const startKm = typed(draft.startKm)
  const parsed = vehicleLeaseSchema.safeParse({
    start: draft.start, end: draft.end, km: typed(draft.km), ...(startKm ? { startKm } : {}),
  })
  // incomplet : le brouillon attend la suite, rien n'est écrit
  if (!parsed.success || JSON.stringify(parsed.data) === JSON.stringify(lease.value)) return
  void house.setDeviceTuning(props.descriptor.id, { lease: parsed.data })
}
function setLeaseField(field: keyof typeof draft, raw: string): void {
  draft[field] = raw.trim()
  writeLease()
}
function clearLease(): void {
  syncDraft(undefined)
  writeLease()
}

/**
 * « Chercher chez Renault » : un contrat d'entretien plafonné en km est souvent calé sur la LOA,
 * mais rien ne le garantit — il est PROPOSÉ, jamais écrit d'office. Lu au clic seulement.
 */
const renaultVin = computed(() => (props.descriptor.pluginId === 'renault' ? props.descriptor.externalId : null))
const contracts = ref<RenaultContract[] | null>(null)
const checking = ref(false)
const checkError = ref<string | null>(null)
async function checkRenault(): Promise<void> {
  if (!renaultVin.value || checking.value) return
  checking.value = true
  checkError.value = null
  try { contracts.value = (await getTransport().renaultContracts(renaultVin.value, locale.value.slice(0, 2))).contracts }
  catch (err) { checkError.value = (err as Error).message }
  finally { checking.value = false }
}
function useContract(c: RenaultContract): void {
  if (c.start) draft.start = c.start
  if (c.end) draft.end = c.end
  draft.km = String(c.maxKm)
  writeLease()
}
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale.value) : '—')
const km = (n: number) => new Intl.NumberFormat(locale.value).format(n)

/** Rien à proposer quand aucune carrosserie ne correspond : les deux lignes disparaissent. */
const models = computed(() => modelsFor(props.descriptor.pluginId, props.descriptor.meta.manufacturer))
/** Ce que la scène dessine AUJOURD'HUI, y compris quand l'utilisateur n'a rien choisi. */
const model3d = computed(() => resolveModel(houseDevice.value?.model3d, props.descriptor.pluginId, props.descriptor.meta.manufacturer)?.id ?? NO_MODEL)
function setModel3d(value: string): void {
  if (value === model3d.value) return
  void house.setDeviceTuning(props.descriptor.id, { model3d: value })
}

/** Le réglage manuel, seul : c'est lui qu'on écrit, et lui seul que la croix efface. */
/**
 * L'aspect de la peinture, dans le vocabulaire de la voiture elle-même (le « Coloriseur » d'une
 * Tesla dit Unie / Métallique / Mate). Le select montre ce qui est PEINT aujourd'hui — le choix
 * manuel, sinon ce que le fabricant dit — et écrire rend ce choix explicite.
 */
const bodyFinish = computed(() => bodyFinishOf(props.descriptor, houseDevice.value))
/** Le choix manuel SEUL — le select, lui, montre ce qui est peint, d'où qu'il vienne. */
const chosenFinish = computed(() => houseDevice.value?.bodyFinish)
function setBodyFinish(value: string): void {
  // `''` efface, comme pour la couleur ; sinon un aspect identique à l'affiché n'écrit rien... SAUF
  // s'il vient du fabricant : le choisir explicitement le FIGE, et c'est un geste utile.
  const finish = value as VehicleFinish | ''
  if (finish && finish === chosenFinish.value) return
  void house.setDeviceTuning(props.descriptor.id, { bodyFinish: finish })
}

const bodyColor = computed(() => houseDevice.value?.bodyColor)
/**
 * Ce que la scène peint AUJOURD'HUI. Sans réglage manuel, c'est la teinte que le plugin a déduite —
 * le sélecteur part donc de la vraie couleur du véhicule, pas d'un gris arbitraire — et à défaut un
 * gris neutre, faute de savoir quoi montrer.
 */
const painted = computed(() => bodyColorOf(props.descriptor, houseDevice.value) ?? '#9aa4b2')
function setBodyColor(value: string): void {
  if (value === bodyColor.value) return
  void house.setDeviceTuning(props.descriptor.id, { bodyColor: value })
}
/**
 * La teinte se voit PENDANT qu'on la choisit : le sélecteur natif annonce chaque nuance survolée, et
 * la scène la peint tout de suite — c'est comme ça qu'on juge une couleur, sur la voiture. Seul le
 * choix validé (`change`) est écrit ; un choix abandonné rend la teinte d'avant, comme la fermeture
 * du panneau.
 */
const preview = (value: string | null) => house.previewBodyColor(props.descriptor.id, value)
onBeforeUnmount(() => preview(null))

/**
 * « RÉTABLIR » : les réglages tels qu'ils étaient à l'OUVERTURE de la section — le composant naît
 * avec elle (les deux surfaces le montent en `v-if`), d'où l'instantané pris ici. Chaque champ
 * s'écrit au fil de la saisie, sans bouton « Enregistrer » : c'est ce retour en arrière qui tient
 * lieu d'annulation, comme « Rétablir » le fait pour l'emplacement d'un appareil.
 *
 * Un seul appel rend les six d'un coup, y compris ceux qu'on vient d'ajouter : `[0, 0]`, `0` et la
 * chaîne vide EFFACENT, c'est ce que dit le contrat d'écriture.
 */
const tuned = () => {
  const hd = houseDevice.value
  return {
    gpsOffset: hd?.gpsOffset ? ([...hd.gpsOffset] as [number, number]) : undefined,
    yawOffset: hd?.yawOffset, batteryKwh: hd?.batteryKwh,
    model3d: hd?.model3d, bodyColor: hd?.bodyColor, bodyFinish: hd?.bodyFinish, lease: hd?.lease,
  }
}
const opened = tuned()
const changed = computed(() => JSON.stringify(tuned()) !== JSON.stringify(opened))
function revert(): void {
  void house.setDeviceTuning(props.descriptor.id, {
    gpsOffset: opened.gpsOffset ?? [0, 0], yawOffset: opened.yawOffset ?? 0, batteryKwh: opened.batteryKwh ?? 0,
    model3d: opened.model3d ?? '', bodyColor: opened.bodyColor ?? '', bodyFinish: opened.bodyFinish ?? '',
    lease: opened.lease ?? '',
  })
}
</script>

<template>
  <div v-if="tunable" class="card card--soft tune">
    <!-- place RÉSERVÉE : invisible tant qu'il n'y a rien à rétablir, la ligne ne bouge pas -->
    <div class="tune__top">
      <button type="button" class="pill tune__revert" :class="{ 'tune__revert--off': !changed }"
              :disabled="!changed" :tabindex="changed ? 0 : -1" @click="revert">{{ $t('place.revert') }}</button>
    </div>
    <!-- décalage et rotation ne concernent qu'une voiture posée par son GPS : celle qu'on a placée à
         la main dans la maison tient déjà sa place et son cap du JSON -->
    <label v-if="gpsPlaced" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.offset') }}</span>
      <span class="tune__fields">
        <span v-for="(axis, i) in (['x', 'y'] as const)" :key="axis" class="tune__axis">
          <span class="muted">{{ $t(`vehicle.offset${axis.toUpperCase()}`) }}</span>
          <input type="number" step="0.5" inputmode="decimal" :value="offsetOf(i as 0 | 1)"
                 @change="setOffset(i as 0 | 1, ($event.target as HTMLInputElement).value)" />
        </span>
      </span>
    </label>
    <label v-if="gpsPlaced" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.rotation') }}</span>
      <span class="tune__fields">
        <input type="number" step="15" inputmode="decimal" :value="rotation"
               @change="setRotation(($event.target as HTMLInputElement).value)" />
      </span>
    </label>
    <label v-if="capacityNeeded" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.capacity') }}</span>
      <span class="tune__fields">
        <input type="number" step="1" min="0" inputmode="decimal" :value="capacity || ''"
               placeholder="—" @change="setCapacity(($event.target as HTMLInputElement).value)" />
      </span>
    </label>
    <p v-if="capacityNeeded" class="muted tune__hint">{{ $t('vehicle.capacityHint') }}</p>
    <!-- carrosserie : les modèles de CE véhicule (son plugin, à défaut sa marque), plus la silhouette -->
    <label v-if="models.length" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.model3d') }}</span>
      <span class="tune__fields">
        <select :value="model3d" @change="setModel3d(($event.target as HTMLSelectElement).value)">
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
          <option :value="NO_MODEL">{{ $t('vehicle.model3dNone') }}</option>
        </select>
      </span>
    </label>
    <!-- `for` EXPLICITE sur les deux lignes qui portent une croix : un label sans `for` active son
         premier descendant étiquetable, et la croix vient avant le champ — cliquer la ligne pour
         sortir du sélecteur de couleur effaçait donc le choix qu'on venait de faire. -->
    <label v-if="models.length" class="tune__row" :for="`tune-finish-${descriptor.id}`">
      <span class="muted tune__k">{{ $t('vehicle.bodyFinish') }}</span>
      <span class="tune__fields">
        <!-- même règle que la couleur : la croix n'efface QUE le choix manuel, et rend la main à
             ce que le plugin a déduit — pas à un défaut arbitraire -->
        <button v-if="chosenFinish" type="button" class="tune__reset" :title="$t('vehicle.bodyFinishReset')"
                @click="setBodyFinish('')">×</button>
        <select :id="`tune-finish-${descriptor.id}`" :value="bodyFinish" @change="setBodyFinish(($event.target as HTMLSelectElement).value)">
          <option v-for="f in VEHICLE_FINISHES" :key="f" :value="f">{{ $t(`vehicle.finish.${f}`) }}</option>
        </select>
      </span>
    </label>
    <label v-if="models.length" class="tune__row" :for="`tune-color-${descriptor.id}`">
      <span class="muted tune__k">{{ $t('vehicle.bodyColor') }}</span>
      <span class="tune__fields">
        <!-- sans couleur choisie, la scène applique la sienne, qui suit le thème : le bouton rend la main -->
        <button v-if="bodyColor" type="button" class="tune__reset" :title="$t('vehicle.bodyColorReset')"
                @click="setBodyColor('')">×</button>
        <input :id="`tune-color-${descriptor.id}`" type="color" :value="painted"
               @input="preview(($event.target as HTMLInputElement).value)"
               @change="setBodyColor(($event.target as HTMLInputElement).value)" />
      </span>
    </label>
    <!-- LOA : saisie à la main, le constructeur ne publie pas le contrat de financement -->
    <div class="tune__section">
      <span class="tune__title">{{ $t('vehicle.lease.title') }}</span>
      <button v-if="lease" type="button" class="tune__reset" :title="$t('vehicle.lease.clear')"
              :aria-label="$t('vehicle.lease.clear')" @click="clearLease">×</button>
    </div>
    <label v-for="f in (['start', 'end'] as const)" :key="f" class="tune__row">
      <span class="muted tune__k">{{ $t(`vehicle.lease.${f}`) }}</span>
      <span class="tune__fields">
        <input type="date" class="tune__date" :value="draft[f]" @change="setLeaseField(f, ($event.target as HTMLInputElement).value)" />
      </span>
    </label>
    <label v-for="f in (['km', 'startKm'] as const)" :key="f" class="tune__row">
      <span class="muted tune__k">{{ $t(`vehicle.lease.${f}`) }}</span>
      <span class="tune__fields">
        <input type="number" step="1000" min="0" inputmode="numeric" class="tune__km" :value="draft[f]" placeholder="—"
               @change="setLeaseField(f, ($event.target as HTMLInputElement).value)" />
      </span>
    </label>
    <p class="muted tune__hint">{{ $t('vehicle.lease.hint') }}</p>
    <template v-if="renaultVin">
      <button type="button" class="pill tune__check" :disabled="checking" :aria-busy="checking" @click="checkRenault">
        <v-progress-circular v-if="checking" indeterminate size="14" width="2" />
        {{ $t('vehicle.lease.check') }}
      </button>
      <p v-if="checkError" class="muted tune__hint">{{ $t('vehicle.lease.checkError', { message: checkError }) }}</p>
      <p v-else-if="contracts && !contracts.length" class="muted tune__hint">{{ $t('vehicle.lease.none') }}</p>
      <div v-for="(c, i) in contracts ?? []" :key="i" class="tune__found">
        <span class="tune__found-text">{{ $t('vehicle.lease.found', { name: c.description, km: km(c.maxKm), start: day(c.start), end: day(c.end) }) }}</span>
        <button type="button" class="pill tune__use" @click="useContract(c)">{{ $t('vehicle.lease.use') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tune { padding: 10px 12px; display: grid; gap: 10px; }
.tune__row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.tune__k { flex: 1 1 auto; min-width: 0; }
.tune__fields { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
.tune__axis { display: flex; align-items: center; gap: 6px; }
.tune input {
  width: 72px; padding: 4px 8px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px; font-variant-numeric: tabular-nums;
}
.tune__hint { margin: 0; font-size: 11px; }
.tune__top { display: flex; justify-content: flex-end; }
/* à l'échelle de la carte (champs de 28 px), et non des 40 px d'une pilule de pleine taille */
.tune__revert { height: 28px; padding: 0 12px; font-size: 12px; }
.tune__revert--off { visibility: hidden; }
.tune select {
  padding: 4px 8px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px;
}
/* la LOA : un intertitre, puis des lignes au gabarit des autres réglages */
.tune__section { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--line); }
.tune__title { font-size: 12px; font-weight: 600; }
.tune input.tune__date { width: 140px; }
.tune input.tune__km { width: 96px; }
.tune__check { justify-self: start; height: 28px; padding: 0 12px; font-size: 12px; gap: 6px; }
.tune__found { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: var(--accent-soft); font-size: 12px; }
.tune__found-text { flex: 1 1 auto; min-width: 0; }
.tune__use { flex: none; height: 28px; padding: 0 12px; font-size: 12px; }
/* même gabarit que les champs nombre : la ligne ne change pas de hauteur d'une section à l'autre */
.tune input[type='color'] { width: 72px; height: 28px; padding: 2px; cursor: pointer; }
.tune__reset {
  width: 22px; height: 22px; padding: 0; line-height: 1;
  border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px; cursor: pointer;
}
</style>
