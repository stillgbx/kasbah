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
import MowerZones from '../robots/MowerZones.vue'
import { useJournals } from '../../composables/useJournals'
import { journalPoints } from '../../lib/journal'
import PanelArraysCard from './PanelArraysCard.vue'
import PlacementControl from './PlacementControl.vue'

// "Device" panel: breadcrumb to its parent, header (icon, name, vendor, toggle), big value, then
// the control specific to the type.
const emit = defineEmits<{ back: [] }>()
const house = useHouseStore()
const devices = useDevicesStore()
const notifications = useNotificationsStore()
const { t, locale } = useI18n()
const resolved = useDeviceResolver(computed(() => house.selectedKey))

/**
 * A vehicle's SETTINGS, folded behind their button like "Location" is behind "Move": what one
 * comes to do here is drive the car, not adjust it. Open, they are written as you type and each
 * manual choice is reset by its cross (see `VehicleTuning`). A vehicle with nothing to adjust does
 * not even show the button.
 */
const tuningOpen = ref(false)
const tunableCar = computed(() => {
  const d = resolved.value?.descriptor
  return d?.kind === 'vehicle' && tunableVehicle(d, resolved.value?.houseDevice) ? d : null
})
/**
 * The mower robot has its own: the OFFSET of its GPS position (`MowerTuning`, the same block as on
 * the Robots view — here you see it applied in the scene) and its LOG. The log unfolds behind its
 * button and, unfolded, puts its incidents positioned ON THE GROUND of the scene; a chosen row
 * frames the camera on it. That is how a failure is located from the house.
 */
const tunableMower = computed(() => {
  const d = resolved.value?.descriptor
  const s = resolved.value?.state
  return d?.kind === 'mower' && s?.kind === 'mower' && !!s.location && resolved.value?.houseDevice?.position === undefined ? d : null
})
/**
 * The cover has its own: leaves, material, color (`CoverTuning`). They only concern what is
 * DRAWN, and a cover absent from the house is drawn nowhere — nothing to adjust until it is
 * placed (or linked to an opening, which places it too).
 */
const tunableCover = computed(() => {
  const d = resolved.value?.descriptor
  return d?.kind === 'cover' && resolved.value?.houseDevice ? d : null
})
/**
 * The mower's ZONES: mow one of them, open or close an exclusion zone — the same panel as on the
 * Robots view, robot in sight. Folded behind its button, like the log.
 */
const zonable = computed(() => {
  const d = resolved.value?.descriptor, s = resolved.value?.state
  if (d?.kind !== 'mower' || s?.kind !== 'mower') return null
  const workAreas = d.capabilities.includes('work_areas'), stayOutZones = d.capabilities.includes('stay_out_zones')
  return workAreas || stayOutZones ? { id: d.id, state: s, workAreas, stayOutZones, siteMap: d.capabilities.includes('site_map') } : null
})
const zonesOpen = ref(false)
const journalable = computed(() => {
  const d = resolved.value?.descriptor
  return d?.kind === 'mower' && d.capabilities.includes('journal') ? d : null
})
const journalIds = computed(() => (journalable.value ? [journalable.value.id] : []))
const { journals } = useJournals(journalIds)
const journalEntries = computed(() => (journalable.value ? journals.value[journalable.value.id] ?? [] : []))
const journalOpen = ref(false)
/** The active incident is SHARED with the scene: a touched pin highlights its row here, and scrolls the list to it. */
const journalActive = computed(() => house.journalActive ?? undefined)
function toggleJournal(): void {
  journalOpen.value = !journalOpen.value
  if (journalOpen.value && journalable.value) house.showJournal(journalable.value.id, journalPoints(journalEntries.value))
  else house.hideJournal()
}
// the log refreshes while it is open: the pins follow
watch(journalEntries, (entries) => { if (journalOpen.value && journalable.value) house.showJournal(journalable.value.id, journalPoints(entries)) })
function pickEntry(e: { at: number }): void {
  if (journalable.value) house.focusJournalPoint(journalable.value.id, e.at)
}
// device changed, the settings and the log fold back: the next panel opens on its controls
watch(() => house.selectedKey, () => { tuningOpen.value = false; zonesOpen.value = false; journalOpen.value = false; house.hideJournal() })
onBeforeUnmount(() => house.hideJournal())

/**
 * The PARENT we came down from, and where the back button leads: the room, the garden zone, or
 * failing that the level that carries the device (a camera placed on the roof, outside any room).
 * "Home" remains only for a device that is nowhere.
 */
const crumb = computed(() => {
  const hd = resolved.value?.houseDevice
  if (!hd) return t('nav.home')
  // a field module belongs to its INSTALLATION: that is the one we name, and where back leads
  if (site.value) return site.value.name
  const idx = house.index
  return (hd.roomId ? idx?.roomsById.get(hd.roomId)?.name
    : hd.zoneId ? idx?.zonesById.get(hd.zoneId)?.name
    : hd.levelId ? idx?.levelsById.get(hd.levelId)?.name : null) ?? t('nav.home')
})
/**
 * What the device IS, said as closely as possible: the kind declared by the vendor when there is
 * one ("Gate", "Awning", "TV"), the kind otherwise. A gate announced as "Shutter" read as a
 * linking error — and the kind's generic word ("Cover") is only a fallback, for a cover whose
 * vendor does not say the kind.
 */
const kindLabel = computed(() => {
  const d = resolved.value?.descriptor
  if (!d) return ''
  if (d.kind === 'media_player') return t(`media.classes.${d.meta.mediaPlayer?.deviceClass ?? 'speaker'}`)
  if (d.kind === 'cover' && d.meta.cover?.deviceClass) return t(`cover.classes.${d.meta.cover.deviceClass}`)
  // Ceiling light linked to a fan (or the reverse): the two functions of the same object.
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

/** Player whose sound this device plays (soundbar of a TV that is playing) — see `lib/audioRouting.ts`. */
const relay = computed(() => (resolved.value?.deviceId ? house.relaySource(resolved.value.deviceId) : undefined))
const on = computed(() => !!resolved.value?.state && (isDeviceOn(resolved.value.state, resolved.value.descriptor) || !!relay.value))
const pending = computed(() => !!resolved.value?.deviceId && devices.isPending(resolved.value.deviceId))
/** Targeted position when the store holds one: it governs EVERYTHING that displays this cover. */
const aimed = computed(() => (resolved.value?.deviceId ? devices.targetPosition(resolved.value.deviceId) : undefined))

/** Request in flight OR device still busy (a shutter travel lasts ~20 s, see `isDeviceBusy`). */
const busy = computed(() => pending.value
  || (!!resolved.value?.state && isDeviceBusy(resolved.value.state, aimed.value !== undefined)))
/** Switch value: for a cover, checked = CLOSED (see `lib/cover.ts`), target included; also checked when the device relays. */
const checked = computed(() => !!resolved.value?.state && (toggleChecked(resolved.value.state, aimed.value) || !!relay.value))
/**
 * Command of a click on the switch: derived from the target, hence able to REVERSE a travel. For a
 * bar that relays, it is the TV that gets paused (`toggleTarget`): it is the one we hear.
 */
const toggle = computed(() => (relay.value ? toggleCommand(relay.value.state) : resolved.value?.state ? toggleCommand(resolved.value.state, aimed.value) : null))
const toggleTarget = computed(() => relay.value?.descriptor.id ?? resolved.value?.deviceId)
const headline = computed(() => {
  const r = resolved.value
  if (!r?.descriptor || !r.state) return ''
  // for a cover, the big value follows the TARGETED POSITION, like the slider just below:
  // otherwise the two would contradict each other during the whole travel
  const state = r.state
  // a vehicle: the card below (`VehicleCard`) already says the battery, with its gauge
  if (state.kind === 'vehicle') return ''
  if (state.kind === 'cover' && r.deviceId) {
    const target = devices.targetPosition(r.deviceId)
    if (target !== undefined) return headlineValue(r.descriptor, { ...state, position: target }, t, locale.value)
  }
  // what one HEARS on a soundbar that relays: the TV's track, not "Idle" — the control, below,
  // says where it comes from ("Sound from TV Living room")
  if (relay.value) {
    const src = relay.value.state
    return (src.kind === 'media_player' && src.nowPlaying?.title) || relayLabel(relay.value.name, src, t)
  }
  return headlineValue(r.descriptor, state, t, locale.value)
})
/**
 * Movable: in the JSON or auto-placed, excluding shutters (anchored to an opening), mower (published
 * position) and modules of a panel array (they move with their array, not one by one).
 */
/** The device to place, or `null`: an UNPLACED device (a vehicle) has no handle in the scene. */
const placeable = computed<PlacedHouseDevice | null>(() => {
  const hd = resolved.value?.houseDevice
  if (!hd || !isPlaced(hd) || hd.openingId || panelOf(hd)) return null
  // neither a mower (it parks at its base), nor a vehicle: a car's place comes from its
  // GPS, not from a gesture — offering to place it would be a button with no effect
  const kind = resolved.value?.descriptor?.kind ?? hd.kind
  return kind !== 'mower' && kind !== 'vehicle' ? hd : null
})
/** The array this device is a module of, when it is one (it follows its array, see `panels.ts`). */
const panelCell = computed(() => (resolved.value?.houseDevice ? panelOf(resolved.value.houseDevice) : undefined))
const array = computed(() => (panelCell.value ? house.arrays.find((a) => a.id === panelCell.value!.arrayId) : undefined))
/**
 * The installation that carries this array: the module's parent in the breadcrumb, and the panel where its
 * setting lives. Named by its house entry if it is placed, by the vendor otherwise.
 */
const site = computed(() => {
  const id = array.value ? house.siteOf(array.value) : undefined
  if (!id) return undefined
  const hd = house.index?.devicesByBinding.get(id)
  return { key: hd?.id ?? id, name: hd?.name ?? devices.descriptors[id]?.name ?? id }
})

/**
 * Solar installation: the site of an installation that PRODUCES (and not a battery, nor a mere
 * meter). It is on its panel that the panel arrays are declared — the modules, for their part, are
 * derived from their array and have nothing to adjust.
 */
const solarSite = computed(() => {
  const d = resolved.value?.descriptor
  return d && isEnergySite(d) && d.capabilities.includes('production') ? d.id : null
})
// Track cover (or radio visual) in the background of the top of the panel, faded at top and bottom.
// Absolute layer behind the content: nothing shifts when it appears, changes or disappears.
// The image is PRELOADED: the layer is only put in place once the image is decoded (otherwise it
// appeared all at once on load, or stayed empty if the image server refused), and a URL that fails
// leaves nothing. A late response from an already replaced URL is ignored.
const artUrl = computed(() => {
  const own = resolved.value?.state
  if (!own?.available) return undefined
  const s = relay.value?.state ?? own                                  // relaying bar: the TV's cover art
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
 * "Forget device": offered to devices that the plugin REMEMBERS (`meta.forgettable` — a switched-off
 * Cast no longer announces itself and would stay listed forever) that do not answer and are NOT in
 * the house. A placed device is first removed from the house ("Location"), otherwise its entry
 * would point to an id that no plugin reports anymore.
 */
const forgettable = computed(() => {
  const r = resolved.value
  return !!r?.descriptor?.meta.forgettable && !r.houseDevice && !!r.state && !r.state.available
})

function send(cmd: CommandInput) {
  const id = resolved.value?.deviceId
  if (!id) return
  // Rewriting a motor's favorite position is barely visible — the cover does not move, and
  // only the button's small value changes. Yet this setting lives IN the motor and is also used by
  // wall remotes: it deserves an explicit acknowledgment, not a silent change.
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
    <!-- cross-fade between two covers: both layers coexist for the duration of the transition -->
    <Transition name="art">
      <div v-if="art" :key="art" class="art" :style="{ backgroundImage: `url(${JSON.stringify(art)})` }" aria-hidden="true" />
    </Transition>
    <!-- sticky: breadcrumb and header stay in view when the control scrolls (styles/app.css) -->
    <div class="panel-head">
    <button type="button" class="crumb" @click="emit('back')"><StrokeIcon name="back" :size="14" /> {{ crumb }}</button>
    <div class="head">
      <span class="icon-square icon-square--lg" :data-on="on ? '1' : '0'"><StrokeIcon :name="headIcon" :size="22" /></span>
      <div class="head__main">
        <!-- name too long for the panel's 340 px (an unlinked device id is 50 characters):
             it scrolls with a fade rather than overflowing, like a track title -->
        <MarqueeText class="head__name" :text="resolved.name" />
        <div class="muted head__sub">
          <!-- each says ITS kind (TV, gate, awning) rather than the kind's word -->
          <span v-if="resolved.descriptor">{{ kindLabel }}</span>
          <!-- "Unavailable" BEFORE the vendor: the line fits in 340 px, and if it is cut
               it is the brand that goes, not the information that matters -->
          <span v-if="resolved.state && !resolved.state.available" class="text-error"> · {{ $t('common.unavailable') }}</span><span v-if="brand"> · {{ brand }}</span>
        </div>
      </div>
      <!-- FIXED footprint: the spinner (20 px) replaces the switch (52 x 56) for the duration of the
           server round trip, and without this reserve the header retracts and pushes the whole
           panel up -->
      <div v-if="toggle || busy" class="head__toggle">
        <v-progress-circular v-if="busy" indeterminate size="20" width="2" color="primary" />
        <v-switch v-else-if="toggle" :model-value="checked" :disabled="!resolved.state?.available" @update:model-value="devices.sendCommand(toggleTarget!, toggle!)" />
      </div>
    </div>
    </div>
    <MarqueeText v-if="headline" class="big-value" :text="headline" />
    <!-- `relay-from` goes through the switch (undeclared attribute) down to the player's control, the only one to read it -->
    <DeviceControl v-if="resolved.descriptor && resolved.state" :descriptor="resolved.descriptor" :state="resolved.state"
                   :pending="devices.isPending(resolved.deviceId!)" :relay-from="relay?.name" @command="send" />
    <div v-else class="card card--soft unbound muted">{{ $t('device.unbound', { id: resolved.houseDevice?.deviceId ?? resolved.key }) }}</div>
    <!-- a vehicle is not placed (its GPS does it): what it has to adjust is the correction of
         that place and of its heading — and we see them applied in the scene, car in sight.
         Folded behind "Adjust", foot at the bottom like "Location". -->
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
    <!-- the cover: what the house knows about it and the vendor does not — its leaves, its
         material, its color. Folded behind "Adjust", like a vehicle's settings: what one
         comes to do here is operate the shutter, not describe it. -->
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
    <!-- the robot's zones: mow one of them, open or close an exclusion -->
    <div v-if="zonable" class="card card--soft tuning">
      <div v-if="zonesOpen" class="tuning__body">
        <MowerZones :state="zonable.state" :work-areas="zonable.workAreas" :stay-out-zones="zonable.stayOutZones"
                    :busy="devices.isPending(zonable.id)" :scene-device-id="zonable.siteMap ? zonable.id : undefined" @command="send" />
      </div>
      <div class="tuning__foot">
        <span class="muted">{{ $t('mower.zonesTitle') }}</span>
        <button type="button" class="pill tuning__cta" :data-on="zonesOpen ? '1' : '0'" :aria-expanded="zonesOpen" @click="zonesOpen = !zonesOpen">
          <StrokeIcon name="layers" :size="16" /> {{ zonesOpen ? $t('place.done') : $t('mower.zones') }}
        </button>
      </div>
    </div>
    <!-- the robot's log: folded behind its button (the number of lines flags it), unfolded it
         puts its incidents on the scene's ground, and a chosen row frames the camera on it -->
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
    <!-- the mower's GPS offset: the same block as on the Robots view, robot in sight -->
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
    <!-- the panel arrays are declared here, right above the installation's location -->
    <PanelArraysCard v-if="solarSite" class="arrays" :site-device-id="solarSite" />
    <!-- rarely used: wedged at the bottom of the panel, under everything else -->
    <PlacementControl v-if="placeable" class="placement" :device="placeable" />
    <!-- array module: it is not placed on its own, but it leads to the setting of its array -->
    <div v-else-if="array" class="card card--soft placement place-new">
      <div class="place-new__row">
        <span class="muted">{{ $t('arrays.single') }}</span>
        <button type="button" class="pill place-new__cta" @click="house.editArray(array.id)">
          <StrokeIcon name="move" :size="16" /> {{ $t('arrays.edit') }}
        </button>
      </div>
      <div class="muted place-new__hint">{{ array.name ?? array.id }} · {{ $t('arrays.cell', { r: panelCell!.row + 1, c: panelCell!.col + 1 }) }}</div>
    </div>
    <!-- device known to the plugin but absent from the house: place it from here, without going back through the
         list. Except a VEHICLE: its place comes from its GPS, placing it by hand would make no sense -->
    <div v-else-if="resolved.descriptor && !resolved.houseDevice && resolved.descriptor.kind !== 'vehicle'" class="card card--soft placement place-new">
      <div class="place-new__row">
        <span class="muted">{{ $t('place.title') }}</span>
        <button type="button" class="pill place-new__cta" :title="$t('rooms.origins.placeHint')" @click="house.startPlacingNew(resolved.descriptor.id)">
          <StrokeIcon name="pin" :size="16" /> {{ $t('rooms.origins.place') }}
        </button>
      </div>
      <!-- device remembered by the plugin that no longer answers: if it has disappeared for good, forget it
           (see `forgettable`); it leaves the inventory, the panel no longer has a subject -->
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
/* a vehicle's settings close its panel, like "Location" closes that of a placed device */
.tuning { margin-top: auto; padding: 12px 14px; font-size: 13px; }
/* several folded blocks (zones, log, a robot's settings): only the FIRST takes the automatic
   margin, the following ones line up under it at the ordinary spacing — otherwise each auto margin
   takes its share of the free height and the blocks scatter over the whole panel */
.tuning ~ .tuning, .tuning ~ .arrays, .tuning ~ .placement { margin-top: 0; }
/* the foot carries the title and the single button, which keeps its place and width in both states */
.tuning__foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.tuning__cta { min-width: 124px; justify-content: center; }
.tuning__body { padding-bottom: 12px; }
/* the settings card lives INSIDE this one: without that, two backgrounds and two inner margins */
.tuning__body :deep(.tune) { padding: 0; background: none; }
/* the robot's zones: same rule, a single card around */
.tuning__body :deep(.zones) { padding-left: 0; padding-right: 0; background: none; }
.tuning__count { min-width: 20px; padding: 0 6px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--surface2); color: var(--text); }
/* the arrays card sticks to the "Location" block that closes the panel */
.arrays { margin-top: auto; }
.arrays + .placement { margin-top: 0; }
.place-new { padding: 12px 14px; font-size: 13px; display: grid; gap: 10px; }
.place-new__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
/* same width as the "Forget device" button on the line below: the two line up */
.place-new__cta { flex: 0 0 auto; min-width: 150px; justify-content: center; font-size: 12px; }
.place-new__hint { min-width: 0; font-size: 12px; }
.head__main { flex: 1 1 0; min-width: 0; }
.head__name { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
/* kind · vendor · availability: never on two lines, cut with ellipsis */
.head__sub { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-square--lg { width: 44px; height: 44px; border-radius: 12px; }
.head__toggle { flex: 0 0 52px; height: 56px; display: grid; place-items: center; }
/* the sentence carries a plugin id, in one piece: it breaks anywhere rather than leaving the panel */
.unbound { padding: 12px 14px; font-size: 13px; overflow-wrap: anywhere; }
</style>
