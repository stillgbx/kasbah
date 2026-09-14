<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput } from '@kasbah/shared'
import { isPlaced, panelOf, type PlacedHouseDevice } from '@kasbah/shared'
import { useDeviceResolver } from '../../composables/useDeviceResolver'
import { relayLabel } from '../../lib/audioRouting'
import { isEnergySite } from '../../lib/energy'
import { toClosure } from '../../lib/cover'
import { formatPercent } from '../../lib/format'
import { headlineValue, isDeviceBusy, isDeviceOn, toggleChecked, toggleCommand } from '../../lib/deviceState'
import { kindIcon } from '../../lib/strokeIcons'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import { useNotificationsStore } from '../../stores/notifications'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import ForgetDeviceButton from '../devices/ForgetDeviceButton.vue'
import DeviceControl from '../controls/DeviceControl.vue'
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
  return t(`kinds.${d.kind}`)
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
  return (resolved.value?.descriptor?.kind ?? hd.kind) !== 'mower' ? hd : null
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
    <button type="button" class="crumb" @click="emit('back')"><StrokeIcon name="back" :size="14" /> {{ crumb }}</button>
    <div class="head">
      <span class="icon-square icon-square--lg" :data-on="on ? '1' : '0'"><StrokeIcon :name="kindIcon(resolved.descriptor?.kind ?? resolved.houseDevice?.kind, resolved.descriptor)" :size="22" /></span>
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
    <MarqueeText v-if="headline" class="big-value" :text="headline" />
    <!-- `relay-from` traverse l'aiguillage (attribut non déclaré) jusqu'au contrôle du lecteur, seul à le lire -->
    <DeviceControl v-if="resolved.descriptor && resolved.state" :descriptor="resolved.descriptor" :state="resolved.state"
                   :pending="devices.isPending(resolved.deviceId!)" :relay-from="relay?.name" @command="send" />
    <div v-else class="card card--soft unbound muted">{{ $t('device.unbound', { id: resolved.houseDevice?.deviceId ?? resolved.key }) }}</div>
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
    <!-- appareil connu du plugin mais absent de la maison : le poser depuis ici, sans repasser par la liste -->
    <div v-else-if="resolved.descriptor && !resolved.houseDevice" class="card card--soft placement place-new">
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
