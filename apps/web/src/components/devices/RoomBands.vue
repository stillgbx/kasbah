<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceEntry, DeviceKind } from '@kasbah/shared'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { useRouter } from 'vue-router'
import { deviceIcon } from '../../lib/deviceIcons'
import { fanLinkedTo } from '../../lib/linkedDevices'
import ForgetDeviceButton from './ForgetDeviceButton.vue'
import MarqueeText from '../ui/MarqueeText.vue'
import { relayLabel } from '../../lib/audioRouting'
import { isDeviceOn, statusLabel } from '../../lib/deviceState'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'

// All the devices of a given kind reported by the plugins, grouped by room and arranged in
// BANDS: one per level (from top to bottom, `levelsSorted`) then a "Not in the house" band.
// A band = its own grid, so each level starts on a new line.
//
// Shared by the Lights, Covers, Cameras, Media and Energy views: from one view to another, ONLY the
// control of a row changes — it comes from the `control` slot. Everything else is common: the
// grouping, the room order and its handle-based adjustment, the JSON link pill, the card of dead
// links. It is also what guarantees that a fix benefits both views. A second slot,
// `status-badge`, allows adding a pill before the status label (empty by default).
// `kind` accepts a LIST: the Energy view brings together the site, the batteries and the charger,
// which do not have the same kind but are read and placed in the same spot.
const props = defineProps<{ kind: DeviceKind | DeviceKind[]; /** Hide the devices that declare `meta.linkedTo`. */ hideLinked?: boolean }>()
const kinds = computed<DeviceKind[]>(() => (Array.isArray(props.kind) ? props.kind : [props.kind]))
const router = useRouter()

/** A device with no entry at all: we take it into the 3D house, provisional, ready to be placed. */
async function place(entry: DeviceEntry) {
  // NAVIGATE FIRST, set the state AFTER: HomeView stays alive under keep-alive and reflects any
  // selection in the URL of the current route — starting the placement before the push rewrote
  // "?device=…" on the list and cancelled the navigation (see 6_1). If the house is not yet
  // loaded, the store keeps the request and replays it on arrival.
  await router.push({ name: 'home' }).catch(() => {})
  house.startPlacingNew(entry.descriptor.id)
}

/** A placed device: we open it in the 3D house, same order as `place` (navigate, then select). */
async function show(entry: DeviceEntry) {
  await router.push({ name: 'home' }).catch(() => {})
  house.selectDevice(house.houseDeviceFor(entry.descriptor.id)?.id ?? entry.descriptor.id)
}

const devices = useDevicesStore()
const house = useHouseStore()
const { t, locale } = useI18n()

type Origin = 'json' | 'auto' | 'unplaced'
interface Row { entry: DeviceEntry; name: string; origin: Origin; on: boolean; status: string }
/** `roomId` = room of the house, null for a plugin room with no equivalent (not reorderable). */
interface Group { key: string; roomId: string | null; title: string; rows: Row[] }
interface Band { key: string; levelId: string | null; title: string; groups: Group[] }

const entries = computed(() => devices.list.filter((e) => {
  if (!kinds.value.includes(e.state.kind)) return false
  // A linked accessory (fan → light) is displayed in the main device's card, not as a row.
  if (props.hideLinked && e.descriptor.meta.linkedTo) return false
  return true
}))
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

// ---- reordering the rooms of a band -----------------------------------------------------------
// The drag starts from the HANDLE, never from the whole card: the cards carry switches, buttons
// and sliders that are handled by finger, and a stray gesture must not rewrite house.json. The
// list reorganizes under the finger; the order is sent on release.
const reorder = ref<{ levelId: string; roomId: string; ids: string[]; from: string[] } | null>(null)

const bands = computed<Band[]>(() => {
  const idx = house.index
  const byRoom = new Map<string, Row[]>()
  const loose = new Map<string, Row[]>()   // plugin room (raw name, '' = none) → devices
  for (const e of entries.value) {
    const hd = idx?.devicesByBinding.get(e.descriptor.id)
    const room = hd?.roomId ? idx?.roomsById.get(hd.roomId) : undefined
    // soundbar playing the sound of a TV that is playing: active, and the status names the TV and the track
    const relay = house.relaySource(e.descriptor.id)
    const row: Row = {
      entry: e,
      name: hd?.name ?? e.descriptor.name,
      origin: hd ? (hd.meta?.autoPlaced ? 'auto' : 'json') : 'unplaced',
      on: isDeviceOn(e.state, e.descriptor) || !!relay,
      status: relay ? relayLabel(relay.name, relay.state, t) : statusLabel(e.descriptor, e.state, t, locale.value),
    }
    const bucket = room ? byRoom : loose
    const key = room ? room.id : e.descriptor.meta.room ?? ''
    const arr = bucket.get(key)
    if (arr) arr.push(row)
    else bucket.set(key, [row])
  }

  const out: Band[] = []
  for (const level of idx?.levelsSorted ?? []) {
    const groups = (idx?.roomsByLevel.get(level.id) ?? [])
      .filter((r) => byRoom.has(r.id))
      .map((r) => ({ key: `room:${r.id}`, roomId: r.id as string | null, title: r.name, rows: byRoom.get(r.id)!.sort(byName) }))
    if (groups.length === 0) continue
    // during the drag, the order displayed is that of the draft (the JSON is only written on release)
    const ids = reorder.value?.levelId === level.id ? reorder.value.ids : null
    if (ids) groups.sort((a, b) => ids.indexOf(a.roomId!) - ids.indexOf(b.roomId!))
    out.push({ key: `level:${level.id}`, levelId: level.id, title: level.name, groups })
  }

  const looseGroups = [...loose.entries()]
    .map(([name, rows]) => ({ key: `plugin:${name}`, roomId: null, title: name || t('rooms.noRoom'), rows: rows.sort(byName) }))
    .sort((a, b) => a.title.localeCompare(b.title))
  if (looseGroups.length) out.push({ key: 'loose', levelId: null, title: t('rooms.notInHouse'), groups: looseGroups })
  return out
})

/** Devices of the JSON whose `deviceId` is not reported by any plugin. */
const dangling = computed(() => {
  const h = house.effective
  if (!h) return []
  // a `kind` missing from the JSON means `light` (the original kind of the format), hence the second test
  return h.devices.filter((d) => d.deviceId && !devices.descriptors[d.deviceId]
    && ((d.kind && kinds.value.includes(d.kind)) || (kinds.value.includes('light') && d.kind === undefined)))
})

function startDrag(ev: PointerEvent, band: Band, roomId: string) {
  ev.preventDefault()
  const ids = band.groups.map((g) => g.roomId!)
  reorder.value = { levelId: band.levelId!, roomId, ids, from: ids }
  // Listeners on the WINDOW, not on the handle: Vue moves the card (hence the button) on each
  // reorganization, which releases the pointer capture — the `pointerup` would never arrive.
  window.addEventListener('pointermove', moveDrag)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
}
function moveDrag(ev: PointerEvent) {
  const d = reorder.value
  if (!d) return
  const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
  const card = el?.closest<HTMLElement>('[data-room]')
  if (!card || card.dataset.level !== d.levelId) return
  const over = card.dataset.room!
  const from = d.ids.indexOf(d.roomId)
  const to = d.ids.indexOf(over)
  if (to < 0 || to === from) return
  const ids = [...d.ids]
  ids.splice(from, 1)
  ids.splice(to, 0, d.roomId)   // to > from → after the target (the removal shifted it): no oscillation
  reorder.value = { ...d, ids }
}
function endDrag() {
  window.removeEventListener('pointermove', moveDrag)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
  const d = reorder.value
  reorder.value = null
  if (d && d.ids.join() !== d.from.join()) void house.setRoomOrder(d.levelId, d.ids)
}
onBeforeUnmount(endDrag)   // leaving the view mid-drag must not leave listeners behind

defineExpose({ count: computed(() => entries.value.length) })
</script>

<template>
  <div>
    <section v-for="b in bands" :key="b.key" class="band">
      <h2 class="band__title muted">{{ b.title }}</h2>
      <div class="cards">
        <section v-for="g in b.groups" :key="g.key" class="card group"
                 :data-room="g.roomId ?? undefined" :data-level="b.levelId ?? undefined"
                 :data-dragged="reorder && reorder.roomId === g.roomId ? '1' : '0'">
          <div class="group__head">
            <div class="group__title">{{ g.title }}</div>
            <!-- control applying to the WHOLE room (Lights view: the master switch); empty by default -->
            <slot name="room-action" :entries="g.rows.map((r) => r.entry)" />
            <button v-if="g.roomId && b.levelId && b.groups.length > 1" type="button" class="grip"
                    :title="$t('rooms.reorder')" :aria-label="$t('rooms.reorder')"
                    @pointerdown="startDrag($event, b, g.roomId)">
              <StrokeIcon name="grip" :size="16" />
            </button>
          </div>
          <!-- room control that needs the FULL width (Lights view: the overall brightness): a row
               of its own, under the header, and not next to the title that it would squash -->
          <slot name="room-under" :entries="g.rows.map((r) => r.entry)" />
          <div v-for="r in g.rows" :key="r.entry.descriptor.id" class="row">
            <!-- optional row background (a player's cover art), under the content, outside the grid -->
            <slot name="backdrop" :entry="r.entry" />
            <!-- 1st column: the default icon; a view can replace it with a control that
                 shows the state (Covers view: the cover's vertical thumbnail) -->
            <slot name="leading" :entry="r.entry" :on="r.on">
              <span class="icon-square" :data-on="r.on ? '1' : '0'">
                <StrokeIcon :name="deviceIcon(r.entry.descriptor, r.entry.state, { linkedFan: !!fanLinkedTo(r.entry.descriptor.id, devices.list) })" :size="18" />
              </span>
            </slot>
            <div class="min0">
              <div class="row__name">{{ r.name }}</div>
              <div class="muted row__status">
                <!-- in front of the STATUS and not in front of the control: an element that appears next
                     to a slider changes its width, and the slider jumps under the finger -->
                <slot name="status-badge" :entry="r.entry" /><MarqueeText class="row__statustext" :text="r.status" /><slot name="status-after" :entry="r.entry" />
              </div>
            </div>
            <!-- not placed: not a badge but an action, putting the device in the house -->
            <button v-if="r.origin === 'unplaced'" type="button" class="badge badge--place" :title="$t('rooms.origins.placeHint')"
                    :aria-label="$t('rooms.origins.place')" @click="place(r.entry)">
              <StrokeIcon name="pin" :size="14" /><span class="badge__label">{{ $t('rooms.origins.place') }}</span>
            </button>
            <!-- placed: the pill leads to the device in the 3D house (framing its room, panel) -->
            <button v-else type="button" class="badge badge--show" :data-kind="r.origin"
                    :title="`${$t(`rooms.origins.${r.origin}Hint`)} · ${$t('common.showIn3d')}`"
                    :aria-label="`${$t(`rooms.origins.${r.origin}`)} · ${$t('common.showIn3d')}`" @click="show(r.entry)">
              <StrokeIcon name="pin" :size="14" />
            </button>
            <slot name="control" :entry="r.entry" :on="r.on" />
            <!-- Device that its plugin REMEMBERS although it no longer answers, and that is not in the
                 house: this is where a ghost shows up ("Not in the house"), so this is where it is
                 forgotten. On its OWN row, full width: next to the name, the pill left
                 nothing to read in a narrow card. -->
            <div v-if="r.origin === 'unplaced' && r.entry.descriptor.meta.forgettable && !r.entry.state.available" class="row__forget">
              <ForgetDeviceButton :device-id="r.entry.descriptor.id" />
            </div>
          </div>
        </section>
      </div>
    </section>

    <section v-if="dangling.length" class="band">
      <div class="cards">
        <section class="card group">
          <div class="group__head">
            <div class="group__title">{{ $t('rooms.dangling') }}</div>
          </div>
          <div class="muted group__sub">{{ $t('rooms.danglingHint') }}</div>
          <div v-for="d in dangling" :key="d.id" class="row row--dead">
            <span class="icon-square"><StrokeIcon name="link" :size="18" /></span>
            <div class="min0">
              <div class="row__name">{{ d.name ?? d.id }}</div>
              <div class="muted row__status mono">{{ d.deviceId }}</div>
            </div>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.band + .band { margin-top: 24px; }
.band__title { font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 8px 2px; }
/* `min(340px, 100%)` and not `340px`: a fixed floor remains a floor when the container is narrower
   than it, and the column then overflowed the view by 37 px on a 375 px screen. */
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 16px; align-items: start; }
.group { padding: 16px 20px; display: grid; gap: 2px; align-content: start; }
.group__head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
/* the title absorbs the free space: the content of `room-action` and the handle stay stuck to the right */
.group__title { flex: 1 1 0; min-width: 0; font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group__sub { font-size: 12px; margin-bottom: 8px; }
.group[data-dragged='1'] { outline: 2px solid var(--accent); opacity: .65; }
.grip {
  flex: 0 0 auto; display: grid; place-items: center; width: 28px; height: 28px; margin: -4px -6px -4px 0;
  border: 0; background: none; color: var(--muted); border-radius: 8px; cursor: grab; touch-action: none;
}
.grip:hover { background: var(--accent-soft); color: var(--accent); }
.grip:active { cursor: grabbing; }
/* The content of the `control` slot arrives here as grid items: a view can therefore place a
   control in the 4th column and, if needed, a slider in `grid-column: 1 / -1` on its own row. */
.row {
  display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; column-gap: 12px;
  padding: 10px 0; border-top: 1px solid var(--line);
  /* reference and stacking context of the row background (`backdrop` slot, at a negative z-index) */
  position: relative; isolation: isolate;
}
.row--dead { opacity: .7; }
.row__name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row__status { font-size: 12px; display: flex; align-items: center; gap: 6px; min-width: 0; }
/* the status scrolls with a fade if it overflows (MarqueeText): a track title is no longer cut off */
.row__statustext { flex: 1 1 auto; min-width: 0; }
.min0 { min-width: 0; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
/* the forget row takes the full width of the row, under the control */
.row__forget { grid-column: 1 / -1; display: flex; justify-content: flex-end; }
.badge {
  flex: 0 0 auto; display: grid; place-items: center; width: 22px; height: 22px; color: var(--muted);
}
/* the "Place" button: same height as the badge, but an accent pill that calls for the gesture */
.badge--place {
  width: auto; grid-auto-flow: column; gap: 4px; padding: 0 8px; border-radius: 11px;
  border: 1px solid var(--accent); background: transparent; color: var(--accent); font-size: 11px; font-weight: 600; cursor: pointer;
  transition: background .15s, color .15s;
}
.badge--place:hover { background: var(--accent); color: var(--on-accent); }
.badge__label { line-height: 1; }
/* "placed" pill: a discreet button, that only reveals itself on hover */
.badge--show { border: 0; background: none; padding: 0; border-radius: 6px; cursor: pointer; transition: background .15s, color .15s; }
.badge--show:hover { background: var(--accent-soft); color: var(--accent); }
.badge[data-kind='auto'] { color: var(--accent); }
.badge[data-kind='unplaced'] { color: #d38b22; }
</style>
