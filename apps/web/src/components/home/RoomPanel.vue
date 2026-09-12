<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceState, HouseDevice } from '@kasbah/shared'
import { relayLabel } from '../../lib/audioRouting'
import { isDeviceOn, isDevicePulsing, statusLabel, toggleChecked, toggleCommand } from '../../lib/deviceState'
import { lightTintCss } from '../../lib/lightTint'
import { kindIcon } from '../../lib/strokeIcons'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import { useScenesStore } from '../../stores/scenes'
import RoomBrightness from '../devices/RoomBrightness.vue'
import RoomLightsToggle from '../devices/RoomLightsToggle.vue'
import SceneChips from '../scenes/SceneChips.vue'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import PulseDot from '../ui/PulseDot.vue'

// Panneau « pièce » (ou zone du jardin) : fil d'Ariane, titre, appareils avec bascule rapide.
const emit = defineEmits<{ back: [] }>()
const house = useHouseStore()
const devices = useDevicesStore()
const scenes = useScenesStore()
const { t, locale } = useI18n()

const target = computed(() => {
  const idx = house.index
  if (!idx || !house.selectedRoomId) return null
  const room = idx.roomsById.get(house.selectedRoomId)
  if (room) return { name: room.name, where: idx.levelsById.get(room.levelId)?.name ?? '', list: idx.devicesByRoom.get(room.id) ?? [] }
  const zone = idx.zonesById.get(house.selectedRoomId)
  if (zone) return { name: zone.name, where: t('home.garden'), list: idx.devicesByZone.get(zone.id) ?? [] }
  return null
})

function row(d: HouseDevice) {
  const descriptor = d.deviceId ? devices.descriptors[d.deviceId] : undefined
  const state = d.deviceId ? devices.states[d.deviceId] : undefined
  const aimed = d.deviceId ? devices.targetPosition(d.deviceId) : undefined
  // Barre de son qui joue le son d'une TV en lecture : active, cochée et pulsante comme elle, le statut le
  // dit, la pochette de la TV lui sert de fond — et son interrupteur agit sur la TV (mettre en pause ce
  // qu'on entend), la barre n'ayant pas de lecture propre.
  const relay = d.deviceId ? house.relaySource(d.deviceId) : undefined
  const toggle = relay ? toggleCommand(relay.state) : state ? toggleCommand(state, aimed) : null
  return {
    key: d.id, name: d.name ?? descriptor?.name ?? d.id, icon: kindIcon(descriptor?.kind ?? d.kind, descriptor),
    on: !!state && (isDeviceOn(state, descriptor) || !!relay),
    // `on` teinte l'icône (un volet OUVERT est l'actif), `checked` est la valeur de
    // l'interrupteur (un volet FERMÉ est coché) — voir `lib/cover.ts`. La cible tenue par le store
    // entre dans `checked` : l'interrupteur bascule au geste, pas à la fin de la course.
    checked: !!state && (toggleChecked(state, aimed) || !!relay),
    busy: !!state && (isDevicePulsing(state, aimed !== undefined) || !!relay),
    status: relay ? relayLabel(relay.name, relay.state, t)
      : descriptor && state ? statusLabel(descriptor, state, t, locale.value) : t('device.unbound', { id: d.deviceId ?? '—' }),
    // `target` : qui reçoit la commande de l'interrupteur (la TV pour une barre qui relaie)
    toggle, target: relay ? relay.descriptor.id : d.deviceId, available: state?.available ?? false,
    // fond de ligne : pochette du morceau (lecteur en lecture, ou celui qu'il relaie) ou teinte de la lampe allumée
    ...backdrop(state, relay?.state),
  }
}
/** Style du fond et sa clé (la pochette change au morceau ; la teinte suit la lampe sans fondu croisé). */
function backdrop(state: DeviceState | undefined, heard?: DeviceState): { backdrop?: Record<string, string>; backdropKey?: string } {
  if (!state || !state.available) return {}
  const media = heard ?? state
  if (media.kind === 'media_player' && media.nowPlaying?.artUrl) return { backdrop: { backgroundImage: `url(${JSON.stringify(media.nowPlaying.artUrl)})` }, backdropKey: media.nowPlaying.artUrl }
  if (state.kind === 'light') { const tint = lightTintCss(state); if (tint) return { backdrop: { background: tint }, backdropKey: 'tint' } }
  return {}
}
const rows = computed(() => (target.value?.list ?? []).map(row))
/** Appareils liés de la pièce : l'interrupteur maître y cherche les lampes. */
const deviceIds = computed(() => (target.value?.list ?? []).map((d) => d.deviceId))
/** Ambiances du fabricant rattachées à cette pièce (rapprochement par nom). */
const roomScenes = computed(() => (target.value ? scenes.forRoom(target.value.name) : []))
</script>

<template>
  <template v-if="target">
    <button type="button" class="crumb" @click="emit('back')"><StrokeIcon name="back" :size="14" /> {{ $t('nav.home') }}</button>
    <div class="head">
      <div class="min0">
        <div class="title">{{ target.name }}</div>
        <div class="muted sub">{{ target.where }} · {{ $t('home.devicesCount', { n: rows.length }, rows.length) }}</div>
      </div>
      <!-- éteindre (ou allumer) la pièce d'un geste, sans parcourir la liste -->
      <RoomLightsToggle :device-ids="deviceIds" />
    </div>
    <!-- luminosité de toute la pièce : sur sa propre ligne, sous l'interrupteur qu'elle prolonge -->
    <RoomBrightness :device-ids="deviceIds" />
    <SceneChips :scenes="roomScenes" :label="$t('scenes.title')" :add-to="target.name" />
    <div class="rows">
      <div v-for="r in rows" :key="r.key" class="dev-row" role="button" tabindex="0" @click="house.selectDevice(r.key)" @keydown.enter="house.selectDevice(r.key)">
        <!-- fond sous le contenu (pochette ou teinte), fondu vers l'interrupteur ; absolu, il ne décale rien -->
        <Transition name="rowart">
          <div v-if="r.backdrop" :key="r.backdropKey" class="dev-row__art" :style="r.backdrop" aria-hidden="true" />
        </Transition>
        <span class="icon-square" :data-on="r.on ? '1' : '0'"><StrokeIcon :name="r.icon" :size="18" /></span>
        <div class="dev-row__main">
          <div class="dev-row__name">{{ r.name }}</div>
          <!-- statut trop long (titre d'un morceau) : il défile avec un fondu plutôt que d'être coupé -->
          <div class="dev-row__status"><PulseDot :on="r.busy" class="dev-row__dot" /><MarqueeText class="dev-row__statustext" :text="r.status" /></div>
        </div>
        <v-switch v-if="r.toggle && r.target" :model-value="r.checked" :disabled="!r.available" class="dev-row__switch"
                  @click.stop @update:model-value="devices.sendCommand(r.target!, r.toggle!)" />
        <StrokeIcon v-else name="chevron" :size="18" class="muted" />
      </div>
    </div>
  </template>
</template>

<style scoped>
.crumb { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted); font-size: 13px; padding: 0; align-self: flex-start; }
.crumb:hover { color: var(--text); }
/* titre à gauche, interrupteur maître collé à droite (il ne bouge pas quand le nom s'allonge) */
.head { display: flex; align-items: center; gap: 12px; }
.min0 { flex: 1 1 0; min-width: 0; }
.title { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
.sub { font-size: 13px; margin-top: 2px; }
.rows { display: grid; gap: 8px; }
.dev-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius);
  background: var(--surface2); cursor: pointer; transition: filter .15s;
  /* repère, contexte d'empilement et découpe de la pochette de fond */
  position: relative; isolation: isolate; overflow: hidden;
}
.dev-row__art {
  position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background-size: auto; background-position: center; opacity: .22;
  mask-image: linear-gradient(90deg, #000 0, #000 35%, transparent 75%);
  -webkit-mask-image: linear-gradient(90deg, #000 0, #000 35%, transparent 75%);
}
.rowart-enter-active, .rowart-leave-active { transition: opacity .6s ease; }
.rowart-enter-from, .rowart-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .rowart-enter-active, .rowart-leave-active { transition: none; } }
.dev-row:hover { filter: brightness(1.03); }
.dev-row__main { flex: 1 1 0; min-width: 0; }
/* nom trop long (id d'un appareil non lié) : coupé aux points de suspension, comme dans les vues en bandes */
.dev-row__name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dev-row__status { font-size: 12px; color: var(--muted); display: flex; align-items: center; min-width: 0; }
.dev-row__statustext { flex: 1 1 auto; min-width: 0; }
.dev-row__dot { margin-right: 6px; color: var(--accent); }
.dev-row__switch { flex: 0 0 auto; }
</style>
