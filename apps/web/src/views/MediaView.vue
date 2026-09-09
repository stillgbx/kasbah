<script setup lang="ts">
import { computed, ref } from 'vue'
import type { StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import PulseDot from '../components/ui/PulseDot.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { useDevicesStore } from '../stores/devices'

// Vue Médias : enceintes, réveils, Chromecast, TV — tout ce qui est du kind `media_player`. La
// liste par pièce vient de `RoomBands` (partagé avec Lumières, Ouvrants, Caméras) ; le statut de la
// ligne dit déjà « Lecture · titre » ou « Au repos » (`lib/deviceState.ts`). Il reste ici les
// touches de transport et le volume.
//
// Les touches suivent les capacités : un Chromecast branché sur une TV a un volume « fixe » (il se
// règle sur la TV) et n'a donc ni curseur ni sourdine ; un lecteur sans file n'a pas de piste
// suivante. Lire / pause n'a de sens que si quelque chose est chargé : sur un appareil au repos le
// plugin refuserait la commande, la touche est donc grisée.
const devices = useDevicesStore()

const players = computed(() => devices.list.filter((e) => e.state.kind === 'media_player'))
const playingCount = computed(() => players.value.filter((e) => (e.state as StateFor<'media_player'>).playback === 'playing' && e.state.available).length)

// Valeur locale pendant le glissement seulement ; ensuite c'est l'état publié qui s'affiche
// (sinon la poignée reviendrait en arrière entre le geste et la réponse de l'appareil).
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
const loaded = (s: StateFor<'media_player'>) => s.playback === 'playing' || s.playback === 'paused'
</script>

<template>
  <div class="page">
    <PageHeader>
      <div class="muted count">{{ $t('media.summary', { playing: playingCount, total: players.length }) }}</div>
    </PageHeader>
    <div class="page__scroll">
      <div v-if="players.length === 0" class="card card--soft empty muted">{{ $t('media.none') }}</div>
      <RoomBands kind="media_player">
        <template #status-badge="{ entry }">
          <PulseDot :on="(entry.state as StateFor<'media_player'>).playback === 'playing'" class="dot" />
        </template>
        <template #control="{ entry }">
          <div class="controls">
            <div class="keys">
              <button v-if="has(entry, 'track_skip')" type="button" class="key"
                      :disabled="!entry.state.available || !loaded(entry.state as StateFor<'media_player'>)"
                      :title="$t('media.previous')" :aria-label="$t('media.previous')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'media_player.previous' })">
                <StrokeIcon name="skipPrev" :size="18" />
              </button>
              <button type="button" class="key key--main"
                      :disabled="!entry.state.available || !loaded(entry.state as StateFor<'media_player'>)"
                      :title="(entry.state as StateFor<'media_player'>).playback === 'playing' ? $t('common.pause') : $t('media.play')"
                      :aria-label="(entry.state as StateFor<'media_player'>).playback === 'playing' ? $t('common.pause') : $t('media.play')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: (entry.state as StateFor<'media_player'>).playback === 'playing' ? 'media_player.pause' : 'media_player.play' })">
                <StrokeIcon :name="(entry.state as StateFor<'media_player'>).playback === 'playing' ? 'pause' : 'play'" :size="18" />
              </button>
              <button v-if="has(entry, 'track_skip')" type="button" class="key"
                      :disabled="!entry.state.available || !loaded(entry.state as StateFor<'media_player'>)"
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
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); }
.count { font-size: 13px; }
.empty { padding: 24px; text-align: center; }
.controls { grid-column: 1 / -1; display: flex; align-items: center; gap: 14px; margin: 2px 4px 0; }
.controls__slider { flex: 1 1 auto; }
.pct { font-size: 12px; width: 4ch; text-align: right; flex: 0 0 auto; }
.dot { margin-right: 6px; color: var(--accent); }
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
