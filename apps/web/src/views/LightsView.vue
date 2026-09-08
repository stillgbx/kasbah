<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceEntry, StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { statusLabel } from '../lib/deviceState'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'

// Vue Lumières : toutes les lampes remontées par les plugins, groupées par pièce, avec leur
// statut de liaison au JSON (placée / auto-placée / non placée) et un contrôle rapide.
// Sert aussi de diagnostic : les liaisons mortes du JSON (deviceId qu'aucun plugin ne remonte).
const devices = useDevicesStore()
const house = useHouseStore()
const { t, locale } = useI18n()

type LightEntry = DeviceEntry & { state: StateFor<'light'> }
type Origin = 'json' | 'auto' | 'unplaced'

interface Row {
  id: string
  name: string
  origin: Origin
  on: boolean
  available: boolean
  status: string
  brightness: number | undefined
}
interface Group { key: string; title: string; sub: string; rows: Row[] }

const lights = computed(() => devices.list.filter((e): e is LightEntry => e.state.kind === 'light'))
const onCount = computed(() => lights.value.filter((e) => e.state.on && e.state.available).length)

/** Rang du groupe : pièces de la maison dans l'ordre des niveaux, puis pièces de plugin, puis rien. */
function roomRank(roomId: string | null): number {
  if (!roomId) return 2_000_000
  const idx = house.index
  const room = idx?.roomsById.get(roomId)
  if (!room || !idx) return 1_000_000
  const level = idx.levelsSorted.findIndex((l) => l.id === room.levelId)
  return level * 1000 + idx.roomsByLevel.get(room.levelId)!.findIndex((r) => r.id === room.id)
}

const groups = computed<Group[]>(() => {
  const idx = house.index
  const acc = new Map<string, Group & { rank: number }>()
  for (const e of lights.value) {
    const hd = idx?.devicesByBinding.get(e.descriptor.id)
    const room = hd?.roomId ? idx?.roomsById.get(hd.roomId) : undefined
    const key = room ? `room:${room.id}` : `plugin:${e.descriptor.meta.room ?? ''}`
    let g = acc.get(key)
    if (!g) {
      g = room
        ? { key, title: room.name, sub: idx?.levelsById.get(room.levelId)?.name ?? '', rows: [], rank: roomRank(room.id) }
        : { key, title: e.descriptor.meta.room ?? t('lights.noRoom'), sub: t('lights.notInHouse'), rows: [], rank: e.descriptor.meta.room ? 1_000_000 : 2_000_000 }
      acc.set(key, g)
    }
    g.rows.push({
      id: e.descriptor.id,
      name: hd?.name ?? e.descriptor.name,
      origin: hd ? (hd.meta?.autoPlaced ? 'auto' : 'json') : 'unplaced',
      on: e.state.on && e.state.available,
      available: e.state.available,
      status: statusLabel(e.descriptor, e.state, t, locale.value),
      brightness: e.descriptor.capabilities.includes('brightness') ? e.state.brightness ?? 100 : undefined,
    })
  }
  return [...acc.values()]
    .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title))
    .map((g) => ({ ...g, rows: g.rows.sort((a, b) => a.name.localeCompare(b.name)) }))
})

/** Appareils du JSON dont le `deviceId` n'est remonté par aucun plugin (lampes ou kind absent). */
const dangling = computed(() => {
  const h = house.effective
  if (!h) return []
  return h.devices.filter((d) => d.deviceId && !devices.descriptors[d.deviceId] && (d.kind === 'light' || d.kind === undefined))
})

// Valeur locale pendant le glissement, effacée dès que la commande est partie (l'état reprend la main).
const draft = ref<Record<string, number>>({})
const level = (r: Row) => draft.value[r.id] ?? r.brightness ?? 100
function drag(id: string, v: number) { draft.value = { ...draft.value, [id]: v } }
function commit(id: string, v: number) {
  void devices.sendCommand(id, { type: 'light.set', brightness: Math.round(v) })
  const next = { ...draft.value }
  delete next[id]
  draft.value = next
}
</script>

<template>
  <div class="lights">
    <PageHeader>
      <div class="muted count">{{ $t('lights.summary', { on: onCount, total: lights.length }) }}</div>
    </PageHeader>
    <div class="lights__scroll">
      <div v-if="lights.length === 0" class="card card--soft empty muted">{{ $t('lights.none') }}</div>
      <div class="cards">
        <section v-for="g in groups" :key="g.key" class="card group">
          <div class="group__head">
            <div class="group__title">{{ g.title }}</div>
            <div class="muted group__sub">{{ g.sub }}</div>
          </div>
          <div v-for="r in g.rows" :key="r.id" class="row">
            <span class="icon-square" :data-on="r.on ? '1' : '0'"><StrokeIcon name="light" :size="18" /></span>
            <div class="min0">
              <div class="row__name">{{ r.name }}</div>
              <div class="muted row__status">{{ r.status }}</div>
            </div>
            <span class="badge" :data-kind="r.origin" :title="$t(`lights.origins.${r.origin}Hint`)">{{ $t(`lights.origins.${r.origin}`) }}</span>
            <v-switch :model-value="r.on" :disabled="!r.available" density="compact" hide-details class="row__switch"
                      @update:model-value="devices.sendCommand(r.id, { type: 'light.set', on: !r.on })" />
            <v-slider v-if="r.brightness !== undefined && r.on" :model-value="level(r)" :min="1" :max="100" :step="1"
                      density="compact" hide-details class="row__slider"
                      @update:model-value="(v: number) => drag(r.id, v)" @end="(v: number) => commit(r.id, v)" />
          </div>
        </section>

        <section v-if="dangling.length" class="card group">
          <div class="group__head">
            <div class="group__title">{{ $t('lights.dangling') }}</div>
            <div class="muted group__sub">{{ $t('lights.danglingHint') }}</div>
          </div>
          <div v-for="d in dangling" :key="d.id" class="row row--dead">
            <span class="icon-square"><StrokeIcon name="link" :size="18" /></span>
            <div class="min0">
              <div class="row__name">{{ d.name ?? d.id }}</div>
              <div class="muted row__status mono">{{ d.deviceId }}</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lights { height: 100%; display: flex; flex-direction: column; }
.lights__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); }
.count { font-size: 13px; }
.empty { padding: 24px; text-align: center; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; align-items: start; }
.group { padding: 16px 20px; display: grid; gap: 2px; align-content: start; }
.group__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.group__title { font-weight: 600; font-size: 15px; }
.group__sub { font-size: 12px; }
.row {
  display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; column-gap: 12px;
  padding: 10px 0; border-top: 1px solid var(--line);
}
.row--dead { opacity: .7; }
.row__name { font-weight: 500; font-size: 14px; }
.row__status { font-size: 12px; }
.min0 { min-width: 0; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.row__switch { flex: 0 0 auto; }
.row__slider { grid-column: 1 / -1; margin: 0 4px; }
.badge {
  font-size: 10px; letter-spacing: .04em; text-transform: uppercase; padding: 3px 7px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--muted); white-space: nowrap;
}
.badge[data-kind='auto'] { border-color: transparent; background: var(--accent-soft); color: var(--accent); }
.badge[data-kind='unplaced'] { border-color: #d38b22; color: #d38b22; }
</style>
