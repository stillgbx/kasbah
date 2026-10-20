<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { openingLabel, type DeviceEntry, type HouseDevice, type StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import CoversMaster from '../components/devices/CoversMaster.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import RoomShutterKeys from '../components/devices/RoomShutterKeys.vue'
import CoverPill from '../components/covers/CoverPill.vue'
import PulseDot from '../components/ui/PulseDot.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { coverActivity, coverWords, fromClosure, toClosure } from '../lib/cover'
import { formatPercent, formatSensor } from '../lib/format'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'

// Covers view: shutters, blinds, gates, windows and garage doors — everything of kind
// `cover`. The per-room list and its link diagnostic come from `RoomBands` (shared with
// the Lights view); only the control specific to a cover remains here.
//
// Open / Stop / Close are conditioned on capabilities, because the device set is heterogeneous: an
// io-homecontrol motor can target a position (slider), a one-way RTS radio only knows
// all or nothing — showing it a slider would promise a command it would refuse.
//
// The percentage is a CLOSURE (0% = open, see `lib/cover.ts`) and the slider shows the
// TARGETED position as long as the store holds one: a motor that only publishes its position at the
// end of travel would otherwise make the handle jump back right after the gesture.
const devices = useDevicesStore()
const house = useHouseStore()
const { t, locale } = useI18n()

const covers = computed(() => devices.list.filter((e) => e.state.kind === 'cover'))

// ---- header summary: one KIND at a time, described by the state that stands out — "16 shutters
// open · 2 blinds deployed · 1 gate open". A single "open" count mixed things
// that are not read in the same direction: of a shutter we remember that it is OPEN, of a blind
// that it is DEPLOYED (`coverActivity`, the same rule as the row gauges and the 3D markers).
//
// A kind absent from the house has no group; a kind present keeps its own even at zero, otherwise
// the label would jump as soon as a shutter opens ("nothing moves" rule). The order is fixed, and
// never that of the counts, for the same reason. Unknown position = not counted: nothing is
// asserted about a silent motor.
const SUMMARY_ORDER = ['shutter', 'blind', 'awning', 'curtain', 'window', 'gate', 'garage', 'other']
const summary = computed(() => {
  const counts = new Map<string, number>()
  for (const e of covers.value) {
    const cls = e.descriptor.meta.cover?.deviceClass ?? ''
    const key = SUMMARY_ORDER.includes(cls) ? cls : 'other'
    // the TARGETED position when the blind holds one, like the gauges: the count follows the gesture
    const active = e.state.available
      && coverActivity(e.descriptor, devices.targetPosition(e.descriptor.id) ?? (e.state as StateFor<'cover'>).position) > 0
    counts.set(key, (counts.get(key) ?? 0) + (active ? 1 : 0))
  }
  return [...counts.entries()]
    .sort((a, b) => SUMMARY_ORDER.indexOf(a[0]) - SUMMARY_ORDER.indexOf(b[0]))
    // the number goes as the 3rd argument and nothing else: an interpolated `n` would overwrite the plural agreement
    .map(([key, n]) => t(`covers.counts.${key}`, n))
    .join(' · ')
})

// ---- covers WITHOUT OPENING: the work list that appears after a plugin is discovered
// (Somfy months after the house was drawn, six shutters at once with no idea where they go).
// `house.coversWithoutOpening` carries the rule (waits for an opening, gate/garage kinds excluded);
// here we display it and assign, row by row. Not to be confused with an "unlinked" device
// (without `deviceId`): the link to the vendor already exists, only the place in the house is
// missing.
const waitingIds = computed(() => new Set(house.coversWithoutOpening.map((d) => d.id)))
const waiting = (hd: HouseDevice | undefined) => !!hd && waitingIds.value.has(hd.id)

/** Each opening of the house, with its room and the cover that already occupies it (if any). */
interface OpeningOption { id: string; label: string; roomId: string; roomName: string; occupantId: string | null; occupantName: string }
const openingIndex = computed<OpeningOption[]>(() => {
  const h = house.effective
  if (!h) return []
  const occupants = new Map<string, HouseDevice>()
  for (const d of h.devices) if (d.openingId) occupants.set(d.openingId, d)
  return h.rooms.flatMap((r) => r.openings.map((o) => {
    const occ = occupants.get(o.id)
    return {
      id: o.id, label: openingLabel(o), roomId: r.id, roomName: r.name,
      occupantId: occ?.id ?? null,
      occupantName: occ ? occ.name ?? (occ.deviceId ? devices.descriptors[occ.deviceId]?.name : undefined) ?? occ.id : '',
    }
  }))
})
/**
 * Selector options, for the cover `hd`: the openings of ITS ROOM first (that is where it
 * lives, so the most likely gesture), then the rest of the house — never hidden, only
 * relegated, because the full list is sometimes needed (a shutter put in the wrong place
 * by the plugin). An opening already taken is flagged ("taken by …") without disappearing: taking
 * it over is a deliberate gesture (`setCoverOpening` frees the old one).
 */
function assignOptions(hd: HouseDevice) {
  const sorted = [...openingIndex.value].sort((a, b) => Number(b.roomId === hd.roomId) - Number(a.roomId === hd.roomId))
  return [
    { value: '', title: t('covers.assignNone') },
    ...sorted.map((o) => ({
      value: o.id,
      title: o.occupantId && o.occupantId !== hd.id
        ? t('covers.assignTaken', { room: o.roomName, opening: o.label, name: o.occupantName })
        : t('covers.assignFree', { room: o.roomName, opening: o.label }),
    })),
  ]
}

// Solar shutter: its panel is a separate light sensor (`meta.linkedTo` toward the shutter).
// Indexed once per shutter, rather than looked up row by row on every render.
const lightByCover = computed(() => {
  const map = new Map<string, DeviceEntry>()
  for (const e of devices.list) {
    const to = e.descriptor.meta.linkedTo
    if (to && e.descriptor.kind === 'sensor' && e.descriptor.meta.sensor?.deviceClass === 'illuminance') map.set(to, e)
  }
  return map
})
const lightText = (coverId: string) => {
  const e = lightByCover.value.get(coverId)
  return e && e.state.kind === 'sensor' ? formatSensor(e.descriptor, e.state.value, locale.value) : undefined
}
const batteryText = (s: StateFor<'cover'>) => (s.batteryPct === undefined ? '—' : formatPercent(s.batteryPct, locale.value))

// Local value during the drag only; afterwards it is the store's target that is displayed.
const draft = ref<Record<string, number>>({})
// Closure shown by the thumbnail: the drag, otherwise the TARGETED position when the store holds
// one (the apron follows the gesture, even from a motor that only publishes at end of travel),
// otherwise the published position. Unknown = `undefined`: the thumbnail asserts nothing about a
// silent motor.
const pillClosure = (e: DeviceEntry) => {
  const id = e.descriptor.id
  const p = devices.targetPosition(id) ?? (e.state as StateFor<'cover'>).position
  return draft.value[id] ?? (p === undefined ? undefined : toClosure(p))
}

// Favorite position of the motor: mark on the thumbnail, and value in the button's accessible
// label (a list row has no room to write it out).
const presetClosure = (s: StateFor<'cover'>) => s.presetPosition === undefined ? undefined : toClosure(s.presetPosition)
function drag(id: string, v: number) { draft.value = { ...draft.value, [id]: v } }
function commit(id: string, v: number) {
  void devices.sendCommand(id, { type: 'cover.set_position', position: fromClosure(Math.round(v)) })
  const next = { ...draft.value }
  delete next[id]
  draft.value = next
}
</script>

<template>
  <div class="page">
    <PageHeader>
      <!-- close all or open all: two named gestures rather than a switch, because the
           device set is rarely all open or all closed; "close" raises a blind (`CoversMaster`) -->
      <div class="head">
        <div class="muted count">{{ summary }}</div>
        <!-- reserved space: always displayed, even at 0, so that nothing jumps in appearance when
             a plugin discovery takes the count from 0 to six -->
        <div class="muted count count--waiting" :data-zero="house.coversWithoutOpening.length === 0 ? '1' : '0'">
          {{ $t('covers.waitingCount', { n: house.coversWithoutOpening.length }, house.coversWithoutOpening.length) }}
        </div>
        <CoversMaster :entries="covers" :label="$t('covers.all')" />
      </div>
    </PageHeader>
    <div class="page__scroll">
      <div v-if="covers.length === 0" class="card card--soft empty muted">{{ $t('covers.none') }}</div>
      <RoomBands kind="cover">
        <!-- open / stop / close all the SHUTTERS of the room with one press -->
        <template #room-action="{ entries }">
          <RoomShutterKeys :entries="entries" />
        </template>
        <!-- the cover seen from the front, in place of the icon: reads OPEN without reading the row,
             and is operated in the direction it moves (see `CoverPill`). Draggable only for a motor
             that can target a position, and once its opening is known. -->
        <template #leading="{ entry }">
          <CoverPill :closure="pillClosure(entry)" :preset="presetClosure(entry.state as StateFor<'cover'>)"
                     :interactive="entry.state.available && entry.descriptor.capabilities.includes('position')
                       && !waiting(house.houseDeviceFor(entry.descriptor.id))"
                     :device-class="entry.descriptor.meta.cover?.deviceClass"
                     :label="$t(`cover.${coverWords(entry.descriptor)}.level`)"
                     :class="{ 'pill--off': !entry.state.available }"
                     @drag="(v: number) => drag(entry.descriptor.id, v)"
                     @commit="(v: number) => commit(entry.descriptor.id, v)" />
        </template>
        <!-- the pulsing dot accompanies the label ("Closing"), which is already in the
             status: placed before the slider, it would change its width on every movement -->
        <template #status-badge="{ entry }">
          <!-- cover without opening: the word before the status, so it shows without reading each
               row (this is the work list that follows a plugin discovery) -->
          <span v-if="waiting(house.houseDeviceFor(entry.descriptor.id))" class="waiting-badge" :title="$t('covers.waitingHint')">
            <StrokeIcon name="linkOff" :size="12" />{{ $t('covers.waitingBadge') }}
          </span>
          <PulseDot :on="(entry.state as StateFor<'cover'>).motion !== 'stopped'" class="dot" />
        </template>
        <!-- solar shutter: panel luminosity and motor battery, at the end of the status line.
             MINIMUM widths reserved: a figure that grows longer does not push the status. -->
        <template #status-after="{ entry }">
          <span v-if="lightText(entry.descriptor.id) !== undefined" class="fact fact--lux" :title="$t('lightHistory.title')">
            <StrokeIcon name="sun" :size="12" />{{ lightText(entry.descriptor.id) }}
          </span>
          <span v-if="entry.descriptor.capabilities.includes('battery')" class="fact fact--battery"
                :class="{ 'fact--low': ((entry.state as StateFor<'cover'>).batteryPct ?? 100) < 20 }" :title="$t('cover.battery')">
            <StrokeIcon name="battery" :size="12" />{{ batteryText(entry.state as StateFor<'cover'>) }}
          </span>
        </template>
        <template #control="{ entry }">
          <!-- cover without opening: it is assigned HERE — no sense showing Open/Close
               as long as we do not know which window it dresses -->
          <div v-if="waiting(house.houseDeviceFor(entry.descriptor.id))" class="assign">
            <span class="muted assign__label">{{ $t('covers.assign') }}</span>
            <v-select class="assign__select" :model-value="''" :items="assignOptions(house.houseDeviceFor(entry.descriptor.id)!)"
                      item-title="title" item-value="value" density="compact" variant="outlined" hide-details
                      :disabled="house.savingOpening" :aria-label="$t('covers.assign')"
                      @update:model-value="(id: string) => house.setCoverOpening(house.houseDeviceFor(entry.descriptor.id)!.id, id || null)" />
          </div>
          <!-- a separate line: three buttons in the 4th column would crush the cover's name -->
          <div v-else class="controls">
            <div class="keys">
              <button type="button" class="key" :disabled="!entry.state.available"
                      :title="$t(`cover.${coverWords(entry.descriptor)}.actionOpen`)"
                      :aria-label="$t(`cover.${coverWords(entry.descriptor)}.actionOpen`)"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.open' })">
                <StrokeIcon name="collapseUp" :size="18" />
              </button>
              <button v-if="entry.descriptor.capabilities.includes('stop')" type="button" class="key"
                      :disabled="!entry.state.available" :title="$t('common.stop')" :aria-label="$t('common.stop')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.stop' })">
                <StrokeIcon name="stop" :size="18" />
              </button>
              <button type="button" class="key" :disabled="!entry.state.available"
                      :title="$t(`cover.${coverWords(entry.descriptor)}.actionClose`)"
                      :aria-label="$t(`cover.${coverWords(entry.descriptor)}.actionClose`)"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.close' })">
                <StrokeIcon name="collapseDown" :size="18" />
              </button>
              <!-- the SETTINGS (custom position, discreet mode) pushed to the right, away from the maneuvers -->
              <span class="keys__gap" aria-hidden="true" />
              <!-- the value does not fit in a button: it goes through the label -->
              <button v-if="entry.descriptor.capabilities.includes('preset')" type="button" class="key"
                      :disabled="!entry.state.available"
                      :title="presetClosure(entry.state as StateFor<'cover'>) !== undefined
                        ? $t('cover.presetAt', { pct: `${Math.round(presetClosure(entry.state as StateFor<'cover'>)!)} %` })
                        : $t('cover.preset')"
                      :aria-label="$t('cover.preset')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.preset' })">
                <StrokeIcon name="crosshair" :size="18" />
              </button>
              <!-- discreet mode: a TOGGLE (not a maneuver), lit in the accent tint -->
              <button v-if="entry.descriptor.capabilities.includes('quiet')" type="button" class="key key--toggle"
                      :disabled="!entry.state.available" :aria-pressed="!!(entry.state as StateFor<'cover'>).quiet"
                      :title="$t('cover.quietHint')" :aria-label="$t('cover.quiet')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.set_quiet', on: !(entry.state as StateFor<'cover'>).quiet })">
                <StrokeIcon name="moon" :size="18" />
              </button>
            </div>
          </div>
        </template>
      </RoomBands>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); }
.head { display: flex; align-items: center; gap: 14px; }
.count { font-size: 13px; }
/* dimmed to 0 rather than hidden: the counter does not jump in appearance when a plugin is discovered */
.count--waiting[data-zero='1'] { opacity: .55; }
.empty { padding: 24px; text-align: center; }
/* The buttons on their own row, UNDER the name and to the right of the thumbnail (which occupies
   the 1st column across both rows, see `CoverPill`): three buttons in the 4th column would crush
   the name. The position is set on the thumbnail, in the direction the cover moves: no more
   horizontal slider, which read backwards for a shutter. */
/* `min-width: 0`: without it, five buttons would widen the `1fr` column beyond the card (375 px) */
.controls { grid-column: 2 / -1; display: grid; margin-top: 8px; min-width: 0; }
/* same footprint as `.controls`: a separate line, so as not to crush the cover's name */
.assign { grid-column: 2 / -1; display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.assign__label { font-size: 12px; flex: 0 0 auto; }
.assign__select { flex: 1 1 auto; min-width: 0; }
/* "no opening" pill: same color as the "not placed" badge of `RoomBands` — a cover
   that still dresses nothing is the same kind of unfinished */
.waiting-badge {
  display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; margin-right: 6px;
  font-size: 11px; font-weight: 600; color: #d38b22;
}
.dot { margin-right: 6px; color: var(--accent); }
/* motor unreachable: the thumbnail keeps its place and its last known state, dimmed like the buttons */
.pill--off { opacity: .4; }
/* wrap on a phone: next to the thumbnail, five 40 px buttons no longer fit,
   and the settings go under the maneuvers. This depends only on the width, never on the state. */
.keys { display: flex; flex-wrap: wrap; gap: 6px; }
.keys__gap { flex: 1 1 auto; }
.key {
  display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
.key--toggle[aria-pressed='true'] { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.fact { display: inline-flex; align-items: center; justify-content: flex-end; gap: 3px; flex: 0 0 auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fact--lux { min-width: 8ch; }
.fact--battery { min-width: 6ch; }
.fact--low { color: rgb(var(--v-theme-error)); }
</style>
