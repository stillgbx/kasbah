<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput } from '@kasbah/shared'
import { isPlaced, panelOf, type PlacedHouseDevice } from '@kasbah/shared'
import { useDeviceResolver } from '../../composables/useDeviceResolver'
import { relayLabel } from '../../lib/audioRouting'
import { isEnergySite } from '../../lib/energy'
import { tunableVehicle } from '../../lib/vehicleTuning'
import { toClosure } from '../../lib/cover'
import { formatPercent } from '../../lib/format'
import { headlineValue, isDeviceBusy, isDeviceOn, toggleChecked, toggleCommand } from '../../lib/deviceState'
import { kindIcon } from '../../lib/strokeIcons'
import { fanLinkedTo } from '../../lib/linkedDevices'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import { useNotificationsStore } from '../../stores/notifications'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import ForgetDeviceButton from '../devices/ForgetDeviceButton.vue'
import DeviceControl from '../controls/DeviceControl.vue'
import VehicleTuning from '../vehicles/VehicleTuning.vue'
import CoverTuning from '../covers/CoverTuning.vue'
import JournalList from '../robots/JournalList.vue'
import MowerTuning from '../robots/MowerTuning.vue'
import { useJournals } from '../../composables/useJournals'
import { journalPoints } from '../../lib/journal'
import PanelArraysCard from './PanelArraysCard.vue'
import PlacementControl from './PlacementControl.vue'

// Panneau « appareil » : fil d'Ariane vers son parent, en-tête (icône, nom, fabricant, bascule),
// grande valeur, puis le contrôle propre au type.
const emit = defineEmits<{ back: [] }>()
const house = useHouseStore()
const devices = useDevicesStore()
const notifications = useNotificationsStore()
const { t, locale } = useI18n()
const resolved = useDeviceResolver(computed(() => house.selectedKey))

/**
 * Les RÉGLAGES d'un véhicule, repliés derrière leur bouton comme « Emplacement » l'est derrière
 * « Déplacer » : ce qu'on vient faire ici, c'est piloter la voiture, pas la régler. Ouverts, ils
 * s'écrivent au fil de la saisie et chaque choix manuel se rend par sa croix (cf. `VehicleTuning`).
 * Un véhicule qui n'a rien à régler ne montre même pas le bouton.
 */
const tuningOpen = ref(false)
const tunableCar = computed(() => {
  const d = resolved.value?.descriptor
  return d?.kind === 'vehicle' && tunableVehicle(d, resolved.value?.houseDevice) ? d : null
})
/**
 * Le robot tondeuse a les siens : le DÉCALAGE de sa place GPS (`MowerTuning`, le même bloc que sur
 * la vue Robots — ici on le voit s'appliquer dans la scène) et son JOURNAL. Le journal se déplie
 * derrière son bouton et, déplié, pose ses incidents positionnés SUR LE TERRAIN de la scène ; une
 * ligne choisie cadre la caméra dessus. C'est ainsi qu'on localise une panne depuis la maison.
 */
const tunableMower = computed(() => {
  const d = resolved.value?.descriptor
  const s = resolved.value?.state
  return d?.kind === 'mower' && s?.kind === 'mower' && !!s.location && resolved.value?.houseDevice?.position === undefined ? d : null
})
/**
 * L'ouvrant a les siens : vantaux, matière, couleur (`CoverTuning`). Ils ne concernent que ce qui est
 * DESSINÉ, et un ouvrant absent de la maison n'est dessiné nulle part — rien à régler tant qu'il
 * n'est pas posé (ou lié à une ouverture, ce qui le pose aussi).
 */
const tunableCover = computed(() => {
  const d = resolved.value?.descriptor
  return d?.kind === 'cover' && resolved.value?.houseDevice ? d : null
})
const journalable = computed(() => {
  const d = resolved.value?.descriptor
  return d?.kind === 'mower' && d.capabilities.includes('journal') ? d : null
})
const journalIds = computed(() => (journalable.value ? [journalable.value.id] : []))
const { journals } = useJournals(journalIds)
const journalEntries = computed(() => (journalable.value ? journals.value[journalable.value.id] ?? [] : []))
const journalOpen = ref(false)
/** L'incident actif est PARTAGÉ avec la scène : une épingle touchée surligne sa ligne ici, et fait défiler la liste jusqu'à elle. */
const journalActive = computed(() => house.journalActive ?? undefined)
function toggleJournal(): void {
  journalOpen.value = !journalOpen.value
  if (journalOpen.value && journalable.value) house.showJournal(journalable.value.id, journalPoints(journalEntries.value))
  else house.hideJournal()
}
// le journal se rafraîchit pendant qu'il est ouvert : les épingles suivent
watch(journalEntries, (entries) => { if (journalOpen.value && journalable.value) house.showJournal(journalable.value.id, journalPoints(entries)) })
function pickEntry(e: { at: number }): void {
  if (journalable.value) house.focusJournalPoint(journalable.value.id, e.at)
}
// changé d'appareil, les réglages et le journal se referment : le panneau suivant s'ouvre sur ses commandes
watch(() => house.selectedKey, () => { tuningOpen.value = false; journalOpen.value = false; house.hideJournal() })
onBeforeUnmount(() => house.hideJournal())

/**
 * Le PARENT dont on est descendu, et où le retour ramène : la pièce, la zone du jardin, ou à défaut
 * le niveau qui porte l'appareil (une caméra posée sur le toit, hors de toute pièce). « Maison »
 * ne reste que pour un appareil qui n'est nulle part.
 */
const crumb = computed(() => {
  const hd = resolved.value?.houseDevice
  if (!hd) return t('nav.home')
  // un module de champ appartient à son INSTALLATION : c'est elle qu'on nomme, et où le retour ramène
  if (site.value) return site.value.name
  const idx = house.index
  return (hd.roomId ? idx?.roomsById.get(hd.roomId)?.name
    : hd.zoneId ? idx?.zonesById.get(hd.zoneId)?.name
    : hd.levelId ? idx?.levelsById.get(hd.levelId)?.name : null) ?? t('nav.home')
})
/**
 * Ce que l'appareil EST, dit au plus près : la nature déclarée par le fabricant quand il y en a une
 * (« Portail », « Store banne », « Téléviseur »), le kind sinon. Un portail annoncé « Volet » se
 * lisait comme une erreur de liaison — et le mot générique du kind (« Ouvrant ») ne sert plus que de
 * repli, pour un ouvrant dont le fabricant ne dit pas la nature.
 */
const kindLabel = computed(() => {
  const d = resolved.value?.descriptor
  if (!d) return ''
  if (d.kind === 'media_player') return t(`media.classes.${d.meta.mediaPlayer?.deviceClass ?? 'speaker'}`)
  if (d.kind === 'cover' && d.meta.cover?.deviceClass) return t(`cover.classes.${d.meta.cover.deviceClass}`)
  // Plafonnier lié à un ventilateur (ou l'inverse) : les deux fonctions du même objet.
  if (d.kind === 'light' && fanLinkedTo(d.id, devices.list)) return t('kinds.lightFan')
  if (d.kind === 'fan' && d.meta.linkedTo) return t('kinds.lightFan')
  return t(`kinds.${d.kind}`)
})

const headIcon = computed(() => {
  const d = resolved.value?.descriptor
  const kind = d?.kind ?? resolved.value?.houseDevice?.kind
  const linkedFan = d?.kind === 'light' && !!fanLinkedTo(d.id, devices.list)
  return kindIcon(kind, d, { linkedFan })
})

/** Lecteur dont cet appareil joue le son (barre de son d'une TV en lecture) — voir `lib/audioRouting.ts`. */
const relay = computed(() => (resolved.value?.deviceId ? house.relaySource(resolved.value.deviceId) : undefined))
const on = computed(() => !!resolved.value?.state && (isDeviceOn(resolved.value.state, resolved.value.descriptor) || !!relay.value))
const pending = computed(() => !!resolved.value?.deviceId && devices.isPending(resolved.value.deviceId))
/** Position visée quand le store en tient une : elle gouverne TOUT ce qui affiche cet ouvrant. */
const aimed = computed(() => (resolved.value?.deviceId ? devices.targetPosition(resolved.value.deviceId) : undefined))

/** Requête en vol OU appareil encore occupé (une course de volet dure ~20 s, voir `isDeviceBusy`). */
const busy = computed(() => pending.value
  || (!!resolved.value?.state && isDeviceBusy(resolved.value.state, aimed.value !== undefined)))
/** Valeur de l'interrupteur : pour un ouvrant, coché = FERMÉ (cf. `lib/cover.ts`), cible comprise ; coché aussi quand l'appareil relaie. */
const checked = computed(() => !!resolved.value?.state && (toggleChecked(resolved.value.state, aimed.value) || !!relay.value))
/**
 * Commande d'un clic sur l'interrupteur : dérivée de la cible, donc capable d'INVERSER une course. Pour une
 * barre qui relaie, c'est la TV qu'on met en pause (`toggleTarget`) : c'est elle qu'on entend.
 */
const toggle = computed(() => (relay.value ? toggleCommand(relay.value.state) : resolved.value?.state ? toggleCommand(resolved.value.state, aimed.value) : null))
const toggleTarget = computed(() => relay.value?.descriptor.id ?? resolved.value?.deviceId)
const headline = computed(() => {
  const r = resolved.value
  if (!r?.descriptor || !r.state) return ''
  // pour un ouvrant, la grande valeur suit la POSITION VISÉE, comme le curseur juste en dessous :
  // les deux se contrediraient sinon pendant toute la course
  const state = r.state
  if (state.kind === 'cover' && r.deviceId) {
    const target = devices.targetPosition(r.deviceId)
    if (target !== undefined) return headlineValue(r.descriptor, { ...state, position: target }, t, locale.value)
  }
  // ce qu'on ENTEND chez une barre de son qui relaie : le morceau de la TV, pas « Au repos » — le
  // contrôle, dessous, dit d'où il vient (« Son de TV Salon »)
  if (relay.value) {
    const src = relay.value.state
    return (src.kind === 'media_player' && src.nowPlaying?.title) || relayLabel(relay.value.name, src, t)
  }
  return headlineValue(r.descriptor, state, t, locale.value)
})
/**
 * Déplaçable : dans le JSON ou auto-placé, hors volets (ancrés à une ouverture), tondeuse (position
 * publiée) et modules d'un champ de panneaux (ils bougent avec leur champ, pas un par un).
 */
/** L'appareil à placer, ou `null` : un appareil NON PLACÉ (un véhicule) n'a pas de poignée dans la scène. */
const placeable = computed<PlacedHouseDevice | null>(() => {
  const hd = resolved.value?.houseDevice
  if (!hd || !isPlaced(hd) || hd.openingId || panelOf(hd)) return null
  // ni une tondeuse (elle se gare a sa base), ni un vehicule : la place d'une voiture vient de son
  // GPS, pas d'un geste — la proposer a placer serait un bouton sans effet
  const kind = resolved.value?.descriptor?.kind ?? hd.kind
  return kind !== 'mower' && kind !== 'vehicle' ? hd : null
})
/** Le champ dont cet appareil est un module, quand il en est un (il suit son champ, cf. `panels.ts`). */
const panelCell = computed(() => (resolved.value?.houseDevice ? panelOf(resolved.value.houseDevice) : undefined))
const array = computed(() => (panelCell.value ? house.arrays.find((a) => a.id === panelCell.value!.arrayId) : undefined))
/**
 * L'installation qui porte ce champ : le parent du module dans le fil d'Ariane, et le panneau où son
 * réglage vit. Nommée par son entrée de maison si elle est posée, par le fabricant sinon.
 */
const site = computed(() => {
  const id = array.value ? house.siteOf(array.value) : undefined
  if (!id) return undefined
  const hd = house.index?.devicesByBinding.get(id)
  return { key: hd?.id ?? id, name: hd?.name ?? devices.descriptors[id]?.name ?? id }
})

/**
 * Installation solaire : le site d'une installation qui PRODUIT (et non une batterie, ni un simple
 * compteur). C'est sur son panneau que se déclarent les champs de panneaux — les modules, eux, sont
 * dérivés de leur champ et n'ont rien à régler.
 */
const solarSite = computed(() => {
  const d = resolved.value?.descriptor
  return d && isEnergySite(d) && d.capabilities.includes('production') ? d.id : null
})
// Pochette du morceau (ou visuel de la radio) en fond du haut du panneau, fondue en haut et en bas.
// Couche absolue derrière le contenu : rien ne se décale quand elle apparaît, change ou disparaît.
// L'image est PRÉCHARGÉE : la couche n'est posée qu'une fois l'image décodée (sinon elle apparaissait
// d'un coup au chargement, ou restait vide si le serveur d'images refusait), et une URL qui échoue ne
// laisse rien. Une réponse tardive d'une URL déjà remplacée est ignorée.
const artUrl = computed(() => {
  const own = resolved.value?.state
  if (!own?.available) return undefined
  const s = relay.value?.state ?? own                                  // barre qui relaie : la pochette de la TV
  return s.kind === 'media_player' && s.nowPlaying?.artUrl ? s.nowPlaying.artUrl : undefined
})
const art = ref<string | undefined>(undefined)
watch(artUrl, (url) => {
  if (!url) { art.value = undefined; return }
  if (url === art.value) return
  const img = new Image()
  img.onload = () => { if (artUrl.value === url) art.value = url }
  img.onerror = () => { if (artUrl.value === url) art.value = undefined }
  img.src = url
}, { immediate: true })
const brand = computed(() => resolved.value?.descriptor?.meta.manufacturer ?? (resolved.value?.deviceId?.split(':')[0] ?? ''))

/**
 * « Oublier l'appareil » : proposé aux appareils que le plugin RETIENT (`meta.forgettable` — un Cast
 * éteint ne s'annonce plus et resterait listé pour toujours) qui ne répondent pas et ne sont PAS dans
 * la maison. Un appareil placé se retire d'abord de la maison (« Emplacement »), sinon son entrée
 * pointerait vers un id que plus aucun plugin ne remonte.
 */
const forgettable = computed(() => {
  const r = resolved.value
  return !!r?.descriptor?.meta.forgettable && !r.houseDevice && !!r.state && !r.state.available
})

function send(cmd: CommandInput) {
  const id = resolved.value?.deviceId
  if (!id) return
  // Réécrire la position favorite d'un moteur ne se voit presque pas — l'ouvrant ne bouge pas, et
  // seule la petite valeur du bouton change. Or ce réglage vit DANS le moteur et sert aussi aux
  // télécommandes murales : il mérite un accusé de réception explicite, pas un changement muet.
  if (cmd.type === 'cover.set_preset') {
    const pct = formatPercent(toClosure(cmd.position), locale.value)
    void devices.sendCommand(id, cmd).then((ok) => { if (ok) notifications.success(t('cover.presetSaved', { pct })) })
    return
  }
  void devices.sendCommand(id, cmd)
}
</script>

<template>
  <template v-if="resolved">
    <!-- fondu croisé entre deux pochettes : les deux couches coexistent le temps de la transition -->
    <Transition name="art">
      <div v-if="art" :key="art" class="art" :style="{ backgroundImage: `url(${JSON.stringify(art)})` }" aria-hidden="true" />
    </Transition>
    <!-- collant : fil d'Ariane et en-tête restent en vue quand le contrôle défile (styles/app.css) -->
    <div class="panel-head">
    <button type="button" class="crumb" @click="emit('back')"><StrokeIcon name="back" :size="14" /> {{ crumb }}</button>
    <div class="head">
      <span class="icon-square icon-square--lg" :data-on="on ? '1' : '0'"><StrokeIcon :name="headIcon" :size="22" /></span>
      <div class="head__main">
        <!-- nom trop long pour les 340 px du panneau (un id d'appareil non lié fait 50 caractères) :
             il défile avec un fondu plutôt que de déborder, comme le titre d'un morceau -->
        <MarqueeText class="head__name" :text="resolved.name" />
        <div class="muted head__sub">
          <!-- chacun dit SA nature (téléviseur, portail, store banne) plutôt que le mot du kind -->
          <span v-if="resolved.descriptor">{{ kindLabel }}</span>
          <!-- « Indisponible » AVANT le fabricant : la ligne tient sur 340 px, et si elle est coupée
               c'est la marque qui part, pas l'information qui compte -->
          <span v-if="resolved.state && !resolved.state.available" class="text-error"> · {{ $t('common.unavailable') }}</span><span v-if="brand"> · {{ brand }}</span>
        </div>
      </div>
      <!-- empreinte FIXE : le spinner (20 px) remplace l'interrupteur (52 x 56) le temps de
           l'aller-retour serveur, et sans cette réserve l'en-tête se retracte et pousse tout
           le panneau vers le haut -->
      <div v-if="toggle || busy" class="head__toggle">
        <v-progress-circular v-if="busy" indeterminate size="20" width="2" color="primary" />
        <v-switch v-else-if="toggle" :model-value="checked" :disabled="!resolved.state?.available" @update:model-value="devices.sendCommand(toggleTarget!, toggle!)" />
      </div>
    </div>
    </div>
    <MarqueeText v-if="headline" class="big-value" :text="headline" />
    <!-- `relay-from` traverse l'aiguillage (attribut non déclaré) jusqu'au contrôle du lecteur, seul à le lire -->
    <DeviceControl v-if="resolved.descriptor && resolved.state" :descriptor="resolved.descriptor" :state="resolved.state"
                   :pending="devices.isPending(resolved.deviceId!)" :relay-from="relay?.name" @command="send" />
    <div v-else class="card card--soft unbound muted">{{ $t('device.unbound', { id: resolved.houseDevice?.deviceId ?? resolved.key }) }}</div>
    <!-- un véhicule ne se place pas (son GPS le fait) : ce qu'il a à régler, c'est la correction de
         cette place et de son cap — et on les voit s'appliquer dans la scène, voiture sous les yeux.
         Replié derrière « Régler », pied en bas comme « Emplacement ». -->
    <div v-if="tunableCar" class="card card--soft tuning">
      <div v-if="tuningOpen" class="tuning__body"><VehicleTuning :descriptor="tunableCar" /></div>
      <div class="tuning__foot">
        <span class="muted">{{ $t('vehicle.tuneTitle') }}</span>
        <button type="button" class="pill tuning__cta" :data-on="tuningOpen ? '1' : '0'"
                :aria-expanded="tuningOpen" @click="tuningOpen = !tuningOpen">
          <StrokeIcon name="gear" :size="16" /> {{ tuningOpen ? $t('place.done') : $t('vehicle.tune') }}
        </button>
      </div>
    </div>
    <!-- l'ouvrant : ce que la maison sait de lui et que le fabricant ignore — ses vantaux, sa
         matière, sa couleur. Replié derrière « Régler », comme les réglages d'un véhicule : ce qu'on
         vient faire ici, c'est manœuvrer le volet, pas le décrire. -->
    <div v-if="tunableCover" class="card card--soft tuning">
      <div v-if="tuningOpen" class="tuning__body"><CoverTuning :descriptor="tunableCover" /></div>
      <div class="tuning__foot">
        <span class="muted">{{ $t('vehicle.tuneTitle') }}</span>
        <button type="button" class="pill tuning__cta" :data-on="tuningOpen ? '1' : '0'"
                :aria-expanded="tuningOpen" @click="tuningOpen = !tuningOpen">
          <StrokeIcon name="gear" :size="16" /> {{ tuningOpen ? $t('place.done') : $t('vehicle.tune') }}
        </button>
      </div>
    </div>
    <!-- le journal du robot : replié derrière son bouton (le nombre de lignes le signale), déplié il
         pose ses incidents sur le terrain de la scène, et une ligne choisie cadre la caméra dessus -->
    <div v-if="journalable" class="card card--soft tuning">
      <div v-if="journalOpen" class="tuning__body"><JournalList :entries="journalEntries" :active="journalActive" @pick="pickEntry" /></div>
      <div class="tuning__foot">
        <span class="muted">{{ $t('mower.journalTitle') }}</span>
        <button type="button" class="pill tuning__cta" :data-on="journalOpen ? '1' : '0'" :aria-expanded="journalOpen" @click="toggleJournal">
          <StrokeIcon name="list" :size="16" /> {{ journalOpen ? $t('place.done') : $t('mower.journal') }}
          <span v-if="!journalOpen" class="tuning__count">{{ journalEntries.length }}</span>
        </button>
      </div>
    </div>
    <!-- le décalage GPS de la tondeuse : le même bloc que sur la vue Robots, robot sous les yeux -->
    <div v-if="tunableMower" class="card card--soft tuning">
      <div v-if="tuningOpen" class="tuning__body"><MowerTuning :descriptor="tunableMower" /></div>
      <div class="tuning__foot">
        <span class="muted">{{ $t('vehicle.tuneTitle') }}</span>
        <button type="button" class="pill tuning__cta" :data-on="tuningOpen ? '1' : '0'"
                :aria-expanded="tuningOpen" @click="tuningOpen = !tuningOpen">
          <StrokeIcon name="gear" :size="16" /> {{ tuningOpen ? $t('place.done') : $t('vehicle.tune') }}
        </button>
      </div>
    </div>
    <!-- les champs de panneaux se déclarent ici, juste au-dessus de l'emplacement de l'installation -->
    <PanelArraysCard v-if="solarSite" class="arrays" :site-device-id="solarSite" />
    <!-- rarement utilisé : calé au fond du panneau, sous tout le reste -->
    <PlacementControl v-if="placeable" class="placement" :device="placeable" />
    <!-- module d'un champ : il ne se place pas seul, mais il mène au réglage de son champ -->
    <div v-else-if="array" class="card card--soft placement place-new">
      <div class="place-new__row">
        <span class="muted">{{ $t('arrays.single') }}</span>
        <button type="button" class="pill place-new__cta" @click="house.editArray(array.id)">
          <StrokeIcon name="move" :size="16" /> {{ $t('arrays.edit') }}
        </button>
      </div>
      <div class="muted place-new__hint">{{ array.name ?? array.id }} · {{ $t('arrays.cell', { r: panelCell!.row + 1, c: panelCell!.col + 1 }) }}</div>
    </div>
    <!-- appareil connu du plugin mais absent de la maison : le poser depuis ici, sans repasser par la
         liste. Sauf un VEHICULE : sa place vient de son GPS, la poser a la main n'aurait pas de sens -->
    <div v-else-if="resolved.descriptor && !resolved.houseDevice && resolved.descriptor.kind !== 'vehicle'" class="card card--soft placement place-new">
      <div class="place-new__row">
        <span class="muted">{{ $t('place.title') }}</span>
        <button type="button" class="pill place-new__cta" :title="$t('rooms.origins.placeHint')" @click="house.startPlacingNew(resolved.descriptor.id)">
          <StrokeIcon name="pin" :size="16" /> {{ $t('rooms.origins.place') }}
        </button>
      </div>
      <!-- appareil retenu par le plugin et qui ne répond plus : s'il a disparu pour de bon, l'oublier
           (voir `forgettable`) ; il quitte l'inventaire, le panneau n'a plus de sujet -->
      <div v-if="forgettable" class="place-new__row">
        <span class="muted place-new__hint">{{ $t('device.gone') }}</span>
        <ForgetDeviceButton :device-id="resolved.deviceId!" @forgotten="house.clearSelection()" />
      </div>
    </div>
  </template>
</template>

<style scoped>
.art {
  position: absolute; top: 60px; left: 0; right: 0; height: 380px; z-index: -1; pointer-events: none;
  background-size: cover; background-position: center; opacity: .26;
  mask-image: linear-gradient(180deg, transparent 0, #000 22%, #000 58%, transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 22%, #000 58%, transparent 100%);
}
.art-enter-active, .art-leave-active { transition: opacity .9s ease; }
.art-enter-from, .art-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .art-enter-active, .art-leave-active { transition: none; } }
.crumb { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted); font-size: 13px; padding: 0; align-self: flex-start; }
.crumb:hover { color: var(--text); }
.head { display: flex; align-items: center; gap: 12px; }
.placement { margin-top: auto; }
/* le réglage d'un véhicule ferme son panneau, comme « Emplacement » ferme celui d'un appareil posé */
.tuning { margin-top: auto; padding: 12px 14px; font-size: 13px; }
/* le pied porte le titre et l'unique bouton, qui garde sa place et sa largeur dans les deux états */
.tuning__foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.tuning__cta { min-width: 124px; justify-content: center; }
.tuning__body { padding-bottom: 12px; }
/* la carte des réglages vit DANS celle-ci : sans ça, deux fonds et deux marges intérieures */
.tuning__body :deep(.tune) { padding: 0; background: none; }
.tuning__count { min-width: 20px; padding: 0 6px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--surface2); color: var(--text); }
/* la carte des champs se colle au bloc « Emplacement » qui ferme le panneau */
.arrays { margin-top: auto; }
.arrays + .placement { margin-top: 0; }
.place-new { padding: 12px 14px; font-size: 13px; display: grid; gap: 10px; }
.place-new__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
/* même largeur que le bouton « Oublier l'appareil » de la ligne d'en dessous : les deux s'alignent */
.place-new__cta { flex: 0 0 auto; min-width: 150px; justify-content: center; font-size: 12px; }
.place-new__hint { min-width: 0; font-size: 12px; }
.head__main { flex: 1 1 0; min-width: 0; }
.head__name { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
/* nature · fabricant · disponibilité : jamais sur deux lignes, coupé aux points de suspension */
.head__sub { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-square--lg { width: 44px; height: 44px; border-radius: 12px; }
.head__toggle { flex: 0 0 52px; height: 56px; display: grid; place-items: center; }
/* la phrase porte un id de plugin, d'un seul tenant : il se coupe n'importe où plutôt que de sortir du panneau */
.unbound { padding: 12px 14px; font-size: 13px; overflow-wrap: anywhere; }
</style>
