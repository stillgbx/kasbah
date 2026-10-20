<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DeviceEntry, StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import PulseDot from '../components/ui/PulseDot.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { isDevicePulsing } from '../lib/deviceState'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'

// Media view: speakers, alarm clocks, Chromecasts, TVs — everything of kind `media_player`. The
// per-room list comes from `RoomBands` (shared with Lights, Covers, Cameras); the status of the
// row already says "Playing · title" or "Idle" (`lib/deviceState.ts`). What remains here is the
// transport buttons and the volume.
//
// The buttons follow the capabilities: a Chromecast plugged into a TV has a "fixed" volume (it is
// set on the TV) and so has neither slider nor mute; a player without a queue has no next
// track. Play / pause only makes sense if something is loaded: on an idle device the
// plugin would refuse the command, so the button is greyed out.
const devices = useDevicesStore()
const house = useHouseStore()

const players = computed(() => devices.list.filter((e) => e.state.kind === 'media_player'))
// Soundbar that plays a TV's sound (`lib/audioRouting.ts`): the dot pulses, the TV's cover art
// is its row background, and the play / pause button acts on the TV — it is the one you hear.
// Previous / next stay greyed out: they address the bar's queue, which has none.
const pulsing = (entry: DeviceEntry) => isDevicePulsing(entry.state) || !!house.relaySource(entry.descriptor.id)
/** What you hear on this row: the relayed TV's playback, otherwise its own. */
const heard = (entry: DeviceEntry): { id: string; state: StateFor<'media_player'> } => {
  const relay = house.relaySource(entry.descriptor.id)
  return relay && relay.state.kind === 'media_player' ? { id: relay.descriptor.id, state: relay.state } : { id: entry.descriptor.id, state: entry.state as StateFor<'media_player'> }
}
// like the header: its own playback, or a TV's sound relayed by a bar — both are playing
const playingCount = computed(() => players.value.filter((e) => e.state.available
  && ((e.state as StateFor<'media_player'>).playback === 'playing' || house.soundRoutes.relays.has(e.descriptor.id))).length)

// Local value during the drag only; afterwards the published state is displayed
// (otherwise the handle would go back between the gesture and the device's response).
const draft = ref<Record<string, number>>({})
const shownVolume = (id: string, volume: number) => draft.value[id] ?? volume
function drag(id: string, v: number) { draft.value = { ...draft.value, [id]: v } }
function commit(id: string, v: number) {
  void devices.sendCommand(id, { type: 'media_player.set_volume', volume: Math.round(v) })
  const next = { ...draft.value }
  delete next[id]
  draft.value = next
}
const has = (entry: { descriptor: { capabilities: string[] } }, c: string) => entry.descriptor.capabilities.includes(c)
// cover art of the track as the row background (URL relayed by the server, see the Cast plugin), faded toward the right
const art = (entry: DeviceEntry) => {
  const s = heard(entry).state
  return entry.state.available && s.nowPlaying?.artUrl ? s.nowPlaying.artUrl : undefined
}
const loaded = (s: StateFor<'media_player'>) => s.playback === 'playing' || s.playback === 'paused'
// a live stream has neither previous nor next track: both buttons are greyed out (see MediaPlayerControl)
const skippable = (s: StateFor<'media_player'>) => loaded(s) && s.nowPlaying?.live !== true
</script>

<template>
  <div class="page">
    <PageHeader>
      <div class="muted count">{{ $t('media.summary', { playing: playingCount, total: players.length }) }}</div>
    </PageHeader>
    <div class="page__scroll">
      <div v-if="players.length === 0" class="card card--soft empty muted">{{ $t('media.none') }}</div>
      <RoomBands kind="media_player">
        <template #backdrop="{ entry }">
          <Transition name="rowart">
            <div v-if="art(entry)" :key="art(entry)" class="row-art" :style="{ backgroundImage: `url(${JSON.stringify(art(entry))})` }" aria-hidden="true" />
          </Transition>
        </template>
        <template #status-badge="{ entry }">
          <PulseDot :on="pulsing(entry)" class="dot" />
        </template>
        <template #control="{ entry }">
          <div class="controls">
            <div class="keys">
              <button v-if="has(entry, 'track_skip')" type="button" class="key"
                      :disabled="!entry.state.available || !skippable(entry.state as StateFor<'media_player'>)"
                      :title="$t('media.previous')" :aria-label="$t('media.previous')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'media_player.previous' })">
                <StrokeIcon name="skipPrev" :size="18" />
              </button>
              <button type="button" class="key key--main"
                      :disabled="!entry.state.available || !loaded(heard(entry).state)"
                      :title="heard(entry).state.playback === 'playing' ? $t('common.pause') : $t('media.play')"
                      :aria-label="heard(entry).state.playback === 'playing' ? $t('common.pause') : $t('media.play')"
                      @click="devices.sendCommand(heard(entry).id, { type: heard(entry).state.playback === 'playing' ? 'media_player.pause' : 'media_player.play' })">
                <StrokeIcon :name="heard(entry).state.playback === 'playing' ? 'pause' : 'play'" :size="18" />
              </button>
              <button v-if="has(entry, 'track_skip')" type="button" class="key"
                      :disabled="!entry.state.available || !skippable(entry.state as StateFor<'media_player'>)"
                      :title="$t('media.next')" :aria-label="$t('media.next')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'media_player.next' })">
                <StrokeIcon name="skipNext" :size="18" />
              </button>
              <button v-if="has(entry, 'mute')" type="button" class="key" :disabled="!entry.state.available"
                      :data-on="(entry.state as StateFor<'media_player'>).muted ? '1' : '0'"
                      :title="(entry.state as StateFor<'media_player'>).muted ? $t('media.unmute') : $t('media.mute')"
                      :aria-label="(entry.state as StateFor<'media_player'>).muted ? $t('media.unmute') : $t('media.mute')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'media_player.set_mute', muted: !(entry.state as StateFor<'media_player'>).muted })">
                <StrokeIcon :name="(entry.state as StateFor<'media_player'>).muted ? 'volumeOff' : 'volume'" :size="18" />
              </button>
            </div>
            <v-slider v-if="has(entry, 'volume')"
                      :model-value="shownVolume(entry.descriptor.id, (entry.state as StateFor<'media_player'>).volume)"
                      :min="0" :max="100" :step="1" :disabled="!entry.state.available"
                      :aria-label="$t('media.volume')"
                      density="compact" hide-details class="controls__slider"
                      @update:model-value="(v: number) => drag(entry.descriptor.id, v)"
                      @end="(v: number) => commit(entry.descriptor.id, v)" />
            <span v-if="has(entry, 'volume')" class="muted pct">{{ Math.round(shownVolume(entry.descriptor.id, (entry.state as StateFor<'media_player'>).volume)) }} %</span>
          </div>
        </template>
      </RoomBands>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); }
.count { font-size: 13px; }
.empty { padding: 24px; text-align: center; }
.controls { grid-column: 1 / -1; display: flex; align-items: center; gap: 14px; margin: 2px 4px 0; }
.controls__slider { flex: 1 1 auto; }
.pct { font-size: 12px; width: 4ch; text-align: right; flex: 0 0 auto; }
.dot { margin-right: 6px; color: var(--accent); }
/* cover art behind the row: under the icon and the name, faded before the buttons; overflows by
   4 px on each side to cover the row up to the card's edges */
.row-art {
  position: absolute; inset: 0 -4px; z-index: -1; pointer-events: none;
  background-size: auto; background-position: center; opacity: .2;
  mask-image: linear-gradient(90deg, #000 0, #000 30%, transparent 70%);
  -webkit-mask-image: linear-gradient(90deg, #000 0, #000 30%, transparent 70%);
}
.rowart-enter-active, .rowart-leave-active { transition: opacity .6s ease; }
.rowart-enter-from, .rowart-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .rowart-enter-active, .rowart-leave-active { transition: none; } }
.keys { display: flex; gap: 4px; flex: 0 0 auto; }
.key {
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
.key--main { border-color: var(--accent); color: var(--accent); }
.key[data-on="1"] { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
</style>
