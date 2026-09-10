<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput } from '@kasbah/shared'
import { useDeviceResolver } from '../../composables/useDeviceResolver'
import { toClosure } from '../../lib/cover'
import { formatPercent } from '../../lib/format'
import { headlineValue, isDeviceBusy, isDeviceOn, toggleChecked, toggleCommand } from '../../lib/deviceState'
import { kindIcon } from '../../lib/strokeIcons'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import { useNotificationsStore } from '../../stores/notifications'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import DeviceControl from '../controls/DeviceControl.vue'
import PlacementControl from './PlacementControl.vue'

// Panneau « appareil » : fil d'Ariane vers la pièce, en-tête (icône, nom, fabricant, bascule),
// grande valeur, puis le contrôle propre au type.
const emit = defineEmits<{ back: [] }>()
const house = useHouseStore()
const devices = useDevicesStore()
const notifications = useNotificationsStore()
const { t, locale } = useI18n()
const resolved = useDeviceResolver(computed(() => house.selectedKey))

const crumb = computed(() => {
  const hd = resolved.value?.houseDevice
  if (!hd) return t('nav.home')
  return (hd.roomId ? house.index?.roomsById.get(hd.roomId)?.name : hd.zoneId ? house.index?.zonesById.get(hd.zoneId)?.name : null) ?? t('nav.home')
})
const on = computed(() => !!resolved.value?.state && isDeviceOn(resolved.value.state))
const pending = computed(() => !!resolved.value?.deviceId && devices.isPending(resolved.value.deviceId))
/** Position visée quand le store en tient une : elle gouverne TOUT ce qui affiche cet ouvrant. */
const aimed = computed(() => (resolved.value?.deviceId ? devices.targetPosition(resolved.value.deviceId) : undefined))

/** Requête en vol OU appareil encore occupé (une course de volet dure ~20 s, voir `isDeviceBusy`). */
const busy = computed(() => pending.value
  || (!!resolved.value?.state && isDeviceBusy(resolved.value.state, aimed.value !== undefined)))
/** Valeur de l'interrupteur : pour un ouvrant, coché = FERMÉ (cf. `lib/cover.ts`), cible comprise. */
const checked = computed(() => !!resolved.value?.state && toggleChecked(resolved.value.state, aimed.value))
/** Commande d'un clic sur l'interrupteur : dérivée de la cible, donc capable d'INVERSER une course. */
const toggle = computed(() => (resolved.value?.state ? toggleCommand(resolved.value.state, aimed.value) : null))
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
  return headlineValue(r.descriptor, state, t, locale.value)
})
/** Déplaçable : dans le JSON ou auto-placé, hors volets (ancrés à une ouverture) et tondeuse (position publiée). */
const placeable = computed(() => {
  const hd = resolved.value?.houseDevice
  return !!hd && !hd.openingId && (resolved.value?.descriptor?.kind ?? hd.kind) !== 'mower'
})
// Pochette du morceau (ou visuel de la radio) en fond du haut du panneau, fondue en haut et en bas.
// Couche absolue derrière le contenu : rien ne se décale quand elle apparaît, change ou disparaît.
// L'image est PRÉCHARGÉE : la couche n'est posée qu'une fois l'image décodée (sinon elle apparaissait
// d'un coup au chargement, ou restait vide si le serveur d'images refusait), et une URL qui échoue ne
// laisse rien. Une réponse tardive d'une URL déjà remplacée est ignorée.
const artUrl = computed(() => {
  const s = resolved.value?.state
  return s?.kind === 'media_player' && s.available && s.nowPlaying?.artUrl ? s.nowPlaying.artUrl : undefined
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
        <div class="head__name">{{ resolved.name }}</div>
        <div class="muted head__sub">
          <!-- un lecteur dit sa nature (téléviseur, écran connecté) plutôt que « Enceinte » pour tous -->
          <span v-if="resolved.descriptor">{{ resolved.descriptor.kind === 'media_player' ? $t(`media.classes.${resolved.descriptor.meta.mediaPlayer?.deviceClass ?? 'speaker'}`) : $t(`kinds.${resolved.descriptor.kind}`) }}</span><span v-if="brand"> · {{ brand }}</span>
          <span v-if="resolved.state && !resolved.state.available" class="text-error"> · {{ $t('common.unavailable') }}</span>
        </div>
      </div>
      <!-- empreinte FIXE : le spinner (20 px) remplace l'interrupteur (52 x 56) le temps de
           l'aller-retour serveur, et sans cette réserve l'en-tête se retracte et pousse tout
           le panneau vers le haut -->
      <div v-if="toggle || busy" class="head__toggle">
        <v-progress-circular v-if="busy" indeterminate size="20" width="2" color="primary" />
        <v-switch v-else-if="toggle" :model-value="checked" :disabled="!resolved.state?.available" @update:model-value="send(toggle!)" />
      </div>
    </div>
    <MarqueeText v-if="headline" class="big-value" :text="headline" />
    <DeviceControl v-if="resolved.descriptor && resolved.state" :descriptor="resolved.descriptor" :state="resolved.state"
                   :pending="devices.isPending(resolved.deviceId!)" @command="send" />
    <div v-else class="card card--soft unbound muted">{{ $t('device.unbound', { id: resolved.houseDevice?.deviceId ?? resolved.key }) }}</div>
    <!-- rarement utilisé : calé au fond du panneau, sous tout le reste -->
    <PlacementControl v-if="placeable" class="placement" :device="resolved.houseDevice!" />
    <!-- appareil connu du plugin mais absent de la maison : le poser depuis ici, sans repasser par la liste -->
    <div v-else-if="resolved.descriptor && !resolved.houseDevice" class="card card--soft placement place-new">
      <span class="muted">{{ $t('place.title') }}</span>
      <button type="button" class="pill place-new__cta" :title="$t('rooms.origins.placeHint')" @click="house.startPlacingNew(resolved.descriptor.id)">
        <StrokeIcon name="pin" :size="16" /> {{ $t('rooms.origins.place') }}
      </button>
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
.place-new { padding: 12px 14px; font-size: 13px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.place-new__cta { min-width: 124px; justify-content: center; }
.head__main { flex: 1 1 0; min-width: 0; }
.head__name { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
.head__sub { font-size: 12px; }
.icon-square--lg { width: 44px; height: 44px; border-radius: 12px; }
.head__toggle { flex: 0 0 52px; height: 56px; display: grid; place-items: center; }
.unbound { padding: 12px 14px; font-size: 13px; }
</style>
